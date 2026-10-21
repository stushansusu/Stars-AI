/* Stars-AI · 探针：把「选区外保持原样」从 Photoshop 搬到 ComfyUI（0.7.17 验证用）
 * ------------------------------------------------------------------
 * 不改任何面板代码，单独跑。要回答三个问题：
 *   1) LoadImageMask → JoinImageWithAlpha 能不能产出「选区外全透明」的 PNG？
 *      （如果能，PS 那边就不用「反选 + Dlt」了 —— 那正是「选区外一片红」的唯一来源）
 *   2) Qwen 回来的尺寸能不能无损映回 crop 尺寸（ImageScale 拉回 W×H）？
 *   3) 接缝长什么样？会顺手合一张「叠在原图上」的预览图，肉眼判断。
 *
 *   node tools/probe-mask-alpha.js
 *   node tools/probe-mask-alpha.js --src "D:\x\crop.png" --steps 20 --resolution 1024 --feather 64
 *
 * 产物：_e2e/probe/ 下的 probe_out_alpha.png（带 alpha）/ probe_seam.png（叠图）/ report.json
 */
global.window = global;
require("../js/comfy.js");
require("../js/workflows.js");
require("../js/png.js");

const fs = require("fs");
const path = require("path");
const { ComfyClient } = global.StarsComfy;
const Flow = global.StarsFlow;
const Png = global.StarsPng;

const SERVER = process.env.COMFY || "http://127.0.0.1:8188";
const OUT = path.resolve(__dirname, "..", "_e2e", "probe");

function argv(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function pickDefaultSrc() {
  const dir = path.join(process.env.LOCALAPPDATA || "", "Temp", "Stars-AI");
  try {
    const cands = fs.readdirSync(dir)
      .filter((n) => /^src_.*\.png$/i.test(n))
      .map((n) => {
        const full = path.join(dir, n);
        const st = fs.statSync(full);
        return { full, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (cands.length) return cands[0].full;
  } catch (e) {}
  const fallback = path.resolve(__dirname, "..", "docs", "demo-edit.png");
  return fs.existsSync(fallback) ? fallback : "";
}

/* 造一张「白 = 重绘区」的羽化蒙版（和 PS 的 exportMask 约定一致：白 255 = 要重绘） */
function buildMask(w, h, feather) {
  const data = Buffer.alloc(w * h * 4);
  const cx = w / 2, cy = h / 2;
  const rw = w * 0.31, rh = h * 0.29;              // 选区半径（= 62% × 58%）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - cx) - rw;             // 到矩形边的有符号距离
      const dy = Math.abs(y - cy) - rh;
      const d = Math.max(dx, dy);                   // >0 在选区外
      let a;
      if (d <= 0) a = 255;
      else if (d >= feather) a = 0;
      else a = Math.round(255 * (1 - d / feather)); // 线性羽化（PS 的 feather 也是高斯→近似线性）
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function buildGraph(ctx) {
  const g = {};
  g["10"] = { class_type: "UNETLoader", inputs: { unet_name: ctx.models.unet, weight_dtype: "default" } };
  let model = ["10", 0];
  if (ctx.models.lora) {
    g["11"] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: ctx.models.lora, strength_model: 1 } };
    model = ["11", 0];
  }
  if (ctx.caps.QwenImage21Cache) {
    g["12"] = { class_type: "QwenImage21Cache", inputs: { model, device: "auto", dtype: "default" } };
    model = ["12", 0];
  }
  g["20"] = { class_type: "CLIPLoader", inputs: { clip_name: ctx.models.clip, type: "qwen_image" } };
  g["21"] = { class_type: "VAELoader", inputs: { vae_name: ctx.models.vae } };
  g["30"] = { class_type: "LoadImage", inputs: { image: ctx.srcName, upload: "image" } };
  g["40"] = {
    class_type: "TextEncodeQwenImage21",
    inputs: {
      clip: ["20", 0], prompt: ctx.prompt, negative_prompt: "",
      resolution: ctx.resolution, "images.image_1": ["30", 0], vae: ["21", 0]
    }
  };
  g["50"] = {
    class_type: "KSampler",
    inputs: {
      model, seed: ctx.seed, steps: ctx.steps, cfg: ctx.cfg,
      sampler_name: "euler", scheduler: "simple",
      positive: ["40", 0], negative: ["40", 1], latent_image: ["40", 2], denoise: 1.0
    }
  };
  g["60"] = { class_type: "VAEDecode", inputs: { samples: ["50", 0], vae: ["21", 0] } };
  // 拉回 crop 的像素尺寸：这样贴回 PS 时就是 1:1（连 resizeImage 都不需要）
  g["70"] = {
    class_type: "ImageScale",
    inputs: { image: ["60", 0], upscale_method: "lanczos", width: ctx.w, height: ctx.h, crop: "disabled" }
  };
  g["31"] = { class_type: "LoadImageMask", inputs: { image: ctx.maskName, channel: "red" } };
  /* 坑（实测 + 源码确认）：JoinImageWithAlpha 内部是 alpha = 1.0 - mask
   * （comfy_extras/nodes_compositing.py:207），和「白 = 重绘」的直觉正好相反。
   * 所以这里补一个 InvertMask，PS 那边就仍然可以按 exportMask 的老约定（白 = 重绘）出图，
   * SD 的 VAEEncodeForInpaint 分支也不用改。 */
  g["32"] = { class_type: "InvertMask", inputs: { mask: ["31", 0] } };
  g["80"] = { class_type: "JoinImageWithAlpha", inputs: { image: ["70", 0], alpha: ["32", 0] } };
  g["90"] = { class_type: "SaveImage", inputs: { filename_prefix: "StarsAI/probe_alpha", images: ["80", 0] } };
  return g;
}

function pickImage(h) {
  const outs = (h && h.outputs) || {};
  for (const k of Object.keys(outs)) {
    const imgs = outs[k].images;
    if (imgs && imgs.length) return imgs[0];
  }
  throw new Error("没有图片输出");
}

function analyze(outBuf, srcImg) {
  const img = Png.decode(outBuf);
  const w = img.width, h = img.height, d = img.data;
  let full = 0, zero = 0, soft = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a === 255) full++;
    else if (a === 0) zero++;
    else soft++;
  }
  const total = w * h;
  const at = (x, y) => d[(y * w + x) * 4 + 3];
  const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
  const center = at(w >> 1, h >> 1);

  // 叠回原图看接缝：out = gen 按 alpha 盖在 src 上
  const seam = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = d[i + 3] / 255;
    for (let k = 0; k < 3; k++) seam[i + k] = Math.round(d[i + k] * a + srcImg.data[i + k] * (1 - a));
    seam[i + 3] = 255;
  }
  return {
    dims: { w, h },
    sizeMatch: w === srcImg.width && h === srcImg.height,
    alpha: { fullPct: +(full / total * 100).toFixed(2), zeroPct: +(zero / total * 100).toFixed(2), softPct: +(soft / total * 100).toFixed(2) },
    corners, center,
    seamImg: { width: w, height: h, data: seam }
  };
}

(async () => {
  const srcPath = argv("src", "") || pickDefaultSrc();
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error("找不到素材图，用 --src 指定一张");
  const steps = parseInt(argv("steps", "20"), 10);
  const resolution = parseInt(argv("resolution", "1024"), 10);
  const feather = parseInt(argv("feather", "64"), 10);
  const prompt = argv("prompt", "提升清晰度与细节质感，保持构图、颜色和光线完全不变");

  fs.mkdirSync(OUT, { recursive: true });
  const srcBuf = fs.readFileSync(srcPath);
  const srcImg = Png.decode(srcBuf);

  // crop 尺寸对齐到 32 的倍数：Qwen 的参考图按 32 取整，先对齐免得回来对不上
  const w = Math.max(64, Math.floor(srcImg.width / 32) * 32) - 0;
  const h = Math.max(64, Math.floor(srcImg.height / 32) * 32) - 0;
  console.log("→ 素材 " + srcPath + "  " + srcImg.width + "×" + srcImg.height + " → 对齐 32 后 " + w + "×" + h);

  // 居中裁到 32 的倍数，写一份 crop_src.png 当输入
  const cropped = Buffer.alloc(w * h * 4);
  const offX = Math.floor((srcImg.width - w) / 2), offY = Math.floor((srcImg.height - h) / 2);
  for (let y = 0; y < h; y++) {
    srcImg.data.copy(cropped, y * w * 4, ((y + offY) * srcImg.width + offX) * 4, ((y + offY) * srcImg.width + offX + w) * 4);
  }
  const cropImg = { width: w, height: h, data: cropped };
  const cropPath = path.join(OUT, "probe_crop_src.png");
  fs.writeFileSync(cropPath, Png.encode(cropImg));

  const maskImg = buildMask(w, h, feather);
  const maskPath = path.join(OUT, "probe_mask.png");
  fs.writeFileSync(maskPath, Png.encode(maskImg));
  console.log("→ 蒙版 " + w + "×" + h + " · 羽化 " + feather + "px · " + maskPath);

  const c = new ComfyClient(SERVER);
  const info = await c.ping();
  console.log("→ ComfyUI " + info.version + " · " + info.device);
  const caps = await c.probe();
  const models = Flow.guess(caps, "qwen");
  if (!models.unet || !models.clip || !models.vae) throw new Error("模型匹配失败");
  console.log("→ 模型 " + models.unet + " / " + models.clip + " / " + models.vae);

  const ts = Date.now();
  const up = await c.upload(cropPath, "starsai_probe_src_" + ts + ".png");
  const upm = await c.upload(maskPath, "starsai_probe_mask_" + ts + ".png");
  console.log("→ 上传 " + up.name + " + " + upm.name);

  let graph = buildGraph({
    caps, models, w, h, steps, resolution, seed: 1234567, cfg: 1,
    srcName: up.name, maskName: upm.name, prompt
  });
  /* --via-flow：不走手写图，改走**面板真正用的** Flow.build，
   * 这样验的就是生产代码（workflows.js 里 alphaCut 分支）本身，而不是另一份等价实现。 */
  const viaFlow = process.argv.includes("--via-flow");
  if (viaFlow) {
    graph = Flow.build({
      mode: "inpaint", arch: "qwen", caps, models,
      prompt, negative: "", seed: 1234567, steps, cfg: 1,
      sampler: "euler", scheduler: "simple",
      resolution, width: w, height: h, denoise: 1,
      imageName: up.name, maskName: upm.name,
      alphaCut: true, cropW: w, cropH: h
    });
    const keys = Object.keys(graph);
    const has = (t) => keys.some((k) => graph[k].class_type === t);
    console.log("→ 走生产代码 Flow.build：节点 " + keys.length +
      " · ImageScale " + (has("ImageScale") ? "✓" : "✗") +
      " · LoadImageMask " + (has("LoadImageMask") ? "✓" : "✗") +
      " · InvertMask " + (has("InvertMask") ? "✓" : "✗") +
      " · JoinImageWithAlpha " + (has("JoinImageWithAlpha") ? "✓" : "✗"));
    if (!has("JoinImageWithAlpha")) throw new Error("Flow.build 没生成 alpha 合成节点！");
  }
  console.log("→ 提交（" + Object.keys(graph).length + " 节点 · " + steps + " 步 · resolution " + resolution + "）");
  const t0 = Date.now();
  const pid = await c.submit(graph);
  const hist = await c.waitFor(pid, (s, q) => process.stdout.write("\r  " + s.toFixed(0) + "s " + (q && q.running ? "运行中" : "排队") + "   "));
  const view = pickImage(hist);
  const outPath = path.join(OUT, "probe_out_alpha.png");
  await c.download(view, outPath);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log("\r✓ 出图 " + secs + "s → " + outPath);

  const outBuf = fs.readFileSync(outPath);
  const rep = analyze(outBuf, cropImg);
  const seamPath = path.join(OUT, "probe_seam.png");
  fs.writeFileSync(seamPath, Png.encode(rep.seamImg));

  const report = {
    src: srcPath, cropPath, maskPath, outPath, seamPath,
    steps, resolution, feather, seconds: +secs,
    srcDims: { w, h }, outDims: rep.dims, sizeMatch: rep.sizeMatch,
    alpha: rep.alpha, corners: rep.corners, centerAlpha: rep.center,
    verdict: {
      alphaOK: rep.corners.every((a) => a === 0) && rep.center === 255,
      sizeOK: rep.sizeMatch
    }
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n—— 结论 ——");
  console.log("  尺寸      : " + rep.dims.w + "×" + rep.dims.h + (rep.sizeMatch ? " ✓ 与 crop 一致" : " ✗ 与 crop 不一致"));
  console.log("  alpha     : 全不透明 " + rep.alpha.fullPct + "% · 全透明 " + rep.alpha.zeroPct + "% · 羽化带 " + rep.alpha.softPct + "%");
  console.log("  四角 alpha: " + rep.corners.join(",") + (rep.corners.every((a) => a === 0) ? "  ✓ 选区外 = 透明" : "  ✗ 四角不是全透明"));
  console.log("  中心 alpha: " + rep.center + (rep.center === 255 ? "  ✓ 选区内 = 不透明" : "  ✗"));
  console.log("  接缝预览  : " + seamPath);
  console.log("  结论      : " + (report.verdict.alphaOK && report.verdict.sizeOK ? "链路可用 ✓" : "有问题，看 report.json"));
})().catch((e) => {
  console.error("\n✗ 失败：" + (e && e.message));
  process.exit(1);
});

/* Stars-AI · 命令行自检（不需要打开 Photoshop）
 * 直接复用插件里真实的 comfy.js / workflows.js，验证：
 *   1) 能否连上 ComfyUI、读模型、自动匹配模型
 *   2) 图生图（qwen 指令修图）工作流能否出图
 *   3) 放大工作流能否出图（需要本机有放大模型）
 *
 *   node tools/e2e-test.js "D:\path\test.png"
 */
global.window = global;
require("../js/comfy.js");
require("../js/workflows.js");

const fs = require("fs");
const path = require("path");
const { ComfyClient } = global.StarsComfy;
const Flow = global.StarsFlow;

const SERVER = process.env.COMFY || "http://127.0.0.1:8188";
const src = process.argv[2];
const OUT = path.resolve(__dirname, "..", "_e2e");

(async () => {
  const c = new ComfyClient(SERVER);
  console.log("→ 连接", SERVER);
  const info = await c.ping();
  console.log("  ComfyUI", info.version, "·", info.device);

  const caps = await c.probe();
  const models = Flow.guess(caps);
  console.log("→ 自动匹配模型", models);
  if (!models.unet || !models.clip || !models.vae) throw new Error("模型匹配失败，请检查 ComfyUI 模型目录");

  fs.mkdirSync(OUT, { recursive: true });
  let image = null;
  if (src) {
    const up = await c.upload(src, "starsai_e2e_src.png");
    image = up.name;
    console.log("→ 上传参考图", image);
  }

  // ---- 图生图 ----
  if (image) {
    const graph = Flow.build({
      mode: "edit", arch: "qwen", caps,
      models: { unet: models.unet, clip: models.clip, vae: models.vae, lora: models.lora },
      prompt: "把画面改成水彩画风格，构图保持不变",
      negative: "", seed: 7, steps: 6, cfg: 1, sampler: "euler", scheduler: "simple",
      resolution: 768, width: 768, height: 768, denoise: 1, imageName: image
    });
    console.log("→ 提交图生图（" + Object.keys(graph).length + " 节点）");
    const t0 = Date.now();
    const pid = await c.submit(graph);
    const h = await c.waitFor(pid, (s, q) => process.stdout.write("\r  " + s.toFixed(0) + "s " + (q && q.running ? "运行中" : "排队") + "   "));
    const out = pickImage(h);
    const dest = path.join(OUT, "edit.png");
    await c.download(out, dest);
    console.log("\r✓ 图生图完成 " + ((Date.now() - t0) / 1000).toFixed(0) + "s → " + dest);
  }

  // ---- 放大 ----
  if (image && models.upscale) {
    const graph = Flow.build({
      mode: "upscale", arch: "qwen", caps,
      models: { upscale: models.upscale },
      prompt: "", negative: "", seed: 1, steps: 1, cfg: 1, sampler: "euler", scheduler: "simple",
      resolution: 1024, width: 1024, height: 1024, denoise: 1, imageName: image
    });
    console.log("→ 提交放大（" + models.upscale + "）");
    const pid = await c.submit(graph);
    const h = await c.waitFor(pid);
    const out = pickImage(h);
    const dest = path.join(OUT, "upscale.png");
    await c.download(out, dest);
    console.log("✓ 放大完成 → " + dest);
  } else if (!models.upscale) {
    console.log("· 跳过放大：本机没有放大模型（upscale_models 目录为空）");
  }

  console.log("全部通过 ✦");
})().catch((e) => {
  console.error("\n✗ 失败：" + e.message);
  process.exit(1);
});

function pickImage(h) {
  const outs = (h && h.outputs) || {};
  for (const k of Object.keys(outs)) {
    const imgs = outs[k].images;
    if (imgs && imgs.length) return imgs[0];
  }
  throw new Error("没有图片输出");
}

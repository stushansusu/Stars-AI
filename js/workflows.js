/* Stars-AI · 工作流图构建
 * 全部图都按 ComfyUI API 格式（/prompt 接受的 prompt 字段）生成，
 * 并且已在本机 ComfyUI 0.41.3 上实测：qwen 文生图 / qwen 参考图编辑 / RealESRGAN 放大。
 */
(function (global) {
  "use strict";

  var PREFIX = "StarsAI";

  function qwenGraph(ctx) {
    var g = {};
    g["10"] = { class_type: "UNETLoader", inputs: { unet_name: ctx.models.unet, weight_dtype: "default" } };
    var model = ["10", 0];
    if (ctx.models.lora) {
      g["11"] = { class_type: "LoraLoaderModelOnly", inputs: { model: model, lora_name: ctx.models.lora, strength_model: ctx.models.loraStrength == null ? 1 : ctx.models.loraStrength } };
      model = ["11", 0];
    }
    if (ctx.caps.QwenImage21Cache) {
      g["12"] = { class_type: "QwenImage21Cache", inputs: { model: model, device: "auto", dtype: "default" } };
      model = ["12", 0];
    }
    g["20"] = { class_type: "CLIPLoader", inputs: { clip_name: ctx.models.clip, type: "qwen_image" } };
    g["21"] = { class_type: "VAELoader", inputs: { vae_name: ctx.models.vae } };

    var enc = {
      clip: ["20", 0],
      prompt: ctx.prompt,
      negative_prompt: ctx.negative || "",
      resolution: ctx.resolution,
      vae: ["21", 0]
    };
    if (ctx.imageName) {
      g["30"] = { class_type: "LoadImage", inputs: { image: ctx.imageName, upload: "image" } };
      // TextEncodeQwenImage21 的参考图是 autogrow 输入：API 里必须写成点号键 images.image_1
      // （写成数组或嵌套对象都会被静默忽略，等于退化成文生图——这是实测踩到的坑）
      enc["images.image_1"] = ["30", 0];
      if (ctx.secondName) {   // 第二张参考图（人物溶图时的背景图）
        g["31"] = { class_type: "LoadImage", inputs: { image: ctx.secondName, upload: "image" } };
        enc["images.image_2"] = ["31", 0];
      }
    }
    g["40"] = { class_type: "TextEncodeQwenImage21", inputs: enc };
    g["50"] = {
      class_type: "KSampler",
      inputs: {
        model: model, seed: ctx.seed, steps: ctx.steps, cfg: ctx.cfg,
        sampler_name: ctx.sampler, scheduler: ctx.scheduler,
        positive: ["40", 0], negative: ["40", 1], latent_image: ["40", 2],
        denoise: 1.0
      }
    };
    g["60"] = { class_type: "VAEDecode", inputs: { samples: ["50", 0], vae: ["21", 0] } };

    /* 局部重绘（0.7.19）：用 PS 导出的羽化蒙版在 ComfyUI 里合成 alpha。
     * 出的图「选区外 alpha = 0」，贴回 PS 时就是个普通图层 ——
     * 不再需要「反选 + Dlt」（实测 PS 27.10 报「命令"删除"当前不可用」），
     * 也就不会再把背景层填成红色。
     * 坑：JoinImageWithAlpha 内部是 alpha = 1 - mask（nodes_compositing.py:207），
     * 所以这里必须先 InvertMask，否则四角不透明、中心透明（第一次接反就是这个结果）。 */
    var imageRef = ["60", 0];
    if (ctx.alphaCut && ctx.maskName) {
      var src = ["60", 0];
      if (ctx.cropW && ctx.cropH) {
        // 模型按 resolution 面积出图，尺寸不一定等于送进去的 crop → 先拉回精确尺寸
        g["61"] = {
          class_type: "ImageScale",
          inputs: { image: ["60", 0], upscale_method: "lanczos", width: ctx.cropW, height: ctx.cropH, crop: "disabled" }
        };
        src = ["61", 0];
      }
      g["62"] = { class_type: "LoadImageMask", inputs: { image: ctx.maskName, channel: "red" } };
      g["63"] = { class_type: "InvertMask", inputs: { mask: ["62", 0] } };
      g["64"] = { class_type: "JoinImageWithAlpha", inputs: { image: src, alpha: ["63", 0] } };
      imageRef = ["64", 0];
    }
    if (ctx.cutout && ctx.models.bgRemoval &&
        ctx.caps.LoadBackgroundRemovalModel && ctx.caps.RemoveBackground &&
        ctx.caps.JoinImageWithAlpha && ctx.caps.InvertMask) {
      g["80"] = { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: ctx.models.bgRemoval } };
      g["90"] = { class_type: "RemoveBackground", inputs: { bg_removal_model: ["80", 0], image: ["60", 0] } };
      // JoinImageWithAlpha 内部会做 alpha = 1 - mask，所以这里再反一次，前景才是不透明的那部分
      g["92"] = { class_type: "InvertMask", inputs: { mask: ["90", 0] } };
      g["91"] = { class_type: "JoinImageWithAlpha", inputs: { image: ["60", 0], alpha: ["92", 0] } };
      imageRef = ["91", 0];
      ctx.usedBgRemoval = true;
    }

    g["70"] = { class_type: "SaveImage", inputs: { filename_prefix: PREFIX + "/qwen_" + ctx.mode, images: imageRef } };
    return g;
  }

  function sdGraph(ctx) {
    var g = {};
    g["10"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ctx.models.ckpt } };
    g["20"] = { class_type: "CLIPTextEncode", inputs: { text: ctx.prompt, clip: ["10", 1] } };
    g["21"] = { class_type: "CLIPTextEncode", inputs: { text: ctx.negative || "", clip: ["10", 1] } };

    if (ctx.imageName) {
      g["30"] = { class_type: "LoadImage", inputs: { image: ctx.imageName, upload: "image" } };
      if (ctx.mode === "inpaint" && ctx.maskName) {
        g["31"] = { class_type: "LoadImage", inputs: { image: ctx.maskName, upload: "image" } };
        g["32"] = { class_type: "ImageToMask", inputs: { image: ["31", 0], channel: "red" } };
        g["33"] = { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["30", 0], vae: ["10", 2], mask: ["32", 0], grow_mask_by: ctx.growMask || 6 } };
      } else {
        g["33"] = { class_type: "VAEEncode", inputs: { pixels: ["30", 0], vae: ["10", 2] } };
      }
    } else {
      g["30"] = { class_type: "EmptyLatentImage", inputs: { width: ctx.width, height: ctx.height, batch_size: 1 } };
    }

    var latent = ctx.imageName ? ["33", 0] : ["30", 0];
    g["50"] = {
      class_type: "KSampler",
      inputs: {
        model: ["10", 0], seed: ctx.seed, steps: ctx.steps, cfg: ctx.cfg,
        sampler_name: ctx.sampler, scheduler: ctx.scheduler,
        positive: ["20", 0], negative: ["21", 0], latent_image: latent,
        denoise: ctx.mode === "txt2img" ? 1.0 : ctx.denoise
      }
    };
    g["60"] = { class_type: "VAEDecode", inputs: { samples: ["50", 0], vae: ["10", 2] } };
    g["70"] = { class_type: "SaveImage", inputs: { filename_prefix: PREFIX + "/sd_" + ctx.mode, images: ["60", 0] } };
    return g;
  }

  function upscaleGraph(ctx) {
    var g = {};
    g["30"] = { class_type: "LoadImage", inputs: { image: ctx.imageName, upload: "image" } };
    g["80"] = { class_type: "UpscaleModelLoader", inputs: { model_name: ctx.models.upscale } };
    g["81"] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["80", 0], image: ["30", 0] } };
    g["82"] = {
      class_type: "ImageScale",
      inputs: { image: ["81", 0], upscale_method: "lanczos", width: ctx.width, height: ctx.height, crop: "disabled" }
    };
    g["70"] = { class_type: "SaveImage", inputs: { filename_prefix: PREFIX + "/upscale", images: ["82", 0] } };
    return g;
  }

  // 自定义工作流：{{prompt}} {{negative}} {{seed}} {{steps}} {{cfg}} {{sampler}} {{scheduler}}
  // {{width}} {{height}} {{denoise}} {{image}} {{mask}} {{ckpt}} {{model}} {{vae}} {{clip}} {{lora}} {{upscale_model}} {{resolution}}
  function fillTokens(node, ctx, key) {
    if (Array.isArray(node)) return node.map(function (v, i) { return fillTokens(v, ctx, key); });
    if (node && typeof node === "object") {
      var out = {};
      Object.keys(node).forEach(function (k) { out[k] = fillTokens(node[k], ctx, k); });
      return out;
    }
    if (typeof node === "string" && node.indexOf("{{") !== -1) {
      var replaced = node.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function (m, name) {
        var v = ctx.tokens[name];
        return v === undefined || v === null ? m : String(v);
      });
      return replaced;
    }
    return node;
  }

  function customGraph(ctx) {
    var tpl = ctx.template;
    if (!tpl || !tpl.nodes) throw new Error("自定义工作流 JSON 无效：缺少 nodes 字段");
    var tokens = {
      prompt: ctx.prompt, negative: ctx.negative || "", seed: ctx.seed, steps: ctx.steps,
      cfg: ctx.cfg, sampler: ctx.sampler, scheduler: ctx.scheduler, width: ctx.width,
      height: ctx.height, denoise: ctx.denoise, image: ctx.imageName || "",
      mask: ctx.maskName || "", ckpt: ctx.models.ckpt || "", model: ctx.models.unet || "",
      vae: ctx.models.vae || "", clip: ctx.models.clip || "", lora: ctx.models.lora || "",
      upscale_model: ctx.models.upscale || "", resolution: ctx.resolution
    };
    var local = Object.assign({}, ctx, { tokens: tokens });
    return fillTokens(tpl.nodes, local);
  }

  function build(src) {
    // 统一兜底，避免 undefined 直接进图（注意不要覆盖调用方的对象：要回写 usedBgRemoval 标记）
    var ctx = Object.assign({
      prompt: "", negative: "", seed: 0, steps: 20, cfg: 7, sampler: "euler",
      scheduler: "simple", width: 1024, height: 1024, resolution: 1024, denoise: 0.6,
      modes: {}, models: {}, caps: {}
    }, src);

    var graph;
    if (ctx.mode === "custom") graph = customGraph(ctx);
    else if (ctx.mode === "upscale") graph = upscaleGraph(ctx);
    else if (ctx.arch === "qwen") graph = qwenGraph(ctx);
    else graph = sdGraph(ctx);

    // 把"用了 BiRefNet 直出 alpha"这个事实回写给调用方
    if (src && ctx.usedBgRemoval) src.usedBgRemoval = true;
    return graph;
  }

  /* ---------- 模型自动匹配 ----------
   * 不写死文件名：用「文件名 token 重合度 + 家族关键词 + 排除词」打分，
   * 这样换机器、换量化版本也能猜对（例如 8B 文本编码器 vs 32B 视频编码器）。
   */
  function tokensOf(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/, "")
      .split(/[^a-z0-9.]+/)
      .filter(function (t) { return t && t.length > 1; });
  }

  function scoreName(name, refTokens, prefer, avoid) {
    var s = 0;
    var tn = tokensOf(name);
    refTokens.forEach(function (t) { if (tn.indexOf(t) !== -1) s += 2; });
    (prefer || []).forEach(function (re) { if (re.test(name)) s += 3; });
    (avoid || []).forEach(function (re) { if (re.test(name)) s -= 5; });
    return s;
  }

  // minScore：最高分不达标就当"没匹配上"返回 ""（默认 -5 = 只要不是纯排除词命中就行）
  function bestOf(list, refTokens, prefer, avoid, minScore) {
    if (!list || !list.length) return "";
    var floor = minScore === undefined ? -5 : minScore;
    var scored = list.map(function (n) { return { n: n, s: scoreName(n, refTokens, prefer, avoid) }; });
    scored.sort(function (a, b) { return (b.s - a.s) || (a.n.length - b.n.length); });
    return scored[0].s > floor ? scored[0].n : "";
  }

  // diffusion_models 里常见的"不是本面板用的架构"的模型（视频 / 其它架构）：
  // 以前 avoid 扣的分被死代码吞掉，只要有任意一个文件就会被误判成 qwen 架构
  var AVOID_UNET = [/minimax/i, /video/i, /fl2va/i, /t2v/i, /i2v/i, /wan/i, /hunyuan/i,
                    /ltxv/i, /mochi/i, /cosmos/i, /sd3/i, /flux/i, /ideogram/i];

  function guess(caps, arch) {
    var o = caps.options || {};
    // 装了 uncensored LoRA 的人，通常也想用对应的 uncensored 主模型；否则优先基础版
    var wantsUC = (o.lora || []).some(function (n) { return /uncensor|(^|[-_ ])uc([-_ ]|$)/i.test(n); });
    var unetPrefer = wantsUC ? [/uncensor|(^|[-_ ])uc([-_ ]|$)/i, /qwen[-_ ]?image/i] : [/qwen[-_ ]?image/i];
    var unet = bestOf(o.unet, [], unetPrefer, AVOID_UNET, 0);   // 0 = 必须命中至少一个正向词
    var result = { arch: arch || (unet ? "qwen" : "sd") };
    var ref = tokensOf(unet);

    if (result.arch === "qwen") {
      result.unet = unet || (o.unet || [])[0] || "";
      result.clip = bestOf(o.clip, ref, [/qwen[-_]?3vl/i, /8b/i], [/minimax/i, /\bh3\b/i, /32b/i, /video/i]);
      result.vae = bestOf(o.vae, ref, [/qwen[-_ ]?image/i], [/minimax/i, /audio/i, /\bh3\b/i, /video/i]);
      var loras = (o.lora || []).filter(function (n) {
        var tn = tokensOf(n);
        return ref.some(function (t) { return tn.indexOf(t) !== -1; });
      });
      result.lora = loras.length === 1 ? loras[0] : "";
      result.ckpt = "";
    } else {
      result.unet = "";
      result.ckpt = bestOf(o.ckpt, [], [/sd|xl|flux|real/i], [/inpaint/i]) || (o.ckpt || [])[0] || "";
    }
    result.upscale = bestOf(o.upscale, [], [/realesrgan/i, /x4/i], [/anime/i]) || (o.upscale || [])[0] || "";
    return result;
  }

  function pick(list, patterns) {
    if (!list || !list.length) return "";
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < list.length; j++) {
        if (patterns[i].test(list[j])) return list[j];
      }
    }
    return "";
  }

  global.StarsFlow = { build: build, guess: guess, pick: pick };
})(window);

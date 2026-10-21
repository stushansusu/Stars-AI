/* Stars-AI · 面板主逻辑 */
(function () {
  "use strict";

  var PS = window.StarsPS;
  var Flow = window.StarsFlow;
  var Comfy = window.StarsComfy;
  var Presets = window.StarsPresets;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }
  function clamp(v, a, b) { v = Number(v); if (isNaN(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function randInt() { return Math.floor(Math.random() * 2147483647); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hhmmss() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }

  var LS_KEY = "starsai.cfg.v1";
  // NSFW 免责条款的同意记录单独存：不跟着「恢复默认参数」一起清掉，
  // 但在 NSFW 工坊里可以随时点「锁定」撤回
  var NSFW_KEY = "starsai.nsfw.ack.v1";

  var MODES = {
    txt2img: {
      label: "文生图",
      hint: "<b>纯文字出图</b>：Qwen 是方形输出（分辨率=边长），SD 可自定义宽高。",
      placeholder: "例：极简产品主视觉，白色陶瓷杯，柔和侧光，浅灰背景",
      chips: ["极简产品主视觉，柔和侧光", "雨后街道，日系胶片感", "白色陶瓷杯，晨光，静物摄影", "深色背景上的悬浮水晶，电影光"]
    },
    edit: {
      label: "图生图",
      hint: "<b>指令修图</b>：以当前画布为参考，说清「要改成什么样」，没提到的尽量保持。",
      placeholder: "例：把背景换成雨夜的霓虹街道，保留人物姿势和光线",
      chips: ["把背景换成纯白", "去掉画面里多余的路人", "换成水彩画风", "把衣服换成米白色针织开衫", "提升清晰度和质感", "改成夜晚霓虹灯氛围"]
    },
    inpaint: {
      label: "局部重绘",
      hint: "<b>先框选</b>要改的区域。<b>Qwen 看不到选区</b>，所以提示词要写清「这块该变成什么」——面板会把选区位置/占比自动补进提示词。合成时只保留选区内像素（按羽化过渡），选区外保持原样不动。",
      placeholder: "例：把选区内的花瓶替换成一束干花",
      chips: ["替换成一束干花", "修掉这块的瑕疵与污点", "补全被遮挡的边缘", "换成玻璃材质"]
    },
    upscale: {
      label: "放大",
      hint: "用本机<b>放大模型</b>（RealESRGAN 等）放大当前文档，按目标尺寸插入新图层。",
      placeholder: "（放大模式不需要提示词）",
      chips: []
    },
    custom: {
      label: "自定义",
      hint: "导入 ComfyUI <b>API 格式</b> JSON；用 {{prompt}} {{image}} {{seed}} 等占位符传参。",
      placeholder: "（占位符会替换进 JSON 的字符串字段）",
      chips: []
    }
  };

  var BUILD = "0.7.40";

  /* 显存档位 → 推荐参数（设置里的「显卡 / 显存 → 推荐参数」表就是这张表）。
   * 依据：Qwen-Image 2.1 int8 在 8G 上 1024 稳、1280 起就危险；SD/SDXL 同分辨率更省。 */
  var TIERS = [
    { id: "x6", max: 6, label: "≤6G", resolution: 768, steps: 20, maxEdge: 1536, timeout: 20, note: "只跑 int8 量化，别碰 1024 以上" },
    { id: "x8", max: 9, label: "6–9G（8G 档）", resolution: 1024, steps: 30, maxEdge: 2048, timeout: 15, note: "int8 主力档；上 1280/1536 很容易把进程逼退" },
    { id: "x12", max: 15, label: "10–15G", resolution: 1280, steps: 30, maxEdge: 2560, timeout: 15, note: "可上 1280；放大目标别超 4096" },
    { id: "x16", max: 23, label: "16–23G", resolution: 1536, steps: 30, maxEdge: 3072, timeout: 15, note: "bf16 模型也能上，显存有富余" },
    { id: "x24", max: 999, label: "≥24G", resolution: 1536, steps: 40, maxEdge: 4096, timeout: 15, note: "可以更激进：高分辨率 + 高步数" }
  ];

  var S = {
    client: null,
    server: "http://127.0.0.1:8188",
    connected: false,
    arch: "qwen",
    mode: "txt2img",
    caps: null,
    models: {},
    template: null,
    templateName: "",
    busy: false,
    canceled: false,
    pid: null,
    results: [],
    selected: -1,
    docSize: null,
    settings: {
      autoPlace: true, verbose: false, timeoutMin: 15, presetRun: false,
      comfyPath: "", autoLaunch: false, launchKind: "auto",
      maxEdge: 2048,        // 编辑类任务导出时按长边缩小，直接决定显存压力
      skipAi: true,         // 导出时跳过「之前贴回的 AI 图层」——否则第二次生成会把上一张当参考图（越滚越脏）
      autoTune: true,       // 连接 / 换架构 / 换机器时按显存自动调参
      tunedSig: ""          // 已按哪套组合调过参，避免每次都覆盖用户手调
    },
    hw: null,               // { name, vram } 来自 ComfyUI /system_stats
    hwTier: null,           // 命中的显存档位
    animeCat: "all",  // 二次元工坊当前分类（all / style / light / chibi / scene / outfit / expression / quality / local）
    modePinned: false, // 用户手动选过模式 = 锁定；此后点功能卡不再抢（结构性模式除外）
    seedAuto: null,    // 上一次生成后「自动回填」进种子框的值；它能显示，但不会被下一次当成固定种子
    wsQ: { anime: "", nsfw: "" },     // 两个工坊各自的搜索词（会话级，不写 localStorage）
    nsfwCat: "all",   // NSFW 工坊当前分类（all / outfit / accessory / body / skin / expression / scene / local）
    view: "anime",
    presetId: "",
    nsfwOk: false,
    fillTexts: {},   // { presetId: 值 }：二次元的"背景"和 NSFW 的"罩杯"各存各的，互不覆盖
    extraImages: {}, // { presetId: 图片路径 }：溶图的背景图 / 融合的物体图，也按预设分开存
    launching: false,
    launchTried: false,
    tempDir: ""
  };

  /* ---------------- 基础 UI ---------------- */

  function log(msg, cls) {
    var box = $("log");
    var line = el("div");
    var t = el("span", "t");
    t.textContent = hhmmss() + "  ";
    var body = el("span", cls || "");
    body.textContent = msg;
    line.appendChild(t);
    line.appendChild(body);
    box.appendChild(line);
    while (box.children.length > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    $("logLast").textContent = msg;
  }

  var toastTimer = null;
  function toast(msg, type) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show " + (type || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, type === "err" ? 5200 : 2600);
  }

  function setStatus(state, text) {
    var pill = $("statusPill");
    pill.className = "status " + (state || "");
    $("statusText").textContent = text || "";
  }

  function setBusy(on) {
    S.busy = on;
    $("btnRun").disabled = on;
    $("btnCancel").disabled = !on;
    $("progressWrap").classList.toggle("hidden", !on);
    $("btnRun").innerHTML = on ? "<span>✦</span> 生成中…" : "<span>✦</span> 生成";
    if (!on) {
      $("progressBar").style.width = "0%";
      $("progressText").textContent = "";
    }
  }

  // 进度条用的是 CSS 无限滑动动画（没有逐 step 进度），这里只更新文字
  function progress(text) {
    $("progressText").textContent = text;
  }

  /* ---------------- 设置持久化 ---------------- */

  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var j = JSON.parse(raw);
      if (j.server) S.server = j.server;
      if (j.arch) S.arch = j.arch;
      if (j.settings) S.settings = Object.assign(S.settings, j.settings);
      if (j.view) S.view = j.view;
      S.models = j.models || {};
      S.params = j.params || {};
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        server: S.server,
        arch: S.arch,
        settings: S.settings,
        view: S.view,
        models: S.models,
        params: readParams()
      }));
    } catch (e) {}
  }

  function readParams() {
    return {
      prompt: $("prompt").value.trim(),
      negative: $("negative").value.trim(),
      steps: clamp($("pSteps").value, 1, 150),
      cfg: clamp($("pCfg").value, 0, 30),
      sampler: $("pSampler").value || "euler",
      scheduler: $("pScheduler").value || "simple",
      resolution: clamp($("pResolution").value, 256, 2048),
      width: clamp($("pWidth").value, 64, 8192),
      height: clamp($("pHeight").value, 64, 8192),
      denoise: clamp($("pDenoise").value, 0, 1),
      // 留空 / 填 -1 = 随机；以前留空会被 Number("") 变成 0，等于固定种子 0
      seed: (function () {
        var v = String($("pSeed").value).trim();
        if (v === "") return -1;
        var n = Math.floor(Number(v));
        if (isNaN(n)) return -1;
        /* 0.7.40：生成完会把实际用的种子写回输入框（方便复现），但那只是「显示」——
         * 以前它会被下一次当成固定种子，导致从第二次起每次生成都同一个种子，
         * 同一套噪声结构反复出现（表现就是「上一张的噪点/水印又来了」）。
         * 只要这个值还是我们自动填的，就当随机；用户在框里动一下，才算真的锁定。 */
        if (S.seedAuto !== null && n === S.seedAuto) return -1;
        return n;
      })(),
      scale: Number($("pScale").value) || 2,
      feather: clamp($("pFeather").value, 0, 500),
      expand: clamp($("pExpand").value, 0, 500)
    };
  }

  function applyParams(p) {
    if (!p) return;
    if (p.prompt !== undefined) $("prompt").value = p.prompt;
    if (p.negative !== undefined) $("negative").value = p.negative;
    if (p.steps) $("pSteps").value = p.steps;
    if (p.cfg !== undefined) $("pCfg").value = p.cfg;
    if (p.sampler) $("pSampler").value = p.sampler;
    if (p.scheduler) $("pScheduler").value = p.scheduler;
    if (p.resolution) $("pResolution").value = String(p.resolution);
    if (p.width) $("pWidth").value = p.width;
    if (p.height) $("pHeight").value = p.height;
    if (p.denoise !== undefined) $("pDenoise").value = p.denoise;
    if (p.seed !== undefined) $("pSeed").value = p.seed;
    if (p.scale) $("pScale").value = String(p.scale);
    if (p.feather !== undefined) $("pFeather").value = p.feather;
    if (p.expand !== undefined) $("pExpand").value = p.expand;
  }

  /* ---------------- 模式 / 字段 ---------------- */

  function setMode(mode, manual) {
    S.mode = mode;
    if (manual) S.modePinned = true;   // 只有「人点下拉」才算锁定，卡片自动带出的不算
    // 模式不再是一排页签：工坊卡会自己带出模式，这里只同步下拉的显示
    var ms = $("modeSelect");
    if (ms) ms.value = mode;
    syncModePin();
    var m = MODES[mode];
    $("modeHint").innerHTML = m.hint;
    $("prompt").setAttribute("placeholder", m.placeholder);
    $("promptHint").textContent = mode === "txt2img" ? "描述你想要的画面" :
      (mode === "edit" ? "描述要改成什么样" : (mode === "inpaint" ? "描述选区内要变成什么" : ""));

    var box = $("chips");
    box.innerHTML = "";
    (m.chips || []).forEach(function (c) {
      var b = el("button", "chip");
      b.type = "button";
      b.textContent = c;
      b.onclick = function () {
        var cur = $("prompt").value.trim();
        $("prompt").value = cur ? cur + "，" + c : c;
        $("prompt").focus();
      };
      box.appendChild(b);
    });

    // 提示词在放大/自定义模式下意义不同
    $("prompt").disabled = (mode === "upscale");

    syncFields();
    renderSlots();
    saveSettings();
  }

  function show(id, on) { $(id).classList.toggle("hidden", !on); }

  /* 模式锁定（0.7.38）：
   * 以前点任何一张功能卡都会 setMode(p.mode)，而 61 张卡里有 52 张是「图生图」——
   * 手动选了「文生图 / 局部重绘」之后，点下一张卡就被拽回图生图。
   * 现在：模式只要是你亲手选的，卡片就不再改它；只有「结构性模式」的卡
   * （局部重绘 / 放大 / 自定义 —— 这几档决定要不要选区、要不要放大模型、要不要工作流）
   * 仍会强制切换，否则那张卡根本不成立。想回到自动跟随，点胶囊右边的「跟随」。 */
  var STRUCTURAL_MODES = { inpaint: 1, upscale: 1, custom: 1 };

  function syncModePin() {
    var ms = $("modeSelect");
    if (ms) {
      ms.classList.toggle("pinned", !!S.modePinned);
      ms.title = S.modePinned
        ? "已手动指定：点功能卡不会改掉它（点右边「跟随」恢复自动）"
        : "生成模式：默认由你选的功能自动决定，也可以在这里手动改";
    }
    var b = $("btnModeFollow");
    if (b) b.classList.toggle("hidden", !S.modePinned);
  }

  function syncFields() {
    var m = S.mode, q = S.arch === "qwen";
    show("fldRes", q && (m === "txt2img" || m === "edit" || m === "inpaint"));
    show("fldSize", !q && m === "txt2img");
    show("fldDenoise", !q && (m === "edit" || m === "inpaint"));
    show("fldScale", m === "upscale");
    show("fldFeather", m === "inpaint");
    show("fldExpand", m === "inpaint");
    show("customRow", m === "custom");
    show("fldSeed", m !== "upscale");
    $("fldRes").querySelector("span").textContent = m === "txt2img" ? "分辨率（方形）" : "参考分辨率";
  }

  /* ---------------- 模型槽位 ---------------- */

  // 下拉里显示精简名（去掉扩展名、过长中间省略），value 保持完整文件名
  function prettyName(name) {
    var s = String(name || "").replace(/\.(safetensors|ckpt|pth|pt|bin|gguf)$/i, "");
    if (s.length > 32) s = s.slice(0, 15) + "…" + s.slice(-13);
    return s;
  }

  function addSlot(kind, label, options, value, allowEmpty) {
    var box = $("modelSlots");
    var row = el("div", "slot");
    var lab = el("span");
    lab.textContent = label;
    row.appendChild(lab);

    var sel = el("select", "in");
    sel.setAttribute("data-kind", kind);
    if (allowEmpty) {
      var o0 = el("option");
      o0.value = "";
      o0.textContent = "（不使用）";
      sel.appendChild(o0);
    }
    var list = options && options.length ? options : [];
    if (!list.length) {
      var oe = el("option");
      oe.value = "";
      oe.textContent = "（ComfyUI 里没有可用文件）";
      sel.appendChild(oe);
      sel.disabled = true;
    } else {
      list.forEach(function (name) {
        var o = el("option");
        o.value = name;
        o.textContent = prettyName(name);
        o.title = name;
        sel.appendChild(o);
      });
      if (value && list.indexOf(value) !== -1) sel.value = value;
      else if (!allowEmpty) sel.value = list[0];
    }
    function syncTitle() { sel.title = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : ""; }
    syncTitle();
    sel.onchange = function () { syncTitle(); saveSettings(); };
    row.appendChild(sel);
    box.appendChild(row);
  }

  function renderSlots() {
    var box = $("modelSlots");
    box.innerHTML = "";
    if (!S.connected) {
      var hint = el("div", "tiny");
      hint.textContent = "连接 ComfyUI 后会自动读取本机模型";
      box.appendChild(hint);
      return;
    }
    var o = (S.caps && S.caps.options) || {};

    if (S.mode === "upscale") {
      addSlot("upscale", "放大模型", o.upscale, S.models.upscale, false);
      return;
    }
    if (S.mode === "custom") {
      var h = el("div", "tiny");
      h.textContent = S.templateName ? ("已载入：" + S.templateName) : "自定义工作流使用 JSON 里写死的模型";
      box.appendChild(h);
      return;
    }

    var caps = S.caps || {};
    if (S.arch === "qwen") {
      if (!caps.TextEncodeQwenImage21) {
        var w = el("div", "tiny");
        w.textContent = "当前 ComfyUI 没有 Qwen 节点，请改用 SD 大模型模式";
        box.appendChild(w);
      }
      addSlot("unet", "UNET 模型", o.unet, S.models.unet, false);
      addSlot("lora", "LoRA", o.lora, S.models.lora, true);
      addSlot("clip", "文本编码器", o.clip, S.models.clip, false);
      addSlot("vae", "VAE", o.vae, S.models.vae, false);
    } else {
      addSlot("ckpt", "大模型", o.ckpt, S.models.ckpt, false);
      if (!(o.ckpt || []).length) {
        var nw = el("div", "tiny");
        nw.textContent = "本机 checkpoints 目录为空：请换用 Qwen 模式，或把 SD/SDXL 大模型放进 ComfyUI 的 models/checkpoints";
        box.appendChild(nw);
      }
    }
  }

  function collectModels() {
    var next = Object.assign({}, S.models);
    // 只更新当前界面上真正渲染出来的槽位。
    // （以前用一份 7 个键全为 "" 的模板去 Object.assign，切到放大模式后一生成，
    //   UNET/CLIP/VAE 就被写成空串；切回来时槽位回落到列表第一个文件，可能是个视频模型）
    Array.prototype.forEach.call(document.querySelectorAll("#modelSlots select"), function (sel) {
      var k = sel.getAttribute("data-kind");
      if (!k) return;
      next[k] = sel.disabled ? "" : (sel.value || "");
    });
    next.loraStrength = next.loraStrength || 1;
    S.models = next;
    return Object.assign({}, S.models);
  }

  /* ---------------- 连接 ---------------- */

  function fillSelect(sel, options, fallback) {
    var keep = sel.value;
    sel.innerHTML = "";
    (options || []).forEach(function (v) {
      var o = el("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    if (!sel.options.length) {
      var o = el("option");
      o.value = fallback;
      o.textContent = fallback;
      sel.appendChild(o);
    }
    var has = function (v) { return !!v && (options || []).indexOf(v) !== -1; };
    // 保留用户当前选择；只有它在本机不可用时才退回默认
    if (has(keep)) sel.value = keep;
    else if (has(fallback)) sel.value = fallback;
  }

  /* ---------------- 显卡识别 / 自动调参 ---------------- */

  function parseHw(raw) {
    var devs = (raw && raw.devices) || [];
    if (!devs.length) return null;
    var d = devs[0] || {};
    var gb = Math.round(((d.vram_total || 0) / 1073741824) * 10) / 10;
    return { name: String(d.name || "未知显卡").replace(/^cuda:\d+\s*/, ""), vram: gb };
  }

  function tierFor(gb) {
    if (!gb) return TIERS[1];   // 拿不到显存就按最常见的 8G 档
    for (var i = 0; i < TIERS.length; i++) { if (gb <= TIERS[i].max) return TIERS[i]; }
    return TIERS[TIERS.length - 1];
  }

  function tunedSteps(tier) {
    return S.arch === "qwen" ? tier.steps : Math.min(tier.steps, 28);
  }

  function renderHwInfo() {
    var hw = S.hw, tier = S.hwTier || (hw ? tierFor(hw.vram) : null);
    var line = hw
      ? ("显卡：" + hw.name + (hw.vram ? " · " + hw.vram + " GB 显存" : " · 显存未知") + (tier ? "（" + tier.label + " 档）" : ""))
      : "显卡：未检测（先连上 ComfyUI）";
    $("hwInfo").textContent = line;
    $("autoTuneTip").textContent = tier
      ? ("建议：参考分辨率 " + tier.resolution + " · " + tunedSteps(tier) + " 步 · cfg " + (S.arch === "qwen" ? 1 : 7) + " · 导出长边 " + tier.maxEdge + " —— " + tier.note)
      : "连上 ComfyUI 后会自动识别显卡";
  }

  // 把某一档参数写进面板（silent = 不弹 toast，只记日志）
  function applyAutoTune(silent) {
    var tier = S.hwTier || TIERS[1];
    var steps = tunedSteps(tier);
    var cfg = S.arch === "qwen" ? 1 : 7;
    $("pResolution").value = String(tier.resolution);
    $("pSteps").value = steps;
    $("pCfg").value = cfg;
    S.settings.maxEdge = tier.maxEdge;
    S.settings.timeoutMin = tier.timeout;
    S.settings.tunedSig = tier.id + "/" + S.arch;
    $("setMaxEdge").value = tier.maxEdge;
    $("setTimeout").value = tier.timeout;
    saveSettings();
    renderHwInfo();
    log("按「" + tier.label + "」调参：" + tier.resolution + " · " + steps + " 步 · cfg " + cfg + " · 导出长边 " + tier.maxEdge, "ok");
    if (!silent) toast("已按本机显卡调参", "ok");
  }

  // 只在「换机器 / 换架构 / 第一次用」时自动调，之后不覆盖用户手调的参数
  function maybeAutoTune() {
    if (!S.settings.autoTune || !S.hwTier) return;
    var sig = S.hwTier.id + "/" + S.arch;
    if (S.settings.tunedSig === sig) return;
    applyAutoTune(true);
  }

  async function connect() {
    var raw = $("serverInput").value.trim();
    if (!raw) raw = "http://127.0.0.1:8188";
    S.server = raw;
    S.client = new Comfy.ComfyClient(raw);
    setStatus("busy", "连接中");
    log("连接 " + raw + " …");
    try {
      var info = await S.client.ping(6000);
      S.hw = parseHw(info.raw);
      S.hwTier = tierFor(S.hw && S.hw.vram);
      S.connected = true;
      setStatus("ok", "已连接");
      log("ComfyUI " + info.version + (info.device ? " · " + info.device : ""), "ok");
      await refreshModels();
      saveSettings();
    } catch (e) {
      S.connected = false;
      setStatus("err", "未连接");
      log("连接失败：" + e.message, "err");
      var found = await probePorts();
      if (found && found.url !== S.server) {
        $("serverInput").value = found.url;
        log("自动改用 " + found.url, "warn");
        return connect();
      }
      if (!found && S.settings.autoLaunch && !S.launchTried) {
        S.launchTried = true;
        log("没连上，按设置自动启动 ComfyUI…", "warn");
        return launchComfy();
      }
      if (!found) log("ComfyUI 没在运行：点连接栏的「▶ 启动」可以直接拉起（会自动找桌面版）", "warn");
      renderSlots();
    }
  }

  // 本机到底能不能跑 Qwen / SD（架构选择不该落在一个"跑不起来"的状态上）
  function usableArches(caps) {
    var q = Flow.guess(caps, "qwen");
    var s = Flow.guess(caps, "sd");
    return {
      q: q, s: s,
      qwenOk: !!(q.unet && q.clip && q.vae && caps && caps.TextEncodeQwenImage21),
      sdOk: !!s.ckpt
    };
  }

  async function refreshModels() {
    if (!S.client) return;
    try {
      // 必须清缓存：否则点「↻ 重新读取模型列表」拿到的永远是第一次 /object_info 的结果
      if (S.client.reset) S.client.reset();
      var caps = await S.client.probe();
      S.caps = caps;
      fillSelect($("pSampler"), caps.options.sampler, "euler");
      fillSelect($("pScheduler"), caps.options.scheduler, "simple");

      var u = usableArches(caps);
      var guessed;
      if (S.arch === "qwen" && !u.qwenOk && u.sdOk) {
        guessed = u.s;
        log("本机没有可用的 Qwen 模型（UNET/CLIP/VAE 或 Qwen 节点缺失），已自动切到 SD 大模型模式", "warn");
      } else if (S.arch === "sd" && !u.sdOk && u.qwenOk) {
        guessed = u.q;
        log("本机没有 SD 大模型，已自动切到 Qwen 模式", "warn");
      } else {
        guessed = (S.arch === "sd") ? u.s : u.q;
      }
      S.arch = guessed.arch;
      $("archSelect").value = S.arch;
      S.models = Object.assign({}, guessed, S.models);
      // 只有自动猜出了放大模型时才覆盖，别把用户手动选的冲掉
      if (guessed.upscale) S.models.upscale = guessed.upscale;
      var bgList = caps.options.bgRemoval || [];
      if (!S.models.bgRemoval || bgList.indexOf(S.models.bgRemoval) === -1) {
        S.models.bgRemoval = bgList.filter(function (n) { return /birefnet/i.test(n); })[0] || bgList[0] || "";
      }

      renderSlots();
      var counts = [
        "UNET " + (caps.options.unet || []).length,
        "CLIP " + (caps.options.clip || []).length,
        "VAE " + (caps.options.vae || []).length,
        "大模型 " + (caps.options.ckpt || []).length,
        "放大 " + (caps.options.upscale || []).length
      ];
      log("模型读取完成：" + counts.join(" · "));
      if (!caps.TextEncodeQwenImage21) log("提示：本机没有 Qwen-Image 节点，图生图请选 SD 模式", "warn");
      maybeAutoTune();
    } catch (e) {
      log("读取模型失败：" + e.message, "err");
    }
  }

  /* ---------------- 生成 ---------------- */

  function needImage(mode) { return mode === "edit" || mode === "inpaint" || mode === "upscale"; }

  /* 兜底蒙版（0.7.20）：纯 JS 画一张「白 = 重绘」的矩形羽化蒙版，尺寸和送出去的图完全一致。
   * 为什么需要：PS 侧的选区不一定活得过 flatten/crop/resize（真机实测裁完就没了），
   * 而「选区外保持原样」其实只依赖几何数据 —— 选区矩形和裁剪矩形我们本来就有。
   * 代价：套索/魔棒这种非矩形选区会退化成它的**外接矩形**（日志会写明）。 */
  function buildRectMask(path, rect, sel, outW, outH, feather, expand) {
    var img = StarsPng.rectMask(rect, sel, outW, outH, feather, expand);
    Comfy.fs.writeFileSync(path, StarsPng.encode(img));
    return { path: path, width: img.width, height: img.height, featherPx: img.featherPx };
  }

  /* 羽化 / 扩展按「被合成的那块面积」算，不按整幅画布：
   * 4640px 画布算出来的 19px 羽化，摊在一张 300px 的裁剪块上等于糊掉一半；
   * 反过来整图模式下又确实需要这么大才不会硬切边。
   * 0.7.19 起这段公式在**导出时**就要用（蒙版在 PS 里烧好、羽化也只有这一次机会），
   * 所以从 placeResult 里抽出来共用。 */
  function inkFeatherExpand(rect, doc) {
    var basis = rect ? Math.min(rect.w, rect.h) : (doc ? Math.min(doc.width, doc.height) : 0);
    var feather = Number($("pFeather").value) || 0;
    var expand = Number($("pExpand").value) || 0;
    if (!basis) return { feather: 0, expand: 0, basis: 0 };
    var fMin = Math.min(200, Math.max(4, Math.round(basis * 0.004)));
    var eMin = Math.min(200, Math.max(2, Math.round(basis * 0.002)));
    var fCap = Math.max(3, Math.round(basis * 0.06));   // 羽化 ≤6%
    var eCap = Math.max(2, Math.round(basis * 0.04));   // 扩展 ≤4%，避免小选区被抹平
    return {
      feather: Math.min(Math.max(feather, fMin), fCap),
      expand: Math.min(Math.max(expand, eMin), eCap),
      basis: basis
    };
  }

  // 结果图的真实尺寸：ComfyUI 的 /history 输出只有 filename/subfolder/type，没有宽高，
  // 所以直接读 PNG 的 IHDR（png.js 里已有解码器）
  function pngSize(path) {
    try {
      if (!Comfy.hasNode || !Comfy.fs || !StarsPng) return null;
      var d = StarsPng.decode(Comfy.fs.readFileSync(path));
      if (d && d.width && d.height) return { w: d.width, h: d.height };
    } catch (e) {}
    return null;
  }

  // alpha > 8 的像素占比（用来判断"抠完是不是什么都没剩下"）
  function solidRatio(img) {
    var n = img.width * img.height, hit = 0, d = img.data;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 8) hit++;
    return n ? hit / n : 1;
  }

  async function run(opts) {
    opts = opts || {};
    if (S.busy) return null;
    if (!S.connected || !S.client) { toast("先连接 ComfyUI", "err"); return; }

    var mode = S.mode;
    var temp = S.tempDir || PS.tmpDir();
    var ts = String(Date.now());
    var srcPath = temp + "/src_" + ts + ".png";
    var outPath = temp + "/out_" + ts + ".png";

    S.canceled = false;
    setBusy(true);
    setStatus("busy", "生成中");
    var t0 = Date.now();
    log("—— " + MODES[mode].label + " ——");

    try {
      var p = readParams();
      if (mode !== "upscale" && mode !== "custom" && !p.prompt) throw new Error("先写提示词");

      var info = await PS.info();
      if (needImage(mode) && !info.doc) throw new Error("请先打开一个文档");
      if (mode === "inpaint" && (!info.doc || !info.doc.hasSelection)) {
        throw new Error("局部重绘需要先在 Photoshop 里建立选区");
      }
      // 局部重绘 + Qwen：只把选区送出去生成（清晰度的主要来源）
      var cropRect = (mode === "inpaint" && S.arch === "qwen") ? selectionCropRect(info.doc) : null;
      if (mode === "custom" && !S.template) throw new Error("先选择一个 API 格式的工作流 JSON");

      if (mode !== "custom") {
        var models = collectModels();
        if (mode === "upscale") {
          if (!models.upscale) throw new Error("没有可用的放大模型：把 RealESRGAN 等放进 ComfyUI 的 models/upscale_models");
        } else if (S.arch === "qwen") {
          var caps0 = S.caps || {};
          if (!caps0.TextEncodeQwenImage21) throw new Error("本机 ComfyUI 没有 Qwen 节点，请改用 SD 大模型模式");
          if (!models.unet || !models.clip || !models.vae) throw new Error("模型没选全：UNET / 文本编码器 / VAE 都要选");
        } else if (!models.ckpt) {
          throw new Error("本机没有大模型（checkpoints 为空）：请用 Qwen 模式，或先放入 SD/SDXL 模型");
        }
      }

      var maxEdge = mode === "upscale" ? 0 : (S.settings.maxEdge || 2048);

      /* 0.7.19：局部重绘 + Qwen 不再让 PS 去「反选 + Dlt」——
       * PS 27.10 实测该命令不可用（自检 2026-10-20 23:43：命令"删除"当前不可用），
       * 而且它作用在活动图层上，正是「选区外变红」的唯一来源。
       * 现在 PS 只负责导出「图 + 同尺寸羽化蒙版」，alpha 合成在 ComfyUI 里做，
       * 回到面板的是一张贴回 rect 的普通图层（选区外 alpha=0，原图透出来）。 */
      /* 0.7.21：所有架构的局部重绘都走 alpha 合成（PS 侧永不删像素）。
       * 之前限制 qwen 是因为 SD 用 VAEEncodeForInpaint 蒙版；但那张蒙版同样可以拿来合成 alpha，
       * 而 PS 侧的裁切已经被证明不可靠（红色边框事故）。 */
      var wantAlphaCut = (mode === "inpaint");
      if (wantAlphaCut && !(S.caps && S.caps.JoinImageWithAlpha && S.caps.InvertMask)) {
        wantAlphaCut = false;
        log("本机 ComfyUI 缺 JoinImageWithAlpha / InvertMask，局部重绘退回 PS 侧裁切（该命令在 PS 27 上可能失败）", "warn");
      }
      var ink = wantAlphaCut ? inkFeatherExpand(cropRect, info.doc) : { feather: 0, expand: 0 };
      var maskPath = wantAlphaCut ? (srcPath.replace(/\.png$/i, "") + "_mask.png") : "";
      var exportOpts = { maxEdge: maxEdge, skipAi: S.settings.skipAi !== false };
      if (wantAlphaCut) { exportOpts.maskPath = maskPath; exportOpts.feather = ink.feather; exportOpts.expand = ink.expand; }

      var src;
      if (cropRect) {
        progress("导出选区 " + cropRect.w + "×" + cropRect.h + "…");
        try {
          src = await PS.exportRegion(srcPath, {
            x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h,
            maxEdge: exportOpts.maxEdge, maskPath: exportOpts.maskPath,
            feather: exportOpts.feather, expand: exportOpts.expand, skipAi: exportOpts.skipAi
          });
          if (src && src.rect) cropRect = src.rect;      // 以 PS 实际裁的为准（越界会被夹回画布）
          var gain = info.doc.width / Math.max(1, cropRect.w);
          log("裁剪式重绘：只送出选区那一块 " + cropRect.w + "×" + cropRect.h +
              (gain > 1.05 ? "（选区内有效像素约 ×" + gain.toFixed(1) + "）" : "") +
              " · 原图 " + info.doc.width + "×" + info.doc.height + " → " + src.path +
              (src.skippedLayers > 0 ? "（已跳过 " + src.skippedLayers + " 个 AI 图层）" : ""), "ok");
        } catch (eCrop) {
          // 裁剪失败不该让整次生成白跑：退回整图模式，结果仍能出
          log("裁剪导出失败，退回整图模式：" + ((eCrop && eCrop.message) || eCrop), "warn");
          cropRect = null;
          src = null;
        }
      }
      if (!cropRect) {
        progress("导出当前画布…");
        // 放大模式要原分辨率；其余模式缩到长边 2048，省显存也省上传时间
        src = await PS.exportDoc(srcPath, exportOpts);
        log("画布 " + src.width + "×" + src.height + " → " + src.path +
            (wantAlphaCut ? "（含 " + ink.feather + "px 羽化蒙版）" : ""));
        if (src.skippedLayers > 0) {
          log("已跳过 " + src.skippedLayers + " 个之前贴回的 AI 图层（这次从原始底图画，不会带上上一张的水印/噪点）", "ok");
        }
        if (wantAlphaCut && !src.maskPath) {
          // 没导出蒙版就没法做 alpha 合成 → 后面 place 会退回 PS 侧裁切（成功率低），必须先说清楚
          log("⚠ 蒙版没导出来" + (src.maskError ? "：" + src.maskError : "（可能选区在出图期间丢了）") +
              " → 这次只能退回 PS 侧裁切", "warn");
        }
      }
      S.docSize = { w: src.width, h: src.height };

      var imageName = "";
      if (needImage(mode) || (mode === "custom" && S.templateHasImage)) {
        progress("上传到 ComfyUI…");
        var up = await S.client.upload(srcPath, "starsai_" + ts + ".png");
        imageName = up.subfolder ? up.subfolder + "/" + up.name : up.name;
        log("上传完成：" + imageName);
      }

      var maskName = "";
      if (mode === "inpaint" && S.arch === "sd") {
        progress("导出选区蒙版…");
        var sdMaskPath = srcPath.replace(/\.png$/i, "") + "_sdmask.png";
        var maskInfo = await PS.exportMask(sdMaskPath, { grow: 0, feather: 0 });
        var upm = await S.client.upload(sdMaskPath, "starsai_mask_" + ts + ".png");
        maskName = upm.name;
        log("蒙版完成：" + maskName + "（" + maskInfo.width + "×" + maskInfo.height + "，白 = 重绘区）");
      }

      /* Qwen 局部重绘：把 PS 导出的羽化蒙版也传上去，在 ComfyUI 里合成 alpha。
       * 回来的图「选区外 alpha = 0」，贴回 PS 就是个普通图层 —— 不再删像素。 */
      var alphaCut = false;
      if (wantAlphaCut && src && src.maskPath) {
        progress("上传选区蒙版…");
        var upmask = await S.client.upload(src.maskPath, "starsai_amask_" + ts + ".png");
        maskName = upmask.subfolder ? upmask.subfolder + "/" + upmask.name : upmask.name;
        alphaCut = true;
        log("遮罩已就绪：" + maskName + " · 羽化 " + ink.feather + "px / 扩展 " + ink.expand + "px · " +
            src.width + "×" + src.height + "（和送出去的图同尺寸，像素级对齐）", "ok");
      } else if (wantAlphaCut) {
        var psWhy = (src && src.maskError) ? src.maskError : "选区在出图期间丢了";
        var selGeo = info.doc && info.doc.selection;
        var useRect = cropRect || { x: 0, y: 0, w: info.doc.width, h: info.doc.height };
        /* 0.7.30：先按「真实选区形状」重烧一次蒙版。
         * exportRegion 里那张蒙版要先 store 通道、再 crop / resize、最后 loadSelection 还原，
         * 真机上这三步不保证活下来；失败时以前的兜底是「外接矩形」——套索/魔棒画的自定义形状
         * 于是全被抹成方块。exportRegionMask 改成在**文档坐标里先烧像素再裁剪**，
         * 像素永远活得过裁剪，形状因此完整保留。 */
        if (src && src.width) {
          try {
            progress("按选区形状导出蒙版…");
            var shapePath = maskPath.replace(/\.png$/i, "") + "_shape.png";
            var sm = await PS.exportRegionMask(shapePath, {
              x: useRect.x, y: useRect.y, w: useRect.w, h: useRect.h,
              maxEdge: exportOpts.maxEdge, feather: ink.feather, expand: ink.expand
            });
            progress("上传选区蒙版…");
            var ups = await S.client.upload(shapePath, "starsai_amask_" + ts + ".png");
            maskName = ups.subfolder ? ups.subfolder + "/" + ups.name : ups.name;
            alphaCut = true;
            log("遮罩：PS 侧那张没导出来（" + psWhy + "）→ 改按**真实选区形状**重出一张 " +
                sm.width + "×" + sm.height + " · 羽化 " + ink.feather + "px / 扩展 " + ink.expand + "px（套索、魔棒等自定义选区按原形状合成）", "ok");
          } catch (eShape) {
            log("按真实选区形状出蒙版也失败了：" + eShape.message, "warn");
          }
        }
        // 最后一道：几何数据画个矩形（形状会退化成外接矩形，但至少不会整张糊）
        if (!alphaCut && selGeo && src && src.width) {
          try {
            var fm = buildRectMask(maskPath, useRect, selGeo, src.width, src.height, ink.feather, ink.expand);
            progress("上传选区蒙版…");
            var upf = await S.client.upload(fm.path, "starsai_amask_" + ts + ".png");
            maskName = upf.subfolder ? upf.subfolder + "/" + upf.name : upf.name;
            alphaCut = true;
            log("遮罩：退到矩形兜底 " + fm.width + "×" + fm.height + " · 羽化 " + fm.featherPx +
                "px（⚠ 非矩形选区会按外接矩形处理）", "warn");
          } catch (eBM) {
            log("矩形兜底也失败了：" + eBM.message, "err");
          }
        }
        if (!alphaCut) {
          log("⚠ 没有可用蒙版" + (src && src.maskError ? "：" + src.maskError : "") +
              " → 这次只能退回 PS 侧裁切（PS 27 上大概率失败，画面会是硬边方块）", "warn");
        }
      }

      var secondName = "";
      var activePreset = Presets.get(S.presetId);
      var extraLabel = extraImageLabel(activePreset);
      if (mode !== "custom" && extraLabel) {
        var ref2 = extraImageOf(activePreset);
        if (!ref2) {
          throw new Error("「" + activePreset.label + "」需要先给它一张" + extraLabel +
            "：把图拖进面板，或点卡片里的「选择」");
        }
        progress("上传" + extraLabel + "…");
        var ext = (ref2.match(/\.[a-zA-Z0-9]+$/) || [".png"])[0];
        var upb = await S.client.upload(ref2, "starsai_ref2_" + ts + ext);
        secondName = upb.subfolder ? upb.subfolder + "/" + upb.name : upb.name;
        log(extraLabel + "：" + secondName);
      }

      var ctx = buildCtx(p, src, imageName, maskName);
      // Qwen 看不到蒙版：把选区位置/占比补进提示词，模型才知道改哪儿（预设文案本身不动）
      if (mode === "inpaint" && S.arch === "qwen") {
        // 裁剪模式：模型只看到选区那一块，"画面左上/右下"这种位置描述反而误导，换成局部语境句
        var hint = cropRect ? CROP_HINT : selectionPhrase(info.doc);
        if (hint) {
          ctx.prompt = String(ctx.prompt || "").trim() + hint;
          log((cropRect ? "局部语境句" : "选区位置") + "已补进提示词：" + hint, "warn");
        }
      }
      ctx.secondName = secondName;
      ctx.alphaCut = alphaCut;      // qwen 局部重绘：出图后按蒙版合成 alpha
      ctx.cropW = src.width;        // 合成目标尺寸 = 送出去的图（crop 模式 = 选区矩形）
      ctx.cropH = src.height;
      ctx.cutout = !!(activePreset && activePreset.cutout);
      if (ctx.cutout) ctx.models.bgRemoval = S.models.bgRemoval || "";
      if (p.seed < 0) {
        S.seedAuto = ctx.seed;          // 记住「这个值是自动填的」，下一次仍然随机
        $("pSeed").value = ctx.seed;    // 显示出来，方便照着填回去复现
      } else {
        S.seedAuto = null;              // 用户自己填的种子，保持锁定
      }
      var graph = Flow.build(ctx);
      var nodeCount = Object.keys(graph).length;
      log("提交：" + nodeCount + " 节点 · " + ctx.steps + " 步 · cfg " + ctx.cfg + " · " + ctx.sampler + "/" + ctx.scheduler + " · seed " + ctx.seed);

      progress("已提交，排队中…");
      var pid = await S.client.submit(graph);
      S.pid = pid;
      log("prompt_id = " + pid);

      var h = await S.client.waitFor(pid, function (elapsed, q) {
        progress("生成中 " + elapsed.toFixed(0) + "s" + (q && q.running ? " · 运行中" : " · 排队 " + (q ? q.pending : "?")));
      }, { timeout: (S.settings.timeoutMin || 15) * 60000 });

      if (S.canceled) throw new Error("已取消");

      var view = firstImage(h);
      if (!view) throw new Error("ComfyUI 返回里没有图片输出");

      progress("下载结果…");
      await S.client.download(view, outPath);
      var secs = Math.round((Date.now() - t0) / 1000);
      // /history 里没有宽高（ComfyUI 只回 filename/subfolder/type），读 PNG 头拿真实尺寸
      var real = pngSize(outPath) || { w: view.width || src.width, h: view.height || src.height };
      log("出图完成 · " + secs + "s · " + real.w + "×" + real.h, "ok");

      var res = {
        path: outPath, view: view, prompt: ctx.prompt, mode: mode, seed: ctx.seed,
        w: real.w, h: real.h, secs: secs, at: Date.now()
      };
      if (cropRect) res.rect = cropRect;   // 写回时按这个矩形摆在原位
      res.selRect = (info.doc && info.doc.selection) || null;   // 兜底裁环要按它裁
      res.composited = alphaCut;           // true = 选区外已经是 alpha=0，PS 侧不用再裁

      /* 体检：合成过的图必须真的带透明区。不透明就说明蒙版/节点没起作用，
       * 这次贴回去会是整块方块 —— 直接说清楚，别让它静默糊上去。 */
      if (alphaCut) {
        try {
          var chk = StarsPng.decode(Comfy.fs.readFileSync(outPath));
          var tot = chk.width * chk.height, zero = 0;
          for (var ci2 = 3; ci2 < chk.data.length; ci2 += 4) { if (chk.data[ci2] === 0) zero++; }
          res.alphaPct = zero / tot * 100;
          if (res.alphaPct < 1) {
            log("⚠ 出图没有透明区（alpha=0 只占 " + res.alphaPct.toFixed(2) + "%）：蒙版/节点可能没生效，这次贴回去会是整块方块", "warn");
          } else {
            log("出图已带透明区：alpha=0 占 " + res.alphaPct.toFixed(1) + "%（选区外）", "ok");
          }
        } catch (eChk) { log("透明度体检跳过：" + eChk.message, "warn"); }
      }
      pushResult(res);

      if (opts.placeMode === "doc") {
        progress("新开文档…");
        await placeAsDoc(res);
      } else if (opts.placeMode === "none") {
        // 只出图不写回
      } else if (activePreset && activePreset.cutout) {
        progress(ctx.usedBgRemoval ? "裁透明边…" : "挖白底…");
        try {
          var raw = Comfy.fs.readFileSync(res.path);
          var cutPath = res.path.replace(/\.png$/i, "") + "_cut.png";
          var how, w2, h2;
          if (ctx.usedBgRemoval) {
            // ComfyUI 里已经用 BiRefNet 生成了 alpha，这里只裁掉透明边
            var dec = StarsPng.decode(raw);
            var cover = solidRatio(dec);
            if (cover < 0.02) {
              throw new Error("没检测到主体（alpha 只覆盖 " + (cover * 100).toFixed(2) + "%），出图可能不是纯白底");
            }
            var tr = StarsPng.trim(dec);
            Comfy.fs.writeFileSync(cutPath, StarsPng.encode(tr));
            how = "BiRefNet 直出 alpha · 主体 " + (cover * 100).toFixed(1) + "%"; w2 = tr.width; h2 = tr.height;
          } else {
            var kr = StarsPng.cutout(raw, { threshold: 236, soft: 14 });
            // 兜底（README 一直承诺的那条）：既不能"几乎全挖光"（出图全白/没画主体），
            // 也不能"几乎没挖掉"（出图根本不是白底，比如提示词被改成了场景图）
            if (kr.removedRatio > 0.99) {
              throw new Error("没检测到成片白底（" + (kr.removedRatio * 100).toFixed(1) + "% 都被当成背景）");
            }
            if (kr.removedRatio < 0.05) {
              throw new Error("没检测到成片白底（只有 " + (kr.removedRatio * 100).toFixed(1) + "% 是背景，出图可能不是纯白底）");
            }
            Comfy.fs.writeFileSync(cutPath, kr.buffer);
            how = "白底 keying · 背景 " + (kr.removedRatio * 100).toFixed(0) + "%"; w2 = kr.width; h2 = kr.height;
          }
          res.cutPath = cutPath;
          log("透明贴纸就绪 · " + how + " · 人物区 " + w2 + "×" + h2, "ok");
          var pr = await PS.place(cutPath, { target: "layer", fit: "none", sizeRatio: 0.34, offsetY: 0.6, layerName: "Stars-AI · Q版小人" });
          log("已插入透明图层：" + pr.name, "ok");
        } catch (eCut) {
          log("透明处理失败，退回普通插入：" + eCut.message, "warn");
          await placeResult(res, true);
        }
      } else if (S.settings.autoPlace || mode === "upscale") {
        progress("写回 Photoshop…");
        await placeResult(res, true);
      } else {
        toast("生成完成", "ok");
      }
      setStatus("ok", "已连接");
      return res;
    } catch (e) {
      var msg = String((e && e.message) || e);
      if ((e && (e.code === "ECONNREFUSED" || e.code === "ECONNRESET")) || /ECONNREFUSED|ECONNRESET|socket hang up|aborted/i.test(msg)) {
        msg = "ComfyUI 进程挂了（多半是显存/内存不足）。点「▶ 启动」重新拉起，或把参考分辨率降到 768 再试";
      }
      if (S.canceled) log("已取消", "warn");
      else { log("失败：" + msg, "err"); toast(msg.slice(0, 120), "err"); }
      setStatus(S.connected ? "ok" : "err", S.connected ? "已连接" : "未连接");
      return null;
    } finally {
      setBusy(false);
      S.pid = null;
    }
  }

  function buildCtx(p, src, imageName, maskName) {
    var models = collectModels();
    var w = src.width, h = src.height;
    if (S.mode === "txt2img") { w = p.width; h = p.height; }
    if (S.mode === "upscale") {
      w = Math.round(src.width * p.scale);
      h = Math.round(src.height * p.scale);
      if (w > 8192 || h > 8192) {
        var k = Math.min(8192 / w, 8192 / h);
        w = Math.round(w * k); h = Math.round(h * k);
        log("目标尺寸过大，已限制到 " + w + "×" + h, "warn");
      }
    }
    return {
      mode: S.mode,
      arch: S.arch,
      caps: S.caps || {},
      models: models,
      prompt: p.prompt,
      negative: p.negative,
      seed: p.seed >= 0 ? p.seed : randInt(),
      steps: p.steps, cfg: p.cfg, sampler: p.sampler, scheduler: p.scheduler,
      resolution: p.resolution, width: w, height: h, denoise: p.denoise,
      imageName: imageName, maskName: maskName,
      template: S.template
    };
  }

  function firstImage(h) {
    var outs = (h && h.outputs) || {};
    var found = null;
    Object.keys(outs).forEach(function (k) {
      var imgs = outs[k].images;
      if (imgs && imgs.length && !found) {
        var im = imgs[0];
        found = {
          filename: im.filename, subfolder: im.subfolder || "", type: im.type || "output",
          width: (im.metadata && im.metadata.width) || 0,
          height: (im.metadata && im.metadata.height) || 0
        };
      }
    });
    return found;
  }

  /* ---------------- 结果 ---------------- */

  function pushResult(res) {
    S.results.unshift(res);
    if (S.results.length > 12) S.results.pop();
    S.selected = 0;
    renderResults();
  }

  function fileUrl(p) {
    return "file:///" + encodeURI(String(p).replace(/\\/g, "/"));
  }

  function attach(img, path) {
    img.onerror = function () {
      var b = PS.readImageBase64(path);
      if (b) { img.onerror = null; img.src = b; }
    };
    img.src = fileUrl(path) + "?t=" + Date.now();
  }

  function openLightbox() {
    var src = $("previewImg").getAttribute("src");
    if (!src) return;
    $("lightboxImg").src = src;
    $("lightbox").classList.remove("hidden");
  }
  function closeLightbox() {
    $("lightbox").classList.add("hidden");
    $("lightboxImg").removeAttribute("src");
  }

  var lastResultCount = 0;   // 只有"新增结果"才自动滚动，点缩略图切换不该让页面跳

  function renderResults() {
    var sel = S.results[S.selected];
    var img = $("previewImg");
    if (sel) {
      img.classList.remove("hidden");
      $("previewBox").classList.remove("zoom");
      $("previewEmpty").classList.add("hidden");
      attach(img, sel.path);
      $("resultMeta").textContent = sel.secs + "s · " + sel.w + "×" + sel.h + " · seed " + sel.seed;
      if (S.results.length !== lastResultCount) {
        lastResultCount = S.results.length;
        try { $("resultsCard").scrollIntoView({ block: "nearest" }); } catch (eSC) {}
      }
      if (!$("lightbox").classList.contains("hidden")) { $("lightboxImg").src = img.getAttribute("src") || ""; }
      $("btnPlaceLayer").disabled = false;
      $("btnPlaceDoc").disabled = false;
      $("btnReveal").disabled = false;
    } else {
      img.classList.add("hidden");
      $("previewEmpty").classList.remove("hidden");
      $("resultMeta").textContent = "还没有结果";
      $("btnPlaceLayer").disabled = true;
      $("btnPlaceDoc").disabled = true;
      $("btnReveal").disabled = true;
    }

    var box = $("thumbs");
    box.innerHTML = "";
    S.results.forEach(function (r, i) {
      var t = el("img", "thumb" + (i === S.selected ? " sel" : ""));
      t.title = MODES[r.mode].label + " · seed " + r.seed + " · " + r.secs + "s";
      t.onclick = function () { S.selected = i; renderResults(); };
      attach(t, r.path);
      box.appendChild(t);
    });
  }

  async function placeResult(res, silent) {
    try {
      var info = await PS.info();
      var doc = info.doc;
      // 放大模式的结果本来就比文档大：塞回原文档会被 fitToDoc 缩回原尺寸，放大就白做了，
      // 所以直接新开一个文档，尺寸就是放大后的真实尺寸
      if (res.mode === "upscale" && doc && res.w && res.h &&
          (res.w > doc.width * 1.02 || res.h > doc.height * 1.02)) {
        var rd = await PS.place(res.path, { target: "doc" });
        log("放大结果已新开文档：" + rd.name + "（" + res.w + "×" + res.h + "）", "ok");
        if (!silent) toast("已新开文档", "ok");
        return true;
      }
      var fit = "stretch";
      var isInpaint = res.mode === "inpaint";
      var rect = res.rect || null;
      if (doc && res.w && res.h) {
        // 裁剪模式要跟"选区矩形"的比例比，而不是跟整幅画布比
        var ra = res.w / res.h;
        var da = rect ? (rect.w / rect.h) : (doc.width / doc.height);
        // 局部重绘不能用 contain：一旦缩放+居中，蒙版内容和底图就错位，接缝特别明显
        if (!isInpaint && !rect && Math.abs(ra - da) / da > 0.02) fit = "contain";
        if ((isInpaint || rect) && Math.abs(ra - da) / da > 0.05) {
          log("注意：出图与" + (rect ? "选区" : "原图") + "比例差 " + Math.round(Math.abs(ra - da) / da * 100) + "%，合成可能有轻微偏移", "warn");
        }
      }

      /* res.composited = 图在 ComfyUI 里已经按蒙版抠好（选区外 alpha=0）：
       * 这种情况下 PS 只负责把这一层摆到 rect 上，一次删像素都不做 ——
       * 也就绕开了 PS 27 不可用的「反选 + Dlt」和「选区外变红」。 */
      var feather = 0, expand = 0;
      if (isInpaint && doc && !res.composited) {
        var ink = inkFeatherExpand(rect, doc);
        feather = ink.feather; expand = ink.expand;
        log("合成：羽化 " + feather + "px · 扩展 " + expand + "px（" +
            (rect ? "选区块 " + rect.w + "×" + rect.h : "画布短边 " + Math.round(ink.basis) + "px") + "，按比例兜底）");
      }

      var opts = {
        target: "layer",
        fit: fit,
        layerName: "Stars-AI · " + MODES[res.mode].label,
        clipToSelection: false,   // 0.7.21 起永不请求 PS 删像素（背景层 + Dlt = 红色边框）
        allowClip: false,
        feather: feather,
        expand: expand
      };
      if (rect) { opts.rect = rect; opts.fit = "none"; }   // 裁剪模式：放回原来的矩形位置

      /* 没合成成功（出图是整块不透明的）时，绝不能把外扩环一起贴上去 ——
       * 那一圈是模型重新画的背景，压在原图上就是「一圈很粗的边框」（红底照片 = 红框）。
       * 这里把选框相对裁剪矩形的位置算出来，让 PS 先裁掉环再贴。 */
      if (rect && !res.composited) {
        var sr = res.selRect;
        if (sr && sr.w > 8 && sr.h > 8) {
          var ix = sr.x - rect.x, iy = sr.y - rect.y;
          if (ix >= 0 && iy >= 0 && ix + sr.w <= rect.w + 2 && iy + sr.h <= rect.h + 2) {
            opts.inset = { x: ix, y: iy, w: Math.min(sr.w, rect.w - ix), h: Math.min(sr.h, rect.h - iy) };
            log("这次没有 alpha 合成 → 只贴选框范围（" + opts.inset.w + "×" + opts.inset.h + "），外扩环已裁掉");
          }
        }
      }
      var r = await PS.place(res.path, opts);
      if (r.action === "doc") {
        log("已作为新文档打开：" + r.name, "ok");
      } else if (isInpaint) {
        // 局部重绘必须知道这次到底有没有真的按选区合成，否则"整张图插进来"是静默的
        if (res.composited) {
          var cb = r.layerBounds ? (" · 图层范围 " + r.layerBounds.join(",")) : "";
          log("已按选区合成：" + r.name + " · 遮罩在 ComfyUI 内完成（选区外 alpha=0）" + cb +
              (rect ? " · 摆回 " + rect.w + "×" + rect.h + " 原位" : ""), "ok");
        } else if (r.maskKind === undefined) {
          // 旧版 host.jsx 的回执没有 maskKind —— 它既不裁切也会把文档留在通道视图（变灰）
          log("PS 脚本还是旧版（回执里没有 maskKind）→ 点设置里的「重载 PS 脚本」，再跑一次", "err");
          toast("先重载 PS 脚本再试", "err");
        } else if (r.maskKind === "alpha") {
          var bb = r.layerBounds ? (" · 图层范围 " + r.layerBounds.join(",")) : "";
          log("已按选区合成：" + r.name + " · 只保留选区内像素 · 羽化 " + feather + "px · 扩展 " + expand + "px" + bb +
              (rect ? " · 裁剪式（选区单独生成）" : ""), "ok");
        } else if (r.maskKind === "mask") {
          log("已按选区合成：" + r.name + " · 图层蒙版 · 羽化 " + feather + "px · 扩展 " + expand + "px", "ok");
        } else if (r.noSelection) {
          if (r.rect) {
            log("选区在出图期间丢了，已按矩形贴上（没做羽化裁切，边缘可能有硬边）—— 需要羽化的话重新框选再生成", "warn");
          } else {
            log("没有有效选区（出图期间被取消了，或者框选覆盖了整幅画布）—— 已按整图插入。请只框选要改的那一块，再生成一次", "err");
          }
          toast("选区丢了，这次是整图插入", "err");
        } else {
          var why = [];
          if (r.clipError) why.push(r.clipError);
          if (r.fitApplied === false) why.push("图层没铺满画布" + (r.fitError ? "（" + r.fitError + "）" : ""));
          if (r.selUsed) why.push("实际选区 " + r.selUsed.w + "×" + r.selUsed.h);
          /* 0.7.32：0.7.21 起 allowClip 恒为 false，maskKind 永远是 none —— 以前这里会无条件
           * 报「裁切没生效，插入了整图」，但图层其实已经按选区矩形摆好了（fitApplied=true）。
           * 两者要分开：摆位成功 = 正常降级（边缘硬），摆位失败 = 才是真事故。 */
          if (r.fitApplied !== false && rect) {
            log("已按选区位置贴回：" + r.name +
                (r.layerBounds ? " · 图层范围 " + r.layerBounds.join(",") : "") +
                " · 未做透明度合成，选区边界是硬的（蒙版那一步成功后就不会有这条）", "warn");
          } else {
            log("结果没能摆到选区位置，按整图插入了" + (why.length ? " · 原因：" + why.join("；") : "（选区可能整体覆盖了画布）") + " —— 点设置里的「自检 PS 状态」，把那一行发我", "err");
            toast("按选区落位失败，插入了整图", "err");
          }
        }
      } else {
        log("已插入图层：" + r.name + "（" + fit + "）", "ok");
      }
      if (r.viewRestored === false) {
        log("注意：文档没切回复合通道，画面可能显示成灰度 —— 在「通道」面板点最上面的 RGB 即可", "err");
        toast("文档视图停在通道上了，点通道面板的 RGB 复位", "err");
      }
      if (!silent) toast("已插入 Photoshop", "ok");
      return true;
    } catch (e) {
      log("写回失败：" + e.message, "err");
      toast("写回 PS 失败：" + e.message.slice(0, 80), "err");
      return false;
    }
  }

  async function placeAsDoc(res) {
    try {
      var r = await PS.place(res.path, { target: "doc" });
      log("已新开文档：" + r.name, "ok");
    } catch (e) { toast(e.message.slice(0, 100), "err"); }
  }

  /* ---------------- 自定义工作流 ---------------- */

  function parseTemplate(text) {
    var j = JSON.parse(text);
    if (j && Array.isArray(j.nodes) && Array.isArray(j.links)) {
      throw new Error("这是 ComfyUI 界面格式，请在 ComfyUI 菜单里用「工作流 → 导出 (API)」保存 API 格式的 JSON");
    }
    var nodes = j && j.nodes ? j.nodes : j;
    if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) throw new Error("JSON 结构不对：应该是 {节点ID: {class_type, inputs}}");
    var keys = Object.keys(nodes);
    if (!keys.length) throw new Error("JSON 里没有节点");
    keys.forEach(function (k) {
      if (!nodes[k] || typeof nodes[k].class_type !== "string") {
        throw new Error("节点 " + k + " 缺少 class_type，看起来不是 API 格式");
      }
    });
    return { nodes: nodes };
  }

  async function pickWorkflow() {
    try {
      var f = await PS.pickFile("选择 ComfyUI API 格式工作流 JSON");
      if (!f || !f.path) return;
      $("customPath").value = f.path;
      var txt;
      if (Comfy.hasNode && Comfy.fs) txt = Comfy.fs.readFileSync(f.path, "utf8");
      else { var r = await PS.readText(f.path); txt = r.text; }
      var tpl = parseTemplate(txt);
      S.template = tpl;
      S.templateName = f.name || "workflow.json";
      S.templateHasImage = /\{\{\s*image\s*\}\}/.test(txt);
      log("载入工作流：" + S.templateName + " · " + Object.keys(tpl.nodes).length + " 节点", "ok");
      toast("工作流已载入", "ok");
      renderSlots();
    } catch (e) {
      log("载入工作流失败：" + e.message, "err");
      toast(e.message.slice(0, 110), "err");
    }
  }

  /* ---------------- 工坊：分类 + 功能卡 ---------------- */

  // 两个工坊各自的 DOM id 与兜底提示语（加新工坊就在这张表里加一行）
  var WORKSHOPS = {
    anime: {
      grid: "animeGrid", cats: "animeCats", tip: "animeTip",
      sub: "animeSub", count: "animeCount",
      search: "animeSearch", clear: "animeSearchClear",
      defaultTip: "选一个功能：模式、提示词、参数会自动配好",
      defaultSub: "选一个功能：模式、提示词、参数会自动配好"
    },
    nsfw: {
      grid: "nsfwGrid", cats: "nsfwCats", tip: "nsfwTip",
      sub: "nsfwSub", count: "nsfwCount",
      search: "nsfwSearch", clear: "nsfwSearchClear",
      defaultTip: "选一个功能：模式、提示词、参数会自动配好（仅限成年角色）",
      defaultSub: "选一个功能：模式、提示词、参数会自动配好（仅限成年角色）"
    }
  };

  // 副标题：平时是提示语，搜索时是命中数，选过功能后是「已选 xxx」
  function wsSubText(view, hit, total, filtered) {
    var w = WORKSHOPS[view];
    var q = (S.wsQ[view] || "").trim();
    if (q) {
      return "搜索「" + q + "」· 命中 " + hit + " / " + total +
        (hit ? "" : (filtered ? " · 换个词，或点分类条最前面的「全部」" : " · 换个词试试"));
    }
    var p = Presets ? Presets.get(S.presetId) : null;
    if (p && p.view === view) return "已选：" + (p.icon ? p.icon + " " : "") + p.label;
    return w.defaultSub;
  }

  // 渲染一个工坊：搜索 + 分类条 + 按分类分组的卡片。
  // 分类完全由 presets.js 的 CATS 决定 —— 加功能只改数据，这里不用动。
  function renderWorkshop(view, ids) {
    var box = $(ids.grid);
    if (!box || !Presets) return;
    var cur = (view === "nsfw") ? S.nsfwCat : S.animeCat;
    var cats = Presets.cats(view);
    var all = Presets.byView(view);
    var q = (S.wsQ[view] || "").trim().toLowerCase();
    var catLabel = {};
    cats.forEach(function (c) { catLabel[c.id] = c.label; });

    // 搜索：功能名 / 副标题 / 说明 / 分类名 都能命中；空格分隔 = 全部关键词都要命中
    var list = !q ? all : all.filter(function (p) {
      var hay = [p.label, p.desc, p.tip, p.id, catLabel[p.cat] || ""].join(" ").toLowerCase();
      return q.split(/\s+/).every(function (t) { return hay.indexOf(t) !== -1; });
    });

    // 分类条（"全部" 总是第一个）
    var bar = $(ids.cats);
    bar.innerHTML = "";
    [{ id: "all", label: "全部" }].concat(cats).forEach(function (c) {
      var b = el("button", "seg" + (cur === c.id ? " active" : ""));
      b.type = "button";
      b.textContent = c.label;
      b.title = c.label;
      b.onclick = function () { setCat(view, c.id); };
      bar.appendChild(b);
    });

    // 兜底：数据里没登记 cat（或写了错的 cat）的预设归到「其它」，不会凭空消失
    var known = {};
    cats.forEach(function (c) { known[c.id] = true; });
    var orphan = list.filter(function (p) { return !p.cat || !known[p.cat]; });
    var groups = cats.map(function (c) {
      return { id: c.id, label: c.label, items: list.filter(function (p) { return p.cat === c.id; }) };
    });
    if (orphan.length) groups.push({ id: "_other", label: "其它", items: orphan });
    if (cur !== "all") groups = groups.filter(function (g) { return g.id === cur; });

    // 卡片
    box.innerHTML = "";
    var shown = 0;
    groups.forEach(function (g) {
      if (!g.items.length) return;
      shown += g.items.length;
      // 只有「全部」视图才加分类小标题；单分类视图标题是多余的
      if (cur === "all") {
        var head = el("div", "cat-head");
        var t = el("span");
        t.textContent = g.label;
        var n = el("i");
        n.textContent = g.items.length;
        head.appendChild(t);
        head.appendChild(n);
        box.appendChild(head);
      }
      var grid = el("div", "anime-grid");
      g.items.forEach(function (p) { grid.appendChild(presetCard(p, "anime-card")); });
      box.appendChild(grid);
    });

    // 搜索没命中：说清原因，别留一片空白让人以为面板坏了
    if (!shown) {
      var empty = el("div", "ws-empty");
      if (q) {
        empty.appendChild(document.createTextNode("没有匹配「"));
        var kw = el("b");
        kw.textContent = (S.wsQ[view] || "").trim();
        empty.appendChild(kw);
        empty.appendChild(document.createTextNode("」的功能"));
        if (cur !== "all") {
          empty.appendChild(document.createElement("br"));
          empty.appendChild(document.createTextNode("当前只在「" + catLabel[cur] + "」分类里找 —— 点分类条最前面的「全部」再试"));
        }
      } else {
        empty.textContent = "这个分类下还没有功能";
      }
      box.appendChild(empty);
    }

    // 计数徽章 / 清空按钮 / 副标题
    // ⚠ 徽章必须等于「你正在看到几张」：分类筛选时显示该分类数量，
    //   搜索时显示 命中/总数。以前固定显示工坊总数，和列表对不上。
    var filtered = cur !== "all";
    var cnt = $(ids.count);
    if (cnt) cnt.textContent = (!q && !filtered) ? String(all.length) : (shown + (q ? "/" + all.length : ""));
    var clr = $(ids.clear);
    if (clr) clr.classList.toggle("hidden", !q);
    var sub = $(ids.sub);
    if (sub) sub.textContent = wsSubText(view, shown, all.length, filtered);

    var p = Presets.get(S.presetId);
    $(ids.tip).textContent = (p && p.view === view) ? (p.tip || p.desc || "") : ids.defaultTip;
  }

  function setCat(view, cat) {
    if (view === "nsfw") S.nsfwCat = cat || "all";
    else S.animeCat = cat || "all";
    renderWorkshop(view, WORKSHOPS[view]);
  }

  /* ---------------- 二次元工坊 ---------------- */

  // 一张功能卡（二次元 / NSFW 两个工坊共用）
  function presetCard(p, cls) {
    var b = el("button", cls + (S.presetId === p.id ? " active" : ""));
    b.type = "button";
    b.title = p.tip || p.prompt || p.label;
    var ic = el("span", "ac-icon");
    ic.textContent = p.icon || "✦";
    var body = el("span", "ac-body");
    var nm = el("span", "ac-name");
    nm.textContent = p.label;
    var ds = el("span", "ac-desc");
    ds.textContent = p.desc || "";
    body.appendChild(nm);
    body.appendChild(ds);
    b.appendChild(ic);
    b.appendChild(body);
    b.onclick = function () { applyPreset(p); };
    return b;
  }

  function renderAnime() {
    renderWorkshop("anime", WORKSHOPS.anime);
    syncExtra();
  }

  /* ---------------- NSFW 工坊（18+，需先同意免责条款） ---------------- */

  function loadNsfwAck() {
    try {
      var j = JSON.parse(localStorage.getItem(NSFW_KEY) || "null");
      return !!(j && j.ok);
    } catch (e) { return false; }
  }

  function saveNsfwAck(on) {
    try {
      if (on) localStorage.setItem(NSFW_KEY, JSON.stringify({ ok: true, at: new Date().toISOString(), build: BUILD }));
      else localStorage.removeItem(NSFW_KEY);
    } catch (e) {}
  }

  // 锁着的 NSFW 页签：黑色、不可直接进入，点了先弹条款
  function syncNsfwTab() {
    Array.prototype.forEach.call(document.querySelectorAll(".vtab"), function (b) {
      if (b.getAttribute("data-view") !== "nsfw") return;
      b.classList.toggle("locked", !S.nsfwOk);
      b.textContent = S.nsfwOk ? "🔞 NSFW" : "🔒 NSFW";
      b.title = S.nsfwOk
        ? "🔞 NSFW 工坊（仅限 18+，已解锁）"
        : "🔞 18+ 内容：点击查看并同意免责条款后解锁";
    });
  }

  function openNsfwGate() {
    $("nsfwAgree").checked = false;
    $("btnNsfwAccept").disabled = true;
    $("nsfwGate").classList.remove("hidden");
    $("nsfwGateBody").scrollTop = 0;
  }

  function closeNsfwGate() {
    $("nsfwGate").classList.add("hidden");
  }

  function unlockNsfw() {
    if (!$("nsfwAgree").checked) return;
    S.nsfwOk = true;
    saveNsfwAck(true);
    closeNsfwGate();
    log("🔞 已确认年满 18 周岁并同意免责条款，NSFW 工坊已解锁", "warn");
    toast("NSFW 工坊已解锁", "ok");
    setView("nsfw");
  }

  function lockNsfw() {
    S.nsfwOk = false;
    saveNsfwAck(false);
    closeNsfwGate();
    if (S.view === "nsfw") setView("anime");
    syncNsfwTab();
    log("NSFW 工坊已重新锁定", "warn");
    toast("已锁定 NSFW 工坊", "ok");
  }

  function renderNsfw() {
    renderWorkshop("nsfw", WORKSHOPS.nsfw);
    syncExtra();
  }

  function composePrompt(p, fill) {
    var tpl = (p && p.prompt) || "";
    if (!p || !p.fill) return tpl;
    var v = (fill === undefined ? (S.fillTexts && S.fillTexts[p.id]) : fill) || "";
    v = String(v).trim() || p.fill["default"] || "";
    return tpl.split("{fill}").join(v);
  }

  function setFill(v) {
    var p = Presets.get(S.presetId);
    if (!p || !p.fill) return;
    S.fillTexts[p.id] = v;
    $(p.view === "nsfw" ? "nsfwFillInput" : "fillInput").value = v;
    $("prompt").value = composePrompt(p, v);
  }

  // 把 PS 选区的位置/大小翻成一句模型能懂的话。
  // Qwen 模式下模型看不到蒙版，全靠这句话知道"要改哪儿"。
  function selectionPhrase(doc) {
    if (!doc || !doc.selection || !doc.width || !doc.height) return "";
    var s = doc.selection;
    var cx = (s.x + s.w / 2) / doc.width;
    var cy = (s.y + s.h / 2) / doc.height;
    var hx = cx < 0.34 ? "左侧" : (cx > 0.66 ? "右侧" : "中间");
    var vy = cy < 0.34 ? "上方" : (cy > 0.66 ? "下方" : "中部");
    var wPct = Math.max(1, Math.round(s.w / doc.width * 100));
    var hPct = Math.max(1, Math.round(s.h / doc.height * 100));
    return "（只修改画面" + hx + vy + "约占画面宽 " + wPct + "%、高 " + hPct + "% 的那块区域，画面其余部分保持原样）";
  }

  // 裁剪式重绘（0.7.11）：把选区外扩 pad 换算成一个矩形，交给 PS 单独裁出来送去生成。
  // 为什么有用：整图缩到长边 2048 时，选区内有效像素只有 (选区宽/画布宽)×2048；
  // 单独裁出来后，模型那份分辨率预算全花在这块上 —— 这是"清晰度"的真正瓶颈。
  // pad 给 15%（最少 24px、最多 256px）：太紧的话模型不知道边缘该接什么。
  // 返回 null = 不值得裁（选区几乎占满画布）或选区数据不可用 → 退回整图流程。
  function selectionCropRect(doc) {
    if (!doc || !doc.selection || !doc.width || !doc.height) return null;
    var s = doc.selection;
    if (!(s.w > 4 && s.h > 4)) return null;
    if (s.w >= doc.width * 0.85 && s.h >= doc.height * 0.85) return null;
    var pad = Math.min(256, Math.max(24, Math.round(Math.max(s.w, s.h) * 0.15)));
    var x0 = Math.max(0, s.x - pad), y0 = Math.max(0, s.y - pad);
    var x1 = Math.min(doc.width, s.x + s.w + pad), y1 = Math.min(doc.height, s.y + s.h + pad);
    var w = Math.round(x1 - x0), h = Math.round(y1 - y0);
    if (w < 16 || h < 16) return null;
    // 模型对极端长条不友好：短边至少补到长边的 1/6
    var minSide = Math.round(Math.max(w, h) / 6);
    if (w < minSide) { var dx = Math.round((minSide - w) / 2); x0 = Math.max(0, x0 - dx); w = Math.min(doc.width - x0, minSide); }
    if (h < minSide) { var dy = Math.round((minSide - h) / 2); y0 = Math.max(0, y0 - dy); h = Math.min(doc.height - y0, minSide); }
    return { x: Math.round(x0), y: Math.round(y0), w: w, h: h };
  }

  // 裁剪模式下拼进提示词的语境句（预设文案本身一个字不动，只换这句自动追加的说明）
  var CROP_HINT = "（这是原画的一块局部特写，请按描述重画这一块，光线、色调、笔触要与画面其余部分保持一致，不要出现边框、白边或留白）";

  // 需要额外一张图的预设（人物溶图的背景 / 图片融合的物体）
  function extraImageLabel(p) {
    if (!p) return "";
    if (p.extraImage) return p.extraImage.label || "参考图";
    if (p.needsBgImage) return "背景图";
    return "";
  }

  function extraImageOf(p) {
    return (p && S.extraImages[p.id]) || "";
  }

  function setExtraImage(p, path) {
    if (!p) return;
    S.extraImages[p.id] = path || "";
  }

  // 渲染一套「补充条件」（二次元：背景词 / 风格词；NSFW：罩杯 / 服饰等）
  function syncFillPanel(p, ids) {
    var hasFill = !!(p && p.fill);
    var extraLabel = extraImageLabel(p);
    var hasBg = !!(extraLabel && ids.bg);
    $(ids.extra).classList.toggle("hidden", !(hasFill || hasBg));
    show(ids.row, hasFill);
    show(ids.apply, hasFill);
    show(ids.chips, hasFill);
    if (ids.bg) show(ids.bg, hasBg);
    if (ids.drop) show(ids.drop, hasBg);
    if (hasFill) {
      $(ids.label).textContent = p.fill.label || "补充";
      $(ids.input).placeholder = p.fill.placeholder || "";
      $(ids.input).value = S.fillTexts[p.id] || p.fill["default"] || "";
      var box = $(ids.chips);
      box.innerHTML = "";
      (p.fill.chips || []).forEach(function (c) {
        var b = el("button", "chip");
        b.type = "button";
        b.textContent = c;
        b.onclick = function () { setFill(c); };
        box.appendChild(b);
      });
    }
    if (hasBg) {
      $(ids.bgPath).value = extraImageOf(p) || "";
      if (ids.bgLabel) $(ids.bgLabel).textContent = extraLabel;
      if (ids.dropHint) {
        $(ids.dropHint).textContent = "把「" + extraLabel + "」的图片直接拖到这里，或点右边「选择」";
      }
      if (ids.bgPath) $(ids.bgPath).placeholder = (p.extraImage && p.extraImage.placeholder) || "选一张图";
    }
  }

  function syncExtra() {
    var p = Presets.get(S.presetId);
    var isNsfw = !!(p && p.view === "nsfw");
    syncFillPanel(isNsfw ? null : p, {
      extra: "animeExtra", row: "fillRow", apply: "btnFillApply", chips: "fillChips",
      label: "fillLabel", input: "fillInput", bg: "bgRow", bgPath: "bgPath",
      bgLabel: "bgLabel", drop: "dropZone", dropHint: "dropHint"
    });
    syncFillPanel(isNsfw ? p : null, {
      extra: "nsfwExtra", row: "nsfwFillRow", apply: "btnNsfwFillApply", chips: "nsfwFillChips",
      label: "nsfwFillLabel", input: "nsfwFillInput"
    });
  }

  function setView(v) {
    // 没同意条款就不许进 NSFW：直接弹层，视图保持不动
    if (v === "nsfw" && !S.nsfwOk) { openNsfwGate(); return; }
    // 只有两个工坊；老 localStorage 里的 "edit" 之类一律落到二次元工坊
    S.view = (v === "nsfw") ? "nsfw" : "anime";
    $("viewAnime").classList.toggle("hidden", S.view !== "anime");
    $("viewNsfw").classList.toggle("hidden", S.view !== "nsfw");
    Array.prototype.forEach.call(document.querySelectorAll(".vtab"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === S.view);
    });
    syncNsfwTab();
    if (S.view === "anime") {
      renderAnime();
      if (S.mode === "txt2img") setMode("edit");   // 二次元基本都从一张图开始
    } else {
      renderNsfw();
      if (S.mode === "txt2img") setMode("edit");
    }
    saveSettings();
  }

  function selectUpscaleByPattern(pattern) {
    var sel = document.querySelector('#modelSlots select[data-kind="upscale"]');
    if (!sel || !pattern) return;
    var hit = Array.prototype.slice.call(sel.options).map(function (o) { return o.value; })
      .filter(function (v) { return v && new RegExp(pattern, "i").test(v); })[0];
    if (hit) {
      sel.value = hit;
      S.models.upscale = hit;
      log("放大模型切到 " + hit);
    }
  }

  async function applyPreset(p, silent) {
    if (!p) return;
    S.presetId = p.id;
    if (p.mode && p.mode !== S.mode) {
      // 结构性模式必须按卡片的来，否则这张卡不成立；图生图 / 文生图 不抢用户的选择
      if (STRUCTURAL_MODES[p.mode] || !S.modePinned) setMode(p.mode);
    }
    if (p.arch && p.arch !== S.arch) {
      S.arch = p.arch;
      $("archSelect").value = p.arch;
      syncFields();
      renderSlots();
    }
    if (p.prompt !== undefined) {
      if (p.fill) {
        // 每个预设各自记住上次选的补充值（罩杯/背景词互不干扰）；
        // 只有从没填过才回落到该预设的默认值
        if (!S.fillTexts[p.id]) S.fillTexts[p.id] = p.fill["default"] || "";
        $("prompt").value = composePrompt(p, S.fillTexts[p.id]);
      } else {
        $("prompt").value = p.prompt;
      }
    }
    if (p.negative !== undefined) {
      $("negative").value = p.negative;
      var d = document.querySelector(".neg");
      if (d) d.open = !!p.negative;
    }
    var q = p.params || {};
    if (q.steps) $("pSteps").value = q.steps;
    if (q.cfg !== undefined) $("pCfg").value = q.cfg;
    if (q.resolution) $("pResolution").value = String(q.resolution);
    if (q.denoise !== undefined) $("pDenoise").value = q.denoise;
    if (q.scale) $("pScale").value = String(q.scale);
    if (q.feather !== undefined) $("pFeather").value = q.feather;
    if (q.expand !== undefined) $("pExpand").value = q.expand;
    if (p.upscaleMatch) selectUpscaleByPattern(p.upscaleMatch);

    renderAnime();
    renderNsfw();
    saveSettings();

    if (p.needsSelection) {
      try {
        var info = await PS.info();
        if (!info.doc || !info.doc.hasSelection) log("「" + p.label + "」需要先在 PS 里框选区域", "warn");
      } catch (e) {}
    }

    if (!silent && S.settings.presetRun) {
      log("预设「" + p.label + "」→ 直接生成");
      run();
    } else if (!silent) {
      log("已套用「" + p.label + "」，按生成开始");
    }
  }

  /* ---------------- 启动 ComfyUI ---------------- */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function probePorts(quiet) {
    var ports = [8188, 8000, 8001, 8189];
    for (var i = 0; i < ports.length; i++) {
      var url = "http://127.0.0.1:" + ports[i];
      try {
        var c = new Comfy.ComfyClient(url);
        var info = await c.ping(1500);
        if (!quiet) log("探测到 ComfyUI：" + url + "（v" + info.version + "）", "ok");
        return { url: url, info: info };
      } catch (e) {}
    }
    return null;
  }

  async function waitForServer(totalMs, pid) {
    var t0 = Date.now();
    var lastLog = 0;
    while (Date.now() - t0 < totalMs) {
      var f = await probePorts(true);
      if (f) return f;
      if (pid && PS.isAlive && !PS.isAlive(pid)) return null;   // 进程已经退出，不用再等
      var sec = Math.round((Date.now() - t0) / 1000);
      progress("ComfyUI 启动中 " + sec + "s…");
      if (sec - lastLog >= 15) { lastLog = sec; log("等待服务就绪 " + sec + "s…"); }
      await sleep(2000);
    }
    return null;
  }

  async function launchComfy() {
    if (S.launching) return;
    S.launching = true;
    var btn = $("btnLaunch");
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "启动中…";
    setStatus("busy", "启动中");
    $("progressWrap").classList.remove("hidden");
    progress("查找 ComfyUI…");
    try {
      var det = await PS.detectComfy(S.settings.comfyPath, S.settings.launchKind || "auto");
      if (!det.ok) throw new Error(det.error || "没找到 ComfyUI");
      log("启动方式：" + det.label, "ok");
      log("命令：" + det.command);
      var r = await PS.launchComfy(det);
      if (!r.ok) throw new Error(r.error || "启动失败");
      log("已拉起 pid=" + r.pid + "，等待端口就绪…");

      var found = await waitForServer(det.kind === "desktop" ? 90000 : 180000, r.pid);

      // 桌面版被拦/秒退时，自动退到无头模式（模型路径会带上桌面版的共享目录）
      if (!found && det.kind === "desktop") {
        log("桌面版没有起来（进程已退出或被拦住），改用无头模式…", "warn");
        var hl = await PS.detectHeadless();
        if (hl) {
          log("无头命令：" + hl.command);
          var r2 = await PS.launchComfy(hl);
          if (r2.ok) {
            log("已拉起 pid=" + r2.pid + "，继续等端口…");
            found = await waitForServer(180000, r2.pid);
          }
        } else {
          log("也没找到 main.py，没法自动启动；请手动打开 ComfyUI 桌面版", "err");
        }
      }
      if (!found) throw new Error("起不来：看看任务栏是不是卡在启动界面，或在设置里改用无头模式");
      $("serverInput").value = found.url;
      toast("ComfyUI 已启动", "ok");
      S.launchTried = false;
      await connect();
    } catch (e) {
      log("启动失败：" + e.message, "err");
      toast(e.message.slice(0, 110), "err");
      setStatus(S.connected ? "ok" : "err", S.connected ? "已连接" : "未连接");
    } finally {
      S.launching = false;
      btn.disabled = false;
      btn.textContent = label;
      if (!S.busy) $("progressWrap").classList.add("hidden");
    }
  }

  /* ---------------- 初始化 ---------------- */

  /* ---------------- 拖拽图片进面板 ---------------- */

  var IMG_RE = /\.(png|jpe?g|webp|bmp|gif|tif?f)$/i;

  // 拖进来的文件 → 本机路径：CEP 的 File 自带 path；浏览器预览没有，就读出来落到临时目录
  function dropPath(file) {
    if (!file) return Promise.reject(new Error("没有文件"));
    if (file.path) return Promise.resolve(file.path);
    return new Promise(function (resolve, reject) {
      if (!Comfy.hasNode || !Comfy.fs) return reject(new Error("当前环境拿不到文件路径"));
      var dest = (S.tempDir || PS.tmpDir()) + "/" + (file.name || ("drop_" + Date.now() + ".png"));
      var fr = new FileReader();
      fr.onload = function () {
        try { Comfy.fs.writeFileSync(dest, Buffer.from(new Uint8Array(fr.result))); resolve(dest); }
        catch (e) { reject(e); }
      };
      fr.onerror = function () { reject(new Error("读取拖入的文件失败")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function initDropZone() {
    var zone = $("dropZone");
    var depth = 0;
    function stop(e) { e.preventDefault(); e.stopPropagation(); }
    function hasFiles(e) {
      var dt = e.dataTransfer;
      if (!dt) return false;
      var t = dt.types || [];
      for (var i = 0; i < t.length; i++) { if (t[i] === "Files") return true; }
      return false;
    }
    function setOver(on) { if (zone) zone.classList.toggle("over", !!on); }

    document.addEventListener("dragenter", function (e) { if (!hasFiles(e)) return; depth++; setOver(true); });
    document.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      stop(e);
      try { e.dataTransfer.dropEffect = "copy"; } catch (e2) {}
      setOver(true);
    });
    document.addEventListener("dragleave", function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    });
    document.addEventListener("drop", async function (e) {
      if (!hasFiles(e)) return;
      stop(e);
      depth = 0;
      setOver(false);
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var p = Presets.get(S.presetId);
      var label = extraImageLabel(p);
      if (!label) {
        toast("先选「🧷 图片融合」或「🧩 人物溶图」，再把图片拖进来", "err");
        log("拖进来一个文件，但当前功能不需要额外的图：" + (file.name || "?"), "warn");
        return;
      }
      if (!IMG_RE.test(file.name || file.path || "")) {
        toast("只支持图片文件（png / jpg / webp / bmp）", "err");
        log("拖入的文件不是图片：" + (file.name || file.path), "warn");
        return;
      }
      try {
        var p2 = await dropPath(file);
        setExtraImage(p, p2);
        $("bgPath").value = p2;
        log(label + "已就绪：" + p2, "ok");
        toast(label + "已就绪，点生成开始融合", "ok");
      } catch (err) {
        log("拖入文件失败：" + err.message, "err");
        toast("拖入失败：" + String(err.message).slice(0, 60), "err");
      }
    });
  }


  /* ---------------- 维护：清理 / 安全自检（0.7.17） ---------------- */

  var cleanArmAt = 0, cleanArmTimer = null;

  function fmtSize(bytes) {
    bytes = Number(bytes) || 0;
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(0, Math.round(bytes / 1024)) + " KB";
  }

  // 只统计不删：把「可清理多少」显示在设置里（扫目录很快，不进主流程）
  async function refreshCleanInfo() {
    var box = $("cleanInfo");
    if (!box) return;
    box.textContent = "正在统计…";
    try {
      var r = await PS.cleanTemp({ dryRun: true, comfyPath: S.settings.comfyPath });
      var files = (r.temp ? r.temp.matched : 0), bytes = (r.temp ? r.temp.matchedBytes : 0);
      (r.comfyDirs || []).forEach(function (d) { files += d.matched; bytes += d.matchedBytes; });
      box.textContent = files ? ("可清理 " + files + " 个文件 · " + fmtSize(bytes)) : "没有可清理的文件";
      if (r.errors && r.errors.length) box.title = r.errors.join("\n");
    } catch (e) {
      box.textContent = "统计失败：" + String(e.message || e).slice(0, 60);
    }
  }

  function disarmClean() {
    cleanArmAt = 0;
    if (cleanArmTimer) { clearTimeout(cleanArmTimer); cleanArmTimer = null; }
    var b = $("btnCleanCache");
    if (b) b.classList.remove("armed");
    var i = $("cleanInfo");
    if (i && i.textContent.indexOf("再点一次") === 0) refreshCleanInfo();
  }

  /* 清理缓存和临时目录。
   * 两次点击确认（CEP 里 window.confirm 有时被吞，用状态机更稳）：
   * 第一下只上膛，6 秒内第二下才真删。删的东西全在下面这两处，绝不碰用户的图：
   *   1) 面板临时目录里的 src_/out_/*_cut（保留 extra_model_paths.yaml）
   *   2) ComfyUI input/ 里 starsai_* 的上传残留
   */
  async function cleanCache(quick) {
    if (S.busy) { toast("正在生成，等它结束再清理（文件还在用）", "err"); return; }
    var now = Date.now();
    if (!cleanArmAt || now - cleanArmAt > 6000) {
      cleanArmAt = now;
      var b0 = $("btnCleanCache");
      if (b0) b0.classList.add("armed");
      var i0 = $("cleanInfo");
      if (i0) i0.textContent = "再点一次 🗑 确认清理 · 6 秒内有效";
      toast(quick ? "再点一次 🗑 确认清理" : "再点一次「清理缓存和临时目录」确认", "warn");
      if (cleanArmTimer) clearTimeout(cleanArmTimer);
      cleanArmTimer = setTimeout(disarmClean, 6000);
      return;
    }
    disarmClean();
    var btn = $("btnCleanCache");
    if (btn) btn.disabled = true;
    try {
      var r = await PS.cleanTemp({ dryRun: false, comfyPath: S.settings.comfyPath });
      var totalFiles = r.tempRemoved + r.comfyRemoved;
      var totalBytes = r.tempFreed + r.comfyFreed;
      log("已清理 " + totalFiles + " 个文件 · 释放 " + fmtSize(totalBytes), totalFiles ? "ok" : "warn");
      log("  临时目录：删了 " + r.tempRemoved + " 个（" + fmtSize(r.tempFreed) + "）· " + r.tempDir);
      (r.comfyDirs || []).forEach(function (d) {
        log("  ComfyUI 上传残留：删了 " + d.matched + " 个（" + fmtSize(d.matchedBytes) + "）· " + d.dir);
      });
      (r.errors || []).forEach(function (m) { log("  跳过：" + m, "warn"); });
      // 结果缩略图指向的文件已经删了：先清空，否则面板会显示一排破图
      S.results = [];
      S.selected = -1;
      renderResults();
      try { if (S.client) S.client.reset(); } catch (eR) {}   // 节点表缓存作废，下次连接重新读
      log("  面板缓存已清空（结果缩略图 / 节点表）；设置和参数不受影响", "ok");
      toast(totalFiles ? ("已清理 " + totalFiles + " 个文件，释放 " + fmtSize(totalBytes)) : "没有需要清理的文件", totalFiles ? "ok" : "warn");
    } catch (e) {
      log("清理失败：" + e.message, "err");
      toast("清理失败：" + String(e.message).slice(0, 80), "err");
    } finally {
      if (btn) btn.disabled = false;
      refreshCleanInfo();
    }
  }

  /* 自检写回链路：host.jsx 的 selfTest 全部跑在文档副本上，用户的图一个像素都不动。
   * 目的：0.7.9~0.7.16 那些"只能真机赌一次"的步骤（makeActive / crop / resizeCanvas /
   * translate / Dlt），点一下就能拿到"这台 PS 到底支持哪一步"的答案。 */
  async function runSelfTest() {
    if (S.busy) { toast("正在生成，等它结束再自检（会和写回抢同一个文档）", "err"); return; }
    var btn = $("btnSelfTest");
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "自检中…"; }
    progress("自检中（只在文档副本上跑，不会改你的图）…");
    $("progressWrap").classList.remove("hidden");
    try {
      var outPath = (S.tempDir || PS.tmpDir()) + "/selftest_" + Date.now() + ".png";
      var r = await PS.selfTest(outPath);
      if (r.mock) { log("当前是浏览器预览模式，探针没有实际执行", "warn"); return; }
      log("—— 自检开始 · Photoshop " + r.ps + " · PS 脚本 " + r.jsx + " ——");
      if (r.doc) {
        log("文档：" + r.doc.name + " · " + r.doc.w + "×" + r.doc.h + " · " + r.doc.channels + " 通道 · " + r.doc.layers + " 图层" +
            (r.doc.quickMask ? " · ⚠ 快速蒙版开着" : "") +
            (r.doc.hasSel ? (" · 有选区 " + (r.doc.sel ? (r.doc.sel.w + "×" + r.doc.sel.h) : "")) : " · 无选区"));
      }
      var pl = r.probeLayers || [];
      if (pl.length) {
        log("图层切换（makeActive）：共 " + pl.length + " 个");
        pl.forEach(function (p) {
          log("  " + (p.ok ? "✓" : "✗") + " 「" + p.name + "」" + (p.inGroup ? "（组内）" : "（顶层）") + " " + (p.ok ? "能切过去" : ("切不过去：" + (p.error || "未知"))), p.ok ? "ok" : "warn");
        });
      }
      (r.steps || []).forEach(function (st) {
        log("  " + (st.ok ? "✓" : "✗") + " " + st.name + " · " + st.ms + "ms" + (st.detail ? " · " + st.detail : "") + (st.error ? " · " + st.error : ""), st.ok ? "ok" : "err");
      });
      (r.warnings || []).forEach(function (w) { log("  ⚠ " + w, "warn"); });
      if (r.topError) log("  ✗ 探针整体中断：" + r.topError, "err");
      log("自检结论：" + r.verdict + "（通过 " + r.pass + " · 失败 " + r.fail + "）· 你的文档未被修改", r.fail ? "err" : "ok");
      toast(r.fail ? ("自检有 " + r.fail + " 步失败，看日志") : "自检全部通过", r.fail ? "err" : "ok");
    } catch (e) {
      log("自检失败：" + e.message, "err");
      toast("自检失败：" + String(e.message).slice(0, 80), "err");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (!S.busy) $("progressWrap").classList.add("hidden");
    }
  }

  function bind() {
    $("btnConnect").onclick = connect;
    // 点预览图 = 全屏看大图（面板窗口再小也能看全）
    $("previewImg").onclick = openLightbox;
    $("lightbox").onclick = closeLightbox;
    document.addEventListener("keydown", function (e) {
      // Esc 逐层关：大图 → 设置抽屉（18+ 条款弹层有自己的取消按钮）
      if (e.key === "Escape" || e.keyCode === 27) {
        closeLightbox();
        $("drawer").classList.remove("open");
      }
      // Ctrl / Cmd + Enter = 生成（手不用离开输入框）
      if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.keyCode === 13)) {
        e.preventDefault();
        // 弹层开着的时候不能凭空开始生成：18+ 条款还没同意 / 设置抽屉正开着
        var gateOpen = !$("nsfwGate").classList.contains("hidden");
        var drawerOpen = $("drawer").classList.contains("open");
        if (!S.busy && !gateOpen && !drawerOpen) run();
      }
    });
    $("serverInput").addEventListener("keydown", function (e) { if (e.key === "Enter") connect(); });
    $("btnRefreshModels").onclick = function () { refreshModels(); };
    $("btnRun").onclick = run;
    $("btnCancel").onclick = async function () {
      if (S.canceled) return;
      S.canceled = true;
      log("已请求取消…", "warn");
      if (!S.client) return;
      try {
        // /interrupt 只停当前正在跑的那个；排队中的任务要单独从队列里删掉，
        // 否则它会继续跑完，然后把结果插进 PS
        if (S.pid && S.client.dequeue) await S.client.dequeue(S.pid);
        await S.client.interrupt();
      } catch (e) { log("取消请求没发出去：" + e.message, "warn"); }
    };
    $("btnDice").onclick = function () { $("pSeed").value = -1; S.seedAuto = null; };
    // 在「种子」框里打字/改数 = 明确要固定这个种子（不再是自动回填的那次）
    $("pSeed").addEventListener("input", function () { S.seedAuto = null; });
    $("btnPlaceLayer").onclick = function () { if (S.results[S.selected]) placeResult(S.results[S.selected]); };
    $("btnPlaceDoc").onclick = function () { if (S.results[S.selected]) placeAsDoc(S.results[S.selected]); };
    $("btnReveal").onclick = function () {
      var r = S.results[S.selected];
      if (!r) return;
      if (!PS.reveal(r.path)) toast("无法打开文件：" + r.path, "err");
    };
    function syncArchTitle() {
      var s = $("archSelect");
      s.title = s.selectedOptions[0] ? s.selectedOptions[0].textContent : "";
    }
    syncArchTitle();
    $("archSelect").onchange = function () {
      syncArchTitle();
      S.arch = this.value;
      applyArchDefaults(S.arch);
      syncFields();
      renderSlots();
      saveSettings();
    };
    // 手动指定模式（默认由工坊卡决定）；改完记得同步提示语和参数可见性
    $("modeSelect").onchange = function () { setMode(this.value, true); };
    // 解除锁定：回到「点卡就跟着卡的默认模式走」
    $("btnModeFollow").onclick = function () {
      S.modePinned = false;
      var pc = Presets.get(S.presetId);
      setMode((pc && pc.mode) ? pc.mode : S.mode);
      log("模式改回「跟随所选功能」（点功能卡时会自动切）");
      toast("已恢复跟随功能卡", "ok");
    };
    $("btnPickWorkflow").onclick = pickWorkflow;

    Array.prototype.forEach.call(document.querySelectorAll(".vtab"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-view");
        if (v === "nsfw" && !S.nsfwOk) { openNsfwGate(); return; }
        setView(v);
      };
    });

    // ---- 工坊：搜索 ----
    ["anime", "nsfw"].forEach(function (v) {
      var w = WORKSHOPS[v];
      var s = $(w.search);
      if (!s) return;
      s.addEventListener("input", function () {
        S.wsQ[v] = this.value;
        renderWorkshop(v, w);
      });
      // 搜索框里回车 = 直接套用第一张卡；Esc = 清空关键词
      s.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.stopPropagation();
          this.value = ""; S.wsQ[v] = ""; renderWorkshop(v, w);
        } else if (e.key === "Enter") {
          e.preventDefault();
          var first = document.querySelector("#" + w.grid + " .anime-card");
          if (first) first.click();
        }
      });
      var clr = $(w.clear);
      if (clr) clr.onclick = function () {
        S.wsQ[v] = ""; $(w.search).value = "";
        renderWorkshop(v, w);
        $(w.search).focus();
      };
    });

    // 18+ 免责条款弹层
    $("nsfwAgree").onchange = function () { $("btnNsfwAccept").disabled = !this.checked; };
    $("btnNsfwCancel").onclick = closeNsfwGate;
    $("btnNsfwAccept").onclick = unlockNsfw;
    $("nsfwGate").onclick = function (e) { if (e.target === this) closeNsfwGate(); };
    $("btnNsfwLock").onclick = lockNsfw;
    function syncPresetRun(on) {
      S.settings.presetRun = on;
      $("setPresetRunAnime").checked = on;
      saveSettings();
    }
    $("setPresetRunAnime").onchange = function () { syncPresetRun(this.checked); };
    $("btnFillApply").onclick = function () { setFill($("fillInput").value.trim()); log("补充条件：" + $("fillInput").value.trim()); };
    $("fillInput").onkeydown = function (e) { if (e.key === "Enter") { setFill(this.value.trim()); this.blur(); } };
    $("fillInput").onchange = function () { setFill(this.value.trim()); };
    // NSFW 工坊的补充条件（罩杯等）
    $("btnNsfwFillApply").onclick = function () {
      setFill($("nsfwFillInput").value.trim());
      log("补充条件：" + $("nsfwFillInput").value.trim());
    };
    $("nsfwFillInput").onkeydown = function (e) { if (e.key === "Enter") { setFill(this.value.trim()); this.blur(); } };
    $("nsfwFillInput").onchange = function () { setFill(this.value.trim()); };
    $("btnPickBg").onclick = async function () {
      var p = Presets.get(S.presetId);
      var label = extraImageLabel(p);
      if (!label) { toast("先选「人物溶图」或「图片融合」", "err"); return; }
      try {
        var f = await PS.pickFile("选择" + label);
        if (f && f.path) {
          setExtraImage(p, f.path);
          $("bgPath").value = f.path;
          log(label + "已选：" + f.path);
          toast(label + "已选", "ok");
        }
      } catch (e) { toast(e.message.slice(0, 100), "err"); }
    };

    // ---- 拖拽：把图片直接拖进面板 ----
    initDropZone();
    $("btnLaunch").onclick = function () { S.launchTried = false; launchComfy(); };
    $("setAutoLaunch").onchange = function () { S.settings.autoLaunch = this.checked; saveSettings(); };
    $("btnAutoTune").onclick = function () { applyAutoTune(false); };
    $("btnParamsTune").onclick = function () { applyAutoTune(false); };
    $("setAutoTune").onchange = function () { S.settings.autoTune = this.checked; saveSettings(); };
    $("setMaxEdge").onchange = function () {
      S.settings.maxEdge = clamp(this.value, 512, 8192);
      this.value = S.settings.maxEdge;
      saveSettings();
    };
    $("setLaunchKind").onchange = function () { S.settings.launchKind = this.value; saveSettings(); };
    $("setComfyPath").onchange = function () { S.settings.comfyPath = this.value.trim(); saveSettings(); };
    $("btnPickComfy").onclick = async function () {
      try {
        var f = await PS.pickFolder("选择 ComfyUI 目录（含 main.py 或 Comfy Desktop.exe）");
        if (f && f.path) {
          $("setComfyPath").value = f.path;
          S.settings.comfyPath = f.path;
          saveSettings();
          log("ComfyUI 路径设为：" + f.path);
        }
      } catch (e) { toast(e.message.slice(0, 100), "err"); }
    };

    $("logToggle").onclick = function () { $("logWrap").classList.toggle("open"); };
    $("btnLogClear").onclick = function (e) {
      e.stopPropagation();          // 清日志不该顺带把日志区折叠/展开
      $("log").innerHTML = "";
      $("logLast").textContent = "";
    };

    // 维护：清理缓存/临时目录（顶栏垃圾桶 + 设置里那条，同一套两次确认逻辑）
    $("btnCleanQuick").onclick = function () { cleanCache(true); };
    $("btnCleanCache").onclick = function () { cleanCache(false); };
    $("btnSelfTest").onclick = runSelfTest;

    $("btnSettings").onclick = function () {
      $("setServer").value = S.server;
      $("setTimeout").value = S.settings.timeoutMin;
      $("setAutoPlace").checked = !!S.settings.autoPlace;
      $("setSkipAi").checked = S.settings.skipAi !== false;
      $("setAutoLaunch").checked = !!S.settings.autoLaunch;
      $("setLaunchKind").value = S.settings.launchKind || "auto";
      $("setComfyPath").value = S.settings.comfyPath || "";
      $("setVerbose").checked = !!S.settings.verbose;
      $("setMaxEdge").value = S.settings.maxEdge || 2048;
      $("setAutoTune").checked = !!S.settings.autoTune;
      renderHwInfo();
      $("aboutVer").textContent = "Stars-AI v" + BUILD;
      $("aboutTemp").textContent = "面板 build " + BUILD + " · 临时目录：" + S.tempDir;
      $("aboutServer").textContent = "ComfyUI：" + S.server + (S.connected ? "（已连接）" : "（未连接）");
      refreshCleanInfo();   // 打开设置时顺手统计一下能清多少
      $("drawer").classList.add("open");
    };
    $("btnCloseDrawer").onclick = function () { $("drawer").classList.remove("open"); };
    $("setServer").onchange = function () { $("serverInput").value = this.value.trim(); S.server = this.value.trim(); saveSettings(); };
    $("setTimeout").onchange = function () { S.settings.timeoutMin = clamp(this.value, 1, 120); saveSettings(); };
    $("setAutoPlace").onchange = function () { S.settings.autoPlace = this.checked; saveSettings(); };
    $("setSkipAi").onchange = function () { S.settings.skipAi = this.checked; saveSettings(); };
    $("setVerbose").onchange = function () { S.settings.verbose = this.checked; saveSettings(); };
    $("btnDiag").onclick = async function () {
      try {
        var d = await PS.diag();
        log("PS 自检：" + JSON.stringify(d), "ok");
        toast("自检结果已写入日志", "ok");
      } catch (e) {
        log("自检失败：" + e.message, "err");
        toast("自检失败", "err");
      }
    };
    $("btnReloadJsx").onclick = async function () {
      try {
        var r = await PS.reloadScript();
        log("PS 脚本已重载（" + r.bytes + " 字节）", "ok");
        toast("PS 脚本已重载", "ok");
      } catch (e) {
        log("重载失败：" + e.message, "err");
        toast(e.message.slice(0, 100), "err");
      }
    };
    $("btnReset").onclick = function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      applyArchDefaults(S.arch);
      toast("已恢复默认参数", "ok");
    };

    ["prompt", "negative", "pSteps", "pCfg", "pSampler", "pScheduler", "pResolution", "pWidth", "pHeight", "pSeed", "pDenoise", "pScale", "pFeather", "pExpand"].forEach(function (id) {
      var e = $(id);
      if (e) e.addEventListener("change", saveSettings);
    });
  }

  function applyArchDefaults(arch) {
    if (arch === "qwen") {
      $("pSteps").value = 30;
      $("pCfg").value = 1;
      $("pSampler").value = "euler";
      $("pScheduler").value = "simple";
      $("pResolution").value = "1024";
    } else {
      $("pSteps").value = 20;
      $("pCfg").value = 7;
      $("pWidth").value = 1024;
      $("pHeight").value = 1024;
    }
  }

  async function init() {
    S.tempDir = PS.tmpDir();
    loadSettings();
    S.nsfwOk = loadNsfwAck();
    // 开发预览用：?server=http://127.0.0.1:8799/comfy 可以指向代理
    try {
      var qp = new URLSearchParams(location.search);
      var sv = qp.get("server");
      if (sv) S.server = sv;
      var qm = qp.get("mode");
      if (qm && MODES[qm]) S.mode = qm;
    } catch (e) {}
    $("serverInput").value = S.server;
    $("archSelect").value = S.arch;
    bind();
    // 用当前 mode（可能是 ?mode= 或默认值），不要写死 txt2img —— 否则预览服务器传的 ?mode= 直接失效
    setMode(MODES[S.mode] ? S.mode : "txt2img");
    $("setPresetRunAnime").checked = !!S.settings.presetRun;
    renderAnime();
    renderNsfw();
    syncNsfwTab();
    // 上次停在 NSFW 但同意记录没了（换了台机器 / 清过缓存）→ 回到二次元工坊，别直接跳进去
    setView(S.view === "nsfw" && !S.nsfwOk ? "anime" : (S.view || "anime"));
    if (S.params) applyParams(S.params);
    /* 0.7.40 迁移：以前「生成完把实际种子写回输入框」会把种子永久钉死，
     * 本地存下来的那个数字就是这么来的（真机证据：连 8 次生成的 seed 全是 1822763858）。
     * 只释放一次，之后想固定就自己填。 */
    try {
      if (!localStorage.getItem("starsai.seed.release.v1")) {
        if (Number($("pSeed").value) >= 0) {
          log("已把「种子」释放为 -1：以前生成完会自动写回，导致每次都同一个种子（同一套噪点反复出现）。想固定就自己填一个数", "warn");
          $("pSeed").value = -1;
        }
        localStorage.setItem("starsai.seed.release.v1", "1");
      }
    } catch (eSeed) {}
    renderResults();

    if (!Comfy.hasNode) log("注意：面板没有启用 Node 权限，网络请求会退回浏览器 fetch（可能被 CORS 拦截）", "warn");
    if (PS.mode === "broken") {
      log("Photoshop 桥未就绪：CSInterface 没拿到（面板会一直失败），请重启 PS 或重开面板", "err");
      toast("没连上 Photoshop，请重启 PS", "err");
    }
    if (!PS.available) {
      log("当前是浏览器预览模式（不在 Photoshop 里），文档相关操作会使用模拟数据", "warn");
    } else {
      try {
        var ping = await PS.ping();
        log("Photoshop " + ping.ps + " · 打开文档 " + ping.docs + " 个 · 面板 build " + BUILD +
          (ping.jsx ? (" · PS 脚本 " + ping.jsx) : " · PS 脚本版本未知"));
        // 自动把 PS 脚本同步到与面板一致的版本：CEP 只在面板加载时执行一次 ScriptPath，
        // 不这么做就会出现"改了 host.jsx 但行为还是旧的"这种极难排查的情况。
        if (!ping.jsx || String(ping.jsx) !== BUILD) {
          log("PS 脚本 " + (ping.jsx || "未知（很旧）") + " ≠ 面板 " + BUILD + "，正在自动同步…", "warn");
          try {
            await PS.reloadScript();
            var ping2 = await PS.ping();
            if (String(ping2.jsx) === BUILD) log("PS 脚本已同步到 " + BUILD + "（无需重启 PS）", "ok");
            else log("自动同步后仍是 " + (ping2.jsx || "未知") + " → 请在设置里手动点「重载 PS 脚本」，或关掉面板重开", "err");
          } catch (e) {
            log("自动同步失败：" + e.message + "（请在设置里手动点「重载 PS 脚本」）", "err");
          }
        }
      } catch (e) { log("Photoshop 握手失败：" + e.message, "err"); }
    }
    connect();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

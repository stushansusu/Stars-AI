/* Stars-AI · CEP <-> Photoshop 桥
 * 在 PS 里走 CSInterface.evalScript 调 jsx/host.jsx；
 * 在普通浏览器里（预览 UI 用）自动降级成 mock，方便截图/调试。
 */
(function (global) {
  "use strict";

  var cepApi = null;
  try { cepApi = (typeof window !== "undefined" && window.__adobe_cep__) || null; } catch (e) {}
  var cep = null;
  try {
    if (typeof CSInterface !== "undefined") cep = new CSInterface();
  } catch (e) { cep = null; }

  var hasCEP = !!cep && typeof cep.evalScript === "function";
  var inCEP = !!cepApi;   // 在 Photoshop 里（即使桥没接上也别装成浏览器预览）
  function notReady() {
    return Promise.reject(new Error("面板没连上 Photoshop（CSInterface 未就绪）：请重启 Photoshop 或重新打开 Stars-AI 面板"));
  }
  var nodeFs = null, nodePath = null, nodeOs = null, childProcess = null;
  try {
    if (typeof require === "function") {
      nodeFs = require("fs");
      nodePath = require("path");
      nodeOs = require("os");
      childProcess = require("child_process");
    }
  } catch (e) {}

  function tmpDir() {
    var base = "/tmp";
    try { if (nodeOs) base = nodeOs.tmpdir(); } catch (e) {}
    var dir = (nodePath ? nodePath.join(base, "Stars-AI") : base + "/Stars-AI");
    try {
      if (nodeFs && !nodeFs.existsSync(dir)) nodeFs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
    return dir;
  }

  function ensureDir(p) {
    try {
      if (nodeFs && nodePath && !nodeFs.existsSync(p)) nodeFs.mkdirSync(p, { recursive: true });
    } catch (e) {}
  }

  function evalScript(code) {
    return new Promise(function (resolve, reject) {
      cep.evalScript(code, function (res) {
        if (res === "EvalScript error." || res === "" || res === undefined || res === null) {
          reject(new Error("Photoshop 脚本执行失败：" + String(res)));
          return;
        }
        var data = null;
        try { data = JSON.parse(res); } catch (e) { reject(new Error("脚本返回无法解析：" + String(res).slice(0, 200))); return; }
        if (data && data.ok === false) { reject(new Error(data.error || "Photoshop 操作失败")); return; }
        resolve(data || {});
      });
    });
  }

  // 把参数安全地塞进 evalScript 代码（JSON 字符串字面量在 JS 里也是合法字符串）
  function escapeUnicode(json) {
    return String(json).replace(/[\u0080-\uffff]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function call(fn, args) {
    var parts = [];
    (args || []).forEach(function (a) { parts.push(escapeUnicode(JSON.stringify(a === undefined ? null : a))); });
    return evalScript("StarsAI." + fn + "(" + parts.join(",") + ")").then(null, function (e) {
      var msg = String((e && e.message) || e);
      /* 0.7.49：EvalScript error. 不告诉你是哪个接口挂了。
       * 最常见的情况是「PS 里的脚本还是旧版本、根本没有这个 api」——
       * 那种情况下所有接口都报同一句话，用户只能瞎猜。这里把接口点名，并给出下一步。 */
      if (msg.indexOf("EvalScript error") >= 0) {
        throw new Error(msg + "（接口 StarsAI." + fn +
          " 不存在或执行出错 —— PS 里的脚本可能还是旧版本：看面板顶栏横幅，或重启 Photoshop 让 boot.jsx 重新读一遍）");
      }
      throw e;
    });
  }

  var mockDoc = null;

  var PS = {
    available: hasCEP,
    mode: hasCEP ? "cep" : (inCEP ? "broken" : "mock"),
    tmpDir: tmpDir,
    ensureDir: ensureDir,

    info: function () {
      if (!hasCEP) {
        return Promise.resolve({
          doc: mockDoc || {
            name: "产品图_主视觉.psd", width: 2400, height: 1600, mode: "RGB", bits: 8,
            layers: 6, hasSelection: false, selection: null, profile: "sRGB IEC61966-2.1"
          }
        });
      }
      return call("info");
    },

    exportDoc: function (path, opts) {
      if (!hasCEP) {
        return Promise.resolve({ path: path, width: 2400, height: 1600 });
      }
      return call("exportDoc", [path, opts || {}]);
    },

    exportMask: function (path, opts) {
      if (!hasCEP) return Promise.resolve({ path: path });
      return call("exportMask", [path, opts || {}]);
    },

    exportRegion: function (path, opts) {
      if (!hasCEP) return Promise.resolve({ path: path, rect: (opts || {}).rect || { x: 0, y: 0, w: 400, h: 300 }, crop: { w: 400, h: 300 } });
      return call("exportRegion", [path, opts || {}]);
    },

    // 0.7.30：按真实选区形状导出蒙版（先烧像素再裁剪，不依赖选区活过 crop）
    exportRegionMask: function (path, opts) {
      if (!hasCEP) return Promise.resolve({ path: path, width: 400, height: 300 });
      return call("exportRegionMask", [path, opts || {}]);
    },

    place: function (path, opts) {
      if (!hasCEP) return Promise.resolve({ action: "layer", name: "Stars-AI" });
      return call("place", [path, opts || {}]);
    },

    // 0.7.46：DR 风格精修（PS 原生滤镜，不走 AI）。kind: smooth / despeckle / sharpen / skintone
    polish: function (kind, opts) {
      if (!hasCEP) {
        return Promise.resolve({
          action: "polish", kind: kind, label: kind, layer: "Stars-AI · " + kind,
          radius: 4, threshold: 15, opacity: 70, blend: "normal",
          hadSelection: false, selection: null, historyStep: true,
          doc: { w: 2400, h: 1600 }
        });
      }
      return call("polish", [kind, opts || {}]);
    },

    /* 0.7.51：ExtendScript 侧的**裸诊断** —— 故意不依赖 StarsAI 存在。
     * 用来回答最基本的问题：「PS 里到底有没有这个脚本？」
     * 之前「连 StarsAI.ping 都不存在」时，面板只能报「脚本执行失败」，
     * 完全区分不出是「版本旧」「对象不存在」还是「文件没读到」。 */
    probeScript: function () {
      if (!hasCEP) return Promise.resolve({ starsai: "preview" });
      var probe =
        '(function(){' +
        'var o={};' +
        'try{o.starsai=typeof StarsAI;}catch(e0){o.starsai="err";}' +
        'try{o.dollar=typeof $;}catch(e1){o.dollar="err";}' +
        'try{o.evalFile=($&&typeof $.evalFile==="function")?"yes":"no";}catch(e2){o.evalFile="no";}' +
        'try{o.ps=String(app.version);}catch(e3){o.ps="?";}' +
        'try{o.userData=Folder.userData.fsName;}catch(e4){o.userData="?";}' +
        'var base="";' +
        'try{base=Folder.userData.fsName+"/Adobe/CEP/extensions/Stars-AI/jsx/";}catch(e5){}' +
        'try{var f=new File(base+"host.jsx");o.hostExists=f.exists;o.hostLen=f.length;}catch(e6){o.hostExists="?";}' +
        'try{var b=new File(base+"boot.jsx");o.bootExists=b.exists;o.bootLen=b.length;}catch(e7){o.bootExists="?";}' +
        /* 0.7.52：这三项决定「能不能在运行期装脚本」。
         * 如果 eval / File 任一不可用，那 reloadScript 的三条路都会失败 —— 只能靠 ScriptPath 直连。 */
        'try{o.fileCtor=typeof File;}catch(e9){o.fileCtor="?";}' +
        'try{o.evalFn=typeof eval;}catch(e10){o.evalFn="?";}' +
        'try{o.evalTest=String(eval("1+1"));}catch(e11){o.evalTest="err:"+e11.message;}' +
        'try{var t=new File(base+"host.jsx");o.canOpen=t.open("r");if(o.canOpen){t.close();}}catch(e12){o.canOpen="err:"+e12.message;}' +
        'try{o.text=JSON.stringify(o);}catch(e8){o.text="jsonfail";}' +
        'return o.text;' +
        '})()';
      return new Promise(function (resolve, reject) {
        cep.evalScript(probe, function (r) {
          if (!r || r === "EvalScript error.") {
            return reject(new Error("连裸诊断都执行失败（" + String(r) + "）—— Photoshop 的 ExtendScript 引擎可能没起来"));
          }
          try { resolve(JSON.parse(r)); } catch (e) { resolve({ raw: String(r) }); }
        });
      });
    },

    openDoc: function (path) {
      if (!hasCEP) return Promise.resolve({ name: "preview.png" });
      return call("openDoc", [path]);
    },

    pickFile: function (title) {
      if (!hasCEP) {
        return Promise.resolve({ path: "D:\\workflows\\my_workflow_api.json", name: "my_workflow_api.json" });
      }
      return call("pickFile", [title || "选择文件"]);
    },

    readText: function (path) {
      if (!hasCEP && nodeFs) {
        try { return Promise.resolve({ text: nodeFs.readFileSync(path, "utf8") }); } catch (e) {}
      }
      if (!hasCEP) return Promise.reject(new Error("预览模式下不能读取文件"));
      return call("readText", [path]);
    },

    ping: function () {
      if (!hasCEP) return Promise.resolve({ ps: "preview", docs: 1 });
      return call("ping");
    },

    // 自检：读当前文档 / 活动图层的真实状态（排错用）
    diag: function () {
      if (!hasCEP) return Promise.resolve({ doc: null });
      return call("diag");
    },

    /* 安全探针（0.7.17）：把 makeActive / crop / resizeCanvas / translate / Dlt 这些
     * 「只能真机跑一次」的步骤，在文档副本上跑一遍并逐步回报。
     * 用户的文档一个像素都不动 —— 所以这个按钮可以随便点。 */
    selfTest: function (outPath) {
      if (!hasCEP) {
        return Promise.resolve({
          mock: true, ps: "preview", jsx: "mock", pass: 0, fail: 0, verdict: "浏览器预览模式不执行探针",
          steps: [], probeLayers: [], doc: null, warnings: ["当前不在 Photoshop 里，探针没有实际执行"]
        });
      }
      return call("selfTest", [outPath || ""]);
    },

    // 在资源管理器里选中文件
    reveal: function (path) {
      try {
        if (childProcess && nodePath) {
          childProcess.spawn("explorer.exe", ["/select,", nodePath.win32.normalize(path)], { detached: true, stdio: "ignore" }).unref();
          return true;
        }
      } catch (e) {}
      return false;
    },

    readImageBase64: function (path) {
      try {
        if (nodeFs) return "data:image/png;base64," + nodeFs.readFileSync(path).toString("base64");
      } catch (e) {}
      return "";
    }
  };


  /* ---------- 清理：临时文件 / ComfyUI 上传残留 ---------- */

  // 统计一个目录里符合条件的文件（数量 + 字节），失败也返回对象而不是抛
  function listFileStats(dir, match) {
    var out = { dir: dir, files: 0, bytes: 0, matched: 0, matchedBytes: 0, names: [], error: null };
    try {
      var names = nodeFs.readdirSync(dir);
      for (var i = 0; i < names.length; i++) {
        var full = nodePath.join(dir, names[i]);
        var st;
        try { st = nodeFs.statSync(full); } catch (e0) { continue; }
        if (!st.isFile()) continue;
        out.files++; out.bytes += st.size;
        if (match(names[i])) {
          out.matched++; out.matchedBytes += st.size;
          if (out.names.length < 6) out.names.push(names[i]);
        }
      }
    } catch (e) { out.error = String((e && e.message) || e); }
    return out;
  }

  /* 找 ComfyUI 的 input 目录（上传的 starsai_*.png 都堆在这里）。
   * 桌面版布局有两种：<root>\ComfyUI\input 和 <root>\..\ComfyUI-Shared\input，都试。 */
  function comfyInputCandidates(pref) {
    var out = [];
    function push(p) {
      if (!p) return;
      var n;
      try { n = nodePath.normalize(p); } catch (e) { return; }
      if (!isDir(n)) return;
      for (var i = 0; i < out.length; i++) if (out[i].toLowerCase() === n.toLowerCase()) return;
      out.push(n);
    }
    var env = (typeof process !== "undefined" && process.env) || {};
    var roots = [];
    var p0 = String(pref || "").trim().replace(/^"|"$/g, "");
    if (p0) roots.push(p0);
    try { headlessRoots().forEach(function (r) { roots.push(r); }); } catch (e1) {}
    ["D:\\Comfy-Desktop", "E:\\Comfy-Desktop", "F:\\Comfy-Desktop",
     env.LOCALAPPDATA + "\\Programs\\ComfyUI", "C:\\ComfyUI", "D:\\ComfyUI", "E:\\ComfyUI"].forEach(function (r) { if (r) roots.push(r); });
    // Comfy-Desktop 的实例目录：<root>\ComfyUI-Installs\<name>
    ["D:\\Comfy-Desktop", "E:\\Comfy-Desktop", "F:\\Comfy-Desktop"].forEach(function (r) {
      if (!isDir(r)) return;
      try {
        var inst = nodePath.join(r, "ComfyUI-Installs");
        if (isDir(inst)) nodeFs.readdirSync(inst).forEach(function (n) { roots.push(nodePath.join(inst, n)); });
      } catch (e2) {}
    });
    for (var i = 0; i < roots.length && i < 40; i++) {
      var r = roots[i];
      push(nodePath.join(r, "input"));
      push(nodePath.join(r, "ComfyUI", "input"));
      push(nodePath.join(r, "..", "input"));
      push(nodePath.join(r, "ComfyUI-Shared", "input"));
      push(nodePath.join(r, "..", "ComfyUI-Shared", "input"));
      push(nodePath.join(r, "..", "..", "ComfyUI-Shared", "input"));
    }
    return out;
  }

  function deleteMatched(dir, match, onEach) {
    var removed = 0, freed = 0, errors = [];
    try {
      var names = nodeFs.readdirSync(dir);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (!match(n)) continue;
        var full = nodePath.join(dir, n);
        try {
          var st = nodeFs.statSync(full);
          if (!st.isFile()) continue;
          nodeFs.unlinkSync(full);
          removed++; freed += st.size;
          if (onEach) onEach(n, st.size);
        } catch (eD) {
          errors.push("删不掉 " + n + "（" + String((eD && eD.message) || eD) + "）");
        }
      }
    } catch (eR) { errors.push("读不到目录 " + dir + "：" + String((eR && eR.message) || eR)); }
    return { removed: removed, freed: freed, errors: errors };
  }

  /* 清理缓存与临时文件（0.7.17）。
   * 范围（都只删自己造的垃圾，绝不碰用户的图和模型）：
   *   1) 面板临时目录 %TEMP%\Stars-AI —— src_*.png / out_*.png / *_cut.png（保留 extra_model_paths.yaml）
   *   2) ComfyUI 的 input/ 目录 —— 只删 starsai_*.png（每次生成都会传一对上去，越堆越多）
   * dryRun=true 只统计不删（面板先拿数字给用户看）。 */
  PS.cleanTemp = function (opts) {
    opts = opts || {};
    var res = {
      ok: true, dryRun: !!opts.dryRun, tempDir: tmpDir(),
      temp: null, comfyDirs: [], errors: [], tempRemoved: 0, tempFreed: 0, comfyRemoved: 0, comfyFreed: 0
    };
    if (!nodeFs || !nodePath) {
      res.ok = false;
      res.errors.push("面板没有 Node 权限，清理不了文件");
      return Promise.resolve(res);
    }
    var isTempGarbage = function (n) { return !/.ya?ml$/i.test(n); };
    var isComfyUpload = function (n) { return /^starsai_/i.test(n) && /.(png|jpe?g|webp)$/i.test(n); };

    try { res.temp = listFileStats(res.tempDir, isTempGarbage); } catch (eT) { res.errors.push(String((eT && eT.message) || eT)); }

    var dirs = [];
    try { dirs = comfyInputCandidates(opts.comfyPath); } catch (eC) { res.errors.push(String((eC && eC.message) || eC)); }
    for (var i = 0; i < dirs.length; i++) {
      try { res.comfyDirs.push(listFileStats(dirs[i], isComfyUpload)); } catch (eD) { res.errors.push(String((eD && eD.message) || eD)); }
    }

    if (!opts.dryRun) {
      try {
        var t = deleteMatched(res.tempDir, isTempGarbage, null);
        res.tempRemoved = t.removed; res.tempFreed = t.freed;
        res.errors = res.errors.concat(t.errors);
      } catch (eTR) { res.errors.push(String((eTR && eTR.message) || eTR)); }
      for (var j = 0; j < dirs.length; j++) {
        try {
          var c = deleteMatched(dirs[j], isComfyUpload, null);
          res.comfyRemoved += c.removed; res.comfyFreed += c.freed;
          res.errors = res.errors.concat(c.errors);
        } catch (eCD) { res.errors.push(String((eCD && eCD.message) || eCD)); }
      }
    }
    return Promise.resolve(res);
  };

  /* ---------- ComfyUI 启动器 ---------- */
  var execSync = null;
  try { execSync = require("child_process").execSync; } catch (e) {}

  function isFile(p) { try { return !!nodeFs && nodeFs.statSync(p).isFile(); } catch (e) { return false; } }
  function isDir(p) { try { return !!nodeFs && nodeFs.statSync(p).isDirectory(); } catch (e) { return false; } }

  function pickPython(dir) {
    var tries = [
      dir + "\\.venv\\Scripts\\python.exe",
      dir + "\\venv\\Scripts\\python.exe",
      dir + "\\python_embeded\\python.exe",
      dir + "\\python_embeded\\pythonw.exe"
    ];
    for (var i = 0; i < tries.length; i++) if (isFile(tries[i])) return tries[i];
    return "";
  }

  // ComfyUI Desktop 把模型放在 <root>\ComfyUI-Shared\models；
  // 无头模式要额外指过去，否则看不到 checkpoints/upscale_models。
  function findSharedModels(startDirs) {
    for (var i = 0; i < startDirs.length; i++) {
      var d = startDirs[i];
      for (var k = 0; k < 5; k++) {
        if (!d) break;
        var cand = d + "\\ComfyUI-Shared\\models";
        if (isDir(cand)) return cand;
        var up = nodePath.dirname(d);
        if (!up || up === d) break;
        d = up;
      }
    }
    return "";
  }

  var SHARED_MAP = [
    ["checkpoints", "checkpoints/"],
    ["clip", "text_encoders/"],
    ["text_encoders", "text_encoders/"],
    ["unet", "diffusion_models/"],
    ["diffusion_models", "diffusion_models/"],
    ["vae", "vae/"],
    ["loras", "loras/"],
    ["upscale_models", "upscale_models/"],
    ["controlnet", "controlnet/"],
    ["clip_vision", "clip_vision/"],
    ["embeddings", "embeddings/"],
    ["style_models", "style_models/"],
    ["vae_approx", "vae_approx/"],
    ["configs", "configs/"],
    ["background_removal", "background_removal/"]
  ];

  function writeSharedPaths(sharedModels) {
    try {
      var file = nodePath.join(tmpDir(), "extra_model_paths.yaml");
      var lines = ["# Stars-AI 临时生成：让无头 ComfyUI 也能看到桌面版共享模型", "starsai_shared:", "  base_path: '" + sharedModels.replace(/\\/g, "/") + "'"];
      SHARED_MAP.forEach(function (kv) {
        if (isDir(sharedModels + "\\" + kv[1].replace(/\//g, "\\"))) lines.push("  " + kv[0] + ": " + kv[1]);
      });
      nodeFs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
      return file;
    } catch (e) { return ""; }
  }

  // 只认真正的启动程序：排除卸载器/安装器/更新器（0.2MB 的 Uninstall Comfy Desktop.exe 曾被误判）
  function looksLikeInstaller(exe) {
    if (!exe) return true;
    var base = nodePath.basename(exe).toLowerCase();
    if (/unins|uninstall|update|setup|installer|crashpad|helper/.test(base)) return true;
    try { if (nodeFs.statSync(exe).size < 2 * 1024 * 1024) return true; } catch (e) { return true; }
    return false;
  }

  function toDesktop(exe) {
    if (looksLikeInstaller(exe)) return null;
    return { ok: true, kind: "desktop", label: "ComfyUI 桌面版", exe: exe, args: [], cwd: nodePath.dirname(exe), command: exe };
  }

  function resolveHeadless(dir) {
    if (!dir || !isDir(dir)) return null;
    var pairs = [];
    if (isFile(dir + "\\main.py")) pairs.push(dir);
    if (isFile(dir + "\\ComfyUI\\main.py")) pairs.push(dir + "\\ComfyUI");
    for (var i = 0; i < pairs.length; i++) {
      var cwd = pairs[i];
      var py = pickPython(cwd);
      if (!py) py = pickPython(dir);
      if (!py) continue;
      var args = ["main.py", "--port", "8188", "--listen", "127.0.0.1"];
      var shared = findSharedModels([cwd, dir]);
      if (shared) {
        var extra = writeSharedPaths(shared);
        if (extra) args = args.concat(["--extra-model-paths-config", extra]);
      }
      return {
        ok: true, kind: "headless", label: "ComfyUI 无头模式（端口 8188）",
        exe: py, args: args, cwd: cwd,
        command: py + " " + args.join(" ")
      };
    }
    return null;
  }

  function desktopFromRegistry() {
    if (!execSync) return "";
    var roots = [
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
    ];
    for (var i = 0; i < roots.length; i++) {
      try {
        var out = execSync('reg query "' + roots[i] + '" /s /f "Comfy Desktop" /d', { encoding: "utf8", timeout: 6000, windowsHide: true });
        var re = /([A-Za-z]:\\[^"\r\n,]*?\.exe)/gi;
        var m;
        while ((m = re.exec(out)) !== null) {
          var p = m[1];
          if (!/[\\\/]Comfy Desktop\.exe$/i.test(p)) continue;   // 必须是启动程序本身
          if (!isFile(p)) continue;
          try { if (nodeFs.statSync(p).size < 2 * 1024 * 1024) continue; } catch (e) { continue; }
          return p;
        }
      } catch (e) {}
    }
    return "";
  }

  function knownDesktops() {
    var env = (typeof process !== "undefined" && process.env) || {};
    var list = [
      env.LOCALAPPDATA + "\\Programs\\ComfyUI\\ComfyUI.exe",
      env.LOCALAPPDATA + "\\Programs\\Comfy Desktop\\Comfy Desktop.exe",
      "C:\\Program Files\\ComfyUI\\ComfyUI.exe",
      "C:\\Program Files\\Comfy Desktop\\Comfy Desktop.exe",
      "D:\\comfy\\Comfy Desktop\\Comfy Desktop.exe",
      "D:\\Comfy Desktop\\Comfy Desktop.exe",
      "E:\\comfy\\Comfy Desktop\\Comfy Desktop.exe",
      "F:\\comfy\\Comfy Desktop\\Comfy Desktop.exe"
    ];
    return list.filter(function (p) { return p && isFile(p); });
  }

  function headlessRoots() {
    var env = (typeof process !== "undefined" && process.env) || {};
    var roots = [
      "C:\\ComfyUI", "D:\\ComfyUI", "E:\\ComfyUI", "F:\\ComfyUI",
      env.USERPROFILE + "\\ComfyUI",
      env.USERPROFILE + "\\Documents\\ComfyUI",
      "D:\\Comfy-Desktop", "E:\\Comfy-Desktop"
    ];
    // Comfy-Desktop 的安装实例：<root>\ComfyUI-Installs\<name>\ComfyUI
    var out = roots.slice();
    roots.forEach(function (r) {
      var inst = r + "\\ComfyUI-Installs";
      if (!isDir(inst)) return;
      try {
        nodeFs.readdirSync(inst).forEach(function (name) { out.push(inst + "\\" + name); });
      } catch (e) {}
    });
    return out.filter(function (p) { return p && isDir(p); });
  }

  PS.detectHeadless = function () {
    try {
      var roots = headlessRoots();
      for (var i = 0; i < roots.length; i++) {
        var h = resolveHeadless(roots[i]);
        if (h) return h;
      }
      return null;
    } catch (e) { return null; }
  };

  PS.isAlive = function (pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return false; }
  };

  // 把扩展目录下的 jsx/host.jsx 重新灌进 ExtendScript 引擎（迭代用，免得每次重启 PS）
  /* 找出 host.jsx 的真实路径：面板自己的目录 → CEP 扩展目录 → 已安装目录，逐个试。
   * 只靠 location.href 推在某些 CEP 版本下会推错，导致"重载了却没生效"。 */
  function findJsxFile() {
    var cands = [];
    try {
      var href = decodeURI(String(location.href)).replace(/^file:\/+/, "").replace(/\/[^\/]*$/, "");
      if (/^\/[A-Za-z]:/.test(href)) href = href.slice(1);
      cands.push(href.replace(/\//g, "\\") + "\\jsx\\host.jsx");
    } catch (e) {}
    try {
      var ext = cep && cep.getSystemPath && cep.getSystemPath("extension");
      if (ext) cands.push(ext.replace(/\//g, "\\") + "\\jsx\\host.jsx");
    } catch (e2) {}
    try {
      if (nodeOs && nodeOs.homedir) {
        cands.push(nodeOs.homedir() + "\\AppData\\Roaming\\Adobe\\CEP\\extensions\\Stars-AI\\jsx\\host.jsx");
      }
    } catch (e3) {}
    for (var i = 0; i < cands.length; i++) {
      try { if (nodeFs && nodeFs.existsSync(cands[i])) return cands[i]; } catch (e4) {}
    }
    return "";
  }

  /* 重载 host.jsx 进 ExtendScript 引擎，并**验证版本真的换了**（不验证等于没重载）。
   *
   * 0.7.48 大改：改成「让 ExtendScript 自己从磁盘读」，不再把源码当字符串塞进 evalScript。
   * 为什么（坑 #19）：CEP 的 evalScript 传长脚本会在 6 万字符出头被截断，
   * 回调只拿到 "EvalScript error."。host.jsx 0.7.47 已经 67,455 字符（77 KB UTF-8），
   * 于是「重载脚本」必失败、内存里仍是旧脚本、面板一直报版本对不上 ——
   * 而自检里当然也看不到新加的探针，特别容易被误判成「PS 不支持这些滤镜」。
   *
   * $.evalFile + File.encoding="UTF-8" 是 ExtendScript 原生读取：无长度上限，
   * 也不会因为我们的文件是「无 BOM UTF-8」而按 GBK 解成乱码。
   * 旧路子保留为回退（短文件仍然最好用）；两个都失败时把体积报出来，别让人去猜。 */
  PS.reloadScript = function () {
    var file = "", size = 0, chars = 0, code = "";
    try {
      if (!hasCEP) return notReady();
      file = findJsxFile();
      if (!file) return Promise.reject(new Error("找不到 jsx/host.jsx，试着重启 Photoshop"));
      try { size = nodeFs.statSync(file).size || 0; } catch (eS) {}
      try { code = nodeFs.readFileSync(file, "utf8"); chars = code.length; } catch (eC) {}
    } catch (e0) {
      return Promise.reject(e0);
    }

    return new Promise(function (resolve, reject) {
      function done(how) {
        cep.evalScript("StarsAI.ping()", function (p) {
          var jsx = null;
          try { jsx = JSON.parse(p).jsx; } catch (e1) {}
          if (!jsx) {
            return reject(new Error("脚本重载后问不到版本（StarsAI.ping 不可用）—— 重启 Photoshop 让 manifest 重新加载"));
          }
          resolve({ ok: true, bytes: size, chars: chars, at: file, jsx: jsx, via: how });
        });
      }

      // ① 首选：ExtendScript 自己读文件（无长度限制）
      var quoted = "'" + String(file).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
      var loader = 'var __starsaiMain = new File(' + quoted + '); ' +
                   '__starsaiMain.encoding = "UTF-8"; $.evalFile(__starsaiMain);';
      cep.evalScript(loader, function (r1) {
        if (r1 !== "EvalScript error.") return done("evalFile");

        /* ② 不依赖 `$` 的兜底：File 读全文 + eval()。
         * `$` 在 CEP 的 evalScript 环境里不一定可用，一旦没有，① 会直接 EvalScript error，
         * 而源码在本进程内部读完再 eval，同样不经过 CEP 的字符串参数通道，没有长度上限。 */
        var loader2 = 'var __starsaiF2 = new File(' + quoted + '); ' +
                      '__starsaiF2.encoding = "UTF-8"; __starsaiF2.open("r"); ' +
                      'var __starsaiSrc2 = __starsaiF2.read(); __starsaiF2.close(); eval(__starsaiSrc2);';
        cep.evalScript(loader2, function (r2) {
          if (r2 !== "EvalScript error.") return done("file+eval");

          // ③ 最后：整串源码（短文件可用；长文件必被截断，所以放最后）
          if (!code) {
            return reject(new Error("脚本重载失败（三种方式都不行），且读不到 jsx/host.jsx"));
          }
          cep.evalScript(code, function (r3) {
            if (r3 !== "EvalScript error.") return done("evalScript");
            reject(new Error(
              "脚本重载失败（evalFile / File+eval / 源码字符串 三种都失败）· 文件 " + chars + " 字符 / " +
              Math.round(size / 1024) + " KB。请重启 Photoshop（启动时走 boot.jsx 从磁盘读）"
            ));
          });
        });
      });
    });
  };

  /* 0.7.45：把「磁盘上的版本号」读出来，用来发现版本漂移。
   * 为什么需要它：js/app.js 只在面板加载时执行一次。改了 js 不重开面板，
   * 面板里跑的还是旧代码，而日志首行的 build 显示的也是旧号 —— 看日志根本分辨不出来。
   * 三个数字必须相等：内存里的 BUILD · 磁盘 app.js 的 BUILD · 磁盘 host.jsx 的 JSX_BUILD。
   * 同步返回（只读两个小文件的正则），读不到就给空串，调用方按「未知」处理。 */
  PS.diskBuild = function () {
    var out = { panel: "", jsx: "", dir: "" };
    try {
      if (!nodeFs || !nodePath) return out;
      var jsxFile = findJsxFile();
      if (!jsxFile) return out;
      out.dir = nodePath.dirname(nodePath.dirname(jsxFile));
      try {
        var t1 = nodeFs.readFileSync(nodePath.join(out.dir, "js", "app.js"), "utf8");
        var m1 = /var\s+BUILD\s*=\s*["']([0-9][0-9.]*)["']/.exec(t1);
        if (m1) out.panel = m1[1];
      } catch (e1) {}
      try {
        var t2 = nodeFs.readFileSync(jsxFile, "utf8");
        var m2 = /JSX_BUILD\s*=\s*["']([0-9][0-9.]*)["']/.exec(t2);
        if (m2) out.jsx = m2[1];
      } catch (e2) {}
    } catch (e) {}
    return out;
  };

  PS.detectComfy = function (pref, kind) {
    try {
      if (!nodeFs) return { ok: false, error: "面板没有 Node 权限，无法启动本机程序" };
      var p = String(pref || "").trim().replace(/^"|"$/g, "");
      if (p) {
        if (isFile(p) && /\.exe$/i.test(p)) {
          // toDesktop() 对安装器/卸载器会返回 null —— 以前这里直接 return null，
          // 调用方 (app.js) 接着 det.ok 就抛 TypeError，日志只剩 "Cannot read properties of null"
          var dt = toDesktop(p);
          if (dt) return dt;
          return { ok: false, error: "这个 exe 看起来是安装器/卸载器或体积过小，不是 ComfyUI 启动程序：" + p };
        }
        if (isDir(p)) {
          var viaDir = resolveHeadless(p);
          if (viaDir) return viaDir;
          var exe = ["\\Comfy Desktop.exe", "\\ComfyUI.exe"].map(function (s) { return p + s; }).filter(isFile)[0];
          if (exe) {
            var dt2 = toDesktop(exe);
            if (dt2) return dt2;
            return { ok: false, error: "这个目录里的启动程序不像 ComfyUI：" + exe };
          }
          return { ok: false, error: "这个目录里既没有 main.py，也没有 Comfy Desktop.exe：" + p };
        }
        return { ok: false, error: "路径不存在：" + p };
      }

      var want = kind || "auto";
      if (want !== "headless") {
        var reg = desktopFromRegistry();
        var d1 = reg ? toDesktop(reg) : null;
        if (d1) return d1;
        var known = knownDesktops();
        for (var k = 0; k < known.length; k++) {
          var d2 = toDesktop(known[k]);
          if (d2) return d2;
        }
        if (want === "desktop") return { ok: false, error: "没找到 ComfyUI 桌面版 exe，请在设置里指定路径" };
      }

      var roots = headlessRoots();
      for (var i = 0; i < roots.length; i++) {
        var h = resolveHeadless(roots[i]);
        if (h) return h;
      }
      return { ok: false, error: "没找到 ComfyUI。可以在设置里指定桌面版 exe 或 ComfyUI 目录。" };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  };

  PS.launchComfy = function (det) {
    try {
      if (!det || !det.ok) return Promise.resolve({ ok: false, error: (det && det.error) || "没有可启动的目标" });
      var cp = require("child_process");
      var child = cp.spawn(det.exe, det.args || [], {
        cwd: det.cwd || undefined,
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();
      return Promise.resolve({ ok: true, pid: child.pid, command: det.command });
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e.message || e) });
    }
  };

  PS.pickFolder = function (title) {
    if (!hasCEP) return Promise.resolve({ path: "" });
    return call("pickFolder", [title || "选择 ComfyUI 目录"]);
  };

  // 在 PS 里但桥没接上：所有 PS 操作直接报错，绝不静默走 mock（否则会导出假路径）
  if (inCEP && !hasCEP) {
    ["info", "exportDoc", "exportRegion", "exportRegionMask", "exportMask", "place", "openDoc", "pickFile", "readText", "ping", "diag", "selfTest"].forEach(function (k) {
      PS[k] = function () { return notReady(); };
    });
  }

  global.StarsPS = PS;
})(window);

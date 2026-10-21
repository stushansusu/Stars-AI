/* Stars-AI · ComfyUI client
 * 优先走 Node http（CEP 内置 nodejs，无 CORS 问题）；没有 Node 时退回 fetch。
 * 所有接口按 ComfyUI 0.4x 实际行为验证：/system_stats /object_info /prompt /history /queue /view /upload/image /interrupt
 */
(function (global) {
  "use strict";

  var hasNode = false, http = null, https = null, fs = null, pathMod = null;
  try {
    if (typeof require === "function") {
      http = require("http");
      https = require("https");
      fs = require("fs");
      pathMod = require("path");
      hasNode = !!(http && fs);
    }
  } catch (e) { hasNode = false; }

  function parseUrl(server) {
    var s = String(server || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    var m = s.match(/^(https?):\/\/([^\/:]+)(?::(\d+))?(.*)$/i);
    if (!m) throw new Error("服务器地址格式不对：" + server);
    return {
      url: s,
      protocol: m[1].toLowerCase(),
      host: m[2],
      port: parseInt(m[3] || (m[1].toLowerCase() === "https" ? "443" : "80"), 10),
      basePath: m[4] || ""
    };
  }

  function request(cfg, method, urlPath, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var body = opts.body;
    var headers = opts.headers || {};
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    }
    if (body && body.length !== undefined) {
      // 注意：中文提示词是 UTF-8 多字节，必须按字节数算，否则请求体被截断
      headers["Content-Length"] = (typeof Buffer !== "undefined" && Buffer.isBuffer(body))
        ? body.length
        : (typeof Buffer !== "undefined" ? Buffer.byteLength(String(body), "utf8") : body.length);
    }

    if (hasNode) {
      return new Promise(function (resolve, reject) {
        var mod = cfg.protocol === "https" ? https : http;
        var req = mod.request({
          host: cfg.host,
          port: cfg.port,
          path: cfg.basePath + urlPath,
          method: method,
          headers: headers
        }, function (res) {
          var chunks = [];
          res.on("data", function (c) { chunks.push(c); });
          res.on("end", function () {
            var buf = Buffer.concat(chunks);
            var text = buf.toString("utf8");
            var json = null;
            try { json = JSON.parse(text); } catch (e) {}
            resolve({ status: res.statusCode, headers: res.headers, buffer: buf, text: text, json: json, ms: Date.now() - t0 });
          });
        });
        req.setTimeout(opts.timeout || 30000, function () { req.destroy(new Error("请求超时（" + (opts.timeout || 30000) + "ms）")); });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
      });
    }

    // 浏览器 / 预览模式
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 30000);
    return fetch(cfg.url + urlPath, {
      method: method,
      headers: headers,
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.arrayBuffer().then(function (ab) {
        clearTimeout(timer);
        var buf = new Uint8Array(ab);
        var text = new TextDecoder().decode(buf);
        var json = null;
        try { json = JSON.parse(text); } catch (e) {}
        return { status: res.status, headers: {}, buffer: buf, text: text, json: json, ms: Date.now() - t0 };
      });
    });
  }

  function ComfyClient(server) {
    this.server = server || "http://127.0.0.1:8188";
    this._cfg = null;
    this._info = {};
    this.clientId = "starsai-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
  }

  ComfyClient.prototype.cfg = function () {
    this._cfg = parseUrl(this.server);
    return this._cfg;
  };
  ComfyClient.prototype.api = function (method, p, opts) {
    return request(this.cfg(), method, p, opts);
  };

  ComfyClient.prototype.ping = function (timeout) {
    var self = this;
    return this.api("GET", "/system_stats", { timeout: timeout || 8000 }).then(function (r) {
      if (r.status !== 200) throw new Error("HTTP " + r.status);
      var sys = (r.json && r.json.system) || {};
      return {
        version: sys.comfyui_version || "?",
        device: ((r.json && r.json.devices) || []).map(function (d) {
          return String(d.name || "").replace(/^cuda:\d+\s*/, "") + " · " + Math.round((d.vram_total || 0) / 1073741824) + "GB";
        }).join(", "),
        raw: r.json
      };
    });
  };

  // 清掉节点/模型列表缓存：点「重新读取模型列表」时必须调，否则永远命中旧缓存
  ComfyClient.prototype.reset = function () {
    this._info = {};
    return this;
  };

  // 单个节点类的定义（含可选项列表）
  ComfyClient.prototype.nodeInfo = function (cls) {
    var self = this;
    if (this._info[cls] !== undefined) return Promise.resolve(this._info[cls]);
    return this.api("GET", "/object_info/" + encodeURIComponent(cls), { timeout: 20000 }).then(function (r) {
      var info = r.json && r.json[cls];
      self._info[cls] = info || null;
      return info || null;
    });
  };

  // 一次性拿一批节点定义，用来判断本机 ComfyUI 支持哪些玩法
  ComfyClient.prototype.probe = function (classes) {
    var self = this;
    return this.nodeInfo("UNETLoader").then(function (u) {
      return Promise.all([
        self.nodeInfo("CheckpointLoaderSimple"),
        self.nodeInfo("CLIPLoader"),
        self.nodeInfo("VAELoader"),
        self.nodeInfo("LoraLoaderModelOnly"),
        self.nodeInfo("TextEncodeQwenImage21"),
        self.nodeInfo("QwenImage21Cache"),
        self.nodeInfo("KSampler"),
        self.nodeInfo("EmptyLatentImage"),
        self.nodeInfo("EmptyImage"),
        self.nodeInfo("ImageUpscaleWithModel"),
        self.nodeInfo("UpscaleModelLoader"),
        self.nodeInfo("ImageScale"),
        self.nodeInfo("SaveImage"),
        self.nodeInfo("LoadBackgroundRemovalModel"),
        self.nodeInfo("RemoveBackground"),
        self.nodeInfo("JoinImageWithAlpha"),
        self.nodeInfo("InvertMask")
      ]).then(function (arr) {
        var byName = {
          UNETLoader: u, CheckpointLoaderSimple: arr[0], CLIPLoader: arr[1], VAELoader: arr[2],
          LoraLoaderModelOnly: arr[3], TextEncodeQwenImage21: arr[4], QwenImage21Cache: arr[5],
          KSampler: arr[6], EmptyLatentImage: arr[7], EmptyImage: arr[8],
          ImageUpscaleWithModel: arr[9], UpscaleModelLoader: arr[10], ImageScale: arr[11], SaveImage: arr[12],
          LoadBackgroundRemovalModel: arr[13], RemoveBackground: arr[14], JoinImageWithAlpha: arr[15],
          InvertMask: arr[16]
        };
        var caps = {};
        Object.keys(byName).forEach(function (k) { caps[k] = !!byName[k]; });
        caps.options = {
          unet: optionList(byName.UNETLoader, "unet_name"),
          ckpt: optionList(byName.CheckpointLoaderSimple, "ckpt_name"),
          clip: optionList(byName.CLIPLoader, "clip_name"),
          vae: optionList(byName.VAELoader, "vae_name"),
          lora: optionList(byName.LoraLoaderModelOnly, "lora_name"),
          upscale: optionList(byName.UpscaleModelLoader, "model_name"),
          sampler: optionList(byName.KSampler, "sampler_name"),
          scheduler: optionList(byName.KSampler, "scheduler"),
          bgRemoval: optionList(byName.LoadBackgroundRemovalModel, "bg_removal_name")
        };
        return caps;
      });
    });
  };

  function optionList(info, field) {
    try {
      var req = (info.input.required && info.input.required[field]) ||
                (info.input.optional && info.input.optional[field]);
      if (!req) return [];
      // 老格式：["a.safetensors", "b.safetensors"]
      if (Array.isArray(req[0])) return req[0].slice();
      // 新格式（0.4x）：["COMBO", {options: [...]}]
      if (req[0] === "COMBO" && req[1] && Array.isArray(req[1].options)) return req[1].options.slice();
    } catch (e) {}
    return [];
  }

  ComfyClient.prototype.submit = function (graph) {
    var payload = { prompt: graph, client_id: this.clientId };
    return this.api("POST", "/prompt", { json: payload, timeout: 30000 }).then(function (r) {
      if (r.status !== 200) {
        throw new Error("提交失败 HTTP " + r.status + "：" + explainNodeError(r.json, r.text));
      }
      if (r.json && r.json.node_errors && Object.keys(r.json.node_errors).length) {
        throw new Error(explainNodeError(r.json, r.text));
      }
      if (!r.json || !r.json.prompt_id) throw new Error("ComfyUI 没有返回 prompt_id：" + r.text.slice(0, 300));
      return r.json.prompt_id;
    });
  };

  function explainNodeError(json, text) {
    try {
      if (json && json.error && json.error.message) {
        var extra = json.error.details ? "（" + json.error.details + "）" : "";
        return json.error.message + extra;
      }
      if (json && json.node_errors) {
        var parts = [];
        Object.keys(json.node_errors).forEach(function (id) {
          var ne = json.node_errors[id];
          var errs = (ne.errors || []).map(function (e) {
            return e.message + (e.details ? "：" + e.details : "");
          });
          parts.push("节点 " + id + " (" + (ne.class_type || "?") + ") " + errs.join("; "));
        });
        if (parts.length) return parts.join(" | ");
      }
      if (text) return String(text).slice(0, 400);
    } catch (e) {}
    return "未知错误";
  }

  ComfyClient.prototype.history = function (promptId) {
    var self = this;
    return this.api("GET", "/history/" + promptId, { timeout: 20000 }).then(function (r) {
      return (r.json && r.json[promptId]) || null;
    });
  };

  ComfyClient.prototype.queue = function () {
    return this.api("GET", "/queue", { timeout: 10000 }).then(function (r) {
      var q = r.json || {};
      return { running: (q.queue_running || []).length, pending: (q.queue_pending || []).length };
    });
  };

  // 把还没开始跑的 prompt 从队列里删掉（/interrupt 只中断正在执行的那个，
  // 排队中的任务照样会跑完并把结果插回 PS —— 用户点「取消」后不该再写回）
  ComfyClient.prototype.dequeue = function (promptId) {
    if (!promptId) return Promise.resolve(false);
    return this.api("POST", "/queue", { json: { delete: [promptId] }, timeout: 10000 })
      .then(function (r) { return r.status === 200; })
      .catch(function () { return false; });
  };

  ComfyClient.prototype.interrupt = function () {
    return this.api("POST", "/interrupt", { body: (typeof Buffer !== "undefined" ? Buffer.from("{}") : "{}"), headers: { "Content-Type": "application/json" }, timeout: 10000 })
      .then(function () { return true; }).catch(function () { return false; });
  };

  // 轮询等待出图；onTick(elapsed, queue) 用于 UI 进度
  ComfyClient.prototype.waitFor = function (promptId, onTick, opt) {
    var self = this;
    opt = opt || {};
    var timeout = opt.timeout || 15 * 60 * 1000;
    var t0 = Date.now();
    var sleep = opt.interval || 1200;

    function step() {
      return self.history(promptId).then(function (h) {
        if (h) {
          var st = h.status || {};
          if (st.status_str === "error") {
            var msg = "生成失败";
            (st.messages || []).forEach(function (m) {
              if (m[0] === "execution_error") msg += "：" + ((m[1] && (m[1].exception_message || m[1].exception_type)) || "");
              if (m[0] === "execution_interrupted") msg = "已取消";
            });
            throw new Error(msg);
          }
          // 用户点了取消：ComfyUI 可能只留下 interrupted 消息而没有 outputs
          var interrupted = false;
          (st.messages || []).forEach(function (m) { if (m[0] === "execution_interrupted") interrupted = true; });
          if (interrupted) throw new Error("已取消");
          if (h.outputs && Object.keys(h.outputs).length) return h;
        }
        if (Date.now() - t0 > timeout) throw new Error("等待超时（" + Math.round(timeout / 60000) + " 分钟），可以在 ComfyUI 里查看进度");
        var elapsed = ((Date.now() - t0) / 1000);
        var p = self.queue().catch(function () { return { running: 0, pending: 0 }; });
        return p.then(function (q) {
          if (onTick) onTick(elapsed, q);
          return new Promise(function (res) { setTimeout(res, sleep); }).then(step);
        });
      });
    }
    return step();
  };

  ComfyClient.prototype.upload = function (filePath, name) {
    var self = this;
    var filename = name || ("starsai_" + Date.now() + pathMod.extname(filePath));
    var raw = fs.readFileSync(filePath);
    var boundary = "----StarsAI" + Date.now() + Math.random().toString(36).slice(2, 8);
    var head = Buffer.from(
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="image"; filename="' + filename + '"\r\n' +
      "Content-Type: image/png\r\n\r\n", "utf8");
    var tail = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
    var body = Buffer.concat([head, raw, tail]);
    return this.api("POST", "/upload/image", {
      body: body,
      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
      timeout: 120000
    }).then(function (r) {
      if (r.status !== 200 || !r.json || !r.json.name) {
        throw new Error("上传图片失败 HTTP " + r.status + "：" + r.text.slice(0, 200));
      }
      return { name: r.json.name, subfolder: r.json.subfolder || "" };
    });
  };

  // 把结果图下载到本地文件
  ComfyClient.prototype.download = function (view, destPath) {
    var q = "/view?filename=" + encodeURIComponent(view.filename) +
      "&subfolder=" + encodeURIComponent(view.subfolder || "") +
      "&type=" + encodeURIComponent(view.type || "output");
    return this.api("GET", q, { timeout: 120000 }).then(function (r) {
      if (r.status !== 200) throw new Error("取图失败 HTTP " + r.status);
      fs.writeFileSync(destPath, r.buffer);
      return { path: destPath, bytes: r.buffer.length };
    });
  };

  ComfyClient.prototype.viewUrl = function (view) {
    return this.cfg().url + "/view?filename=" + encodeURIComponent(view.filename) +
      "&subfolder=" + encodeURIComponent(view.subfolder || "") +
      "&type=" + encodeURIComponent(view.type || "output");
  };

  global.StarsComfy = { ComfyClient: ComfyClient, hasNode: hasNode, fs: fs, pathMod: pathMod };
})(window);

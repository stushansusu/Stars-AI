/* Stars-AI · Photoshop 端脚本（ExtendScript / ES3）
 * 只做四件事：读文档信息、导出当前图 PNG、导出选区蒙版 PNG、把结果放进 PS。
 * 所有返回值都是 JSON 字符串，方便 CEP 面板直接 JSON.parse。
 */
var StarsAI = (function () {
  var MAX_LOG = 0;
  var JSX_BUILD = '0.7.40';

  /* ---------- 极简 JSON ---------- */
  function qstr(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32) out += ' ';
      else out += c;
    }
    return out + '"';
  }
  function toJson(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return qstr(v);
    if (v instanceof Array) {
      var parts = [];
      for (var i = 0; i < v.length; i++) parts.push(toJson(v[i]));
      return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
      var kv = [];
      for (var k in v) {
        if (!v.hasOwnProperty(k)) continue;
        if (typeof v[k] === 'function') continue;
        kv.push(qstr(k) + ':' + toJson(v[k]));
      }
      return '{' + kv.join(',') + '}';
    }
    return 'null';
  }
  function ok(extra) {
    var o = { ok: true, jsx: JSX_BUILD };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return toJson(o);
  }
  function err(msg) {
    return toJson({ ok: false, error: String(msg) });
  }
  function parseOpts(s) {
    if (!s) return {};
    // CEP 的 evalScript 把参数作为真正的 JS 对象传进来；只有字符串时才需要 eval。
    // 以前这里无条件 eval(object)，失败被吞掉 → 所有选项（图层名/target/羽化…）都变成空。
    if (typeof s === 'object') return s;
    try { return eval('(' + s + ')'); } catch (e) { return {}; }
  }
  function px(u) {
    try { return Number(u.as('px')); } catch (e) { return Number(u); }
  }

  /* ---------- 工具 ---------- */
  function activeDoc() {
    if (app.documents.length === 0) return null;
    return app.activeDocument;
  }
  function hasSelection(doc) {
    try {
      var b = doc.selection.bounds;
      if (b === null || b === undefined || b.length !== 4) return false;
      var l = px(b[0]), t = px(b[1]), r = px(b[2]), bt = px(b[3]);
      // 空矩形（某些 PS 版本在没有选区时返回 [0,0,0,0]）
      if (!(r - l > 0.5 && bt - t > 0.5)) return false;
      // 整幅画布 = 没有真正框选（有的版本"无选区"会直接返回画布尺寸）
      try {
        var dw = px(doc.width), dh = px(doc.height);
        if (l <= 0.5 && t <= 0.5 && r >= dw - 0.5 && bt >= dh - 0.5) return false;
      } catch (e1) {}
      return true;
    } catch (e) {
      return false;
    }
  }
  function selRect(doc) {
    try {
      var b = doc.selection.bounds;
      if (!b) return null;
      var l = px(b[0]), t = px(b[1]), r = px(b[2]), bt = px(b[3]);
      return { x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(bt - t) };
    } catch (e) {
      return null;
    }
  }
  function tempDocName() {
    return 'StarsAI_tmp_' + new Date().getTime();
  }
  function savePNG(doc, file) {
    var o = new PNGSaveOptions();
    o.interlaced = false;
    o.compression = 6;
    doc.saveAs(file, o, true);
  }
  /* 在「已经裁好 / 缩好」的临时文档里，把当前选区烧成一张黑白蒙版 PNG（白 = 重绘区）。
   * 为什么在同一个 dup 里做：保证蒙版和送出去的那张图**像素级对齐**（同一次 crop/resize）。
   * ⚠ 会毁掉 dup 的像素，所以必须在保存完图片之后再调用；dup 是副本，无所谓。
   * 极性：白 = 要重绘（和 VAEEncodeForInpaint、LoadImageMask 的约定一致）。
   * 0.7.19 起这条路径是局部重绘的主力：蒙版进 ComfyUI 做 alpha 合成，
   * PS 侧不再需要「反选 + Dlt」（那在 PS 27.10 上实测不可用）。 */
  /* 0.7.31：把当前选区直接烧成黑白像素（白 = 重绘区），**完全不碰通道**。
   * 为什么改：以前是 channels.add() → selection.store → （裁剪/缩放）→ channel`.loadSelection()`。
   * `Channel.loadSelection()` 并不是 Photoshop 脚本 API 里的标准方法
   * （标准写法是 `selection.load(channel, SelectionType.REPLACE)`），一旦它不存在，
   * 蒙版就永远失败、只能退到「外接矩形」—— 套索 / 魔棒画的形状被抹成方块，正是用户看到的现象。
   * 现在只用到 invert + fill 两个一定存在的操作：
   *   1) 反选 → 把「选区外」涂黑
   *   2) 再反选回原选区 → 把「选区内」涂白
   * 羽化会跟着 invert 一起保留，所以边缘仍是柔的；全画布选区时反选为空，填充是 no-op，结果仍是全白。 */
  function hasAnySelection(doc) {
    try {
      var b = doc.selection.bounds;
      if (!b || b.length !== 4) return false;
      return (px(b[2]) - px(b[0]) > 0.5) && (px(b[3]) - px(b[1]) > 0.5);
    } catch (e) { return false; }
  }

  function burnMaskOnDoc(doc) {
    // ⚠ 没有选区时 invert 会全选 → 整张蒙版变成全黑（合成后整块透明）。必须先挡住。
    if (!hasAnySelection(doc)) throw new Error('选区不在了，做不了蒙版');
    var sel = doc.selection;
    sel.invert();
    // 选区铺满整幅时反选为空，这里 fill 是 no-op（有的版本会抛，吞掉即可，后面的白填会盖满）
    try { sel.fill(solid(0, 0, 0), ColorBlendMode.NORMAL, 100, false); } catch (eBlack) {}
    sel.invert();
    sel.fill(solid(255, 255, 255), ColorBlendMode.NORMAL, 100, false);
    try { sel.deselect(); } catch (e) {}
  }

  function saveMaskFromDup(dup, path) {
    var f = new File(path);
    if (f.parent && !f.parent.exists) f.parent.create();
    burnMaskOnDoc(dup);   // 里面自带「选区还在吗」的检查
    savePNG(dup, f);
    if (!f.exists || f.length <= 0) throw new Error('蒙版没写出来：' + f.fsName);
    return { path: f.fsName, width: Math.round(px(dup.width)), height: Math.round(px(dup.height)) };
  }

  function solid(r, g, b) {
    var c = new SolidColor();
    c.rgb.red = r; c.rgb.green = g; c.rgb.blue = b;
    return c;
  }
  /* 0.7.40：导出前把「之前贴回来的结果图层」藏起来。
   * 为什么：place() 贴回来的图层叫 "Stars-AI · xxx"，它会留在画布上；下一次生成把整张画布
   * flatten 出去，等于把上一张 AI 图当参考图喂给模型 —— 上一张的水印/噪点会被当成内容再画一遍，
   * 越滚越脏（真机数据：第二次的 src 中心区域和第一张出图逐像素一致）。
   * 只在 dup 上隐藏，用户文档一像素不动；全隐会导出空白，所以有兜底。 */
  function hideAiLayers(doc) {
    var hid = [], visible = 0;
    function walk(parent) {
      try {
        for (var i = 0; i < parent.layers.length; i++) {
          var l = parent.layers[i];
          try {
            if (l.typename === 'LayerSet') { walk(l); continue; }
            if (!l.visible) continue;
            if (/^Stars-AI/.test(String(l.name || ''))) { l.visible = false; hid.push(l); }
            else visible++;
          } catch (e1) {}
        }
      } catch (e2) {}
    }
    walk(doc);
    if (visible === 0) {          // 整张只剩 AI 图层：全隐就等于导出一张空白，恢复原样
      for (var k = 0; k < hid.length; k++) { try { hid[k].visible = true; } catch (e3) {} }
      return 0;
    }
    return hid.length;
  }

  function normalize(doc) {
    try { if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB); } catch (e) {}
    try { if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) doc.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (e) {}
  }
  /* 按图层 id 在文档里找图层（含组内）。
   * 为什么要它：document.activeLayer 不一定是"刚复制进来的那个图层"，
   * 盲目信任它会导致后面的重命名/缩放/删除作用到用户自己的图层上（事故级）。 */
  function findLayerById(parent, id) {
    try {
      for (var i = 0; i < parent.layers.length; i++) {
        var l = parent.layers[i];
        try { if (l.id === id) return l; } catch (eId) {}
        if (l.typename === 'LayerSet') {
          var r = findLayerById(l, id);
          if (r) return r;
        }
      }
    } catch (e) {}
    return null;
  }

  function msgOf(e) {
    try { return String((e && e.message) ? e.message : e); } catch (e2) { return '未知错误'; }
  }
  function layerIdOf(layer) {
    try { return layer.id; } catch (e) { return null; }
  }
  /* 图层的像素边界 [x1,y1,x2,y2]，全部换算成整数 px（比较/打日志用）。
   * 拿不到就返回 null —— 调用方必须能处理 null，别让它静默变成 NaN。 */
  function numericBounds(layer) {
    try {
      var b = layer.bounds;
      if (!b || b.length !== 4) return null;
      return [Math.round(px(b[0])), Math.round(px(b[1])), Math.round(px(b[2])), Math.round(px(b[3]))];
    } catch (e) { return null; }
  }
  function boundsSize(b) {
    if (!b) return null;
    return { w: b[2] - b[0], h: b[3] - b[1] };
  }
  /* 递归找文档里第一个像素图层（跳过图层组）。探针需要一个“有像素、能随便弄坏”的图层用。 */
  function findArtLayer(layers) {
    try {
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l.typename === 'ArtLayer') return l;
        if (l.typename === 'LayerSet') {
          var r = findArtLayer(l.layers);
          if (r) return r;
        }
      }
    } catch (e) {}
    return null;
  }

  /* 把一个图层设为「活动图层」，并**确认真的切过去了**（0.7.9）。
   * 为什么需要多路尝试：doc.activeLayer = layer 在某些文档结构下会静默失败
   * （图层落在折叠的图层组里、文档开着「自动选择」等）。一旦失败：
   *   → 紧接着的 resize/translate 作用到用户原来的图层（往往是背景层）上
   *   → PS 弹「命令"变换"当前不可用」模态框，脚本卡住十几秒
   *   → 图层尺寸没变，后面按选区裁切自然无效（用户看到的就是「整张图」）
   * 这是 0.7.3~0.7.8 一系列怪象的最后一块拼图。 */
  function makeActive(doc, layer, id) {
    if (id === null || id === undefined) id = layerIdOf(layer);
    try { doc.activeLayer = layer; } catch (e1) {}
    if (id === null || id === undefined) return true;        // 拿不到 id 就没法验证，维持旧行为
    try { if (doc.activeLayer.id === id) return true; } catch (e2) {}
    // 第二招：在组里就先提到文档顶层，再选一次
    try {
      var p = null;
      try { p = layer.parent; } catch (e3) {}
      if (p && p.typename === 'LayerSet') layer.move(doc, ElementPlacement.PLACEATBEGINNING);
    } catch (e4) {}
    try { doc.activeLayer = layer; } catch (e5) {}
    try { if (doc.activeLayer.id === id) return true; } catch (e6) {}
    // 第三招：ActionManager 按 id 选图层
    try {
      var d = new ActionDescriptor();
      var r = new ActionReference();
      r.putIdentifier(charIDToTypeID('Lyr '), id);
      d.putReference(charIDToTypeID('null'), r);
      executeAction(charIDToTypeID('slct'), d, DialogModes.NO);
      if (doc.activeLayer.id === id) return true;
    } catch (e7) {}
    return false;
  }

  /* 变换（resize / translate）前的前置检查。
   * Photoshop 在这些状态下会弹「命令"变换"当前不可用」的模态框：
   *   - 图层是背景层 / 被锁定（All Locked、位置锁定）
   *   - 文档处于快速蒙版
   *   - 活动通道不是复合通道（在编辑某个 alpha 通道）
   * 能自动修的（快速蒙版、锁定、通道）就修掉，修不好的把原因带回去给面板显示。 */
  function prepareForTransform(doc, layer) {
    var issues = [];

    try { if (doc.quickMaskMode) doc.quickMaskMode = false; } catch (e1) {}

    // 通道必须在复合通道上
    if (!selectComposite(doc)) issues.push('无法切回复合通道');

    try { if (layer.isBackgroundLayer) issues.push('目标图层是背景层'); } catch (e2) {}

    // 尝试解除锁定（背景层无法解除，会走到上面的分支）
    try { if (layer.allLocked) { layer.allLocked = false; } } catch (e3) {}
    try { if (layer.positionLocked) { layer.positionLocked = false; } } catch (e4) {}
    try { if (layer.allLocked) issues.push('图层被完全锁定'); } catch (e5) {}
    try { if (layer.positionLocked) issues.push('图层位置被锁定'); } catch (e6) {}

    // 让它在文档里成为活动图层（很多 PS 版本要求这样变换才生效）
    // 0.7.9：改成「多路尝试 + 验证」，并且失败要作为 issue 带回去 —— 静默失败正是历史事故的根源
    if (!makeActive(doc, layer, layerIdOf(layer))) issues.push('无法把新图层设为活动图层（可能它在折叠的图层组里）');

    return issues;
  }

  /* 强制把文档切回“复合通道”视图。
   * 为什么必须做：一旦活动通道落在 alpha 通道上，画布就会显示成灰度图（用户看到的就是“PS 变黑白了”）。
   * 先用属性赋值，失败再用 ActionManager 的 slct/Cmps。 */
  function selectComposite(doc) {
    try {
      if (doc.channels.length) { doc.activeChannels = [doc.channels[0]]; return true; }
    } catch (e1) {}
    try {
      var d = new ActionDescriptor();
      var r = new ActionReference();
      r.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Cmps'));
      d.putReference(charIDToTypeID('null'), r);
      executeAction(charIDToTypeID('slct'), d, DialogModes.NO);
      return true;
    } catch (e2) { return false; }
  }


  function fitToDoc(layer, doc, mode) {
    var b = layer.bounds;
    var lw = px(b[2]) - px(b[0]);
    var lh = px(b[3]) - px(b[1]);
    var dw = px(doc.width), dh = px(doc.height);
    if (mode === 'none' || !lw || !lh) { center(layer, doc); return; }
    var sx = dw / lw, sy = dh / lh;
    var s = mode === 'contain' ? Math.min(sx, sy) : sx;
    if (mode === 'contain' && Math.abs(sy - sx) < 0.001) s = sx;
    var pctW = s * 100;
    var pctH = (mode === 'contain' ? s : sy) * 100;
    // 两个方向都要判：只看横向的话，宽已经对上、高没对上时纵向不会被拉伸
    var changed = Math.abs(pctW - 100) > 0.5 || Math.abs(pctH - 100) > 0.5;
    if (changed) {
      layer.resize(pctW, pctH, AnchorPosition.MIDDLECENTER);
    }
    center(layer, doc);
  }
  function center(layer, doc) {
    var b = layer.bounds;
    var cx = (px(b[0]) + px(b[2])) / 2;
    var cy = (px(b[1]) + px(b[3])) / 2;
    var dx = px(doc.width) / 2 - cx;
    var dy = px(doc.height) / 2 - cy;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      layer.translate(UnitValue(dx, 'px'), UnitValue(dy, 'px'));
    }
  }

  /* ---------- 对外接口 ---------- */
  var api = {};

  api.info = function () {
    try {
      var doc = activeDoc();
      if (!doc) return ok({ doc: null });
      var info = {
        name: doc.name,
        width: Math.round(px(doc.width)),
        height: Math.round(px(doc.height)),
        mode: String(doc.mode).replace('DocumentMode.', ''),
        bits: String(doc.bitsPerChannel).replace('BitsPerChannelType.', ''),
        layers: doc.layers.length,
        hasSelection: hasSelection(doc),
        selection: selRect(doc),
        profile: (function () {
          try { return doc.colorProfileName; } catch (e) { return ''; }
        })()
      };
      return ok({ doc: info });
    } catch (e) { return err(e); }
  };

  api.hasSelection = function () {
    try {
      var doc = activeDoc();
      if (!doc) return ok({ value: false });
      return ok({ value: hasSelection(doc) });
    } catch (e) { return err(e); }
  };

  /* 导出当前文档的扁平 PNG（不动用户文件） */
  api.exportDoc = function (path, optsJson) {
    var opts = parseOpts(optsJson);
    var doc = activeDoc();
    if (!doc) return err('没有打开的文档');
    var dup = null;
    try {
      dup = doc.duplicate();
      app.activeDocument = dup;
      normalize(dup);
      var skippedAi = opts.skipAi ? hideAiLayers(dup) : 0;
      try { dup.flatten(); } catch (e) { try { dup.mergeVisibleLayers(); } catch (e2) {} }
      // 大画布整张丢给 ComfyUI 会把显存/内存压爆（实测 30MP 直接 abort），先按长边缩一下
      var maxEdge = parseInt(opts.maxEdge, 10) || 0;
      var w0 = px(dup.width), h0 = px(dup.height);
      if (maxEdge > 0 && (w0 > maxEdge || h0 > maxEdge)) {
        var k = maxEdge / Math.max(w0, h0);
        try {
          dup.resizeImage(UnitValue(Math.round(w0 * k), "px"), UnitValue(Math.round(h0 * k), "px"), null, ResampleMethod.BICUBIC);
        } catch (eR) {}
      }
      var f = new File(path);
      if (!f.parent.exists) f.parent.create();
      savePNG(dup, f);
      var res = { path: f.fsName, width: Math.round(px(dup.width)), height: Math.round(px(dup.height)), skippedLayers: skippedAi };
      /* 0.7.19：顺手导一张同尺寸黑白蒙版（局部重绘时在 ComfyUI 里合成 alpha）。
       * 必须先存图再烧蒙版 —— 烧蒙版会把 dup 的像素涂黑。 */
      if (opts.maskPath && hasSelection(dup)) {
        try {
          if (opts.expand > 0) { try { dup.selection.expand(UnitValue(parseFloat(opts.expand), 'px')); } catch (eE) {} }
          if (opts.feather > 0) { try { dup.selection.feather(UnitValue(parseFloat(opts.feather), 'px')); } catch (eF) {} }
          res.mask = saveMaskFromDup(dup, opts.maskPath);
          res.maskPath = res.mask.path;
          res.feather = parseFloat(opts.feather) || 0;
          res.expand = parseFloat(opts.expand) || 0;
        } catch (eM) { res.maskError = msgOf(eM); }
      }
      app.activeDocument = doc;
      dup.close(SaveOptions.DONOTSAVECHANGES);
      return ok(res);
    } catch (e) {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
      try { app.activeDocument = doc; } catch (e3) {}
      return err(e);
    }
  };

  /* 选区 -> 黑白蒙版 PNG（白 = 要重绘的区域） */
  api.exportMask = function (path, optsJson) {
    var doc = activeDoc();
    if (!doc) return err('没有打开的文档');
    if (!hasSelection(doc)) return err('当前没有选区：局部重绘需要先框选要修改的区域');
    var opts = parseOpts(optsJson);
    var dup = null;
    try {
      dup = doc.duplicate();
      app.activeDocument = dup;
      normalize(dup);
      var sel = dup.selection;
      if (opts.grow > 0) { try { sel.expand(UnitValue(opts.grow, 'px')); } catch (e) {} }
      if (opts.feather > 0) { try { sel.feather(UnitValue(opts.feather, 'px')); } catch (e) {} }
      // 0.7.31：极性不变（白 = 要重绘，ComfyUI 的 VAEEncodeForInpaint 内部是 m = 1 - mask），
      // 但改成不依赖通道的烧法：先把文档压成单层，再用 invert + fill 涂黑涂白。
      try { dup.flatten(); } catch (eF) { try { dup.mergeVisibleLayers(); } catch (eF2) {} }
      burnMaskOnDoc(dup);
      var f = new File(path);
      if (!f.parent.exists) f.parent.create();
      savePNG(dup, f);
      var res = { path: f.fsName, width: Math.round(px(dup.width)), height: Math.round(px(dup.height)) };
      app.activeDocument = doc;
      dup.close(SaveOptions.DONOTSAVECHANGES);
      return ok(res);
    } catch (e) {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
      try { app.activeDocument = doc; } catch (e3) {}
      return err(e);
    }
  };

  /* 把文档的一块区域（矩形）单独导出成 PNG —— “裁剪式局部重绘”的前半段（0.7.11）。
   * 为什么要它：整图缩到长边 2048 再送去生成，选区内能分到的有效像素只有
   *   （选区宽 / 画布宽）× 2048 那么一点，模型再怎么画也是糊的。
   * 把选区单独裁出来送出去，模型的那点分辨率预算就全花在这块上。
   * 参数 {x,y,w,h, maxEdge}：文档像素坐标；返回实际用的 rect 与真正发出的尺寸。 */
  api.exportRegion = function (path, optsJson) {
    var opts = parseOpts(optsJson);
    var doc = activeDoc();
    if (!doc) return err('没有打开的文档');
    var dup = null;
    try {
      var dw = px(doc.width), dh = px(doc.height);
      var x = Math.max(0, Math.round(parseFloat(opts.x) || 0));
      var y = Math.max(0, Math.round(parseFloat(opts.y) || 0));
      var w = Math.round(parseFloat(opts.w) || 0);
      var h = Math.round(parseFloat(opts.h) || 0);
      if (w < 8 || h < 8) return err('选区太小（' + w + '×' + h + 'px），至少 8 像素');
      if (x + w > dw) w = Math.round(dw - x);
      if (y + h > dh) h = Math.round(dh - y);
      if (w < 8 || h < 8) return err('选区不在画布内');

      dup = doc.duplicate();
      app.activeDocument = dup;
      normalize(dup);
      var skippedAi = opts.skipAi ? hideAiLayers(dup) : 0;
      /* 0.7.19：不再事先反选掉 —— 选区要用来生成蒙版。
       * 0.7.20：实测**选区活不过 flatten/crop/resize**（真机日志：裁完之后选区没了），
       * 所以进来第一件事就是把它存进通道：通道会随 crop / resize 一起被裁、被缩，
       * 天然和输出图对齐，最后再 loadSelection 恢复。
       * selTrace 把每一步的存活情况带回去 —— 以后再出问题一眼能定位是哪一步吃掉的。 */
      var selTrace = { dup: hasSelection(dup), flatten: null, crop: null, resize: null, restored: false };
      var chSel = null;
      try {
        if (selTrace.dup) { chSel = dup.channels.add(); dup.selection.store(chSel); }
      } catch (eS0) { selTrace.storeError = msgOf(eS0); }
      try { if (dup.layers.length > 1) dup.flatten(); } catch (eF) { try { dup.mergeVisibleLayers(); } catch (eF2) {} }
      selTrace.flatten = hasSelection(dup);
      dup.crop([UnitValue(x, 'px'), UnitValue(y, 'px'), UnitValue(x + w, 'px'), UnitValue(y + h, 'px')]);
      selTrace.crop = hasSelection(dup);

      var maxEdge = parseInt(opts.maxEdge, 10) || 0;
      var cw = px(dup.width), ch = px(dup.height);
      if (maxEdge > 0 && (cw > maxEdge || ch > maxEdge)) {
        var k = maxEdge / Math.max(cw, ch);
        try {
          dup.resizeImage(UnitValue(Math.round(cw * k), 'px'), UnitValue(Math.round(ch * k), 'px'), null, ResampleMethod.BICUBIC);
        } catch (eR) {}
      }
      selTrace.resize = hasSelection(dup);
      if (!hasSelection(dup) && chSel) {
        try {
          // 标准写法是 selection.load(channel, SelectionType.REPLACE)；
          // Channel.loadSelection() 在有的版本上不存在（0.7.31 之前这是「蒙版永远失败→矩形兜底」的嫌疑人之一）
          try { dup.selection.load(chSel, SelectionType.REPLACE); }
          catch (eL1) { chSel.loadSelection(); }
          selTrace.restored = hasSelection(dup);
        } catch (eRst) { selTrace.restoreError = msgOf(eRst); }
      }
      if (chSel) { try { chSel.remove(); chSel = null; } catch (eChR) {} }   // saveMaskFromDup 自己会建通道

      var f = new File(path);
      if (!f.parent.exists) f.parent.create();
      savePNG(dup, f);
      var out = {
        path: f.fsName,
        rect: { x: x, y: y, w: w, h: h },
        // ⚠ 0.7.32：之前这里漏了 width/height，而面板的蒙版兜底是 `if (src && src.width)`，
        // 于是裁剪模式下两层兜底全部被跳过、直接报「没有可用蒙版」（也顺带弄丢了 S.docSize）。
        width: Math.round(px(dup.width)),
        height: Math.round(px(dup.height)),
        crop: { w: Math.round(px(dup.width)), h: Math.round(px(dup.height)) },
        skippedLayers: skippedAi,
        doc: { w: Math.round(dw), h: Math.round(dh) },
        selTrace: selTrace
      };
      // 先存图再烧蒙版（烧蒙版会把 dup 的像素涂黑），两者尺寸必然一致
      if (opts.maskPath) {
        try {
          if (!hasSelection(dup)) throw new Error('选区没活到生成蒙版这一步（诊断 ' + toJson(selTrace) + '）');
          if (opts.expand > 0) { try { dup.selection.expand(UnitValue(parseFloat(opts.expand), 'px')); } catch (eE) {} }
          if (opts.feather > 0) { try { dup.selection.feather(UnitValue(parseFloat(opts.feather), 'px')); } catch (eFe) {} }
          out.mask = saveMaskFromDup(dup, opts.maskPath);
          out.maskPath = out.mask.path;
          out.feather = parseFloat(opts.feather) || 0;
          out.expand = parseFloat(opts.expand) || 0;
        } catch (eM) { out.maskError = msgOf(eM); }
      }
      app.activeDocument = doc;
      dup.close(SaveOptions.DONOTSAVECHANGES);
      return ok(out);
    } catch (e) {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
      try { app.activeDocument = doc; } catch (e3) {}
      return err(e);
    }
  };

  /* 0.7.32：按「真实选区形状」导出一张蒙版。
   * 为什么又要改：真机日志证明 `doc.duplicate()` 出来的副本**根本没有选区**
   *   （selTrace 全 false：{"dup":false,"flatten":false,"crop":false,"resize":false}），
   * 所以任何「在副本里用 selection 烧蒙版」的写法都不可能成功 —— 0.7.19~0.7.31 一直卡在这。
   * 现在的做法是「**先在你自己的文档上烧，再复制像素**」：
   *   1) 按面板给的 feather/expand 调整当前选区
   *   2) 新建一个临时图层，用 invert + fill 把选区烧成黑白像素（像素复制一定成功）
   *   3) duplicate 一份 → crop → resize → 存 PNG
   *   4) 无论成败都把临时图层删掉（你的原图一个像素没动，代价是选区会被用掉）
   * 参数与 exportRegion 完全一致（同一组 x/y/w/h + maxEdge），两次算出的缩放比相同，
   * 蒙版和图片仍然像素级对齐。 */
  api.exportRegionMask = function (path, optsJson) {
    var opts = parseOpts(optsJson);
    var doc = activeDoc();
    if (!doc) return err('没有打开的文档');
    if (!hasAnySelection(doc)) return err('当前没有选区：局部重绘需要先框选要修改的区域');
    var dup = null;
    var layer = null;
    try {
      var dw = px(doc.width), dh = px(doc.height);
      var x = Math.max(0, Math.round(parseFloat(opts.x) || 0));
      var y = Math.max(0, Math.round(parseFloat(opts.y) || 0));
      var w = Math.round(parseFloat(opts.w) || dw);
      var h = Math.round(parseFloat(opts.h) || dh);
      if (x + w > dw) w = Math.round(dw - x);
      if (y + h > dh) h = Math.round(dh - y);
      if (w < 8 || h < 8) return err('选区不在画布内');

      // 1) 羽化 / 扩展：在文档坐标里做（和面板 inkFeatherExpand 的单位一致）
      var sel = doc.selection;
      if (opts.expand > 0) { try { sel.expand(UnitValue(parseFloat(opts.expand), 'px')); } catch (eE) {} }
      if (opts.feather > 0) { try { sel.feather(UnitValue(parseFloat(opts.feather), 'px')); } catch (eFe) {} }

      // 2) 临时图层上烧蒙版（原图被它整个盖住，删层即还原；这一步会把选区用掉）
      layer = doc.artLayers.add();
      layer.name = 'StarsAI_mask_tmp';
      if (doc.activeLayer && doc.activeLayer.id !== layer.id) { try { doc.activeLayer = layer; } catch (eAL) {} }
      burnMaskOnDoc(doc);

      // 3) 复制像素（不依赖选区复制）→ 裁 → 缩 → 存
      dup = doc.duplicate('StarsAI_mask');
      app.activeDocument = dup;
      try { dup.flatten(); } catch (eF) { try { dup.mergeVisibleLayers(); } catch (eF2) {} }
      dup.crop([UnitValue(x, 'px'), UnitValue(y, 'px'), UnitValue(x + w, 'px'), UnitValue(y + h, 'px')]);
      var maxEdge = parseInt(opts.maxEdge, 10) || 0;
      var cw = px(dup.width), chh = px(dup.height);
      if (maxEdge > 0 && (cw > maxEdge || chh > maxEdge)) {
        var k = maxEdge / Math.max(cw, chh);
        try {
          dup.resizeImage(UnitValue(Math.round(cw * k), 'px'), UnitValue(Math.round(chh * k), 'px'), null, ResampleMethod.BICUBIC);
        } catch (eR) {}
      }

      var f = new File(path);
      if (!f.parent.exists) f.parent.create();
      savePNG(dup, f);
      var out = {
        path: f.fsName,
        rect: { x: x, y: y, w: w, h: h },
        width: Math.round(px(dup.width)),
        height: Math.round(px(dup.height))
      };
      app.activeDocument = doc;
      dup.close(SaveOptions.DONOTSAVECHANGES);
      dup = null;
      // 4) 收尾：删掉临时图层，你的原图回到原样（选区在烧蒙版时已经用掉了）
      try { if (layer) { layer.remove(); layer = null; } } catch (eRm) {}
      try { doc.selection.deselect(); } catch (eDe) {}
      return ok(out);
    } catch (e) {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e3) {}
      try { app.activeDocument = doc; } catch (e4) {}
      // ⚠ 失败路径也必须删层，否则黑白的蒙版会留在用户文档最上面
      try { if (layer) { layer.remove(); layer = null; } } catch (e5) {}
      return err(e);
    }
  };

  /* 把图片放进 PS：target=layer 插入当前文档（可选按选区加蒙版），target=doc 新开文档 */
  api.place = function (path, optsJson) {
    var opts = parseOpts(optsJson);
    var f = new File(path);
    if (!f.exists) return err('找不到结果文件：' + path);

    if (opts.target === 'doc') {
      try {
        var d = app.open(f);
        return ok({ action: 'doc', name: d.name, width: Math.round(px(d.width)), height: Math.round(px(d.height)) });
      } catch (e) { return err(e); }
    }

    var target = activeDoc();
    if (!target) {
      try {
        var nd = app.open(f);
        return ok({ action: 'doc', name: nd.name, width: Math.round(px(nd.width)), height: Math.round(px(nd.height)) });
      } catch (e2) { return err(e2); }
    }

    var src = null;
    var hadSel = hasSelection(target);
    try {
      src = app.open(f);
      app.activeDocument = src;            // 复制图层要求源文档在最前面
      // 千万别 flatten：带 alpha 的 PNG 被扁平化会合成到白底，透明背景就没了（Q 版小人白底的元凶）
      if (src.layers.length > 1) {
        try { src.mergeVisibleLayers(); } catch (eMerge) {}
      }
      try { if (src.layers[0].isBackgroundLayer) src.layers[0].isBackgroundLayer = false; } catch (e0) {}
      /* 0.7.9：把「缩放」搬到源文档里做 —— 这是「命令"变换"当前不可用」的解法。
       * 旧做法是在用户文档里对复制进来的图层 resize/translate：一旦 activeLayer 没切过去，
       * 变换就落到用户原来的图层（通常是背景层）上 —— PS 弹「命令"变换"当前不可用」模态框、
       * 脚本卡住十几秒、图层尺寸却没变，后面按选区裁切自然全部无效（=「整张图」）。
       * 现在先在临时 PNG 文档上 resizeImage 到目标像素尺寸（和 exportDoc 里那条同款：
       * 单图层、无选区、无锁定，最不容易出问题），复制进用户文档后天生就是画布大小、贴 (0,0)，
       * 用户文档里一次 transform 都不需要。 */
      var fitMode = opts.fit || 'stretch';
      var stretched = false;
      /* 0.7.11 裁剪模式（opts.rect）：结果图只代表选区那一块。
       * 做法：在临时文档里先缩到 rect 的像素尺寸 → 画布扩到整幅（TOPLEFT，图层留在 0,0）
       * → 平移到 rect 位置 → 再 duplicate 进用户文档。所有变换都发生在临时文档里
       * （单图层、无选区、无锁定），用户文档里一次 transform 都不做。 */
      var rectUsed = null;
      var rectError = null;
      try {
        if (opts.rect && parseFloat(opts.rect.w) > 0 && parseFloat(opts.rect.h) > 0) {
          rectUsed = {
            x: Math.round(parseFloat(opts.rect.x) || 0), y: Math.round(parseFloat(opts.rect.y) || 0),
            w: Math.round(parseFloat(opts.rect.w)), h: Math.round(parseFloat(opts.rect.h))
          };
        }
      } catch (eR0) { rectUsed = null; }
      if (rectUsed) {
        // 越界保护：app.js 传的是当时那张文档的坐标，换了文档/改过画布后可能越界
        try {
          var tw0 = px(target.width), th0 = px(target.height);
          if (rectUsed.x < 0) rectUsed.x = 0;
          if (rectUsed.y < 0) rectUsed.y = 0;
          if (rectUsed.x + rectUsed.w > tw0) rectUsed.w = Math.round(tw0 - rectUsed.x);
          if (rectUsed.y + rectUsed.h > th0) rectUsed.h = Math.round(th0 - rectUsed.y);
          if (rectUsed.w < 8 || rectUsed.h < 8) {
            try { src.close(SaveOptions.DONOTSAVECHANGES); } catch (eSC0) {}
            try { app.activeDocument = target; } catch (eAT0) {}
            return err('选区块已经不在画布里了（文档被改过尺寸？），这条结果请用「新文档」查看');
          }
        } catch (eRc) {}
        /* 0.7.21：可选 inset —— 把生成图外扩的那一圈裁掉再贴。
         * 为什么需要：裁剪模式送出去的是「选区 + 15% 外扩」，那一圈是模型重新画的背景。
         * 没有 alpha 合成时如果整块贴回去，就会在选区外围多出一圈很粗的边（红底照片 = 红框）。 */
        var insetUsed = null;
        try {
          if (opts.inset && parseFloat(opts.inset.w) > 8 && parseFloat(opts.inset.h) > 8) {
            var ix = Math.max(0, Math.round(parseFloat(opts.inset.x) || 0));
            var iy = Math.max(0, Math.round(parseFloat(opts.inset.y) || 0));
            var iw = Math.round(parseFloat(opts.inset.w)), ih = Math.round(parseFloat(opts.inset.h));
            if (ix + iw > rectUsed.w) iw = rectUsed.w - ix;
            if (iy + ih > rectUsed.h) ih = rectUsed.h - iy;
            if (iw > 8 && ih > 8) insetUsed = { x: ix, y: iy, w: iw, h: ih };
          }
        } catch (eInset) { insetUsed = null; }
        try {
          src.resizeImage(UnitValue(rectUsed.w, 'px'), UnitValue(rectUsed.h, 'px'), null, ResampleMethod.BICUBIC);
          if (insetUsed) {
            // 先把外扩环裁掉：画布缩到 inset 区域，图层随之落到 (0,0)
            src.crop([UnitValue(insetUsed.x, 'px'), UnitValue(insetUsed.y, 'px'),
                      UnitValue(insetUsed.x + insetUsed.w, 'px'), UnitValue(insetUsed.y + insetUsed.h, 'px')]);
          }
          src.resizeCanvas(UnitValue(px(target.width), 'px'), UnitValue(px(target.height), 'px'), AnchorPosition.TOPLEFT);
          var tx0 = rectUsed.x + (insetUsed ? insetUsed.x : 0);
          var ty0 = rectUsed.y + (insetUsed ? insetUsed.y : 0);
          if (tx0 || ty0) src.activeLayer.translate(UnitValue(tx0, 'px'), UnitValue(ty0, 'px'));
        } catch (eRect) {
          // 失败就明确中止：继续走"整图缩放"会把一块小图居中糊到画面上，比报错更糟
          var rectWhy = msgOf(eRect);
          try { src.close(SaveOptions.DONOTSAVECHANGES); } catch (eSC) {}
          try { app.activeDocument = target; } catch (eAT) {}
          return err('结果没法摆到选区位置（' + rectWhy + '）：可以先用「新文档」查看这张结果');
        }
      }
      if (!rectUsed && !opts.sizeRatio && fitMode !== 'contain' && fitMode !== 'none') {
        try {
          var sw0 = px(src.width), sh0 = px(src.height);
          var dw0 = px(target.width), dh0 = px(target.height);
          if (Math.abs(sw0 - dw0) > 0.5 || Math.abs(sh0 - dh0) > 0.5) {
            src.resizeImage(UnitValue(dw0, 'px'), UnitValue(dh0, 'px'), null, ResampleMethod.BICUBIC);
            stretched = true;
          }
        } catch (eStretch) {}
      }
      var layer = src.activeLayer.duplicate(target);
      // 记下这个图层的唯一 id：之后所有操作都只认它，绝不作用到用户的图层上
      var layerId = null;
      try { layerId = layer.id; } catch (eId) {}
      try { src.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
      src = null;
      app.activeDocument = target;
      selectComposite(target);   // 顺手把「停在通道视图」的文档修回彩色

      // 重新按 id 解析一次（跨文档复制后对象引用偶尔会失效）；解析不到就报错，绝不用 activeLayer 顶替
      if (layerId !== null) {
        var resolved = findLayerById(target, layerId);
        if (resolved) layer = resolved;
        else { try { return err('复制图层失败：目标文档里找不到刚新建的图层（id ' + layerId + '）'); } catch (eR) { return err('复制图层失败'); } }
      }
      try { layer.name = opts.layerName || 'Stars-AI'; } catch (eName) {}
      // 安全闸：确认要动的图层是刚复制进来的那个，并且不是用户的背景层
      var safeLayer = true;
      try {
        if (layerId !== null && layer.id !== layerId) safeLayer = false;
        if (layer.isBackgroundLayer) safeLayer = false;
      } catch (eSafe) { safeLayer = false; }
      if (!safeLayer) {
        return err('拒绝操作：目标图层不是新复制进来的图层（或它是背景层），已中止以免破坏原图');
      }

      // 变换前的体检：这一步能挡住「命令"变换"当前不可用」的模态框
      var prepIssues = prepareForTransform(target, layer);

      /* 0.7.9：变换不再静默。
       * 以前是 catch (eFit) {}，变换失败和成功长得一模一样（用户只看到「整张图」）。
       * 现在三件事都回传给面板：要不要变换、变换抛了什么、变换后图层到底铺满画布没有。 */
      var fitError = null;
      var fitApplied = false;
      var needFit = true;
      try {
        var lbz = layer.bounds;
        var lwz = px(lbz[2]) - px(lbz[0]), lhz = px(lbz[3]) - px(lbz[1]);
        var dwt = px(target.width), dht = px(target.height);
        if (Math.abs(lwz - dwt) <= Math.max(1.5, dwt * 0.001) &&
            Math.abs(lhz - dht) <= Math.max(1.5, dht * 0.001)) needFit = false;
      } catch (eNeed) {}
      if (rectUsed) needFit = false;   // 裁剪模式：尺寸和位置已经在临时文档里摆好了
      if (needFit && prepIssues.length) {
        return err('无法变换图层（' + prepIssues.join('；') + '）：请在 Photoshop 里确认文档不在快速蒙版、图层未被锁定后重试');
      }
      try {
        if (rectUsed) {
          // 裁剪模式：什么都不做（临时文档里已经缩好、摆好位置）
        } else if (opts.sizeRatio) {
          // 贴纸模式：按画布高度比例缩放，再按 offsetY 定位
          var lb = layer.bounds;
          var lh2 = px(lb[3]) - px(lb[1]);
          var pct2 = (px(target.height) * parseFloat(opts.sizeRatio) / lh2) * 100;
          if (isFinite(pct2) && pct2 > 0) layer.resize(pct2, pct2, AnchorPosition.MIDDLECENTER);
          var lb2 = layer.bounds;
          var cx2 = (px(lb2[0]) + px(lb2[2])) / 2;
          var cy2 = (px(lb2[1]) + px(lb2[3])) / 2;
          var oy2 = opts.offsetY === undefined ? 0.58 : parseFloat(opts.offsetY);
          layer.translate(UnitValue(px(target.width) / 2 - cx2, 'px'), UnitValue(px(target.height) * oy2 - cy2, 'px'));
        } else if (needFit) {
          fitToDoc(layer, target, fitMode);
        } else {
          // 尺寸已经精确匹配：只需居中，而这种情况 dx/dy 通常是 0，压根不会调 transform
          center(layer, target);
        }
      } catch (eFit) {
        fitError = '变换失败：' + msgOf(eFit);
      }
      // 复核：图层真的落在该在的位置/尺寸上了吗？不对的话，后面按选区裁切一定对不齐
      try {
        var lba = layer.bounds;
        var lwa = px(lba[2]) - px(lba[0]), lha = px(lba[3]) - px(lba[1]);
        if (rectUsed) {
          var exX = rectUsed.x + (insetUsed ? insetUsed.x : 0);
          var exY = rectUsed.y + (insetUsed ? insetUsed.y : 0);
          var exW = insetUsed ? insetUsed.w : rectUsed.w;
          var exH = insetUsed ? insetUsed.h : rectUsed.h;
          fitApplied = Math.abs(Math.round(px(lba[0])) - exX) <= 2 &&
                       Math.abs(Math.round(px(lba[1])) - exY) <= 2 &&
                       Math.abs(lwa - exW) <= Math.max(2, exW * 0.01) &&
                       Math.abs(lha - exH) <= Math.max(2, exH * 0.01);
        } else {
          fitApplied = Math.abs(lwa - px(target.width)) <= Math.max(2, px(target.width) * 0.002) &&
                       Math.abs(lha - px(target.height)) <= Math.max(2, px(target.height) * 0.002);
        }
      } catch (eFitChk) { fitApplied = false; }
      if (!fitApplied && !fitError) fitError = rectUsed ? '结果没摆到选区位置上' : '图层尺寸没铺满画布';

      var masked = false;
      var maskKind = 'none';
      var lostSelection = false;
      var viewRestored = true;
      var clipError = null;      // 0.7.9：裁切在哪一步失败，原样回传给面板（不再静默）
      var selTouched = '';       // 扩展/羽化是否失败
      var selUsed = null;        // 实际参与裁切的选区（扩展/羽化之后）
      /* ⚠ 0.7.21 起这条路**默认关闭**，必须显式传 allowClip=true 才会跑。
       * 原因（真机血泪）：
       *   1) PS 27.10 上「反选 + Dlt」本身不可用（自检 2026-10-20 23:43 实测）；
       *   2) 万一它生效了、而活动图层是背景层，删掉的像素会被**背景色**填回来 ——
       *      用户背景色是红的，于是「选区外一圈巨大的红色边框」。
       * 现在局部重绘改在 ComfyUI 里合成 alpha，PS 侧只负责摆图层，一次删像素都不做。
       * 这里保留代码只为兼容，任何调用方都不要再传 clipToSelection。 */
      if (opts.clipToSelection && opts.allowClip) {
        if (!hadSel) {
          // 导出/出图期间选区没了（换过文档、手动取消过选择）：没法做局部合成，明确告诉面板
          lostSelection = true;
        } else {
          /* 局部合成只用「像素裁切」，不再建图层蒙版、也完全不碰通道。
           * 原因：建蒙版要走 ActionManager 的 Mk/Chnl 动作，配合临时通道时会把文档带进通道视图
           * （画布变灰），且失败是静默的。裁切只用到 selection + Dlt 两个最常见的操作，
           * 而且**做完可以自检**（比较图层 bounds 有没有真的缩小），失败能被发现。 */
          selectComposite(target);

          if (opts.expand > 0) {
            try { target.selection.expand(UnitValue(opts.expand, 'px')); }
            catch (eExp) { selTouched = '扩展失败：' + msgOf(eExp); }
          }
          if (opts.feather > 0) {
            try { target.selection.feather(UnitValue(opts.feather, 'px')); }
            catch (eFea) { selTouched = '羽化失败：' + msgOf(eFea); }
          }
          selUsed = selRect(target);

          if (!hasSelection(target)) {
            lostSelection = true;
          } else {
            var beforeBounds = null;
            try { beforeBounds = layer.bounds; } catch (eB) {}
            // 0.7.9：先确认新图层真的成了活动图层，再由它去删；每步失败都记下原因
            var activated = makeActive(target, layer, layerId);
            if (!activated) {
              clipError = '无法把新图层设为活动图层（它可能在折叠的图层组里）';
            } else {
              /* 0.7.10 硬保险：删除（Dlt）永远作用在「当前活动图层」上。
               * 万一活动图层变成了用户的背景层，删掉的像素会被**背景色**填回来 ——
               * 用户看到的就是「选区外一片红色」（他的背景色是红的，0.7.6 的红色块同源）。
               * 宁可放弃这次裁切，也绝不在背景层上删像素。 */
              var bgTarget = false;
              try { bgTarget = !!target.activeLayer.isBackgroundLayer; } catch (eBg) { bgTarget = true; }
              if (bgTarget) {
                clipError = '删除目标变成了背景层，已中止（否则选区外会被背景色填成红色）';
              } else {
                try { target.selection.invert(); }                    // 反选 = 选区外
                catch (eInv) { clipError = '反选失败：' + msgOf(eInv); }
                if (!clipError) {
                  try { executeAction(charIDToTypeID('Dlt '), new ActionDescriptor(), DialogModes.NO); }   // 删掉选区外
                  catch (eDlt) { clipError = '删除选区外像素失败：' + msgOf(eDlt); }
                }
              }
            }
            try { target.selection.deselect(); } catch (e) {}

            // 自检：图层边界应该明显小于原来的画布级范围，否则说明没删掉（= 还是整张图）
            if (beforeBounds) {
              try {
                var afterBounds = layer.bounds;
                var bw = px(beforeBounds[2]) - px(beforeBounds[0]);
                var bh = px(beforeBounds[3]) - px(beforeBounds[1]);
                var aw = px(afterBounds[2]) - px(afterBounds[0]);
                var ah = px(afterBounds[3]) - px(afterBounds[1]);
                if ((bw > 0 && aw < bw * 0.99) || (bh > 0 && ah < bh * 0.99)) maskKind = 'alpha';
                else maskKind = 'none';
              } catch (eChk) { maskKind = 'none'; }
            } else {
              maskKind = 'none';
            }
            masked = (maskKind === 'alpha');
            if (!masked && !clipError) {
              clipError = '有选区，但删掉选区外像素后图层范围没缩小（选区可能压在图层外，或整幅画布都被选中）';
              if (selTouched) clipError = selTouched + '；' + clipError;
            }
          }

          // 收尾：务必把文档切回复合通道（万一此前被别的操作带到通道视图）
          viewRestored = selectComposite(target);
        }
      }

      return ok({
        action: 'layer', name: layer.name,
        masked: masked, maskKind: maskKind, noSelection: lostSelection, viewRestored: viewRestored,
        layerId: layerId,
        // 0.7.9 新增的诊断字段：面板据此告诉用户到底哪一步没成，而不是一句「整图」
        stretch: stretched, needFit: needFit, fitApplied: fitApplied,
        fitError: fitError, clipError: clipError, selUsed: selUsed,
        rect: rectUsed, rectError: rectError,
        layerBounds: (function () {
          try { var b = layer.bounds; return [Math.round(px(b[0])), Math.round(px(b[1])), Math.round(px(b[2])), Math.round(px(b[3]))]; }
          catch (e) { return null; }
        })(),
        width: Math.round(px(target.width)), height: Math.round(px(target.height))
      });
    } catch (e) {
      try { if (src) src.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
      try { app.activeDocument = target; } catch (e4) {}
      return err(e);
    }
  };

  /* 打开图片为文档 */
  api.openDoc = function (path) {
    try {
      var f = new File(path);
      if (!f.exists) return err('文件不存在');
      var d = app.open(f);
      return ok({ name: d.name });
    } catch (e) { return err(e); }
  };

  /* 让用户挑一个文件（JSON 工作流） */
  api.pickFile = function (title) {
    try {
      var f = File.openDialog(title || '选择文件', function (f2) { return true; }, false);
      if (!f) return ok({ path: '' });
      return ok({ path: f.fsName, name: f.name });
    } catch (e) { return err(e); }
  };

  /* 读取文本文件（工作流 JSON 用，避开浏览器里的文件选择框） */
  api.readText = function (path) {
    try {
      var f = new File(path);
      if (!f.exists) return err('文件不存在');
      f.encoding = 'UTF-8';
      f.open('r');
      var s = f.read();
      f.close();
      return ok({ text: s });
    } catch (e) { return err(e); }
  };

  /* 让用户挑一个目录（选 ComfyUI 安装位置） */
  api.pickFolder = function (title) {
    try {
      var f = Folder.selectDialog(title || '选择 ComfyUI 目录');
      if (!f) return ok({ path: '' });
      return ok({ path: f.fsName, name: f.name });
    } catch (e) { return err(e); }
  };

  /* 自检：把文档/图层/通道的真实状态吐出来（排"画布变灰/贴错位置/贴错图层"这类问题用） */
  api.diag = function () {
    try {
      var doc = activeDoc();
      if (!doc) return ok({ doc: null });
      var o = {
        name: doc.name,
        mode: String(doc.mode),
        bits: String(doc.bitsPerChannel),
        width: Math.round(px(doc.width)),
        height: Math.round(px(doc.height)),
        channels: doc.channels.length,
        layers: doc.layers.length,
        hasSel: false,
        sel: null,
        quickMask: null,
        layer: null
      };
      try { o.hasSel = hasSelection(doc); o.sel = selRect(doc); } catch (eSel) {}
      try { o.quickMask = doc.quickMaskMode; } catch (e1) {}
      try {
        var l = doc.activeLayer;
        var b = l.bounds;
        o.layer = {
          name: l.name,
          kind: String(l.kind),
          visible: l.visible,
          opacity: l.opacity,
          hasMask: false,
          bounds: [Math.round(px(b[0])), Math.round(px(b[1])), Math.round(px(b[2])), Math.round(px(b[3]))]
        };
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID('Lyr '), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
        o.layer.hasMask = executeActionGet(ref).hasKey(charIDToTypeID('UsrM'));
      } catch (e2) {}
      return ok(o);
    } catch (e) { return err(e); }
  };

  /* 文档状态快照（自检报告里用；字段与 diag 保持一致，但 diag 那份是给用户看的旧格式，不去动它） */
  function docState(doc) {
    var o = { name: doc.name };
    try { o.w = Math.round(px(doc.width)); o.h = Math.round(px(doc.height)); } catch (e0) {}
    try { o.mode = String(doc.mode); } catch (e1) {}
    try { o.bits = String(doc.bitsPerChannel); } catch (e2) {}
    try { o.channels = doc.channels.length; } catch (e3) {}
    try { o.layers = doc.layers.length; } catch (e4) {}
    try { o.quickMask = !!doc.quickMaskMode; } catch (e5) {}
    try { o.hasSel = hasSelection(doc); o.sel = selRect(doc); } catch (e6) {}
    try {
      var l = doc.activeLayer;
      o.active = { name: l.name, id: layerIdOf(l), isBg: !!l.isBackgroundLayer };
    } catch (e7) {}
    return o;
  }

  /* ---------- 安全探针（0.7.17）----------
   * 为什么需要它：0.7.9~0.7.16 的每一步都只能“真机跑一次，失败才知道”，
   * 而一次失败要等 30 秒生成、还可能改坏用户文档（“选区外一片红”就是这么来的）。
   * 这个函数把整条链路在**文档副本**上跑一遍，用户的文档一个像素都不动：
   *   - 全程 app.displayDialogs = DialogModes.NO：PS 不会弹模态框把脚本卡住（这是最关键的防护）
   *   - 每一步独立 try/catch：成功带耗时，失败带 PS 的原话
   *   - 副本用完 DONOTSAVECHANGES 关掉；原文档的 activeLayer 也会还原
   * 它回答的是：「这台 PS 上 makeActive / crop / resizeCanvas / translate / Dlt 到底行不行」。
   * 结果直接写进面板日志，不用再等一次完整生成。 */
  api.selfTest = function (outPath) {
    var doc = activeDoc();
    if (!doc) return err('先打开一个文档再自检');

    var steps = [];
    var probeLayers = [];
    function run(name, fn) {
      var t0 = new Date().getTime();
      var rec = { name: name, ok: false };
      try {
        var r = fn();
        rec.ok = true;
        if (r !== undefined && r !== null) rec.detail = r;
      } catch (e) {
        rec.ok = false;
        rec.error = msgOf(e);
      }
      rec.ms = new Date().getTime() - t0;
      steps.push(rec);
      return rec.ok;
    }

    var report = { ps: String(app.version), jsx: JSX_BUILD, doc: null, probeLayers: probeLayers, steps: steps, pass: 0, fail: 0, verdict: '', warnings: [] };
    try { report.doc = docState(doc); } catch (e0) {}

    var dup = null;
    var oldDialogs = null;
    var savedPath = '';
    try {
      try { oldDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO; } catch (eD) {}

      var dupOk = run('duplicate（复制成临时文档，原文档不动）', function () {
        dup = doc.duplicate();
        if (!dup) throw new Error('duplicate() 没有返回文档');
        app.activeDocument = dup;
        normalize(dup);
        try { if (hasSelection(dup)) dup.selection.deselect(); } catch (eSel0) {}
        return dup.name + ' · ' + Math.round(px(dup.width)) + '×' + Math.round(px(dup.height));
      });

      if (dupOk) {
        /* A. makeActive 三路：把文档里前 6 个图层（含组内图层）逐个切成活动图层并验证 id。
         * 全部失败 = 0.7.9 的三路在这台 PS 上都不成立，那就必须换思路（不能靠活动图层删像素）。 */
        var cands = [];
        (function collect(layers, inGroup, depth) {
          for (var i = 0; i < layers.length && cands.length < 6; i++) {
            var L = layers[i];
            cands.push({ layer: L, name: L.name, inGroup: inGroup, id: layerIdOf(L) });
            if (L.typename === 'LayerSet' && depth < 2) collect(L.layers, true, depth + 1);
          }
        })(dup.layers, false, 0);
        for (var ci = 0; ci < cands.length; ci++) {
          var prec = { name: cands[ci].name, inGroup: cands[ci].inGroup, ok: false };
          try { prec.ok = makeActive(dup, cands[ci].layer, cands[ci].id); }
          catch (eMA) { prec.error = msgOf(eMA); }
          probeLayers.push(prec);
        }
        var okCount = 0, groupSeen = false;
        for (var pi = 0; pi < probeLayers.length; pi++) {
          if (probeLayers[pi].ok) okCount++;
          if (probeLayers[pi].inGroup) groupSeen = true;
        }
        if (probeLayers.length && okCount === 0) report.warnings.push('makeActive 全部失败：任何依赖“活动图层”的操作（含删选区外）都不可用');
        if (!groupSeen) report.warnings.push('文档里没有图层组：组内图层那条路径这次没验证到');

        run('resizeImage（副本缩到长边 512）', function () {
          var w = px(dup.width), h = px(dup.height);
          var k = Math.min(1, 512 / Math.max(w, h));
          var nw = Math.max(16, Math.round(w * k)), nh = Math.max(16, Math.round(h * k));
          dup.resizeImage(UnitValue(nw, 'px'), UnitValue(nh, 'px'), null, ResampleMethod.BICUBIC);
          return Math.round(px(dup.width)) + '×' + Math.round(px(dup.height)) + '（k=' + k.toFixed(3) + '）';
        });

        /* B. 造一个“可以随便弄坏”的图层：删像素永远作用在活动图层上，
         * 所以先证明「探针图层 → 设为活动图层 → 删选区外 → 范围缩小」这条路通。
         * ⚠ 0.7.17 这里的写法是 artLayers.add() + layer.fill()，但 PS 27 的 ArtLayer 上
         * **没有 fill 方法**（实测报「probeLayer.fill 不是函数」）→ 建出来的是空图层 →
         * 紧接着 Dlt 报「命令"删除"当前不可用」、translate 报「最初的定界矩形是空的」，
         * 三步连环失败，看起来像 PS 不支持，其实是探针自己的 bug。
         * 0.7.18 改成「复制文档里最底层的像素图层」：和真实写回（duplicate 一个满画布图层）
         * 最接近，也不依赖任何不确定的 DOM 方法。 */
        var probeLayer = null, probeId = null, probeReady = false;
        run('复制像素图层当探针', function () {
          var srcLayer = null;
          try { if (dup.artLayers.length) srcLayer = dup.artLayers[dup.artLayers.length - 1]; } catch (eAL) {}
          if (!srcLayer) srcLayer = findArtLayer(dup.layers);
          if (!srcLayer) throw new Error('文档里找不到像素图层（全是调整层 / 组？）');
          probeLayer = srcLayer.duplicate();
          try { probeLayer.name = 'StarsAI_probe'; } catch (ePN) {}
          probeId = layerIdOf(probeLayer);
          probeReady = (probeId !== null);
          return probeLayer.name + ' · id ' + probeId + ' · 来源「' + srcLayer.name + '」';
        });

        /* ⚠ 这步测的是 0.7.18 及以前的方案。0.7.19 起局部重绘改用「ComfyUI 内 alpha 合成」，
         * PS 侧不再删像素 —— 所以这里 ✗ 也**不影响功能**了，只作为 FYI 记录。 */
        run('反选 + Dlt（旧方案·0.7.19 起已弃用，仅记录）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          if (!makeActive(dup, probeLayer, probeId)) throw new Error('无法把探针图层设为活动图层');
          if (dup.activeLayer.isBackgroundLayer) throw new Error('活动图层是背景层，删像素会被背景色填满（这就是“选区外变红”）');
          var b0 = numericBounds(probeLayer);
          var s0 = boundsSize(b0);
          if (!s0 || s0.w <= 0 || s0.h <= 0) throw new Error('探针图层是空的（bounds 为零），没有像素可删');
          var w = Math.min(80, Math.max(16, Math.round(px(dup.width) / 3)));
          var h = Math.min(60, Math.max(16, Math.round(px(dup.height) / 3)));
          var x = Math.round((px(dup.width) - w) / 2), y = Math.round((px(dup.height) - h) / 2);
          dup.selection.select([[UnitValue(x, 'px'), UnitValue(y, 'px')], [UnitValue(x + w, 'px'), UnitValue(y + h, 'px')]], SelectionType.REPLACE, 0, true);
          dup.selection.invert();
          executeAction(charIDToTypeID('Dlt '), new ActionDescriptor(), DialogModes.NO);
          try { dup.selection.deselect(); } catch (eDS) {}
          var b1 = numericBounds(probeLayer);
          var s1 = boundsSize(b1);
          if (!s1) throw new Error('删完拿不到图层 bounds');
          if (!(s1.w < s0.w || s1.h < s0.h)) throw new Error('删完图层范围没缩小（Dlt 没真正生效）：' + s0.w + '×' + s0.h + ' → ' + s1.w + '×' + s1.h);
          return s0.w + '×' + s0.h + ' → ' + s1.w + '×' + s1.h;
        });

        run('crop（按矩形裁剪）', function () {
          var w = Math.min(128, Math.round(px(dup.width)));
          var h = Math.min(96, Math.round(px(dup.height)));
          dup.crop([UnitValue(0, 'px'), UnitValue(0, 'px'), UnitValue(w, 'px'), UnitValue(h, 'px')]);
          return Math.round(px(dup.width)) + '×' + Math.round(px(dup.height));
        });

        /* resizeCanvas 和 translate 拆成两步：0.7.17 合成一步时，translate 失败会把
         * 「resizeCanvas 到底成没成」一起吞掉（实测它其实成功了，日志里却只看到一句失败）。 */
        run('resizeCanvas TOPLEFT', function () {
          var w = Math.round(px(dup.width)), h = Math.round(px(dup.height));
          dup.resizeCanvas(UnitValue(w + 64, 'px'), UnitValue(h + 48, 'px'), AnchorPosition.TOPLEFT);
          return w + '×' + h + ' → ' + Math.round(px(dup.width)) + '×' + Math.round(px(dup.height));
        });

        run('translate（活动图层位移）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          if (!makeActive(dup, probeLayer, probeId)) throw new Error('无法把探针图层设为活动图层');
          var b0 = numericBounds(probeLayer);
          var s0 = boundsSize(b0);
          if (!s0 || s0.w <= 0 || s0.h <= 0) throw new Error('活动图层是空的（bounds 为零），没法测变换');
          probeLayer.translate(UnitValue(10, 'px'), UnitValue(8, 'px'));
          var b1 = numericBounds(probeLayer);
          if (!b1) throw new Error('变换后拿不到 bounds');
          if (b1[0] - b0[0] !== 10 || b1[1] - b0[1] !== 8) throw new Error('translate 没生效：' + b0.join(',') + ' → ' + b1.join(','));
          return b0.join(',') + ' → ' + b1.join(',');
        });

        run('flatten + savePNG（真的写出文件）', function () {
          try { if (dup.layers.length > 1) dup.flatten(); } catch (eF) {}
          var f = outPath ? new File(outPath) : new File(Folder.temp.fsName + '/starsai_selftest_' + new Date().getTime() + '.png');
          if (f.parent && !f.parent.exists) f.parent.create();
          savePNG(dup, f);
          if (!f.exists || f.length <= 0) throw new Error('文件没写出来：' + f.fsName);
          savedPath = f.fsName;
          return f.fsName + ' · ' + Math.round(f.length / 1024) + ' KB';
        });

        run('open（重新打开刚写的 PNG）', function () {
          if (!savedPath) throw new Error('上一步没写出文件，跳过');
          var f2 = new File(savedPath);
          var re = app.open(f2);
          var out = re.name + ' · ' + Math.round(px(re.width)) + '×' + Math.round(px(re.height));
          re.close(SaveOptions.DONOTSAVECHANGES);
          app.activeDocument = dup;
          return out;
        });
      }
    } catch (eTop) {
      report.topError = msgOf(eTop);
    } finally {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {}
      try { app.activeDocument = doc; } catch (eA) {}
      try { if (oldDialogs) app.displayDialogs = oldDialogs; } catch (eD2) {}
      dup = null;
      for (var si = 0; si < steps.length; si++) { if (steps[si].ok) report.pass++; else report.fail++; }
      report.verdict = report.fail ? ('有 ' + report.fail + ' 步失败，见 steps 里的 error') : '全部通过';
    }
    return ok(report);
  };

  api.ping = function () {
    return ok({ ps: String(app.version), docs: app.documents.length, jsx: JSX_BUILD });
  };

  return api;
})();

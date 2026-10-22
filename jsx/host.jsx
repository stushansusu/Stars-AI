/* #1 */
var StarsAI = (function () {
  var MAX_LOG = 0;
  var JSX_BUILD = '0.7.58';

  /* #2 */
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
//#55
//#56
    if (typeof s === 'object') return s;
    try { return eval('(' + s + ')'); } catch (e) { return {}; }
  }
  function px(u) {
    try { return Number(u.as('px')); } catch (e) { return Number(u); }
  }

  /* #3 */
  function activeDoc() {
    if (app.documents.length === 0) return null;
    return app.activeDocument;
  }
  function hasSelection(doc) {
    try {
      var b = doc.selection.bounds;
      if (b === null || b === undefined || b.length !== 4) return false;
      var l = px(b[0]), t = px(b[1]), r = px(b[2]), bt = px(b[3]);
//#74
      if (!(r - l > 0.5 && bt - t > 0.5)) return false;
//#76
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
  /* #4 */
  /* #5 0.7.31：把当前选区直接烧成黑白像素（白 = 重绘区），**完全不碰通道**。 */
  function hasAnySelection(doc) {
    try {
      var b = doc.selection.bounds;
      if (!b || b.length !== 4) return false;
      return (px(b[2]) - px(b[0]) > 0.5) && (px(b[3]) - px(b[1]) > 0.5);
    } catch (e) { return false; }
  }

  function burnMaskOnDoc(doc) {
//#116
    if (!hasAnySelection(doc)) throw new Error('选区不在了，做不了蒙版');
    var sel = doc.selection;
    sel.invert();
//#120
    try { sel.fill(solid(0, 0, 0), ColorBlendMode.NORMAL, 100, false); } catch (eBlack) {}
    sel.invert();
    sel.fill(solid(255, 255, 255), ColorBlendMode.NORMAL, 100, false);
    try { sel.deselect(); } catch (e) {}
  }

  function saveMaskFromDup(dup, path) {
    var f = new File(path);
    if (f.parent && !f.parent.exists) f.parent.create();
    burnMaskOnDoc(dup);
    savePNG(dup, f);
    if (!f.exists || f.length <= 0) throw new Error('蒙版没写出来：' + f.fsName);
    return { path: f.fsName, width: Math.round(px(dup.width)), height: Math.round(px(dup.height)) };
  }

  function solid(r, g, b) {
    var c = new SolidColor();
    c.rgb.red = r; c.rgb.green = g; c.rgb.blue = b;
    return c;
  }
  /* #6 */
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
    if (visible === 0) {
      for (var k = 0; k < hid.length; k++) { try { hid[k].visible = true; } catch (e3) {} }
      return 0;
    }
    return hid.length;
  }

  function normalize(doc) {
    try { if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB); } catch (e) {}
    try { if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) doc.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (e) {}
  }
  /* #7 */
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
  /* #8 */
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
  /* #9 */
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

  /* #10 把一个图层设为「活动图层」，并**确认真的切过去了**（0.7.9）。 */
  function makeActive(doc, layer, id) {
    if (id === null || id === undefined) id = layerIdOf(layer);
    try { doc.activeLayer = layer; } catch (e1) {}
    if (id === null || id === undefined) return true;
    try { if (doc.activeLayer.id === id) return true; } catch (e2) {}
//#223
    try {
      var p = null;
      try { p = layer.parent; } catch (e3) {}
      if (p && p.typename === 'LayerSet') layer.move(doc, ElementPlacement.PLACEATBEGINNING);
    } catch (e4) {}
    try { doc.activeLayer = layer; } catch (e5) {}
    try { if (doc.activeLayer.id === id) return true; } catch (e6) {}
//#231
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

  /* #11 */
  function prepareForTransform(doc, layer) {
    var issues = [];

    try { if (doc.quickMaskMode) doc.quickMaskMode = false; } catch (e1) {}

//#249
    if (!selectComposite(doc)) issues.push('无法切回复合通道');

    try { if (layer.isBackgroundLayer) issues.push('目标图层是背景层'); } catch (e2) {}

//#254
    try { if (layer.allLocked) { layer.allLocked = false; } } catch (e3) {}
    try { if (layer.positionLocked) { layer.positionLocked = false; } } catch (e4) {}
    try { if (layer.allLocked) issues.push('图层被完全锁定'); } catch (e5) {}
    try { if (layer.positionLocked) issues.push('图层位置被锁定'); } catch (e6) {}

//#260
//#261
    if (!makeActive(doc, layer, layerIdOf(layer))) issues.push('无法把新图层设为活动图层（可能它在折叠的图层组里）');

    return issues;
  }

  /* #12 */
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
//#294
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

  /* #13 */
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
//#328
        activeLayer: (function () {
          try {
            var L = doc.activeLayer;
            return { name: String(L.name), isGroup: (L.typename === 'LayerSet') };
          } catch (eAL) { return null; }
        })(),
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

  /* #14 */
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
//#363
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
      /* #15 */
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

  /* #16 */
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
//#411
//#412
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

  /* #17 */
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
      /* #18 */
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
//#472
//#473
          try { dup.selection.load(chSel, SelectionType.REPLACE); }
          catch (eL1) { chSel.loadSelection(); }
          selTrace.restored = hasSelection(dup);
        } catch (eRst) { selTrace.restoreError = msgOf(eRst); }
      }
      if (chSel) { try { chSel.remove(); chSel = null; } catch (eChR) {} }

      var f = new File(path);
      if (!f.parent.exists) f.parent.create();
      savePNG(dup, f);
      var out = {
        path: f.fsName,
        rect: { x: x, y: y, w: w, h: h },
//#487
//#488
        width: Math.round(px(dup.width)),
        height: Math.round(px(dup.height)),
        crop: { w: Math.round(px(dup.width)), h: Math.round(px(dup.height)) },
        skippedLayers: skippedAi,
        doc: { w: Math.round(dw), h: Math.round(dh) },
        selTrace: selTrace
      };
//#496
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

  /* #19 */
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

//#536
      var sel = doc.selection;
      if (opts.expand > 0) { try { sel.expand(UnitValue(parseFloat(opts.expand), 'px')); } catch (eE) {} }
      if (opts.feather > 0) { try { sel.feather(UnitValue(parseFloat(opts.feather), 'px')); } catch (eFe) {} }

//#541
      layer = doc.artLayers.add();
      layer.name = 'StarsAI_mask_tmp';
      if (doc.activeLayer && doc.activeLayer.id !== layer.id) { try { doc.activeLayer = layer; } catch (eAL) {} }
      burnMaskOnDoc(doc);

//#547
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
//#573
      try { if (layer) { layer.remove(); layer = null; } } catch (eRm) {}
      try { doc.selection.deselect(); } catch (eDe) {}
      return ok(out);
    } catch (e) {
      try { if (dup) dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e3) {}
      try { app.activeDocument = doc; } catch (e4) {}
//#580
      try { if (layer) { layer.remove(); layer = null; } } catch (e5) {}
      return err(e);
    }
  };

  /* #20 */
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
      app.activeDocument = src;
//#612
      if (src.layers.length > 1) {
        try { src.mergeVisibleLayers(); } catch (eMerge) {}
      }
      try { if (src.layers[0].isBackgroundLayer) src.layers[0].isBackgroundLayer = false; } catch (e0) {}
      /* #21 */
      var fitMode = opts.fit || 'stretch';
      var stretched = false;
      /* #22 */
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
//#632
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
        /* #23 */
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
//#660
            src.crop([UnitValue(insetUsed.x, 'px'), UnitValue(insetUsed.y, 'px'),
                      UnitValue(insetUsed.x + insetUsed.w, 'px'), UnitValue(insetUsed.y + insetUsed.h, 'px')]);
          }
          src.resizeCanvas(UnitValue(px(target.width), 'px'), UnitValue(px(target.height), 'px'), AnchorPosition.TOPLEFT);
          var tx0 = rectUsed.x + (insetUsed ? insetUsed.x : 0);
          var ty0 = rectUsed.y + (insetUsed ? insetUsed.y : 0);
          if (tx0 || ty0) src.activeLayer.translate(UnitValue(tx0, 'px'), UnitValue(ty0, 'px'));
        } catch (eRect) {
//#669
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
//#687
      var layerId = null;
      try { layerId = layer.id; } catch (eId) {}
      try { src.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
      src = null;
      app.activeDocument = target;
      selectComposite(target);

//#695
      if (layerId !== null) {
        var resolved = findLayerById(target, layerId);
        if (resolved) layer = resolved;
        else { try { return err('复制图层失败：目标文档里找不到刚新建的图层（id ' + layerId + '）'); } catch (eR) { return err('复制图层失败'); } }
      }
      try { layer.name = opts.layerName || 'Stars-AI'; } catch (eName) {}
//#702
      var safeLayer = true;
      try {
        if (layerId !== null && layer.id !== layerId) safeLayer = false;
        if (layer.isBackgroundLayer) safeLayer = false;
      } catch (eSafe) { safeLayer = false; }
      if (!safeLayer) {
        return err('拒绝操作：目标图层不是新复制进来的图层（或它是背景层），已中止以免破坏原图');
      }

//#712
      var prepIssues = prepareForTransform(target, layer);

      /* #24 */
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
      if (rectUsed) needFit = false;
      if (needFit && prepIssues.length) {
        return err('无法变换图层（' + prepIssues.join('；') + '）：请在 Photoshop 里确认文档不在快速蒙版、图层未被锁定后重试');
      }
      try {
        if (rectUsed) {
//#732
        } else if (opts.sizeRatio) {
//#734
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
//#747
          center(layer, target);
        }
      } catch (eFit) {
        fitError = '变换失败：' + msgOf(eFit);
      }
//#753
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
      var clipError = null;
      var selTouched = '';
      var selUsed = null;
      /* #25 ⚠ 0.7.21 起这条路**默认关闭**，必须显式传 allowClip=true 才会跑 */
      if (opts.clipToSelection && opts.allowClip) {
        if (!hadSel) {
//#783
          lostSelection = true;
        } else {
          /* #26 */
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
//#804
            var activated = makeActive(target, layer, layerId);
            if (!activated) {
              clipError = '无法把新图层设为活动图层（它可能在折叠的图层组里）';
            } else {
              /* #27 */
              var bgTarget = false;
              try { bgTarget = !!target.activeLayer.isBackgroundLayer; } catch (eBg) { bgTarget = true; }
              if (bgTarget) {
                clipError = '删除目标变成了背景层，已中止（否则选区外会被背景色填成红色）';
              } else {
                try { target.selection.invert(); }
                catch (eInv) { clipError = '反选失败：' + msgOf(eInv); }
                if (!clipError) {
                  try { executeAction(charIDToTypeID('Dlt '), new ActionDescriptor(), DialogModes.NO); }
                  catch (eDlt) { clipError = '删除选区外像素失败：' + msgOf(eDlt); }
                }
              }
            }
            try { target.selection.deselect(); } catch (e) {}

//#825
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

//#846
          viewRestored = selectComposite(target);
        }
      }

      return ok({
        action: 'layer', name: layer.name,
        masked: masked, maskKind: maskKind, noSelection: lostSelection, viewRestored: viewRestored,
        layerId: layerId,
//#855
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

  /* #28 */
  api.openDoc = function (path) {
    try {
      var f = new File(path);
      if (!f.exists) return err('文件不存在');
      var d = app.open(f);
      return ok({ name: d.name });
    } catch (e) { return err(e); }
  };

  /* #29 */
  api.pickFile = function (title) {
    try {
      var f = File.openDialog(title || '选择文件', function (f2) { return true; }, false);
      if (!f) return ok({ path: '' });
      return ok({ path: f.fsName, name: f.name });
    } catch (e) { return err(e); }
  };

  /* #30 */
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

  /* #31 */
  api.pickFolder = function (title) {
    try {
      var f = Folder.selectDialog(title || '选择 ComfyUI 目录');
      if (!f) return ok({ path: '' });
      return ok({ path: f.fsName, name: f.name });
    } catch (e) { return err(e); }
  };

  /* #32 */
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

  /* #33 */
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

  /* #34 */
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
        /* #35 */
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

        /* #36 */
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

        /* #37 已删除：原「反选 + Dlt」探针自 0.7.19 起就是弃用状态，
         * 结论记在 NEXT-SESSION 坑 #3（PS 27 的 Dlt 不可用），代码留在自检里只占体积。 */

        run('crop（按矩形裁剪）', function () {
          var w = Math.min(128, Math.round(px(dup.width)));
          var h = Math.min(96, Math.round(px(dup.height)));
          dup.crop([UnitValue(0, 'px'), UnitValue(0, 'px'), UnitValue(w, 'px'), UnitValue(h, 'px')]);
          return Math.round(px(dup.width)) + '×' + Math.round(px(dup.height));
        });

        /* #38 */
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

        /* #39 */




        run('suspendHistory（精修要合并成一步撤销）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          var flag = { done: false };
          $.global.__starsaiProbeHist = function () { flag.done = true; };
          try {
            dup.suspendHistory('StarsAI probe', '__starsaiProbeHist()');
          } finally {
            try { delete $.global.__starsaiProbeHist; } catch (eDel) {}
          }
          if (!flag.done) throw new Error('suspendHistory 里的脚本没被执行');
          return '一步历史记录可用';
        });

        /* #40 */
        run('selectEllipse + feather（暗角选区）', function () {
          var w = Math.max(32, Math.round(px(dup.width) * 0.6));
          var h = Math.max(32, Math.round(px(dup.height) * 0.6));
          var x = Math.round((px(dup.width) - w) / 2), y = Math.round((px(dup.height) - h) / 2);
          dup.selection.selectEllipse([
            [UnitValue(x, 'px'), UnitValue(y, 'px')],
            [UnitValue(x + w, 'px'), UnitValue(y + h, 'px')]
          ], SelectionType.REPLACE, 6, true);
          if (!hasSelection(dup)) throw new Error('画完椭圆没有选区');
          dup.selection.deselect();
          return w + '×' + h + ' · feather 6';
        });

        run('selection.fill（暗角填黑 / 灰层铺灰）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          if (!makeActive(dup, probeLayer, probeId)) throw new Error('无法把探针图层设为活动图层');
          var w = Math.min(40, Math.round(px(dup.width))), h = Math.min(40, Math.round(px(dup.height)));
          dup.selection.select([
            [UnitValue(0, 'px'), UnitValue(0, 'px')],
            [UnitValue(w, 'px'), UnitValue(h, 'px')]
          ], SelectionType.REPLACE, 0, true);
          var c = new SolidColor();
          c.rgb.hexValue = '808080';
          dup.selection.fill(c, ColorBlendMode.NORMAL, 100, false);
          dup.selection.deselect();
          return '填了 ' + w + '×' + h + ' 的 50% 灰';
        });

        run('adjustBrightnessContrast / adjustHueSaturation（眼睛 / 牙齿）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          if (!makeActive(dup, probeLayer, probeId)) throw new Error('无法把探针图层设为活动图层');
          probeLayer.adjustBrightnessContrast(8, 4);
          probeLayer.adjustHueSaturation(-20, 0, 0);
          return '两组 adjust* 都跑通';
        });


        /* #41 0.7.49：精修的端到端干跑 —— 在**副本**上真的调一次 api.polish。 */
        run('api.polish 端到端（在副本上真跑一次磨皮）', function () {
          if (!probeReady) throw new Error('跳过：探针图层没造出来');
          if (!makeActive(dup, probeLayer, probeId)) throw new Error('无法把探针图层设为活动图层');
          var raw = api.polish('smooth', { strength: 'normal' });
          var j = null;
          try { j = JSON.parse(raw); } catch (e1) {}
          if (!j) throw new Error('polish 返回的不是 JSON：' + String(raw).slice(0, 120));
          if (!j.ok) throw new Error('polish 报错：' + j.error);
          return j.layer + ' · 半径 ' + j.radius + ' / 阈值 ' + j.threshold +
                 ' · 不透明度 ' + j.opacity + '% · 历史 ' + (j.historyStep ? '一步' : '多步（回退路径）');
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

  /* #42 */
  var POLISH = {
    /* #43 */
    smooth:    { label: '磨皮', base: 4,  threshold: 15, opacity: 70,  blend: null },
    despeckle: { label: '去斑', base: 2,  threshold: 10, opacity: 100, blend: null, dust: true },
    sharpen:   { label: '锐化', base: 0,  threshold: 3,  opacity: 100, blend: null, usm: true },
    skintone:  { label: '肤色', base: 12, threshold: 30, opacity: 45,  blend: 'color' },
    /* #44 */
    eyes:      { label: '眼睛', opacity: 100, needSelection: '眼睛', bright: 10, contrast: 6, usm: true },
    teeth:     { label: '牙齿', opacity: 100, needSelection: '牙齿', sat: -28, bright: 6 },
    /* #45 */
    vignette:  { label: '暗角', opacity: 60, blend: 'multiply', newLayer: true },
    dnb:       { label: '减淡加深', opacity: 100, blend: 'softlight', newLayer: true, gray: true }
  };

  /* #46 */
  var POLISH_STRENGTH = { light: 0.62, normal: 1, heavy: 1.7 };

  function strengthOf(opts) {
    var k = POLISH_STRENGTH[String(opts.strength || 'normal')];
    return k == null ? 1 : k;
  }

  function polishRadius(doc, base, k) {
    var longEdge = Math.max(px(doc.width), px(doc.height));
    var scale = Math.max(1, longEdge / 2048);
    return Math.min(32, Math.max(2, Math.round(base * scale * (k == null ? 1 : k))));
  }

  function polishOpacity(base, k) {
    var v = Math.round((base == null ? 100 : base) * (k == null ? 1 : k));
    return Math.max(5, Math.min(100, v));
  }

  /* #47 */
  /* #47 PS 27 可能整批没有 ArtLayer 的 apply* 滤镜（0.7.55 真机实测）。
   * 策略：宿主给什么就用什么；全挑不到再退 ActionManager（菜单能点的滤镜它都能调）。 */
  function callFilter(layer, names, a1, a2) {
    for (var i = 0; i < names.length; i++) {
      try {
        if (typeof layer[names[i]] !== 'function') continue;
        if (a2 === undefined || a2 === null) layer[names[i]](a1);
        else layer[names[i]](a1, a2);
        return names[i];
      } catch (e) {}
    }
    return '';
  }
  function amFilter(cmdId, params) {
    try {
      var r = new ActionDescriptor();
      for (var i = 0; i < params.length; i++) {
        var p = params[i];
        if (p[0] === 'px') r.putUnitDouble(charIDToTypeID(p[1]), charIDToTypeID("#Pxl"), p[2]);
        else r.putInteger(charIDToTypeID(p[1]), p[2]);
      }
      var d = new ActionDescriptor();
      d.putObject(charIDToTypeID("With"), charIDToTypeID(cmdId), r);
      executeAction(charIDToTypeID(cmdId), d, DialogModes.NO);
      return true;
    } catch (e) { return false; }
  }
  /* #48 真机探测：PS 27.10 没有 applySurfaceBlur / adjustHueSaturation；ActionManager 可用。
   * 磨皮优先 applySmartBlur（保边），高斯只作最后手段。 */
  function amHueSat(saturation, lightness) {
    try {
      var adj = new ActionDescriptor();
      adj.putInteger(charIDToTypeID("H   "), 0);
      adj.putInteger(charIDToTypeID("Strt"), saturation);
      adj.putInteger(charIDToTypeID("Lght"), lightness);
      var d = new ActionDescriptor();
      d.putObject(charIDToTypeID("Adjs"), charIDToTypeID("HStr"), adj);
      executeAction(charIDToTypeID("HStr"), d, DialogModes.NO);
      return true;
    } catch (e) { return false; }
  }

  /* #49 真机：`BlendMode.COLOR` 在 PS 27.10 里报「无效枚举值」。所以混合模式不能硬赋枚举：
   * 先按候选名试 BlendMode.xxx，再试字符串赋值，最后走 ActionManager（BlnM 那套标准 ID）。
   * 全都设不上也**不抛错** —— 混合模式没生效只是效果降级，不该让整次精修白跑。 */
  function setBlendSafe(layer, mode) {
    var names = mode === 'color' ? ['COLOR', 'COLORBLEND']
              : mode === 'multiply' ? ['MULTIPLY']
              : mode === 'softlight' ? ['SOFTLIGHT', 'SOFT_LIGHT'] : [];
    for (var i = 0; i < names.length; i++) {
      try {
        var e = BlendMode[names[i]];
        if (e != null) { layer.blendMode = e; return names[i]; }
      } catch (e1) {}
    }
    try { layer.blendMode = mode; return 'str:' + mode; } catch (e2) {}
    var amId = mode === 'color' ? 'Clr ' : mode === 'multiply' ? 'Mltp' : mode === 'softlight' ? 'SftL' : '';
    if (amId) {
      try {
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID('Lyr '), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
        var bd = new ActionDescriptor();
        bd.putEnumerated(charIDToTypeID('Md  '), charIDToTypeID('BlnM'), charIDToTypeID(amId));
        var d = new ActionDescriptor();
        d.putReference(charIDToTypeID('null'), ref);
        d.putObject(charIDToTypeID('T   '), charIDToTypeID('Lyr '), bd);
        executeAction(charIDToTypeID('setd'), d, DialogModes.NO);
        return 'AM:' + amId;
      } catch (e3) {}
    }
    return '';
  }

  function applyBlur(layer, radius, threshold) {
    var v = callFilter(layer, ['applySmartBlur', 'applySurfaceBlur'], radius, threshold);
    if (v) return v;
    if (amFilter('SbBl', [['px', 'Rds ', radius], ['int', 'Thsh', threshold]])) return 'AM:SbBl';
    var v2 = callFilter(layer, ['applyGaussianBlur'], radius);
    if (v2) return v2;
    if (amFilter('GsnB', [['px', 'Rds ', radius]])) return 'AM:GsnB';
    return '';
  }
  function applyDust(layer, radius, threshold) {
    var v = callFilter(layer, ['applyDustAndScratches', 'applyMedianNoise'], radius, threshold);
    if (v) return v;
    if (amFilter('DstS', [['px', 'Rds ', radius], ['int', 'Thsh', threshold]])) return 'AM:DstS';
    return '';
  }
  function applySharpen(layer, amount, threshold) {
    var v = '';
    try {
      if (typeof layer.applyUnSharpMask === 'function') {
        layer.applyUnSharpMask(amount, 1.2, threshold);
        v = 'applyUnSharpMask';
      }
    } catch (e0) {}
    if (v) return v;
    v = callFilter(layer, ['applySharpenMore', 'applySharpen', 'applySharpenEdges'], null);
    if (v) return v;
    if (amFilter('UnsM', [['int', 'Amnt', amount], ['px', 'Rds ', 1.2], ['int', 'Thsh', threshold]])) return 'AM:UnsM';
    return '';
  }

  function polishImpl(kind, optsJson) {
    var opts = parseOpts(optsJson);
    var doc = activeDoc();
    if (!doc) return err('没有打开的文档');
    var plan = POLISH[kind];
    if (!plan) return err('未知的精修类型：' + kind);
    var k = strengthOf(opts);

    var src = null;
    try { src = doc.activeLayer; } catch (eL) { src = null; }
    if (!src) return err('没有活动图层');
    if (src.typename === 'LayerSet') {
      return err('活动图层是图层组「' + src.name + '」—— 先选中一个像素图层再点精修');
    }

    var hadSel = false, selBox = null;
    try {
      hadSel = hasSelection(doc);
      if (hadSel) selBox = selRect(doc);
    } catch (eS) {}
    if (hadSel && !selBox) { try { selBox = selRect(doc); } catch (eS2) {} }

//#1301
    if (plan.needSelection && !hadSel) {
      return err('「' + plan.label + '」需要先框选：在 PS 里把' + plan.needSelection +
                 '选住再点（整层处理会把整张脸一起改掉）');
    }

    var out = { ok: false };
    var newLayer = null;
    var opacity = polishOpacity(plan.opacity, k);

    function body() {
      try {
        if (plan.newLayer) {
          newLayer = doc.artLayers.add();
        } else {
          newLayer = src.duplicate();
        }
        try { doc.activeLayer = newLayer; } catch (eA) {}
        var r = 0, t = plan.threshold || 0;

        if (plan.vignette) {
          /* #48 */
          try { if (hasSelection(doc)) doc.selection.deselect(); } catch (eV0) {}
          var nw = px(doc.width), nh = px(doc.height);
          var inset = 0.42;
          var box = [
            [UnitValue(Math.round(nw * (0.5 - inset)), 'px'), UnitValue(Math.round(nh * (0.5 - inset)), 'px')],
            [UnitValue(Math.round(nw * (0.5 + inset)), 'px'), UnitValue(Math.round(nh * (0.5 + inset)), 'px')]
          ];
          var featherPx = Math.max(8, Math.round(Math.max(nw, nh) * 0.06 * k));
          doc.selection.selectEllipse(box, SelectionType.REPLACE, featherPx, true);
          doc.selection.invert();
          var black = new SolidColor();
          black.rgb.hexValue = '000000';
          doc.selection.fill(black, ColorBlendMode.NORMAL, 100, false);
          try { doc.selection.deselect(); } catch (eV1) {}
          out.feather = featherPx;
        } else if (plan.gray) {
          /* #49 */
          try { if (hasSelection(doc)) doc.selection.deselect(); } catch (eV2) {}
          doc.selection.selectAll();
          var gray = new SolidColor();
          gray.rgb.hexValue = '808080';
          doc.selection.fill(gray, ColorBlendMode.NORMAL, 100, false);
          try { doc.selection.deselect(); } catch (eV3) {}
        } else if (plan.usm) {
//#1347
          var amt = Math.max(10, Math.round(80 * k));
          var viaU = applySharpen(newLayer, amt, t);
          if (!viaU) throw new Error('这个版本的 PS 没有可用的锐化滤镜（3 条路都试过了）');
          out.amount = amt;
          out.via = viaU;
          if (plan.bright !== undefined) {
            newLayer.adjustBrightnessContrast(Math.round(plan.bright * k), Math.round((plan.contrast || 0) * k));
            out.bright = Math.round(plan.bright * k);
          }
        } else if (plan.sat !== undefined) {
//#1356
          var satVal = Math.round(plan.sat * k);
          var satOk = false;
          try {
            if (typeof newLayer.adjustHueSaturation === 'function') {
              newLayer.adjustHueSaturation(satVal, 0, 0);
              satOk = true;
              out.via = 'adjustHueSaturation';
            }
          } catch (e0) {}
          if (!satOk && amHueSat(satVal, 0)) {
            satOk = true;
            out.via = 'AM:HStr';
          }
          if (!satOk) throw new Error('这个版本的 PS 没法降饱和（2 条路都试过了）');
          out.sat = satVal;
          if (plan.bright !== undefined && typeof newLayer.adjustBrightnessContrast === 'function') {
            newLayer.adjustBrightnessContrast(Math.round(plan.bright * k), 0);
            out.bright = Math.round(plan.bright * k);
          }
        } else if (plan.dust) {
          r = polishRadius(doc, plan.base, k);
          var viaD = applyDust(newLayer, r, t);
          if (!viaD) throw new Error('这个版本的 PS 没有可用的去斑滤镜（3 条路都试过了）');
          out.via = viaD;
        } else {
          r = polishRadius(doc, plan.base, k);
          var viaB = applyBlur(newLayer, r, t);
          if (!viaB) throw new Error('这个版本的 PS 没有可用的模糊滤镜（4 条路都试过了）');
          out.via = viaB;
        }

        out.radius = plan.base ? r : null;
        out.threshold = plan.base ? t : null;

        if (plan.blend) {
          var bm = setBlendSafe(newLayer, plan.blend);
          if (bm) {
            out.blend = plan.blend;
            out.blendVia = bm;
          } else {
            // 设不上不抛错：效果降级（普通叠加），但这次精修仍然算成功
            out.blendWarn = '混合模式没设上（BlendMode.' + String(plan.blend).toUpperCase() + ' 和 ActionManager 都试过了）';
          }
        }
        newLayer.opacity = opacity;
        out.opacity = opacity;
        try { newLayer.name = 'Stars-AI · ' + plan.label; } catch (eN) {}
        out.layer = String(newLayer.name);
        out.ok = true;
      } catch (e) {
        out.error = msgOf(e);
//#1391
        try { if (newLayer) newLayer.remove(); } catch (eR) {}
        newLayer = null;
      }
    }

    /* #50 */
    var historyStep = false;
    try {
      $.global.__starsaiPolishBody = body;
      doc.suspendHistory('Stars-AI 精修 · ' + plan.label, '__starsaiPolishBody()');
      historyStep = true;
    } catch (eH) {
//#1404
      if (!out.ok && !out.error) {
        try { body(); } catch (e3) { out.error = msgOf(e3); }
        if (!out.ok && !out.error) out.error = msgOf(eH);
      }
    } finally {
      try { delete $.global.__starsaiPolishBody; } catch (eD) {}
    }

    if (!out.ok) return err(out.error || '精修失败（原因未知）');

    return ok({
      action: 'polish',
      kind: kind,
      label: plan.label,
      layer: out.layer,
      strength: String(opts.strength || 'normal'),
      radius: out.radius,
      threshold: out.threshold,
      amount: out.amount,
      via: out.via,
      bright: out.bright,
      sat: out.sat,
      feather: out.feather,
      opacity: out.opacity,
      blend: out.blend || 'normal',
      blendVia: out.blendVia,
      blendWarn: out.blendWarn,
      hadSelection: hadSel,
      selection: selBox,
      historyStep: historyStep,
      doc: { w: Math.round(px(doc.width)), h: Math.round(px(doc.height)) }
    });
  };

  /* #51 */
  api.polish = function (kind, optsJson) {
    try {
      return polishImpl(kind, optsJson);
    } catch (eTop) {
      return err('精修内部错误（已兜住）：' + msgOf(eTop));
    }
  };

  api.ping = function () {
    return ok({
      ps: String(app.version),
      docs: app.documents.length,
      jsx: JSX_BUILD,
      /* #52 */
      caps: {
        polish: (typeof api.polish === 'function'),
        polishKinds: (function () {
          var n = 0;
          for (var kk in POLISH) { if (POLISH.hasOwnProperty(kk)) n++; }
          return n;
        })()
      }
    });
  };

  return api;
})();

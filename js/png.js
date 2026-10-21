/* Stars-AI · 极简 PNG 编解码 + 白底抠图
 * 为什么不用 PS 的「选择主体」：
 *   实测同一版 PS 上 Msk/autoCutout 描述符时灵时不灵，抠不干净还会把人物一起清掉。
 *   我们的提示词强制纯白背景，所以直接在 Node 里按像素把白色背景挖掉最稳：
 *   - 从画布四边做 flood fill，只去掉与边缘连通的白色 → 人物身上的白色（眼睛、衣服）不会被误删
 *   - 边缘再做 1px 半透明过渡，避免锯齿和白边
 */
(function (global) {
  "use strict";

  var zlib = null;
  try { zlib = require("zlib"); } catch (e) { zlib = null; }

  function crc32(buf) {
    var table = crc32.table;
    if (!table) {
      table = crc32.table = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  function decode(buf) {
    if (!zlib) throw new Error("需要 Node 的 zlib");
    if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error("不是 PNG");
    var off = 8, w = 0, h = 0, colorType = -1, bitDepth = 0, idat = [];
    while (off < buf.length) {
      var len = buf.readUInt32BE(off);
      var type = buf.toString("ascii", off + 4, off + 8);
      var data = buf.subarray(off + 8, off + 8 + len);
      if (type === "IHDR") {
        w = data.readUInt32BE(0); h = data.readUInt32BE(4);
        bitDepth = data[8]; colorType = data[9];
        if (data[12] !== 0) throw new Error("不支持隔行 PNG");
      } else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      off += 12 + len;
    }
    if (bitDepth !== 8) throw new Error("只支持 8bit PNG");
    var bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
    if (!bpp) throw new Error("不支持的 PNG 颜色类型 " + colorType);
    var raw = zlib.inflateSync(Buffer.concat(idat));
    var stride = w * bpp;
    var out = Buffer.alloc(w * h * 4);
    var prev = Buffer.alloc(stride);
    var cur = Buffer.alloc(stride);
    var pos = 0;
    for (var y = 0; y < h; y++) {
      var filter = raw[pos++];
      raw.copy(cur, 0, pos, pos + stride);
      pos += stride;
      for (var x = 0; x < stride; x++) {
        var a = x >= bpp ? cur[x - bpp] : 0;
        var b = prev[x];
        var c = x >= bpp ? prev[x - bpp] : 0;
        var v = cur[x];
        if (filter === 1) v = (v + a) & 0xff;
        else if (filter === 2) v = (v + b) & 0xff;
        else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (filter === 4) {
          var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xff;
        }
        cur[x] = v;
      }
      for (var x2 = 0; x2 < w; x2++) {
        var si = x2 * bpp, di = (y * w + x2) * 4;
        if (bpp === 4) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = cur[si + 3]; }
        else if (bpp === 3) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = 255; }
        else { out[di] = out[di + 1] = out[di + 2] = cur[si]; out[di + 3] = 255; }
      }
      var t = prev; prev = cur; cur = t;
    }
    return { width: w, height: h, data: out };
  }

  function encode(img) {
    if (!zlib) throw new Error("需要 Node 的 zlib");
    var w = img.width, h = img.height, data = img.data;
    var raw = Buffer.alloc((w * 4 + 1) * h);
    for (var y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    }
    function chunk(type, body) {
      var len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      var t = Buffer.from(type, "ascii");
      var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body])));
      return Buffer.concat([len, t, body, crc]);
    }
    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0))
    ]);
  }

  // 判断是否"背景白"：亮度高且几乎无彩度
  function isBg(r, g, b, lo) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max >= lo && (max - min) <= 26;
  }

  /* 从四边 flood fill 去掉白色背景；返回新的 PNG Buffer
   * opts: { threshold: 236, soft: 12 } */
  function keyOutWhite(buf, opts) {
    opts = opts || {};
    var lo = opts.threshold || 236;
    var img = decode(buf);
    var w = img.width, h = img.height, d = img.data;
    var bg = new Uint8Array(w * h);
    var stack = [];
    function push(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      var i = y * w + x;
      if (bg[i]) return;
      var p = i * 4;
      if (!isBg(d[p], d[p + 1], d[p + 2], lo)) return;
      bg[i] = 1;
      stack.push(i);
    }
    for (var x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (var y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      var i2 = stack.pop();
      var cx = i2 % w, cy = (i2 - cx) / w;
      push(cx - 1, cy); push(cx + 1, cy); push(cx, cy - 1); push(cx, cy + 1);
    }
    var removed = 0;
    for (var i3 = 0; i3 < w * h; i3++) {
      if (bg[i3]) { d[i3 * 4 + 3] = 0; removed++; }
    }
    // 边缘软化：紧挨背景的像素如果是亮色，按亮度给部分 alpha，减少白边/锯齿
    var soft = opts.soft === undefined ? 14 : opts.soft;
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var idx = y2 * w + x2;
        if (bg[idx]) continue;
        var n = (x2 > 0 && bg[idx - 1]) || (x2 < w - 1 && bg[idx + 1]) || (y2 > 0 && bg[idx - w]) || (y2 < h - 1 && bg[idx + w]);
        if (!n) continue;
        var q = idx * 4;
        var lum = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
        if (lum > lo - soft) {
          var k = (lo - lum) / (soft * 2) + 0.35;
          d[q + 3] = Math.max(0, Math.min(255, Math.round(255 * k)));
        }
      }
    }
    var out = encode(img);
    return { buffer: out, width: w, height: h, data: img.data, removedRatio: removed / (w * h), hasAlpha: true };
  }

  // 裁掉全透明边框（让"缩到画布 34% 高"真的等于人物 34% 高）
  function trim(img) {
    var w = img.width, h = img.height, d = img.data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return img;
    var pad = 2;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    var nw = maxX - minX + 1, nh = maxY - minY + 1;
    var out = Buffer.alloc(nw * nh * 4);
    for (var yy = 0; yy < nh; yy++) {
      d.copy(out, yy * nw * 4, ((minY + yy) * w + minX) * 4, ((minY + yy) * w + minX + nw) * 4);
    }
    return { width: nw, height: nh, data: out };
  }

  // 一键：挖白底 → 裁剪 → 重新编码
  function cutout(buf, opts) {
    var res = keyOutWhite(buf, opts);
    var trimmed = trim({ width: res.width, height: res.height, data: res.data });
    return {
      buffer: encode(trimmed),
      width: trimmed.width, height: trimmed.height,
      removedRatio: res.removedRatio
    };
  }

  // 统计：方便命令行/面板里判断抠图效果
  function stats(buf) {
    var img = decode(buf);
    var d = img.data, n = img.width * img.height;
    var transparent = 0, opaque = 0;
    for (var i = 0; i < n; i++) {
      var a = d[i * 4 + 3];
      if (a === 0) transparent++; else if (a === 255) opaque++;
    }
    return { width: img.width, height: img.height, transparentRatio: transparent / n, opaqueRatio: opaque / n };
  }

  /* 矩形羽化蒙版（0.7.20）：白 = 重绘区，和 PS 的 exportMask 约定一致。
   * 参数（全部是「文档坐标」，函数内部按 outW/outH 换算）：
   *   rect   —— 这次实际送到模型的那块矩形
   *   sel    —— 用户框选的矩形
   *   outW/H —— 送出去的图（已按 maxEdge 缩过）的像素尺寸
   *   feather/expand —— 文档像素；按同一比例换算到输出像素
   * 为什么要有它：PS 侧的选区不一定活得过 flatten/crop/resize（真机实测裁完就没了），
   * 而"选区外保持原样"这件事只依赖几何数据，不依赖 PS 的状态。
   * 代价：套索/魔棒这种非矩形选区会退化成外接矩形。
   * 返回 {width, height, data}，可直接 encode()。 */
  function rectMask(rect, sel, outW, outH, feather, expand) {
    var sx = outW / Math.max(1, rect.w), sy = outH / Math.max(1, rect.h);
    var k = Math.min(sx, sy);
    var cx = (sel.x - rect.x) * sx + (sel.w * sx) / 2;
    var cy = (sel.y - rect.y) * sy + (sel.h * sy) / 2;
    var ex = Math.max(0, expand * k);
    var rx = (sel.w * sx) / 2 + ex;
    var ry = (sel.h * sy) / 2 + ex;
    var f = Math.max(1, feather * k);
    var data = Buffer.alloc(outW * outH * 4);
    for (var y = 0; y < outH; y++) {
      var dy = Math.abs(y + 0.5 - cy) - ry;
      for (var x = 0; x < outW; x++) {
        var d = Math.max(Math.abs(x + 0.5 - cx) - rx, dy);
        var a = d <= 0 ? 255 : (d >= f ? 0 : Math.round(255 * (1 - d / f)));
        var i = (y * outW + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = a;
        data[i + 3] = 255;
      }
    }
    return { width: outW, height: outH, data: data, featherPx: Math.round(f), scale: k };
  }

  global.StarsPng = { decode: decode, encode: encode, keyOutWhite: keyOutWhite, trim: trim, cutout: cutout, stats: stats, rectMask: rectMask };
})(window);

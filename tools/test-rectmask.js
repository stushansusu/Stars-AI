/* Stars-AI · 离线回归：矩形羽化蒙版（js/png.js 的 rectMask）
 * ------------------------------------------------------------------
 * 为什么单独测它：局部重绘的「选区外保持原样」全靠这张蒙版。
 * 它又完全是纯函数（文档坐标 + 输出尺寸 → 像素），不需要 PS、不需要 GPU，
 * 所以每次改羽化/扩展/缩放逻辑都先跑这个，别拿真机赌。
 *
 *   node tools/test-rectmask.js
 */
global.window = global;
require("../js/png.js");
const Png = global.StarsPng;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

const doc = { w: 4640, h: 6960 };
const sel = { x: 1200, y: 2800, w: 2105, h: 3168 };
const rect = { x: 944, y: 2544, w: 2617, h: 3680 };
const k = 2048 / Math.max(rect.w, rect.h);
const outW = Math.round(rect.w * k), outH = Math.round(rect.h * k);
const feather = 19, expand = 9;

const m = Png.rectMask(rect, sel, outW, outH, feather, expand);
const d = m.data;
const R = (x, y) => d[(y * outW + x) * 4];        // 蒙版值在 RGB（alpha 恒 255）

console.log("rect " + rect.w + "x" + rect.h + " -> out " + outW + "x" + outH +
  " · scale " + k.toFixed(3) + " · 羽化带 " + m.featherPx + "px");

ok("尺寸正确", m.width === outW && m.height === outH);
ok("中心 = 255", R(outW >> 1, outH >> 1) === 255);
ok("四角 = 0", [R(1, 1), R(outW - 2, 1), R(1, outH - 2), R(outW - 2, outH - 2)].every((v) => v === 0));
ok("RGB 三通道相等（LoadImageMask 读 red）", d[0] === d[1] && d[1] === d[2]);
ok("alpha 通道恒 255（不污染透明度）", d[3] === 255);

const s = outW / rect.w;
const yMid = outH >> 1;
const leftWhite = (sel.x - rect.x) * s + 2;
const leftBlack = (sel.x - rect.x) * s - expand * s - feather * s - 4;
ok("选区内侧 = 255", R(Math.ceil(leftWhite), yMid) === 255);
ok("羽化带外 = 0", R(Math.max(0, Math.floor(leftBlack)), yMid) === 0);

// 从左往右扫第一段 (0,255)，遇到 255 就停 = 羽化带宽度
let start = -1, end = -1;
for (let x = 1; x < outW; x++) {
  const a = R(x, yMid);
  if (a > 0 && a < 255) { if (start < 0) start = x; end = x; }
  else if (start >= 0 && a === 255) break;
}
ok("羽化带宽度 ≈ " + m.featherPx + "px", Math.abs((end - start + 1) - m.featherPx) <= 2, "实测 " + (end - start + 1) + "px");

let op = 0, tr = 0, sf = 0;
for (let i = 0; i < d.length; i += 4) { const a = d[i]; if (a === 255) op++; else if (a === 0) tr++; else sf++; }
const total = outW * outH;
console.log("  分布: 白 " + (op / total * 100).toFixed(1) + "% · 黑 " + (tr / total * 100).toFixed(1) +
  "% · 羽化 " + (sf / total * 100).toFixed(2) + "%");
ok("白区 ≈ 选区面积比（" + (sel.w * sel.h / (rect.w * rect.h) * 100).toFixed(1) + "%）",
  Math.abs(op / total - sel.w * sel.h / (rect.w * rect.h)) < 0.03);
ok("羽化带占比 0.2%~8%", sf / total > 0.002 && sf / total < 0.08);

const buf = Png.encode(m);
const back = Png.decode(buf);
ok("encode/decode 往返一致", back.width === outW && back.data[((outH >> 1) * outW + (outW >> 1)) * 4] === 255);
console.log("  PNG " + (buf.length / 1024).toFixed(0) + " KB");

// 整图模式（cropRect = null 时走这条）
const k2 = 2048 / Math.max(doc.w, doc.h);
const m2 = Png.rectMask({ x: 0, y: 0, w: doc.w, h: doc.h }, sel,
  Math.round(doc.w * k2), Math.round(doc.h * k2), feather, expand);
const w2 = m2.width, h2 = m2.height;
ok("整图模式：中心 255 / 角 0", m2.data[(h2 >> 1) * w2 * 4 + (w2 >> 1) * 4] === 255 && m2.data[0] === 0);

// 选区贴左上角
const m3 = Png.rectMask({ x: 0, y: 0, w: 1000, h: 1000 }, { x: 0, y: 0, w: 400, h: 300 }, 1000, 1000, 19, 9);
ok("选区贴边不越界", m3.data[0] === 255 && m3.data[(999 * 1000 + 999) * 4] === 0);

console.log("\n结果：通过 " + pass + " · 失败 " + fail);
process.exit(fail ? 1 : 0);

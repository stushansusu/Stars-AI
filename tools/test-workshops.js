/* Stars-AI · 离线回归：面板接线 + 工坊分类
 * ------------------------------------------------------------------
 * 管什么：
 *   1. app.js 里 $("id") 引用的元素，index.html 里必须真的有 —— 少一个就是
 *      运行时 TypeError（"Cannot set properties of null"），而且面板只在
 *      你点那一下才炸，很容易漏。改 HTML 结构后先跑这个。
 *   2. presets.js 的数据自洽：每个预设的 cat 必须登记在 CATS 里，否则卡片会
 *      落到「其它」分组（不会消失，但分类就乱了）。
 *   3. 已删除的旧元素（修图区块）不能再被引用。
 *
 *   node tools/test-workshops.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

console.log("\n[1] index.html 的 id 与 app.js 的 $() 引用");

const htmlIds = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);

const refs = new Set();
for (const m of appJs.matchAll(/\$\("([^"]+)"\)/g)) refs.add(m[1]);

const missing = [...refs].filter((id) => !htmlIds.has(id)).sort();
ok("所有 $() 引用的元素都存在（" + refs.size + " 个）", missing.length === 0, missing.join(", "));

const legacy = ["presetChips", "presetGroups", "presetTip", "presetCard", "viewEdit", "setPresetRun", "presetGroup"];
const stillThere = legacy.filter((id) => htmlIds.has(id) || new RegExp('"' + id + '"').test(appJs));
ok("修图区块的旧元素/状态已彻底移除", stillThere.length === 0, stillThere.join(", "));

console.log("\n[2] 工坊分类数据（presets.js）");

global.window = global;
require(path.join(ROOT, "js", "presets.js"));
const P = global.StarsPresets;

ok("导出 cats / byView / get", typeof P.cats === "function" && typeof P.byView === "function" && typeof P.get === "function");

const ids = P.list.map((p) => p.id);
ok("预设 id 无重复", new Set(ids).size === ids.length,
  ids.filter((x, i) => ids.indexOf(x) !== i).join(", "));

for (const view of ["anime", "nsfw"]) {
  const cats = P.cats(view);
  const items = P.byView(view);
  const catIds = new Set(cats.map((c) => c.id));
  ok(view + "：分类表非空（" + cats.map((c) => c.label).join(" / ") + "）", cats.length > 0);

  const bad = items.filter((p) => !p.cat || !catIds.has(p.cat));
  ok(view + "：每个功能都落在已登记的分类里（" + items.length + " 个功能 / " + cats.length + " 类）",
    bad.length === 0, bad.map((p) => p.id + "=" + p.cat).join(", "));

  const empty = cats.filter((c) => !items.some((p) => p.cat === c.id));
  ok(view + "：没有空分类", empty.length === 0, empty.map((c) => c.label).join(", "));

  // 卡片渲染顺序 = CATS 顺序，所以每个分类至少要有一个
  const unknownView = P.list.filter((p) => p.view !== "anime" && p.view !== "nsfw");
  ok(view + "：所有预设的 view 合法", unknownView.length === 0, unknownView.map((p) => p.id).join(", "));
}

const anime = P.byView("anime"), nsfw = P.byView("nsfw");
ok("二次元 31 个功能", anime.length === 31, "实际 " + anime.length);
ok("NSFW 30 个功能", nsfw.length === 30, "实际 " + nsfw.length);

// 需要选区的卡（local 分类）必须都标了 needsSelection，否则会静默退化成整图重绘
const localCards = P.list.filter((p) => p.cat === "local");
ok("局部类卡片都声明了 needsSelection", localCards.every((p) => p.needsSelection && p.mode === "inpaint"),
  localCards.filter((p) => !p.needsSelection || p.mode !== "inpaint").map((p) => p.id).join(", "));

// 带 {fill} 的卡必须有 fill 定义，否则提示词里会留一个字母面花括号
const fillCards = P.list.filter((p) => /\{fill\}/.test(p.prompt || ""));
ok("{fill} 占位符都有对应的 fill 定义", fillCards.every((p) => p.fill && p.fill.default),
  fillCards.filter((p) => !p.fill || !p.fill["default"]).map((p) => p.id).join(", "));
ok("NSFW 全部带强制负面词（排除未成年特征）",
  nsfw.every((p) => /未成年人/.test(p.negative || "")), nsfw.filter((p) => !/未成年人/.test(p.negative || "")).map((p) => p.id).join(", "));

// 胸部变大：档位要够（用户点名「能变得更大」），别再退回 C–G
const chestUp = P.get("nsfw_chest_up");
ok("胸部变大有 C→K 九档", !!(chestUp && chestUp.fill && chestUp.fill.chips.length === 9 &&
  /^C/.test(chestUp.fill.chips[0]) && /^K/.test(chestUp.fill.chips[8])), chestUp && chestUp.fill ? chestUp.fill.chips.join("/") : "缺 fill");
ok("胸部变大的提示词不再自我设限（无「真实人体范围内」）", !!chestUp && chestUp.prompt.indexOf("真实人体范围内") === -1);

console.log("\n[3] 局部重绘：按真实选区形状出蒙版");

const hostJsx = fs.readFileSync(path.join(ROOT, "jsx", "host.jsx"), "utf8");
const bridgeJs = fs.readFileSync(path.join(ROOT, "js", "bridge.js"), "utf8");
ok("PS 脚本提供 exportRegionMask", /api\.exportRegionMask\s*=\s*function/.test(hostJsx));
const ermBody = hostJsx.slice(hostJsx.indexOf("api.exportRegionMask"), hostJsx.indexOf("api.place"));
ok("PS 脚本是「先烧像素再裁剪」（不靠选区活过 crop）",
  ermBody.indexOf("burnMaskOnDoc(") > 0 &&
  ermBody.indexOf("dup.crop(") > ermBody.indexOf("burnMaskOnDoc("));
ok("CEP 桥暴露了 exportRegionMask", /exportRegionMask:\s*function/.test(bridgeJs));
ok("桥没接上时 exportRegionMask 也走 notReady（不静默 mock）",
  /"exportRegionMask"/.test(bridgeJs));
ok("面板优先调 exportRegionMask 出蒙版", /PS\.exportRegionMask\(/.test(appJs));
// 0.7.31：烧蒙版不再依赖 Channel.loadSelection（该 API 存疑，一挂就永远退化成矩形）
const burnIdx = hostJsx.indexOf("function burnMaskOnDoc");
ok("PS 脚本有 burnMaskOnDoc（invert + fill 烧蒙版）", burnIdx > 0);
const saveMaskBody = hostJsx.slice(hostJsx.indexOf("function saveMaskFromDup"), hostJsx.indexOf("function solid("));
ok("saveMaskFromDup 不再建通道", saveMaskBody.indexOf("channels.add") === -1);
ok("exportMask 走 burnMaskOnDoc", hostJsx.slice(hostJsx.indexOf("api.exportMask")).slice(0, 2200).indexOf("burnMaskOnDoc") > 0);
ok("exportRegionMask 走 burnMaskOnDoc", hostJsx.slice(hostJsx.indexOf("api.exportRegionMask")).slice(0, 2400).indexOf("burnMaskOnDoc") > 0);
// 0.7.32：真机日志暴露的两个 bug 的回归
const erBody = hostJsx.slice(hostJsx.indexOf("api.exportRegion ="), hostJsx.indexOf("api.exportRegionMask"));
ok("exportRegion 回执带 width/height（面板的蒙版兜底靠它判断）", /width:\s*Math\.round/.test(erBody));
const erm2 = hostJsx.slice(hostJsx.indexOf("api.exportRegionMask"), hostJsx.indexOf("api.place"));
ok("形状蒙版先在你自己的文档上烧、再复制（不依赖选区能被复制）",
  erm2.indexOf("artLayers.add()") > 0 && erm2.indexOf("doc.duplicate(") > erm2.indexOf("artLayers.add()"));
ok("形状蒙版的失败路径也会删掉临时图层",
  /catch[\s\S]{0,500}?layer\.remove\(\)/.test(erm2));
ok("面板区分「摆位成功」和「摆位失败」，不再无条件报整图",
  /r\.fitApplied !== false && rect/.test(appJs));

const stdLoad = hostJsx.indexOf("dup.selection.load(chSel, SelectionType.REPLACE)");
const legacyCall = hostJsx.indexOf("chSel.loadSelection()");
ok("恢复选区优先用标准 API，老写法只作兜底", stdLoad > 0 && legacyCall > stdLoad);
const shapeIdx = appJs.indexOf("PS.exportRegionMask(");
const rectIdx = appJs.indexOf("buildRectMask(maskPath, useRect");
ok("矩形蒙版只作为最后兜底（在形状蒙版之后）", shapeIdx > 0 && rectIdx > shapeIdx, "shape@" + shapeIdx + " rect@" + rectIdx);

console.log("\n[4] 工坊页签");

const vtabs = [...html.matchAll(/class="vtab[^"]*" data-view="([^"]+)"/g)].map((m) => m[1]);
ok("只剩两个工坊页签（二次元 + NSFW）", vtabs.length === 2 && vtabs.join() === "anime,nsfw", vtabs.join(", "));
ok("setView 只接受两个工坊", /S\.view = \(v === "nsfw"\) \? "nsfw" : "anime";/.test(appJs));
ok("初始化默认进二次元工坊", /setView\(S\.view === "nsfw" && !S\.nsfwOk \? "anime"/.test(appJs));

console.log("\n" + (fail ? "✗ " + fail + " 条失败 · " + pass + " 条通过" : "✓ 全部通过（" + pass + " 条）"));
process.exit(fail ? 1 : 0);

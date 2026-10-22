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


global.window = global;
require(path.join(ROOT, "js", "presets.js"));
const P = global.StarsPresets;

ok("导出 cats / byView / get", typeof P.cats === "function" && typeof P.byView === "function" && typeof P.get === "function");

const ids = P.list.map((p) => p.id);
ok("预设 id 无重复", new Set(ids).size === ids.length,
  ids.filter((x, i) => ids.indexOf(x) !== i).join(", "));

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
  ok(view + "：所有预设的 view 合法", unknownView.length === 0, unknownView.map((p) => p.id).join(", "));
}

ok("二次元 31 个功能", anime.length === 31, "实际 " + anime.length);

// 需要选区的卡（local 分类）必须都标了 needsSelection，否则会静默退化成整图重绘
const localCards = P.list.filter((p) => p.cat === "local");
ok("局部类卡片都声明了 needsSelection", localCards.every((p) => p.needsSelection && p.mode === "inpaint"),
  localCards.filter((p) => !p.needsSelection || p.mode !== "inpaint").map((p) => p.id).join(", "));

// 带 {fill} 的卡必须有 fill 定义，否则提示词里会留一个字母面花括号
const fillCards = P.list.filter((p) => /\{fill\}/.test(p.prompt || ""));
ok("{fill} 占位符都有对应的 fill 定义", fillCards.every((p) => p.fill && p.fill.default),
  fillCards.filter((p) => !p.fill || !p.fill["default"]).map((p) => p.id).join(", "));

  /^C/.test(chestUp.fill.chips[0]) && /^K/.test(chestUp.fill.chips[8])), chestUp && chestUp.fill ? chestUp.fill.chips.join("/") : "缺 fill");

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

console.log("\n[5] DR 精修区块（PS 原生滤镜，不走 AI）");

const polishBody = hostJsx.slice(hostJsx.indexOf("function polishImpl"), hostJsx.indexOf("api.ping"));
ok("PS 脚本提供 api.polish", /api\.polish\s*=\s*function/.test(hostJsx));
ok("八种精修都登记在 POLISH 表里",
  /smooth:[\s\S]{0,900}?despeckle:[\s\S]{0,300}?sharpen:[\s\S]{0,300}?skintone:[\s\S]{0,400}?eyes:[\s\S]{0,300}?teeth:[\s\S]{0,400}?vignette:[\s\S]{0,300}?dnb:/.test(hostJsx));
/* 0.7.56：PS 27 的 ArtLayer 可能整批没有 apply* 滤镜（真机报 applySurfaceBlur 不是函数），
 * 所以滤镜调用改成「宿主给什么就用什么 + ActionManager 兜底」的候选链。断言跟着改结构。 */
const filterBody = hostJsx.slice(hostJsx.indexOf("function callFilter"), hostJsx.indexOf("function polishImpl"));
ok("模糊走候选链：applySurfaceBlur → applyGaussianBlur → AM:SbBl",
  /applySurfaceBlur/.test(filterBody) && /applyGaussianBlur/.test(filterBody) && /'SbBl'|"SbBl"/.test(filterBody));
ok("去斑走候选链：applyDustAndScratches → applyMedianNoise → AM:DstS",
  /applyDustAndScratches/.test(filterBody) && /'DstS'|"DstS"/.test(filterBody));
ok("锐化走候选链：applyUnSharpMask → applySharpen* → AM:UnsM",
  /applyUnSharpMask/.test(filterBody) && /'UnsM'|"UnsM"/.test(filterBody));
ok("候选链全失败时给明确错误（不静默）",
  /没有可用的模糊滤镜/.test(polishBody) && /没有可用的锐化滤镜/.test(polishBody));
ok("精修回执带出实际用了哪条路径（via）", /via: out\.via/.test(hostJsx));
/* 0.7.58 真机：`BlendMode.COLOR` 报「无效枚举值」—— PS 27 的 BlendMode 枚举也不全。
 * 混合模式改成「枚举名 → 字符串赋值 → ActionManager」三级容错，且设不上只降级不抛错。 */
ok("混合模式走 setBlendSafe 三级容错（枚举名 / 字符串 / ActionManager）",
  /function setBlendSafe/.test(hostJsx) && /BlnM/.test(hostJsx) && /setBlendSafe\(newLayer/.test(hostJsx));
ok("肤色统一用 COLOR 混合模式（候选名里要有 COLOR）", /'COLOR'/.test(hostJsx));
ok("混合模式设不上只降级、不抛错（真机报过「无效枚举值」）",
  /blendWarn/.test(hostJsx) && /blendWarn: out\.blendWarn/.test(hostJsx));
ok("减淡加深铺 50% 灰 + SOFTLIGHT（之后手涂）",
  /808080/.test(hostJsx) && /softlight/.test(hostJsx));
ok("暗角用正片叠底", /multiply/.test(hostJsx));
ok("眼睛走 adjustBrightnessContrast；牙齿先试 adjustHueSaturation，没有就退 AM:HStr",
  /adjustBrightnessContrast\(/.test(polishBody) && /adjustHueSaturation/.test(polishBody) && /amHueSat/.test(polishBody));
ok("眼睛 / 牙齿必须框选，没选区直接报错（不静默改整张脸）",
  /plan\.needSelection\s*&&\s*!hadSel/.test(polishBody) && /需要先框选/.test(polishBody));
ok("暗角用椭圆选区 + 羽化 + selection.fill（不是 layer.fill）",
  /selectEllipse\(/.test(polishBody) && /selection\.fill\(/.test(polishBody) && /ColorBlendMode\.NORMAL/.test(polishBody));
// 铁律：精修绝不能碰原图层 —— 复制图层 或 新建空层
ok("精修在复制图层上做（src.duplicate）", /src\.duplicate\(\)/.test(polishBody));
ok("暗角 / 灰层用新建空层（artLayers.add）", /doc\.artLayers\.add\(\)/.test(polishBody));
ok("精修失败会删掉半成品图层（不留垃圾层）", /newLayer\.remove\(\)/.test(polishBody));
ok("半径按长边自适应（polishRadius）", /function polishRadius/.test(hostJsx) && /polishRadius\(doc,/.test(polishBody));
ok("三档强度倍率同时作用于半径与不透明度", /POLISH_STRENGTH/.test(hostJsx) && /polishOpacity\(/.test(hostJsx));
ok("精修合成一步历史记录（suspendHistory）", /suspendHistory\(/.test(polishBody));
ok("活动图层是图层组时给明确报错，不是静默不做", /LayerSet/.test(polishBody) && /图层组/.test(polishBody));
ok("CEP 桥暴露了 polish 且把强度透传下去", /polish:\s*function\s*\(kind, opts\)/.test(bridgeJs) && /call\("polish", \[kind, opts/.test(bridgeJs));
ok("面板把 strength 传给 PS", /PS\.polish\(kind, \{ strength:/.test(appJs));
const drCardIdx = html.indexOf('id="drCard"');
const resultsIdx = html.indexOf('id="resultsCard"');
ok("精修是独立区块（#drCard 在结果卡之外）", drCardIdx > 0 && drCardIdx > resultsIdx);
ok("结果卡里已经不再挂精修按钮", html.slice(resultsIdx, drCardIdx).indexOf("btnPolish") === -1);
const polishBtns = [...html.matchAll(/id="(btnPolish\w+)"/g)].map((m) => m[1]);
ok("区块里有 8 个精修按钮", polishBtns.length === 8, polishBtns.join(", "));
ok("8 个按钮都绑了事件", polishBtns.every((id) => new RegExp('\\$\\("' + id + '"\\)\\.onclick').test(appJs)),
  polishBtns.filter((id) => !new RegExp('\\$\\("' + id + '"\\)\\.onclick').test(appJs)).join(", "));
ok("区块有强度三段控", /id="drStrength"/.test(html) && /data-strength="heavy"/.test(html));
ok("区块状态行（当前图层 / 选区）由 refreshDrMeta 刷新", /async function refreshDrMeta/.test(appJs) && /activeLayer/.test(hostJsx));

console.log("\n[6] 脚本加载：绕开 evalScript 的字符串上限（坑 #19）");

const manifestXml = fs.readFileSync(path.join(ROOT, "CSXS", "manifest.xml"), "utf8");
const bootPath = path.join(ROOT, "jsx", "boot.jsx");
const bootExists = fs.existsSync(bootPath);
const bootJsx = bootExists ? fs.readFileSync(bootPath, "utf8") : "";
// host.jsx 0.7.47 已经 67,455 字符 —— 超过 6 万就会被 evalScript 截断，
// 所以 ScriptPath 必须挂小引导脚本，绝不能直接挂 host.jsx。
// host.jsx 0.7.52：历史注释搬到 jsx/NOTES.md 后降到 ~59.6K。
// ScriptPath 直连是唯一稳的路 —— eval/evalFile 在部分 CEP 环境被阻断（三条装载路径全失败的实测）。
ok("manifest 的 ScriptPath 直连 host.jsx（不经过 eval/evalFile）",
  /<ScriptPath>\.\/jsx\/host\.jsx<\/ScriptPath>/.test(manifestXml),
  (/<ScriptPath>([^<]+)<\/ScriptPath>/.exec(manifestXml) || [])[1]);
ok("host.jsx 体积在 ScriptPath 可加载范围内（< 62000 字符）",
  hostJsx.length < 62000, hostJsx.length + " 字符");
/* 按字节再守一道：UTF-8 中文注释每字 3 字节，字符数达标不代表字节数达标。
 * 0.7.52 就是「59,611 字符但 65.9 KB 字节」，仍然可能超过 CEP 的 64KB。 */
/* 按字节再守一道：UTF-8 中文注释每字 3 字节，字符数达标不代表字节数达标。
 * 63,500 B 是留了余量的阈值（硬上限约 64 KB；0.7.44 能跑时是 60.7 KB）。 */
const hostBytes = fs.statSync(path.join(ROOT, "jsx", "host.jsx")).size;
ok("host.jsx 字节数也在安全线内（< 63500 B）", hostBytes < 63500, hostBytes + " B");
/* 0.7.54：真机实测「无法转换（第 45 行）」= $.evalFile 不认 File.encoding，
 * 按系统 ANSI(GBK) 去解 UTF-8 文件 → 无效字节序列 → 解析错位。
 * 加 UTF-8 BOM 让解码器自己知道编码。这条断言防止以后被工具写回「无 BOM」。 */
const hostBuf = fs.readFileSync(path.join(ROOT, "jsx", "host.jsx"));
ok("host.jsx 带 UTF-8 BOM（否则 evalFile/ScriptPath 会按 GBK 误解码）",
  hostBuf[0] === 0xEF && hostBuf[1] === 0xBB && hostBuf[2] === 0xBF,
  "前 3 字节 " + hostBuf[0].toString(16) + " " + hostBuf[1].toString(16) + " " + hostBuf[2].toString(16));
ok("历史注释搬到了 jsx/NOTES.md（不是删掉了）",
  fs.existsSync(path.join(ROOT, "jsx", "NOTES.md")) &&
  fs.readFileSync(path.join(ROOT, "jsx", "NOTES.md"), "utf8").length > 5000);
ok("源码里保留了 #N 编号锚点，能对回 NOTES.md",
  /\/\* #\d+ /.test(hostJsx));
ok("boot.jsx 还在（作为手动装载工具，但不再挂在 ScriptPath 上）", bootExists);
ok("boot.jsx 用 $.evalFile 从磁盘读主脚本（不是字符串 evalScript）", /\$\.evalFile\(/.test(bootJsx));

/* 0.7.54 真机踩到：ExtendScript 在 ES3 保留字之外，还把 **Adobe 的类型关键字**当保留字。
 * `var long = Math.max(...)` 会让整个脚本加载失败，报「非法使用保留字 "long"（第 1267 行）」，
 * 而 V8 完全合法 —— 所以本地语法检查抓不到，只有真机才炸。
 * 这里只查「声明位置」，`=== undefined` 这种值比较是合法的，不拦。 */
const JSX_RESERVED = ["long", "int", "short", "float", "double", "char", "byte", "boolean",
  "any", "class", "enum", "export", "extends", "final", "goto", "implements", "import",
  "interface", "native", "package", "private", "protected", "public", "static", "super",
  "synchronized", "throws", "transient", "volatile", "abstract", "const", "debugger", "with"];
const reservedHits = [];
hostJsx.split(/\r?\n/).forEach((L, i) => {
  const code = L.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const w of JSX_RESERVED) {
    const decl = new RegExp("\\b(var|function)\\s+" + w + "\\b");
    const param = new RegExp("[(,]\\s*" + w + "\\s*[,)]");
    if (decl.test(code) || param.test(code)) reservedHits.push("第 " + (i + 1) + " 行 " + w);
  }
});
ok("host.jsx 没有把 ExtendScript 保留字当标识符（`var long` 这类会让整脚本加载失败）",
  reservedHits.length === 0, reservedHits.slice(0, 6).join("; "));
ok("boot.jsx 把编码设成 UTF-8（文件是无 BOM UTF-8，否则会按 GBK 解成乱码）",
  /encoding\s*=\s*["']UTF-8["']/.test(bootJsx));
ok("boot.jsx 自己很短（它也要过 ScriptPath 那道门）", bootJsx.length < 3000, bootJsx.length + " 字符");
ok("boot.jsx 找不到主脚本时抛明确错误（不静默）", /throw new Error/.test(bootJsx));
/* 0.7.50（坑 #21）：host.jsx 顶层是 `var StarsAI = (function(){...})()`。
 * 如果 evalFile/eval 在函数作用域里执行，StarsAI 会变成那个函数的**局部变量**，
 * 全局旧对象根本没被替换 —— 症状就是「重载成功但版本没变」。
 * 所以 boot.jsx 必须写在顶层，绝不能包 IIFE。 */
ok("boot.jsx 写在顶层，不包 IIFE（否则 StarsAI 会变成局部变量）",
  !/^\s*\(function/m.test(bootJsx) && !/^\s*\(function/m.test(bootJsx.replace(/\/\*[\s\S]*?\*\//g, "")));
ok("boot.jsx 有「不依赖 $ 」的兜底：File 读全文 + eval()",
  /\.open\(["']r["']\)/.test(bootJsx) && /eval\(__starsaiSrc\)/.test(bootJsx));
const reloadBody = bridgeJs.slice(bridgeJs.indexOf("PS.reloadScript"), bridgeJs.indexOf("PS.diskBuild"));
ok("重载优先走 evalFile", reloadBody.indexOf("$.evalFile(") > 0);
ok("重载第二条：File + eval（$ 不可用时仍能装）", /"file\+eval"/.test(reloadBody));
ok("重载第三条：整串源码（最后兜底）", reloadBody.indexOf("cep.evalScript(code") > 0);
ok("重载彻底失败时报出体积并让用户重启 PS（不让人干猜）",
  /字符 \/|字符。/.test(reloadBody) && /重启 Photoshop/.test(reloadBody));
ok("精修失败时顺手补报 PS 侧真实版本与接口情况",
  /PS 侧实际状态/.test(appJs) && /精修接口/.test(appJs));

console.log("\n[7] 错误可诊断性：别让每个失败都变成「脚本执行失败」");

// 0.7.49：CEP 只会回 "EvalScript error."，看不出是哪个接口、为什么。
// 三道防线，任何一道缺了，下次真机失败又只能瞎猜。
const polishWrap = hostJsx.slice(hostJsx.indexOf("api.polish = function"), hostJsx.indexOf("api.ping"));
ok("api.polish 有最外层兜底（异常转成中文 JSON，不漏成 EvalScript error）",
  /try\s*\{\s*return polishImpl\(/.test(polishWrap) && /精修内部错误/.test(polishWrap));
ok("ping 自报能力（caps.polish）—— 面板能在点按钮前判断脚本新旧",
  /caps:\s*\{/.test(hostJsx) && /polish:\s*\(typeof api\.polish === 'function'\)/.test(hostJsx));
ok("ping 上报已登记的精修种类数", /polishKinds/.test(hostJsx));
ok("自检里有 api.polish 端到端干跑（在副本上真跑一次磨皮）",
  /api\.polish 端到端/.test(hostJsx) && /api\.polish\('smooth'/.test(hostJsx));
ok("bridge 的 call 在 EvalScript error 时点名是哪个接口 + 给下一步",
  /接口 StarsAI\./.test(bridgeJs) && /重启 Photoshop/.test(bridgeJs));
ok("面板在点精修之前就检查 caps.polish（脚本旧时直接说人话）",
  /S\.psCaps && S\.psCaps\.polish === false/.test(appJs));
ok("面板把 ping 的 caps 记下来", /S\.psCaps = ping\.caps/.test(appJs));
ok("顶栏对「脚本太旧、没有精修接口」单独有一条横幅", /没有精修接口（StarsAI\.polish）/.test(appJs));
/* 0.7.51：ping 都失败 = PS 里可能压根没有 StarsAI（不是版本旧）——
 * 这时候必须自愈，并且要有不依赖 StarsAI 的裸诊断。 */
const probeBody = bridgeJs.slice(bridgeJs.indexOf("probeScript"), bridgeJs.indexOf("openDoc:"));
ok("bridge 有裸诊断 probeScript（不依赖 StarsAI 存在）",
  /probeScript:\s*function/.test(bridgeJs) && /typeof StarsAI/.test(probeBody));
ok("裸诊断会报 $ / evalFile / 文件存在性与大小（一次看全）",
  /o\.evalFile/.test(probeBody) && /hostExists/.test(probeBody) && /bootExists/.test(probeBody));
const initCatch = appJs.slice(appJs.indexOf("Photoshop 握手失败"), appJs.indexOf("Photoshop 握手失败") + 2200);
ok("ping 失败时自动尝试装载脚本（重开面板即自愈）",
  /PS\.reloadScript\(\)/.test(initCatch) && /尝试自动装载/.test(initCatch));
ok("自动装载失败才做裸诊断，并按「对象是否存在」给不同提示",
  /probeScript\(\)/.test(initCatch) && /完全没有 StarsAI 脚本/.test(initCatch));
ok("重载日志带出「用了哪条路径 + 哪个文件」", /方式 " \+ \(r\.via/.test(appJs) && /r\.at/.test(appJs));

console.log("\n" + (fail ? "✗ " + fail + " 条失败 · " + pass + " 条通过" : "✓ 全部通过（" + pass + " 条）"));
process.exit(fail ? 1 : 0);

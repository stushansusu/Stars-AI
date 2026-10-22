/* Stars-AI · 引导脚本（0.7.50 起是 manifest 的 ScriptPath）
 * ------------------------------------------------------------------
 * 它只做一件事：让 ExtendScript 把真正的主脚本 host.jsx 装进**全局作用域**。
 *
 * 为什么需要它（坑 #19）：
 *   CEP 把 ScriptPath / evalScript 的内容当**字符串**塞进引擎，6 万字符出头就被截断，
 *   回调只拿到 "EvalScript error."。host.jsx 0.7.49 已经 65,747 字符，于是
 *   「重载必失败 + 自检里没有新探针 + 横幅一直报版本对不上」。
 *
 * 为什么改成现在的写法（坑 #21，0.7.50）：
 *   ① 上一版把 $.evalFile 包在 IIFE 里 —— 一旦它在函数作用域执行，
 *      host.jsx 顶层的 `var StarsAI = (function(){...})()` 就变成**局部变量**，
 *      全局那个旧 StarsAI 根本没被替换。症状正是「重载成功但版本没变」。
 *      → 所以本文件**必须写在顶层，不许包 IIFE / 不许包函数**。
 *   ② 整条路都押 `$.evalFile` 上太脆：`$` 在 CEP 的 evalScript 环境里不一定可用。
 *      → 加一条不依赖 `$` 的兜底：File 读全文 + eval()。它同样没有 CEP 的字符串传输上限
 *        （源码是在 PS 进程内部读出来的，不经过 evalScript 的参数通道）。
 *
 * ⚠ 这个文件必须保持极短（几十行）—— 它自己也要过 ScriptPath 那道门。
 */

var __starsaiCands = [];

// ① 按自己在磁盘上的位置推同级 host.jsx（$.fileName 在 ScriptPath 场景下通常可用）
try {
  var __starsaiSelf = new File($.fileName);
  if (__starsaiSelf && __starsaiSelf.exists && __starsaiSelf.parent) {
    __starsaiCands.push(__starsaiSelf.parent.fsName + "/host.jsx");
  }
} catch (e0) {}

// ② 兜底：标准安装位置（和 bridge.js 的 findJsxFile() 同一套候选）
try {
  __starsaiCands.push(Folder.userData.fsName + "/Adobe/CEP/extensions/Stars-AI/jsx/host.jsx");
} catch (e1) {}

var __starsaiMain = null;
for (var __starsaiI = 0; __starsaiI < __starsaiCands.length; __starsaiI++) {
  var __starsaiF = new File(__starsaiCands[__starsaiI]);
  if (__starsaiF.exists) { __starsaiMain = __starsaiF; break; }
}

if (!__starsaiMain) {
  throw new Error("boot.jsx：找不到 host.jsx，试过：" + __starsaiCands.join(" | "));
}

__starsaiMain.encoding = "UTF-8";

// ① 首选 $.evalFile（若 $ 在本环境可用）
var __starsaiLoaded = false;
try {
  if (typeof $ !== "undefined" && $ && $.evalFile) {
    $.evalFile(__starsaiMain);
    __starsaiLoaded = true;
  }
} catch (eEF) {
  __starsaiLoaded = false;
}

// ② 兜底：自己读全文 + eval —— 不依赖 $，也不经过 CEP 的字符串通道
if (!__starsaiLoaded) {
  __starsaiMain.open("r");
  var __starsaiSrc = __starsaiMain.read();
  __starsaiMain.close();
  eval(__starsaiSrc);
}

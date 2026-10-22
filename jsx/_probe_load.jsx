/* Stars-AI · 手动装载探针（0.7.54）
 * ------------------------------------------------------------------
 * 用途：把 host.jsx 手动装进 ExtendScript 全局，并把**真实错误**（含行号）弹出来。
 *       CEP 的 evalScript 只回一句 "EvalScript error."，看不到行号和原因。
 *
 * 怎么用：Photoshop 菜单 → 文件 → 脚本 → 浏览… → 选这个文件
 *
 * 为什么不用 $.evalFile（0.7.54 实测结论）：
 *   $.evalFile 不认 File.encoding，它按系统 ANSI(GBK) 去解我们的 UTF-8 文件，
 *   遇到无效字节序列就报「无法转换（第 N 行）」（N 指向的是解析错位后的位置，不是真错处）。
 *   而 File.open("r") + read() 认 f.encoding，能正确读出 UTF-8 字符 —— 所以这里用 read + eval。
 *
 * ⚠ 本文件全部写在**顶层**，不许包 IIFE：
 *   host.jsx 里是 `var StarsAI = (function(){...})()`，一旦 eval 在函数作用域执行，
 *   StarsAI 就变成那个函数的局部变量，全局旧对象根本不会被替换（坑 #21）。
 */

var __saBase = "";
try {
  __saBase = Folder.userData.fsName + "/Adobe/CEP/extensions/Stars-AI/jsx/";
} catch (e0) {
  alert("连 Folder.userData 都读不到：" + e0.message);
}

var __saLines = [];
var __saFile = new File(__saBase + "host.jsx");
__saLines.push("host.jsx：" + __saFile.fsName);
__saLines.push("存在：" + __saFile.exists + " · 大小：" + (__saFile.exists ? __saFile.length + " 字节" : "—"));

if (__saFile.exists) {
  __saFile.encoding = "UTF-8";
  var __saSrc = "";
  try {
    if (__saFile.open("r")) {
      __saSrc = __saFile.read();
      __saFile.close();
    }
    __saLines.push("按 UTF-8 读出：" + __saSrc.length + " 字符");
  } catch (e1) {
    __saLines.push("读取失败：" + e1.message);
  }

  var __saErr = "";
  if (__saSrc) {
    try {
      // 顶层 eval —— var StarsAI 会成为全局，这正是我们要的
      eval(__saSrc);
    } catch (e2) {
      __saErr = e2.message + (e2.line ? ("（第 " + e2.line + " 行）") : "");
    }
  }

  if (__saErr) {
    __saLines.push("");
    __saLines.push("✗ 装载失败：" + __saErr);
  } else {
    __saLines.push("");
    try {
      __saLines.push("typeof StarsAI = " + (typeof StarsAI));
      if (typeof StarsAI === "object" && StarsAI && StarsAI.ping) {
        __saLines.push("✔ 装载成功！ping = " + StarsAI.ping());
        __saLines.push("");
        __saLines.push("回 Stars-AI 面板点「连接」就能用了，不用重启 Photoshop。");
        if (typeof StarsAI.polish === "function") {
          __saLines.push("✔ 精修接口在（StarsAI.polish）。");
        } else {
          __saLines.push("⚠ 没有 polish —— 磁盘上的 host.jsx 可能是旧版本。");
        }
      } else {
        __saLines.push("✗ eval 没报错，但全局没有 StarsAI —— 文件可能不是 Stars-AI 的 host.jsx。");
      }
    } catch (e3) {
      __saLines.push("检查 StarsAI 时出错：" + e3.message);
    }
  }
}

alert(__saLines.join("\n"));

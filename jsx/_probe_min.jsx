/* Stars-AI · 最小探针（手动运行）
 * ------------------------------------------------------------------
 * 用途：确认 Photoshop 的 ExtendScript 引擎本身是否正常。
 *
 * 怎么用：Photoshop 菜单 → 文件 → 脚本 → 浏览… → 选这个文件
 *
 * 判读：
 *   · 弹出「引擎正常」→ 引擎没问题，问题在 host.jsx 或 CEP 通道（去跑 _probe_load.jsx）
 *   · 弹出「引擎异常」或 PS 报错 → PS 的脚本引擎/环境有问题，跟 Stars-AI 无关
 *   · 什么都不弹 → PS 里可能有个隐藏的模态对话框卡着，先看 PS 窗口
 */

(function () {
  var lines = [];
  try {
    lines.push("app.version = " + app.version);
    lines.push("app.name    = " + app.name);
    lines.push("documents   = " + app.documents.length);
    lines.push("app.locale  = " + (function () { try { return app.locale; } catch (e) { return "?"; } })());
  } catch (e1) {
    alert("引擎异常：连 app 对象都读不到\n\n" + e1.message);
    return;
  }
  try {
    lines.push("typeof $    = " + (typeof $));
    lines.push("typeof File = " + (typeof File));
    lines.push("typeof eval = " + (typeof eval));
    try { lines.push("eval(\"1+1\") = " + eval("1+1")); } catch (e2) { lines.push("eval(\"1+1\") 失败：" + e2.message); }
  } catch (e3) {
    lines.push("全局对象探测失败：" + e3.message);
  }
  try {
    lines.push("userData    = " + Folder.userData.fsName);
  } catch (e4) {
    lines.push("Folder.userData 读不到：" + e4.message);
  }
  alert("引擎正常（这几行能弹出来就说明 ExtendScript 没坏）\n\n" + lines.join("\n"));
})();

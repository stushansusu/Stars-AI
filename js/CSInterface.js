/* Stars-AI · 精简版 CSInterface
 * CEP 宿主会注入 window.__adobe_cep__，Adobe 官方 CSInterface.js 只是它的包装层。
 * 面板只需要 evalScript / getSystemPath 等几个方法，这里自己实现，省一个 1000 行依赖。
 * 之前漏了这一步 → 面板里拿不到 CSInterface → 静默走 mock，导出全是假的。
 */
(function (global) {
  "use strict";

  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (typeof callback !== "function") callback = function () {};
    var api = global.__adobe_cep__;
    if (!api || typeof api.evalScript !== "function") {
      callback("EvalScript error.");
      return;
    }
    try {
      api.evalScript(script, callback);
    } catch (e) {
      callback(String(e));
    }
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    try { return global.__adobe_cep__.getSystemPath(pathType); } catch (e) { return ""; }
  };

  CSInterface.prototype.getHostEnvironment = function () {
    try { return JSON.parse(global.__adobe_cep__.getHostEnvironment()); } catch (e) { return null; }
  };

  CSInterface.prototype.getApplicationID = function () {
    var env = this.getHostEnvironment();
    return env ? env.appId : "";
  };

  CSInterface.prototype.getExtensionID = function () {
    try { return global.__adobe_cep__.getExtensionId(); } catch (e) { return ""; }
  };

  CSInterface.prototype.addEventListener = function (type, listener, obj) {
    try { global.__adobe_cep__.addEventListener(type, listener, obj); } catch (e) {}
  };

  CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    try { global.__adobe_cep__.removeEventListener(type, listener, obj); } catch (e) {}
  };

  CSInterface.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
  };

  global.CSInterface = CSInterface;
})(window);

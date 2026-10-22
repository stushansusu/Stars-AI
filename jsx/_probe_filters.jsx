/* Stars-AI · 滤镜能力探测（手动运行）
 * ------------------------------------------------------------------
 * 用途：PS 27.10 上 ArtLayer 到底有哪些 apply* 滤镜方法？
 *       0.7.55 真机报「newLayer.applySurfaceBlur 不是函数」，需要知道实际能调什么。
 *
 * 怎么用：Photoshop 菜单 → 文件 → 脚本 → 浏览… → 选这个文件
 *        （会自动复制文档再测，原文档不会被改，测完把副本关掉）
 *
 * 输出解读：
 *   「apply* 方法 (N)」这一行是关键 —— 把整行列出来发我，我据此改实现。
 *   如果 N = 0，说明 PS 27 已经整批移除 ExtendScript 滤镜，只能走 ActionManager。
 */

var __pfOut = [];
var __pfDoc = app.activeDocument;
var __pfDup = null;

if (!__pfDoc) {
  alert("先打开一张图再跑这个探针（需要有活动文档才能读图层方法）。");
} else {
  try {
    __pfDup = __pfDoc.duplicate("StarsAI_filter_probe");
  } catch (eDup) {
    __pfOut.push("复制文档失败：" + eDup.message + "（下面只在原文档上读方法名，不做实际调用）");
  }

  var __pfTarget = __pfDup || __pfDoc;
  app.activeDocument = __pfTarget;
  var __pfLayer = __pfTarget.activeLayer;

  // ① 把所有方法名捞出来
  var __pfNames = [];
  try {
    var __pfMs = __pfLayer.reflect.methods;
    for (var i = 0; i < __pfMs.length; i++) __pfNames.push(String(__pfMs[i].name));
  } catch (eR) {
    for (var k in __pfLayer) {
      try { if (typeof __pfLayer[k] === "function") __pfNames.push(k); } catch (eR2) {}
    }
  }

  var __pfApplies = [];
  for (var j = 0; j < __pfNames.length; j++) {
    if (__pfNames[j].indexOf("apply") === 0) __pfApplies.push(__pfNames[j]);
  }

  __pfOut.push("图层类型：" + __pfLayer.typename);
  __pfOut.push("方法总数：" + __pfNames.length);
  __pfOut.push("");
  __pfOut.push("apply* 方法 (" + __pfApplies.length + ")：");
  __pfOut.push(__pfApplies.length ? __pfApplies.join(", ") : "  （一个都没有 —— PS 27 已移除 ExtendScript 滤镜）");
  __pfOut.push("");

  // ② 逐个确认关键滤镜存不存在（typeof 判断，不真跑）
  var __pfKey = [
    "applySurfaceBlur", "applyGaussianBlur", "applySmartBlur", "applyMedianNoise",
    "applyDustAndScratches", "applyUnSharpMask", "applySharpen", "applySharpenMore",
    "applySharpenEdges", "applyHighPass", "applyAddNoise", "applyBlur", "applyBlurMore"
  ];
  var __pfExist = [];
  for (var t = 0; t < __pfKey.length; t++) {
    var __pfFn = __pfKey[t];
    var __pfHas = false;
    try { __pfHas = (typeof __pfLayer[__pfFn] === "function"); } catch (eT) { __pfHas = false; }
    __pfExist.push((__pfHas ? "✔ " : "✘ ") + __pfFn);
  }
  __pfOut.push("关键滤镜：");
  __pfOut.push(__pfExist.join("\n"));
  __pfOut.push("");

  // ③ 调整类方法（眼睛/牙齿要用）
  var __pfAdj = ["adjustBrightnessContrast", "adjustHueSaturation", "adjustCurves", "adjustLevels"];
  var __pfAdjRes = [];
  for (var a = 0; a < __pfAdj.length; a++) {
    var __pfOk = false;
    try { __pfOk = (typeof __pfLayer[__pfAdj[a]] === "function"); } catch (eA) { __pfOk = false; }
    __pfAdjRes.push((__pfOk ? "✔ " : "✘ ") + __pfAdj[a]);
  }
  __pfOut.push("调整方法：");
  __pfOut.push(__pfAdjRes.join("\n"));
  __pfOut.push("");

  // ④ ActionManager 是否可用（滤镜的最终兜底）
  var __pfAM = "未测";
  try {
    var __pfDesc = new ActionDescriptor();
    var __pfRec = new ActionDescriptor();
    __pfRec.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), 2);
    __pfDesc.putObject(charIDToTypeID("With"), charIDToTypeID("GsnB"), __pfRec);
    executeAction(charIDToTypeID("GsnB"), __pfDesc, DialogModes.NO);
    __pfAM = "✔ 可用（高斯模糊 GsnB 执行成功）";
  } catch (eAM) {
    __pfAM = "✘ 失败：" + eAM.message;
  }
  __pfOut.push("ActionManager 兜底：");
  __pfOut.push(__pfAM);

  // 收拾副本
  if (__pfDup) {
    try { app.activeDocument = __pfDoc; } catch (eS) {}
    try { __pfDup.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {}
  }

  alert("Stars-AI 滤镜能力探测\n\n" + __pfOut.join("\n"));
}

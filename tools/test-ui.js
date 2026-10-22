/* Stars-AI · UI 功能回归：搜索 / 收起 / 分类 / 运行时报错（无头 Chrome）
 * ------------------------------------------------------------------
 * 管什么：
 *   1. 工坊列表真的渲染出来了（31 / 31 张），搜索能过滤、能清空、没命中会给空状态；
 *   2. 选完功能后工坊自动收起，且「提示词」被顶进首屏（这是 0.7.33 的核心改动，
 *      退回旧行为会让用户滚 1400px 才看到提示词）；
 *   3. 切分类 / 切 NSFW 正常；
 *   4. 整个过程中没有 JS 异常 —— 面板只在「你点那一下」才炸，这类问题肉眼很难发现。
 *
 *   node tools/test-ui.js
 *   （需要本机有 Chrome/Edge，或设置 CHROME_PATH；自己起预览服务器和 headless Chrome）
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 8803, CDP = 9226, ROOT = path.resolve(__dirname, "..");
/* 从 app.js 读出当前 BUILD，别在测试里硬编码版本号 ——
 * 否则每次 bump 版本，[8] 的假 ping 就会对不上，横幅会走成 err 级、断言全挂。 */
const BUILD = (/var\s+BUILD\s*=\s*"([0-9.]+)"/.exec(fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8")) || [])[1] || "0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (port, p) => new Promise((res, rej) => { http.get("http://127.0.0.1:" + port + p, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej); });
const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(fs.existsSync);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, "tools", "preview-server.js"), String(PORT)], { cwd: ROOT, stdio: "ignore" });
  const profile = path.join(os.tmpdir(), "starsai-check-" + Date.now());
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + CDP, "--user-data-dir=" + profile, "--window-size=340,1100", "about:blank"], { stdio: "ignore" });
  const cleanup = () => { try { browser.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  process.on("exit", cleanup);

  let target = null;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await getJson(CDP, "/json/list")).find((t) => t.type === "page"); } catch (e) {} }
  await sleep(500);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evalu = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) errors.push("eval: " + JSON.stringify(r.result.exceptionDetails.text)); return r.result && r.result.result ? r.result.result.value : ""; };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 340, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" });
  await sleep(1800);
  await evalu("localStorage.setItem('starsai.nsfw.ack.v1', JSON.stringify({ok:true}))");

  console.log("\n[1] 首屏");
  ok("二次元卡片渲染 31 张", await evalu("document.querySelectorAll('#animeGrid .anime-card').length") === 31);
  ok("计数徽章显示 31", (await evalu("document.getElementById('animeCount').textContent")) === "31");
  ok("工坊列表默认全展开（可见高度 > 300）", await evalu("document.getElementById('animeGrid').offsetHeight") > 300);
  ok("副标题是提示语", /选一个功能/.test(await evalu("document.getElementById('animeSub').textContent")));
  ok("设置里有「跳过之前贴回的 AI 图层」且默认开",
    (await evalu("(()=>{const c=document.getElementById('setSkipAi');return !!c && c.checked})()")) === true);
  ok("种子默认是 -1（随机）", (await evalu("document.getElementById('pSeed').value")) === "-1");

  console.log("\n[2] 搜索");
  await evalu("(()=>{const s=document.getElementById('animeSearch');s.value='背景';s.dispatchEvent(new Event('input'))})()");
  await sleep(200);
  const hit = await evalu("document.querySelectorAll('#animeGrid .anime-card').length");
  ok("搜「背景」有命中且变少（" + hit + " 张）", hit > 0 && hit < 31);
  ok("徽章变成 命中/全部", /^\d+\/31$/.test(await evalu("document.getElementById('animeCount').textContent")));
  ok("副标题显示命中数", /命中/.test(await evalu("document.getElementById('animeSub').textContent")));
  ok("清空按钮出现", !(await evalu("document.getElementById('animeSearchClear').classList.contains('hidden')")));

  await evalu("(()=>{const s=document.getElementById('animeSearch');s.value='zzzz';s.dispatchEvent(new Event('input'))})()");
  await sleep(200);
  ok("无结果时给空状态提示", await evalu("!!document.querySelector('#animeGrid .ws-empty')"));
  ok("无结果时卡片为 0", await evalu("document.querySelectorAll('#animeGrid .anime-card').length") === 0);

  await evalu("document.getElementById('animeSearchClear').click()");
  await sleep(200);
  ok("点清空恢复 31 张", await evalu("document.querySelectorAll('#animeGrid .anime-card').length") === 31);

  console.log("\n[3] 选卡（0.7.34 起不会自动收起）");
  await evalu("document.querySelector('#animeGrid .anime-card').click()");
  await sleep(400);
  ok("选卡后工坊保持展开（31 张仍可见）",
    await evalu("document.querySelectorAll('#animeGrid .anime-card').length") === 31 &&
    await evalu("document.getElementById('animeGrid').offsetHeight") > 300);
  ok("没有任何 ws-closed 折叠态", await evalu("document.querySelectorAll('.ws-closed').length") === 0);
  ok("副标题显示已选", /已选/.test(await evalu("document.getElementById('animeSub').textContent")));
  ok("卡片显示选中态", await evalu("document.querySelectorAll('#animeGrid .anime-card.active').length") === 1);
  ok("提示词已填", (await evalu("document.getElementById('prompt').value")).length > 10);

  console.log("\n[4] 分类 / NSFW");
  await evalu("(()=>{const b=[...document.querySelectorAll('#animeCats .seg')].find(x=>x.textContent==='画风');b.click()})()");
  await sleep(250);
  ok("单分类只出该分类卡片", await evalu("document.querySelectorAll('#animeGrid .anime-card').length") === 8);
  ok("切分类后徽章 = 实际显示数（不是工坊总数）", (await evalu("document.getElementById('animeCount').textContent")) === "8");
  await evalu("(()=>{const b=[...document.querySelectorAll('#animeCats .seg')].find(x=>x.textContent==='全部');b.click()})()");
  await sleep(200);

  await evalu("(()=>{const b=[...document.querySelectorAll('.vtab')].find(x=>x.dataset.view==='nsfw');b.click()})()");
  await sleep(400);
  ok("NSFW 工坊渲染 31 张", await evalu("document.querySelectorAll('#nsfwGrid .anime-card').length") === 31);
  ok("NSFW 计数徽章 31", (await evalu("document.getElementById('nsfwCount').textContent")) === "31");
  await evalu("(()=>{const s=document.getElementById('nsfwSearch');s.value='泳装';s.dispatchEvent(new Event('input'))})()");
  await sleep(200);
  const n = await evalu("document.querySelectorAll('#nsfwGrid .anime-card').length");
  ok("NSFW 搜索可用（" + n + " 张）", n > 0 && n < 34);

  console.log("\n[5] 模式：由功能卡自动带出，可手动覆盖");
  await evalu("(()=>{const b=[...document.querySelectorAll('.vtab')].find(x=>x.dataset.view==='anime');b.click()})()");
  await sleep(300);
  ok("默认模式是「图生图」", (await evalu("document.getElementById('modeSelect').value")) === "edit");
  ok("模式只剩一个下拉（没有 5 个页签了）", (await evalu("document.querySelectorAll('[data-mode]').length")) === 0);
  await evalu("(()=>{const s=document.getElementById('animeSearch');s.value='局部修改';s.dispatchEvent(new Event('input'))})()");
  await sleep(250);
  await evalu("document.querySelector('#animeGrid .anime-card').click()");
  await sleep(450);
  ok("点「局部修改」→ 模式自动变成「局部重绘」", (await evalu("document.getElementById('modeSelect').value")) === "inpaint");
  ok("羽化 / 扩展字段跟着出现", !(await evalu("document.getElementById('fldFeather').classList.contains('hidden')")));
  await evalu("(()=>{const s=document.getElementById('modeSelect');s.value='txt2img';s.dispatchEvent(new Event('change'))})()");
  await sleep(300);
  ok("手动改回「文生图」生效（提示语同步）", /纯文字出图/.test(await evalu("document.getElementById('modeHint').innerHTML")));
  ok("切到文生图后羽化字段收起", await evalu("document.getElementById('fldFeather').classList.contains('hidden')"));

  console.log("\n[6] 模式锁定：手动选过的模式不被功能卡抢走");
  // 此刻：搜索词是「局部修改」，模式已被手动改成「文生图」→ 应该是锁定态
  ok("手动选过模式后出现「跟随」按钮", !(await evalu("document.getElementById('btnModeFollow').classList.contains('hidden')")));
  ok("下拉显示为锁定态（pinned）", await evalu("document.getElementById('modeSelect').classList.contains('pinned')"));
  await evalu("document.getElementById('animeSearchClear').click()");
  await sleep(250);
  await evalu("document.querySelector('#animeGrid .anime-card').click()");   // 第一张 = 二次元化（图生图）
  await sleep(450);
  ok("点「图生图」卡不会把模式拽回图生图", (await evalu("document.getElementById('modeSelect').value")) === "txt2img");
  ok("锁定态保持", await evalu("document.getElementById('modeSelect').classList.contains('pinned')"));
  // 结构性模式仍然强制：局部重绘卡必须能切
  await evalu("(()=>{const s=document.getElementById('animeSearch');s.value='局部修改';s.dispatchEvent(new Event('input'))})()");
  await sleep(250);
  await evalu("document.querySelector('#animeGrid .anime-card').click()");
  await sleep(450);
  ok("「局部重绘」卡仍会强制切过去", (await evalu("document.getElementById('modeSelect').value")) === "inpaint");
  // 解除锁定
  await evalu("document.getElementById('btnModeFollow').click()");
  await sleep(300);
  ok("点「跟随」后按钮隐藏", await evalu("document.getElementById('btnModeFollow').classList.contains('hidden')"));
  ok("点「跟随」后下拉不再是锁定态", !(await evalu("document.getElementById('modeSelect').classList.contains('pinned')")));
  await evalu("document.getElementById('animeSearchClear').click()");
  await sleep(250);
  await evalu("document.querySelector('#animeGrid .anime-card').click()");   // 图生图卡
  await sleep(450);
  ok("解除锁定后，卡片又能自动切模式", (await evalu("document.getElementById('modeSelect').value")) === "edit");

  console.log("\n[7] 运行时错误");
  ok("没有 JS 异常 / console.error", errors.length === 0, errors.slice(0, 4).join(" | "));

  console.log("\n[8] 版本漂移横幅（当前 build " + BUILD + "）");
  /* 怎么造出「面板没重开」这个场景：bridge.js 结束时 `global.StarsPS = PS`（global 就是 window），
   * 所以这里在页面任何脚本执行之前，给 window.StarsPS 装一个 setter —— 它在挂载的那一刻
   * 把 PS.diskBuild 改成「磁盘上是 9.9.9」，app.js 启动时的 checkBuildDrift() 就会认为
   * 内存里的 BUILD 与磁盘不符，横幅必须亮起来。这是纯 mock，不依赖 PS 也不依赖真实磁盘。 */
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(function(){
      var _ps = null;
      try {
        Object.defineProperty(window, 'StarsPS', {
          configurable: true,
          get: function(){ return _ps; },
          set: function(v){
            _ps = v;
            try {
              if (v && typeof v === 'object') {
                // 预览模式（没有 CEP）时 init 会整个跳过版本检查分支，所以这里连
                // available / ping 一起伪装成「真的在 Photoshop 里」，只让 diskBuild 说谎
                v.available = true;
                v.ping = function(){ return Promise.resolve({ ps: '27.10.0', docs: 1, jsx: '${BUILD}' }); };
                v.diskBuild = function(){ return { panel: '9.9.9', jsx: '9.9.9', dir: '' }; };
                // 0.7.46：精修条要能点 —— 假装滤镜跑成功并回执一个新图层
                v.polish = function(kind){
                  return Promise.resolve({
                    action: 'polish', kind: kind, label: kind, layer: 'Stars-AI · ' + kind,
                    radius: 4, threshold: 15, opacity: 70, blend: 'normal',
                    hadSelection: false, selection: null, historyStep: true,
                    doc: { w: 2400, h: 1600 }
                  });
                };
              }
            } catch (e) {}
          }
        });
      } catch (e) {}
    })();`
  });
  await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" });
  await sleep(2200);
  ok("磁盘版本漂移时横幅自动出现", !(await evalu("document.getElementById('verBar').classList.contains('hidden')")));
  ok("横幅是 warn 级（面板没重开＝最常见那种）", /\bwarn\b/.test(await evalu("document.getElementById('verBar').className") || ""));
  ok("横幅文本带出磁盘版本 9.9.9", /9\.9\.9/.test(await evalu("document.getElementById('verBarTx').textContent") || ""));
  ok("warn 级允许关掉（× 可见）", !(await evalu("document.getElementById('verBarClose').classList.contains('hidden')")));
  await evalu("document.getElementById('verBarClose').click()");
  await sleep(200);
  ok("点 × 后横幅隐藏", await evalu("document.getElementById('verBar').classList.contains('hidden')"));
  ok("横幅流程没有引入 JS 异常", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n[9] DR 精修区块（0.7.47）");
  ok("精修是独立区块且可见", !(await evalu("(()=>{const b=document.getElementById('drCard');return !b || b.classList.contains('hidden')})()")));
  const pbtns = await evalu("['btnPolishSmooth','btnPolishDespeckle','btnPolishSharpen','btnPolishSkintone','btnPolishEyes','btnPolishTeeth','btnPolishVignette','btnPolishDnb'].filter(id=>!document.getElementById(id))");
  ok("8 个精修按钮都在 DOM 里", pbtns.length === 0, (pbtns || []).join(", "));
  ok("区块有强度三段控", (await evalu("document.querySelectorAll('#drStrength .seg').length")) === 3);
  ok("默认强度是「中」", /中/.test(await evalu("(()=>{const a=document.querySelector('#drStrength .seg.active');return a?a.textContent:''})()") || ""));
  await evalu("(()=>{const b=[...document.querySelectorAll('#drStrength .seg')].find(x=>x.dataset.strength==='heavy');b.click()})()");
  await sleep(200);
  ok("点「重」后切到 heavy 并落盘",
    /heavy/.test(await evalu("document.querySelector('#drStrength .seg.active').dataset.strength") || "") &&
    /heavy/.test(await evalu("(JSON.parse(localStorage.getItem('starsai.cfg.v1')||'{}').settings||{}).polishStrength || ''") || ""));
  await evalu("document.getElementById('btnPolishSmooth').click()");
  await sleep(400);
  ok("点「磨皮」写出日志「精修 · 磨皮」", /精修 · 磨皮/.test(await evalu("document.getElementById('log').textContent") || ""));
  ok("日志带出新图层名", /Stars-AI · smooth/.test(await evalu("document.getElementById('log').textContent") || ""));
  ok("日志带上强度档位", /（重）/.test(await evalu("document.getElementById('log').textContent") || ""));
  await evalu("document.getElementById('btnPolishVignette').click()");
  await sleep(400);
  ok("点「暗角」也生效", /精修 · 暗角/.test(await evalu("document.getElementById('log').textContent") || ""));
  ok("跑完没有残留 busy 态", !(await evalu("document.getElementById('drCard').classList.contains('busy')")));
  ok("精修没有引入 JS 异常", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n" + (fail ? "✗ " + fail + " 条失败 · " + pass + " 条通过" : "✓ 全部通过（" + pass + " 条）"));
  ws.close(); cleanup(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("fail " + e.message); process.exit(2); });

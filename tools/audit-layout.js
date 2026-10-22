/* Stars-AI · 布局回归：窄面板下有没有元素顶出父容器
 * ------------------------------------------------------------------
 * 为什么要有这个：0.7.28 的「卡片顶出边框」bug 是纯 CSS 问题 ——
 *   .anime-grid { grid-template-columns: 1fr 1fr }
 * 而 1fr = minmax(auto, 1fr)，auto 的下限是内容的 min-content。
 * 卡片名字/副标题都是 nowrap，面板窄到 340 时两列下限之和超过容器，
 * 网格被撑开、卡片顶出去。420px 下完全看不出来，只有面板拖窄才复现。
 * 这类问题肉眼验证很费劲，所以直接量：每个元素相对父容器内容盒的溢出量。
 *
 *   node tools/audit-layout.js
 *   node tools/audit-layout.js --widths 320,340,420 --port 8801
 *
 * 它会自己起预览服务器和 headless Chrome，跑完自动清理。
 * 需要本机有 Chrome/Edge（或用 CHROME_PATH 指定）。
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = Number(argOf("port", 8799));
const CDP_PORT = Number(argOf("cdp", 9223));
const WIDTHS = argOf("widths", "320,340,360,380,420").split(",").map(Number);
const ROOT = path.resolve(__dirname, "..");

/* 0.7.45：版本漂移横幅默认是 .hidden 的，而 AUDIT 会跳过 .hidden 子树 ——
 * 也就是说它一旦默认藏起来就永远测不到。这里显式把它摊开并塞最长的真实文案
 * （图标 + 长句 + 动作按钮 + × 全在），量的是最坏情况。 */
const SHOW_BANNER = `(() => {
  const bar = document.getElementById('verBar');
  if (!bar) return 0;
  bar.classList.remove('hidden');
  bar.className = 'verbar err';
  const tx = document.getElementById('verBarTx');
  if (tx) tx.textContent = '磁盘上版本就不一致：面板 0.7.45 / PS 脚本 0.7.44 —— 点「重载脚本」；还不行就重跑 install.ps1';
  const act = document.getElementById('verBarAct');
  if (act) act.classList.remove('hidden');
  return 1;
})()`;

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    process.env["ProgramFiles"] + "\\Google\\Chrome\\Application\\chrome.exe",
    (process.env["ProgramFiles(x86)"] || "") + "\\Google\\Chrome\\Application\\chrome.exe",
    (process.env["LOCALAPPDATA"] || "") + "\\Google\\Chrome\\Application\\chrome.exe",
    (process.env["ProgramFiles(x86)"] || "") + "\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env["ProgramFiles"] + "\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  return "";
}

function getJson(port, p) {
  return new Promise((res, rej) => {
    http.get("http://127.0.0.1:" + port + p, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在页面里跑：返回所有「相对父容器外框溢出」的元素。
// 判定用 padding box（外框减边框），不是 content box —— 居中图标伸进父容器 padding
// 属于正常排版（比如 26px 图标按钮里的 15px svg），只有压到边框外面才是真的顶出去。
// absolute / fixed 的元素不参与（设置抽屉、弹层本来就是脱离文档流的）。
const AUDIT = `(() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.hidden')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const own = getComputedStyle(el);
    if (own.position === 'absolute' || own.position === 'fixed') continue;
    const p = el.parentElement;
    if (!p || p === document.body) continue;
    const cs = getComputedStyle(p);
    // 父元素自己会裁剪的（滚动区/缩略图条/标签栏）是设计上就截断，跳过
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') continue;
    const pr = p.getBoundingClientRect();
    const bR = parseFloat(cs.borderRightWidth) || 0, bL = parseFloat(cs.borderLeftWidth) || 0;
    const overR = r.right - (pr.right - bR);
    const overL = (pr.left + bL) - r.left;
    if (overR > 1 || overL > 1) {
      bad.push({
        el: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.') : ''),
        text: (el.textContent || el.value || '').trim().slice(0, 12),
        right: Math.round(overR), left: Math.round(overL)
      });
    }
  }
  return JSON.stringify({
    doc: document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth,
    bad: bad.slice(0, 10), n: bad.length
  });
})()`;

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.error("找不到 Chrome/Edge，请设置 CHROME_PATH"); process.exit(2); }

  console.log("[" + path.basename(chrome) + "] 启动预览服务器 :" + PORT + " ...");
  const server = spawn(process.execPath, [path.join(__dirname, "preview-server.js"), String(PORT)], { cwd: ROOT, stdio: "ignore" });
  const profile = path.join(os.tmpdir(), "starsai-audit-" + Date.now());
  console.log("[chrome] headless 启动 :" + CDP_PORT + " ...");
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + profile, "--window-size=420,1100", "about:blank"
  ], { stdio: "ignore" });

  const cleanup = () => {
    try { browser.kill(); } catch (e) {}
    try { server.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });

  // 等 Chrome 的调试端口
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await getJson(CDP_PORT, "/json/list");
      target = list.find((t) => t.type === "page");
    } catch (e) {}
  }
  if (!target) { console.error("Chrome 调试端口没起来"); cleanup(); process.exit(2); }
  await sleep(600);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalu = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : "";
  };

  await send("Page.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" });
  await sleep(1500);
  await evalu("localStorage.setItem('starsai.nsfw.ack.v1', JSON.stringify({ok:true}))");

  let total = 0;
  for (const w of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" });
    await sleep(1400);
    const rows = [];

    await evalu(SHOW_BANNER);
    await sleep(150);
    rows.push(["顶栏版本横幅（最长文案）", JSON.parse(await evalu(AUDIT))]);
    rows.push(["二次元·全部", JSON.parse(await evalu(AUDIT))]);
    // 选一张带「补充条件」的卡（会多出输入行 + 快捷词）
    await evalu("(()=>{const c=[...document.querySelectorAll('#animeGrid .anime-card')].find(x=>x.textContent.includes('更换背景'));if(c)c.click()})()");
    await sleep(250);
    rows.push(["二次元·补充条件展开", JSON.parse(await evalu(AUDIT))]);
    // 切 NSFW，选一张带快捷词的卡
    await evalu("(()=>{const b=[...document.querySelectorAll('.vtab')].find(x=>x.dataset.view==='nsfw');b.click()})()");
    await sleep(250);
    await evalu("(()=>{const c=[...document.querySelectorAll('#nsfwGrid .anime-card')].find(x=>x.textContent.includes('更换服装'));if(c)c.click()})()");
    await sleep(250);
    rows.push(["NSFW·补充条件展开", JSON.parse(await evalu(AUDIT))]);

    console.log("\n=== 面板宽度 " + w + "px ===");
    for (const [name, r] of rows) {
      const flag = r.n ? "✗ " + r.n + " 处溢出" : "✓";
      console.log("  " + flag + "  " + name + "  (页面 " + r.doc + ")");
      if (r.n) r.bad.forEach((b) => console.log("        · " + b.el + ' "' + b.text + '" 右+' + b.right + " 左+" + b.left));
      total += r.n;
    }
  }

  console.log("\n" + (total ? "✗ 共 " + total + " 处溢出，检查 CSS 的 grid/flex 最小宽度" : "✓ 所有宽度下都没有元素顶出父容器"));
  ws.close();
  cleanup();
  process.exit(total ? 1 : 0);
})().catch((e) => { console.error("audit 失败: " + e.message); process.exit(2); });

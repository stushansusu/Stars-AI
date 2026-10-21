/* Stars-AI · 面板预览服务器（开发用）
 * 把插件目录当作静态站点，并把 /comfy/* 反向代理到本机 ComfyUI，
 * 这样用浏览器就能看到真实模型列表的真实 UI，不需要打开 Photoshop。
 *   node tools/preview-server.js 8799
 *   然后访问 http://127.0.0.1:8799/?server=http://127.0.0.1:8799/comfy
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 8799);
const COMFY = process.env.COMFY || "http://127.0.0.1:8188";
const target = new URL(COMFY);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function proxy(req, res, urlPath) {
  const p = urlPath.replace(/^\/comfy/, "") || "/";
  const opts = {
    hostname: target.hostname,
    port: target.port || 80,
    path: p,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: target.host })
  };
  const up = http.request(opts, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("ComfyUI 连接失败: " + e.message);
  });
  req.pipe(up);
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname.startsWith("/comfy")) return proxy(req, res, u.pathname + u.search);

  let rel = decodeURIComponent(u.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.join(ROOT, rel.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found: " + rel); }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log("Stars-AI preview: http://127.0.0.1:" + PORT + "/?server=http://127.0.0.1:" + PORT + "/comfy");
  console.log("proxy -> " + COMFY);
});

// ============================================================
// gbmd-v3 - HTTP 入口（零依赖，自旧项目重构）
// P1：路由按域拆到 server/routes/*.js，本文件只做装配 + 鉴权门 + 静态/启动。
// 保留：搜索（关键词/按时间）、下载（四步流程）、设置（读 gamebanana.com.json
//       设置游戏下载路径）、文件夹合并、网页界面框架、gbCookie + 登录状态检测
// 移除：旧项目整理功能（扫描/错位/重复/一键整理/散落归组/图片还原/回收站 HTML
//       整理/md5 整理等全部不搬）
// ============================================================
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const urlMod = require("url");
const os = require("os");

const appLog = require("./lib/app-log");
appLog.install();
const cfg = require("./config");
const auth = require("./auth");
const gbApi = require("./lib/gb-api");
const downloader = require("./lib/downloader");
const search = require("./lib/search");
const searchDateRange = require("./lib/search-date-range.cjs");
const mergeDirs = require("./lib/merge-dirs");
const dataBackup = require("./lib/data-backup");
const hashIndex = require("./lib/hash-index");
const incompleteScan = require("./lib/incomplete-scan");
const { sendJson, readBody, cleanCookie } = require("./utils/http");
const { isBrowsableDir, isBlocked } = require("./utils/path-safe");
const autoUpdate = require("./lib/auto-update");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// ---------- 命令行：设置密码 ----------
if (process.argv.includes("--set-password")) {
  const idx = process.argv.indexOf("--set-password");
  const pwd = process.argv[idx + 1];
  if (!pwd) { console.error("用法: node app.js --set-password \"你的密码\""); process.exit(1); }
  cfg.setPassword(pwd);
  console.log("密码已设置（scrypt 哈希存入 server/config.json）");
  process.exit(0);
}

// ---------- 工具 ----------
function setSessionCookie(res, token) {
  const cfgNow = cfg.readConfig();
  const maxAge = (cfgNow.sessionHours || 72) * 3600;
  res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

async function requireAuth(req) {
  const cfgNow = cfg.readConfig();
  if (!cfgNow.passwordHash) return true;
  return await auth.isValidSession(auth.extractToken(req));
}

function injectAssetVersion(html, publicDir) {
  // 「固化skill 不要求用户强刷网页，而是升级页面版本」
  return String(html).replace(
    /(<(?:link|script)\b[^>]*(?:href|src)=["'])([^"']+\.(?:css|js))(\?[^"']*)?(["'][^>]*>)/gi,
    function (_, pre, url, query, post) {
      if (/^(https?:)?\/\//i.test(url) || url.indexOf("/vendor/") >= 0) return pre + url + (query || "") + post;
      var rel = url.replace(/^\//, "");
      var file = path.join(publicDir, rel);
      var v = "";
      try {
        if (fs.existsSync(file)) v = String(fs.statSync(file).mtimeMs | 0);
      } catch (_) {}
      if (!v) return pre + url + (query || "") + post;
      var q = String(query || "");
      if (/[?&]v=/.test(q)) q = q.replace(/([?&])v=[^&]*/, "$1v=" + v);
      else q = (q ? q + "&" : "?") + "v=" + v;
      return pre + url + q + post;
    }
  );
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end("Not Found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (ext === ".html" || ext === ".js" || ext === ".css") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    }
    if (ext === ".html") {
      const html = injectAssetVersion(fs.readFileSync(filePath, "utf8"), PUBLIC_DIR);
      headers["Content-Length"] = Buffer.byteLength(html);
      res.writeHead(200, headers);
      return res.end(html);
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- 路由装配 ----------
const publicRoutes = [];
const routes = [];
const routePublic = (method, path, handler) => publicRoutes.push({ method, path, handler });
const route = (method, path, handler) => routes.push({ method, path, handler });

const api = {
  route, routePublic,
  sendJson, readBody, cleanCookie,
  setSessionCookie,
  cfg, auth, gbApi, downloader, search, searchDateRange, mergeDirs,
  dataBackup, hashIndex, incompleteScan,
  fs, path, os,
  isBrowsableDir, isBlocked,
  autoUpdate
};

require("./routes/auth")(api);
require("./routes/settings")(api);
require("./routes/cred")(api);
require("./routes/games")(api);
require("./routes/search")(api);
require("./routes/download")(api);
require("./routes/hashindex")(api);
require("./routes/browse")(api);
require("./routes/data")(api);
require("./routes/merge")(api);
require("./routes/auto-update")(api);

// ---------- 路由分发 ----------
const server = http.createServer(async (req, res) => {
  const parsed = urlMod.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;
  const match = (list) => {
    for (const r of list) {
      if ((r.method === "*" || r.method === method) && r.path === pathname) return r.handler;
    }
    return null;
  };

  try {
    if (appLog.shouldLogApi(method, pathname)) appLog.apiLine(method, pathname);
    // ---- 公开路由（登录/登出/状态）----
    const pub = match(publicRoutes);
    if (pub) return await pub(req, res, parsed);
    // ---- 需鉴权 ----
    if (pathname.startsWith("/api/") && !(await requireAuth(req))) {
      return sendJson(res, 401, { ok: false, error: "未登录" });
    }
    // ---- 业务路由（/api/*）----
    const h = match(routes);
    if (h) return await h(req, res, parsed);
    // ---- 油猴脚本下载（2026-09-01 参照 iwara：顶部「📥 油猴脚本」）----
    if (pathname === "/userscript.user.js" || pathname === "/gamebanana-cookie-userscript.user.js") {
      const scriptPath = path.join(__dirname, "..", "scripts", "gamebanana-cookie-userscript.user.js");
      fs.readFile(scriptPath, (err, data) => {
        if (err) return sendJson(res, 404, { ok: false, error: "油猴脚本不存在" });
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          // 2026-09-01：inline 让 Tampermonkey/Violentmonkey 自动弹安装/更新（附件会强制下载）
          "Content-Disposition": "inline; filename=gamebanana-cookie-userscript.user.js",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        });
        res.end(data);
      });
      return;
    }
    // ---- 静态页面 ----
    if (!pathname.startsWith("/api/")) {
      if (!cfg.readConfig().passwordHash) {
        if (pathname === "/" || pathname === "/index.html" || pathname === "/setup.html") {
          return serveStatic(req, res, "/setup.html");
        }
      }
      return serveStatic(req, res, pathname);
    }

    return sendJson(res, 404, { ok: false, error: "接口不存在" });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message || String(e) });
  }
});

// ---------- 启动 ----------
(async () => {
  const cfgNow = cfg.readConfig();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (cfgNow.port || 8642);

  await auth.loadSessions();
  auth.startCleanup(); // 每小时清过期 session
  downloader.restorePendingTask();
  search.restorePendingQuery();

  // hash 反查：加载两张持久化索引表（json/gb-hash-index.json + json/local-hash-index.json）
  try {
    const r = hashIndex.load();
    console.log(`[hash-index] 已加载: GB 表 ${r.gb} 条, 本地表 ${r.local} 条`);
  } catch (e) {
    console.log("[hash-index] 加载失败: " + (e && e.message));
  }

  // 2026-09-06 自动更新：监控代码变更 → 防抖重启
  autoUpdate.start(cfgNow.autoUpdate || { enabled: false }, async () => {
    // 重启回调：当前任务已 saveTask（downloader 每次状态变更都写盘），
    // 下次启动 restorePendingTask 自动恢复 paused/done 状态
    console.log("[auto-update] 重启回调：任务状态已保存");
  }, (msg) => {
    // 状态回调：auto-update 内部 _log 已打印，这里不重复输出
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("==============================================");
    console.log("gbmd-v3 server 已启动");
    console.log(`  本机访问: http://127.0.0.1:${PORT}`);
    console.log(`  局域网访问: http://<本机IP>:${PORT}`);
    if (!cfg.hasPassword()) {
      console.log('  ⚠️  尚未设置密码！首次使用请先设置：node app.js --set-password "你的密码"');
    }
    console.log("==============================================");
  });
})();

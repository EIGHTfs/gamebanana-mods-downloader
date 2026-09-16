// ============================================================
// gbmd-v3 - HTTP 入口（零依赖，模板化装配）
// 装配顺序：framework 提供 HTTP 服务/鉴权门/静态文件/路由工厂，
//           本文件只做：配置/鉴权初始化 + 业务路由挂载 + 启动钩子。
// 保留：搜索（关键词/按时间）、下载（四步流程）、设置（读 gamebanana.com.json
//       设置游戏下载路径）、文件夹合并、网页界面框架、gbCookie + 登录状态检测、
//       油猴脚本分发、资源版本注入、API 日志过滤
// ============================================================
"use strict";

const path = require("path");
const fs = require("fs");

const { createServer, appLog, sendJson, createRoute, auth: gbAuth } = require("./framework");
const cfg = require("./config");
const downloader = require("./lib/downloader");
const search = require("./lib/search");
const hashIndex = require("./lib/hash-index");
const autoUpdate = require("./lib/auto-update");

appLog.install();

const PUBLIC_DIR = path.join(__dirname, "public");
const PROJECT_ROOT = path.join(__dirname, "..");

// ---------- 命令行：设置密码 ----------
if (process.argv.includes("--set-password")) {
  const idx = process.argv.indexOf("--set-password");
  const pwd = process.argv[idx + 1];
  if (!pwd) { console.error('用法: node app.js --set-password "你的密码"'); process.exit(1); }
  cfg.setPassword(pwd);
  console.log("密码已设置（scrypt 哈希存入 server/config.json）");
  process.exit(0);
}

// ---------- 静态 HTML 资源版本注入 ----------
// 升级页面版本号（mtime）而不要求用户强刷网页；/vendor/ 与外部 URL 跳过。
function injectAssetVersion(html, publicDir) {
  return String(html).replace(
    /(<(?:link|script)\b[^>]*(?:href|src)=["'])([^"']+\.(?:css|js))(\?[^"']*)?(["'][^>]*>)/gi,
    function (_, pre, url, query, post) {
      if (/^(https?:)?\/\//i.test(url) || url.indexOf("/vendor/") >= 0) return pre + url + (query || "") + post;
      const rel = url.replace(/^\//, "");
      const file = path.join(publicDir, rel);
      let v = "";
      try {
        // mtimeMs 是 13 位毫秒时间戳，不能用 |0（32 位会溢出成负数），取整即可
        if (fs.existsSync(file)) v = String(Math.floor(fs.statSync(file).mtimeMs));
      } catch (_) { /* 文件不存在则不追加版本号 */ }
      if (!v) return pre + url + (query || "") + post;
      let q = String(query || "");
      if (/[?&]v=/.test(q)) q = q.replace(/([?&])v=[^&]*/, "$1v=" + v);
      else q = (q ? q + "&" : "?") + "v=" + v;
      return pre + url + q + post;
    }
  );
}

// ---------- 片段清单 ----------
// 框架模式：框架文件含 <!-- @frag:xxx --> 指令（HTML）或 /* @frag:xxx */ 指令（CSS），
// 片段在 fragments/ 下（通用分片 + 项目特有分片），组装器按指令替换插入。
//   index.html ← 蓝图框架（HTML 指令）
//   style.css  ← 蓝图框架（CSS 指令，样式分片在 fragments/styles/）
function loadFragmentManifest() {
  const fragDir = path.join(PUBLIC_DIR, "fragments");
  if (!fs.existsSync(fragDir) || !fs.statSync(fragDir).isDirectory()) return null;
  // 页面名 → 框架文件（public/ 下的同名文件即框架）
  const FRAMEWORKS = ["index.html", "style.css"];
  const pages = {};
  for (const name of FRAMEWORKS) {
    const f = path.join(PUBLIC_DIR, name);
    try {
      if (fs.existsSync(f) && fs.statSync(f).isFile()) pages[name] = f;
    } catch (_) {
      console.log("[fragments] 框架文件不可用: " + name);
    }
  }
  if (!Object.keys(pages).length) return null;
  return { pages: pages };
}

// ---------- 油猴脚本分发 ----------
// 顶部「📥 油猴脚本」入口：inline 让 Tampermonkey/Violentmonkey 自动弹安装/更新
const USERSCRIPT_NAMES = ["/userscript.user.js", "/gamebanana-cookie-userscript.user.js"];
const userscriptRoute = createRoute({
  "GET /userscript.user.js": serveUserscript,
  "GET /gamebanana-cookie-userscript.user.js": serveUserscript,
});

function serveUserscript(req, res) {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "gamebanana-cookie-userscript.user.js");
  fs.readFile(scriptPath, (err, data) => {
    if (err) return sendJson(res, { ok: false, error: "油猴脚本不存在" }, 404);
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": "inline; filename=gamebanana-cookie-userscript.user.js",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
  return true;
}

// ---------- 组装 ----------
async function main() {
  // 业务路由（需鉴权）：每个模块导出 createRoute 表
  const modules = [
    "./routes/auth", "./routes/settings", "./routes/cred", "./routes/games",
    "./routes/search", "./routes/download", "./routes/hashindex", "./routes/browse",
    "./routes/data", "./routes/merge", "./routes/auto-update",
  ];
  const routes = [
    { prefix: "", handler: userscriptRoute },   // 油猴脚本（公开）
  ];
  // 认证前放行的路径；未设密码时 framework 会整体放行（首次初始化阶段）
  const publicRoutes = [
    "/userscript.user.js",
    "/gamebanana-cookie-userscript.user.js",
    "/api/status",
    "/api/login",
    "/api/logout",
  ];

  // 公开路由模块（登录/登出/状态）单独挂载
  const authRoutes = require("./routes/auth");
  if (authRoutes.public) routes.push({ prefix: "", handler: authRoutes.public });
  const settingsRoutes = require("./routes/settings");
  if (settingsRoutes.public) routes.push({ prefix: "", handler: settingsRoutes.public });

  for (const m of modules) {
    const mod = require(m);
    if (typeof mod === "function") routes.push({ prefix: "", handler: mod });
  }

  // HTML 片段组装：index.html 由 fragments/ 下的功能片段拼装（改片段刷新生效）
  const fragManifest = loadFragmentManifest();
  const fragments = fragManifest
    ? {
        dir: path.join(PUBLIC_DIR, "fragments"),
        pages: fragManifest.pages,
        watch: true,
      }
    : null;

  const server = createServer({
    config: cfg,
    auth: gbAuth,
    publicDir: PUBLIC_DIR,
    routes: routes,
    publicRoutes: publicRoutes,
    loginPath: "/login.html",
    setupPath: "/setup.html",
    fragments: fragments,
    // 未设密码时把首页导向首次设置页
    needsSetup: () => !cfg.readConfig().passwordHash,
    // HTML 资源版本注入
    transformHtml: (html) => injectAssetVersion(html, PUBLIC_DIR),
    onReady: async (port) => {
      downloader.restorePendingTask();
      search.restorePendingQuery();
      try {
        const r = hashIndex.load();
        console.log(`[hash-index] 已加载: GB 表 ${r.gb} 条, 本地表 ${r.local} 条`);
      } catch (e) {
        console.log("[hash-index] 加载失败: " + (e && e.message));
      }
      // 自动更新：监控代码变更 → 防抖重启（watch/git/github 三模式）
      autoUpdate.start(cfg.readConfig().autoUpdate || { enabled: false }, async () => {
        console.log("[auto-update] 重启回调：任务状态已保存");
      }, () => { /* auto-update 内部已打印 */ });

      console.log("==============================================");
      console.log("gbmd-v3 server 已启动");
      console.log(`  本机访问: http://127.0.0.1:${port}`);
      console.log(`  局域网访问: http://<本机IP>:${port}`);
      if (!cfg.hasPassword()) {
        console.log('  ⚠️  尚未设置密码！首次使用请先设置：node app.js --set-password "你的密码"');
      }
      console.log("==============================================");
    },
  });

  return server;
}

// 会话清理：每小时清过期 session（auth 由 framework 提供）
//runtime-manifest.json file server/sessions.json watch=skip desc=会话持久化（登录态，运行期频繁写）
gbAuth.init({ sessionFile: path.join(__dirname, "sessions.json"), cookieName: "session" });
gbAuth.startCleanup();

main().catch((e) => {
  console.error("[启动失败] " + (e && e.message));
  process.exit(1);
});

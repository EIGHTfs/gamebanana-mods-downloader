// ============================================================
// gbmd - 路由：本地目录浏览 / 图片预览代理
// P1 从 app.js 拆分。bug#2：browse 加白名单（收敛到下载根分支）。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, cfg, fs, path, downloadRoots, isWithinRoots, isBrowsableDir } = api;

  // GET /api/browse（设置页「读取本地选择」下载路径；用户原话 2026-08-26）
  // bug#2：白名单——只列「下载根 + 祖先 + 后代」分支，/etc、/home 等与下载无关分支不列、不可进。
  route("GET", "/api/browse", (req, res, parsed) => {
    const roots = downloadRoots(cfg);
    const p = String(parsed.query.path || "").trim();
    const dir = p && p.startsWith("/") ? p : "/";
    if (!isBrowsableDir(dir, roots)) {
      return sendJson(res, 403, { ok: false, error: "仅可浏览已配置的下载目录分支" });
    }
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return sendJson(res, 400, { ok: false, error: "目录不存在: " + dir });
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // 2026-08-31 修复老 bug（用户原话：「设置目录不显示带.目录」）：
      //   不再过滤 . 开头目录，只排除 @eaDir（缩略图缓存）、#recycle（回收站）、.git（版本库）
      const dirs = entries
        .filter((e) => e.isDirectory() && e.name !== "@eaDir" && e.name !== "#recycle" && e.name !== ".git")
        .filter((e) => isBrowsableDir(path.join(dir, e.name), roots)) // bug#2：只列可继续浏览的分支
        .map((e) => e.name)
        .sort();
      return sendJson(res, 200, { ok: true, path: dir, parent: dir === "/" ? null : path.dirname(dir), dirs });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // GET /api/image（下载进度页预览图；路径必须在某游戏下载根内，防穿越）
  route("GET", "/api/image", (req, res, parsed) => {
    const filePath = parsed.query && parsed.query.path;
    if (!filePath || typeof filePath !== "string") { res.writeHead(400); res.end("bad request"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" }[ext];
    if (!mime) { res.writeHead(403); res.end("not an image"); return; }
    const abs = path.resolve(filePath);
    // 2026-09-02：白名单必须含 defaultDownloadPath（文件落在默认下载位置时也能预览）
    const roots = downloadRoots(cfg);
    if (!isWithinRoots(abs, roots)) { res.writeHead(403); res.end("forbidden"); return; }
    if (!fs.existsSync(abs)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
    fs.createReadStream(abs).pipe(res);
    return;
  });
};

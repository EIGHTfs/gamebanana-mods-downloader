// ============================================================
// gbmd - 路由：本地目录浏览 / 图片预览代理
// 2026-09-06：黑名单实现——局域网项目，只拉黑系统关键目录，不做白名单收敛。
// ============================================================
"use strict";

const { createRoute, sendJson, pathSafe } = require("../core/index.js");
const cfg = require("../config");
const { isBlocked, isBrowsableDir } = pathSafe;
const fs = require("fs");
const path = require("path");

module.exports = createRoute({


  // GET /api/browse（设置页「📂 读取本地选择」下载路径）
  // 黑名单：只拉黑系统关键目录（/etc /proc /sys /dev /root 等），其余放行。
  "GET /api/browse": (req, res, ctx) => {
    const p = String(ctx.query.path || "").trim();
    const dir = p && p.startsWith("/") ? p : "/";
    if (!isBrowsableDir(dir)) {
      return sendJson(res, { ok: false, error: "该目录不可浏览（系统目录已拉黑）" }, 403);
    }
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return sendJson(res, { ok: false, error: "目录不存在: " + dir }, 400);
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && e.name !== "@eaDir" && e.name !== "#recycle" && e.name !== ".git")
        .filter((e) => isBrowsableDir(path.join(dir, e.name))) // 黑名单过滤
        .map((e) => e.name)
        .sort();
      return sendJson(res, { ok: true, path: dir, parent: dir === "/" ? null : path.dirname(dir), dirs }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 400);
    }
  },

  // GET /api/image（下载进度页预览图；黑名单拉黑系统目录，防穿越到敏感路径）
  "GET /api/image": (req, res, ctx) => {
    const filePath = ctx.query && ctx.query.path;
    if (!filePath || typeof filePath !== "string") { res.writeHead(400); res.end("bad request"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" }[ext];
    if (!mime) { res.writeHead(403); res.end("not an image"); return; }
    const abs = path.resolve(filePath);
    if (isBlocked(abs)) { res.writeHead(403); res.end("forbidden"); return; }
    if (!fs.existsSync(abs)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
    fs.createReadStream(abs).pipe(res);
    return;
  },
});

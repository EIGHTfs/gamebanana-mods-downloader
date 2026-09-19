// ============================================================
// gbmd - 路由：HTML 反查（双表：GB 信息表 + 本地表）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

const { createRoute, sendJson, readBody } = require("../core/index.js");
const hashIndex = require("../lib/hash-index");

module.exports = createRoute({


  // GET /api/hash-query?hash=<md5> → 该 hash 所属 mod/目录/文件（O(1) 内存索引）
  //   source: "local"=本地表命中（有实际落盘路径）| "gb"=仅 GB 表命中（线上信息，未在本机下载）
  "GET /api/hash-query": (req, res, ctx) => {
    const h = String(ctx.query.hash || "").trim().toLowerCase();
    if (!h) return sendJson(res, { ok: false, error: "缺 hash 参数" }, 400);
    const hit = hashIndex.queryByHash(h);
    if (!hit) return sendJson(res, { ok: true, found: false, hash: h }, 200);
    return sendJson(res, {
      ok: true, found: true, hash: h, source: hit.source || "gb",
      mod: { name: hit.modName || "", url: hit.url || "", author: hit.author || "", game: hit.game || "", modId: hit.modId || "" },
      file: { name: hit.file || hit.fileName || "", gbMd5: hit.gbMd5 || "", hash: hit.hash || "", kind: hit.kind || "file" },
      modDir: hit.modDir || ""
    }, 200);
  },

  // GET /api/hash-index-status → 双表状态（GB 表 / 本地表 大小、上次构建耗时）
  "GET /api/hash-index-status": (req, res) => {
    return sendJson(res, { ok: true, ...hashIndex.status() }, 200);
  },

  // POST /api/hash-rebuild → 后台重建索引（body.game 指定只重建该游戏，不传或空 = 全部）
  "POST /api/hash-rebuild": async (req, res) => {
    const body = await readBody(req);
    hashIndex.rebuild(String((body && body.game) || "").trim() || undefined).then(() => {}).catch(() => {});
    return sendJson(res, { ok: true, running: true, game: String((body && body.game) || "").trim() || "all" }, 200);
  },

  // GET /api/hash-index-search?q=<关键词>&game=<游戏名可选> → GB 表模糊搜索
  "GET /api/hash-index-search": (req, res, ctx) => {
    const q = String(ctx.query.q || "").trim();
    if (q.length < 2) return sendJson(res, { ok: true, results: [], hint: "关键词至少 2 个字符" }, 200);
    const game = String(ctx.query.game || "").trim();
    const results = hashIndex.searchGb(q, game);
    return sendJson(res, { ok: true, count: results.length, results }, 200);
  },
});

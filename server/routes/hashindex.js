// ============================================================
// gbmd - 路由：HTML 反查（双表：GB 信息表 + 本地表）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, hashIndex } = api;

  // GET /api/hash-query?hash=<md5> → 该 hash 所属 mod/目录/文件（O(1) 内存索引）
  //   source: "local"=本地表命中（有实际落盘路径）| "gb"=仅 GB 表命中（线上信息，未在本机下载）
  route("GET", "/api/hash-query", (req, res, parsed) => {
    const h = String(parsed.query.hash || "").trim().toLowerCase();
    if (!h) return sendJson(res, 400, { ok: false, error: "缺 hash 参数" });
    const hit = hashIndex.queryByHash(h);
    if (!hit) return sendJson(res, 200, { ok: true, found: false, hash: h });
    return sendJson(res, 200, {
      ok: true, found: true, hash: h, source: hit.source || "gb",
      mod: { name: hit.modName || "", url: hit.url || "", author: hit.author || "", game: hit.game || "", modId: hit.modId || "" },
      file: { name: hit.file || hit.fileName || "", gbMd5: hit.gbMd5 || "", hash: hit.hash || "", kind: hit.kind || "file" },
      modDir: hit.modDir || ""
    });
  });

  // GET /api/hash-index-status → 双表状态（GB 表 / 本地表 大小、上次构建耗时）
  route("GET", "/api/hash-index-status", (req, res) => {
    return sendJson(res, 200, { ok: true, ...hashIndex.status() });
  });

  // POST /api/hash-rebuild → 后台重建索引（body.game 指定只重建该游戏，不传或空 = 全部）
  route("POST", "/api/hash-rebuild", async (req, res) => {
    const body = await readBody(req);
    hashIndex.rebuild(String((body && body.game) || "").trim() || undefined).then(() => {}).catch(() => {});
    return sendJson(res, 200, { ok: true, running: true, game: String((body && body.game) || "").trim() || "all" });
  });

  // GET /api/hash-index-search?q=<关键词>&game=<游戏名可选> → GB 表模糊搜索
  route("GET", "/api/hash-index-search", (req, res, parsed) => {
    const q = String(parsed.query.q || "").trim();
    if (q.length < 2) return sendJson(res, 200, { ok: true, results: [], hint: "关键词至少 2 个字符" });
    const game = String(parsed.query.game || "").trim();
    const results = hashIndex.searchGb(q, game);
    return sendJson(res, 200, { ok: true, count: results.length, results });
  });
};

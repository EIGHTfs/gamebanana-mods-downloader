// ============================================================
// gbmd - 路由：搜索（关键词 / 按时间 / 状态 / 缓存导入导出）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, cfg, gbApi, search, searchDateRange } = api;

  // ---- 关键词搜索（中文/变体 → 英文归一后搜 GB Results API）----
  route("GET", "/api/keyword-search", async (req, res, parsed) => {
    let q = String(parsed.query.q || "").trim();
    const game = String(parsed.query.game || "").trim();
    if (!q || !game) return sendJson(res, 400, { ok: false, error: "missing q or game" });
    const gameId = cfg.gameIdOf(game);
    if (!gameId) return sendJson(res, 400, { ok: false, error: "unknown game id: " + game });
    try {
      const origQ = q;
      q = gbApi.normalizeKeyword(game, q); // 桑多涅 → Sandrone
      const perpage = Math.min(parseInt(parsed.query.perpage, 10) || 50, 100);
      const maxResults = Math.min(parseInt(parsed.query.max || 100, 10) || 100, 500);
      // 2026-08-27：合并搜索——搜角色名时自动补搜变体（短名/中文），合并去重。
      const genVariants = (base) => {
        const vs = new Set();
        vs.add(base);
        // 短名：去全名后缀（Jane Doe → Jane；Burnice White → Burnice）
        const parts = String(base).split(" ");
        if (parts.length > 1) {
          vs.add(parts[0]);
          // 去掉中间名保留前两个（Anby Demara → Anby）
          if (parts.length > 2) vs.add(parts[0] + " " + parts[1]);
        }
        // 中文变体：从映射 roles 反查（简·杜/简）
        try {
          const map = cfg.readGameMapping(game);
          for (const [en, zh] of Object.entries((map && map.roles) || {})) {
            if (String(en).toLowerCase() === String(base).toLowerCase()) {
              vs.add(zh);
              // 中文短名（取 · 前段）
              const zhShort = String(zh).split("·")[0].trim();
              if (zhShort && zhShort.length >= 1) vs.add(zhShort);
            }
          }
        } catch (_) {}
        return [...vs].filter(Boolean);
      };
      const variants = genVariants(q);
      const all = [];
      const seen = new Set();
      for (const vq of variants) {
        for (let page = 1; page <= 12 && all.length < maxResults; page++) {
          const recs = await gbApi.searchGameBananaMods(gameId, vq, perpage, page);
          const mods = (recs || []).filter((r) => r && r.id);
          if (!mods.length) break;
          for (const m of mods) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            all.push(m);
          }
          if (mods.length < 10) break;
        }
      }
      const results = all.slice(0, maxResults).map((r) => ({
        modId: r.id, name: r.name, author: r.author || "",
        profileUrl: r.profileUrl || ("https://gamebanana.com/mods/" + r.id),
        game, isNsfw: !!r.isNsfw, dateAdded: 0, dateModified: 0, dateUpdated: 0
      }));
      // 归一关键词无结果且与原词不同 → 回退原词再搜一次
      if (!results.length && q !== origQ) {
        const recs2 = await gbApi.searchGameBananaMods(gameId, origQ, perpage, 1);
        const mods2 = (recs2 || []).filter((r) => r && r.id);
        for (const m of mods2) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          results.push({
            modId: m.id, name: m.name, author: m.author || "",
            profileUrl: m.profileUrl || ("https://gamebanana.com/mods/" + m.id),
            game, isNsfw: !!m.isNsfw, dateAdded: 0, dateModified: 0, dateUpdated: 0
          });
        }
      }
      return sendJson(res, 200, { ok: true, count: results.length, results, pages: all.length >= maxResults, normalized: q !== origQ ? { from: origQ, to: q } : undefined, variants: variants.length > 1 ? variants : undefined });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // ---- 按时间搜索（保留）----
  route("POST", "/api/search", async (req, res) => {
    const body = await readBody(req);
    const range = searchDateRange.resolveRange(body.startDate, body.endDate);
    if (!range.ok) return sendJson(res, 400, { ok: false, error: range.error });
    const contentFilter = Array.isArray(body.contentFilter) && body.contentFilter.length ? body.contentFilter : ["normal", "nsfw"];
    let games = (body.games || []).filter((g) => g && String(g).trim());
    if (!games.length) return sendJson(res, 400, { ok: false, error: "未指定要搜索的游戏" });
    try {
      const t = await search.startSearchTask({ games, startDate: range.startDate, endDate: range.endDate, contentFilter, startTs: range.startTs, endTs: range.endTs });
      return sendJson(res, 200, { ok: true, started: true, task: t });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });
  route("GET", "/api/search-status", (req, res) => sendJson(res, 200, { ok: true, task: search.getQueryTask() }));
  route("POST", "/api/search/stop", (req, res) => sendJson(res, 200, search.stopSearch()));
  route("GET", "/api/search/cache", (req, res) => sendJson(res, 200, { ok: true, cache: search.getCache() }));
  route("POST", "/api/search/clear", (req, res) => sendJson(res, 200, search.clearCache()));
  // 2026-08-26：手动导入搜索记录（上传 JSON 数组，按 modId 合并，导入覆盖原有）
  route("POST", "/api/search/import", async (req, res) => {
    const body = await readBody(req);
    let records = body && body.records;
    if (typeof records === "string") {
      try { records = JSON.parse(records); } catch (_) { return sendJson(res, 400, { ok: false, error: "JSON 解析失败，请上传正确的搜索记录数组" }); }
    }
    if (body && body.json && !records) {
      try { records = JSON.parse(body.json); } catch (_) { return sendJson(res, 400, { ok: false, error: "JSON 解析失败，请上传正确的搜索记录数组" }); }
    }
    return sendJson(res, 200, search.importCache(records));
  });
  // 2026-08-31：保存搜索结果（把前端当前结果覆盖写入 search_cache.json）
  route("POST", "/api/search/save", async (req, res) => {
    const body = await readBody(req);
    const results = Array.isArray(body && body.results) ? body.results : [];
    return sendJson(res, 200, search.saveRecords(results));
  });
  // 2026-08-26：导出搜索记录（当前 cache 完整 JSON，前端下载为文件）
  route("GET", "/api/search/export", (req, res) => {
    const cache = search.exportCache();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="gbmd-search-records-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.end(JSON.stringify(cache, null, 2));
  });
};

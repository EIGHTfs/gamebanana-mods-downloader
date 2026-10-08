// ============================================================
// gbmd - 路由：搜索（关键词 / 按时间 / 状态 / 缓存导入导出）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

const { createRoute, sendJson, readBody } = require("../core/index.js");
const search = require("../lib/search");
const cfg = require("../config");
const gbApi = require("../lib/gb-api");
const searchDateRange = require("../search/search-date-range.cjs");

// 模块级 handler 工厂（keywordSearch 等）接收 api 依赖对象；
// 模板化后由 framework + 业务模块在本地组装，工厂函数体保持原样。
const api = { sendJson, readBody, cfg, gbApi, search, searchDateRange };

module.exports = createRoute({


  // ---- 关键词搜索（中文/变体 → 英文归一后搜 GB Results API）----
  "GET /api/keyword-search": keywordSearch(api),

  // ---- 按角色分类抓取（2026-10-08）：角色网址 → catId → 该分类下全部 mod ----
  "GET /api/role-mods": roleMods(api),

  // ---- 按时间搜索（保留）----
  "POST /api/search": searchByDate(api),
  "GET /api/search-status": (req, res) => sendJson(res, { ok: true, task: search.getQueryTask() }, 200),
  "POST /api/search/stop": (req, res) => sendJson(res, search.stopSearch(), 200),
  "GET /api/search/cache": (req, res) => sendJson(res, { ok: true, cache: search.getCache() }, 200),
  "POST /api/search/clear": (req, res) => sendJson(res, search.clearCache(), 200),
  // 2026-08-26：手动导入搜索记录（上传 JSON 数组，按 modId 合并，导入覆盖原有）
  "POST /api/search/import": importSearchCache(api),
  // 2026-08-31：保存搜索结果（把前端当前结果覆盖写入 search_cache.json）
  "POST /api/search/save": saveSearchResults(api),
  // 2026-08-26：导出搜索记录（当前 cache 完整 JSON，前端下载为文件）
  "GET /api/search/export": exportSearchCache(api),
});

// ---- 模块级 handler 工厂 ----

// 按角色分类抓取 handler（2026-10-08）：
//   角色名 → 角色分类网址（json/role/<游戏>.json 里的 url，或「角色名 → catId」映射）
//   → catId → apiv11/Mod/Index?_aFilters[Generic_Category]=<catId> 取该角色**全部** mod。
//   与关键词搜索返回同一结构（results[].modId/name/profileUrl…），前端可直接复用渲染。
//   拿不到分类网址时**回退关键词搜索**（旧缓存/新角色），并在响应里注明 mode=keyword。
function roleMods(api) {
  const { sendJson, cfg, gbApi } = api;
  return async (req, res, ctx) => {
    const game = String(ctx.query.game || "").trim();
    const role = String(ctx.query.role || "").trim();
    const catUrlQ = String(ctx.query.url || "").trim(); // 也支持直接传分类网址
    if (!game || (!role && !catUrlQ)) return sendJson(res, { ok: false, error: "missing game or role" }, 400);
    const gameId = cfg.gameIdOf(game);
    if (!gameId) return sendJson(res, { ok: false, error: "unknown game id: " + game }, 400);
    const shape = (r) => ({
      modId: r.id,
      name: r.name,
      author: r.author || "",
      profileUrl: r.profileUrl || "https://gamebanana.com/mods/" + r.id,
      game,
      isNsfw: !!r.isNsfw,
      dateAdded: 0, dateModified: 0, dateUpdated: 0
    });
    try {
      let url = catUrlQ || (await gbApi.fetchRoleUrl(gameId, game, role));
      // 角色缓存可能是旧格式（只有名字、没网址）→ 强制刷新一次补网址（两层下探会写入 _sUrl）
      if (!url && !catUrlQ) {
        try {
          await gbApi.fetchGameCharacterList(gameId, game, true);
          url = await gbApi.fetchRoleUrl(gameId, game, role);
        } catch (_) { /* 刷新失败：走下面的报错分支 */ }
      }
      const catId = gbApi.catIdFromUrl(url);
      if (!catId) {
        // 角色搜索**不走关键词搜索**（2026-10-08）：拿不到分类网址时明确报错并给出指引
        return sendJson(res, {
          ok: false, mode: "category", role,
          error: "该角色暂无香蕉网分类网址（可能是本地 mapping 手加的角色，或官方无对应分类）",
          hint: "在设置页「手动添加映射」处点「刷新角色列表」可补全分类网址；关键词搜索请用上方「关键词」输入框"
        }, 404);
      }
      // 香蕉网 _nPerpage 上限 50 → 服务端**翻页取全量**（默认最多 200 条，可用 max 调整）
      const perpage = Math.min(parseInt(ctx.query.perpage, 10) || 50, 50);
      const max = Math.min(parseInt(ctx.query.max, 10) || 200, 500);
      let page = Math.max(parseInt(ctx.query.page, 10) || 1, 1);
      const all = [];
      let hasMore = false;
      let total = 0;
      for (let i = 0; i < 10 && all.length < max; i++) {
        const r = await gbApi.fetchModsByCategory(gameId, catId, page, perpage);
        const recs = r.records || [];
        total = r.total || total;
        all.push(...recs);
        hasMore = !!r.hasMore;
        if (!hasMore || !recs.length) break;
        page++;
      }
      const results = all.slice(0, max).map(shape);
      return sendJson(res, { ok: true, count: results.length, results, pages: hasMore, mode: "category", role, catId, catUrl: url, total }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 400);
    }
  };
}

// 关键词搜索 handler：归一 → 变体合并搜索 → 无结果回退原词
function keywordSearch(api) {
  const { sendJson, cfg, gbApi } = api;
  return async (req, res, ctx) => {
    let q = String(ctx.query.q || "").trim();
    const game = String(ctx.query.game || "").trim();
    if (!q || !game) return sendJson(res, { ok: false, error: "missing q or game" }, 400);
    const gameId = cfg.gameIdOf(game);
    if (!gameId) return sendJson(res, { ok: false, error: "unknown game id: " + game }, 400);
    try {
      const origQ = q;
      q = gbApi.normalizeKeyword(game, q); // 桑多涅 → Sandrone
      const perpage = Math.min(parseInt(ctx.query.perpage, 10) || 50, 100);
      const maxResults = Math.min(parseInt(ctx.query.max || 100, 10) || 100, 500);
      // 2026-08-27：合并搜索——搜角色名时自动补搜变体（短名/中文），合并去重。
      const variants = genKeywordVariants(api, game, q);
      const { all, seen } = await collectSearchResults(api, gameId, variants, perpage, maxResults); // 2026-10-08 修：collectSearchResults 是 async，漏 await 会让 all 为 undefined → 关键词搜索必崩（Cannot read properties of undefined (reading 'slice')）
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
      return sendJson(res, { ok: true, count: results.length, results, pages: all.length >= maxResults, normalized: q !== origQ ? { from: origQ, to: q } : undefined, variants: variants.length > 1 ? variants : undefined }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 400);
    }
  };
}

// 2026-08-27：合并搜索——搜角色名时自动补搜变体（短名/中文），合并去重。
// 变体生成：原词 + 短名 + 中文名（从映射 roles 反查）
function genKeywordVariants(api, game, base) {
  const { cfg } = api;
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
}

// 变体分页搜索：全部变体逐页搜到 maxResults 或 12 页，合并去重
async function collectSearchResults(api, gameId, variants, perpage, maxResults) {
  const { gbApi } = api;
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
  return { all, seen };
}

// 按时间搜索：解析日期范围后启动搜索任务（保留）
function searchByDate(api) {
  const { sendJson, readBody, search, searchDateRange } = api;
  return async (req, res) => {
    const body = await readBody(req);
    const range = searchDateRange.resolveRange(body.startDate, body.endDate);
    if (!range.ok) return sendJson(res, { ok: false, error: range.error }, 400);
    const contentFilter = Array.isArray(body.contentFilter) && body.contentFilter.length ? body.contentFilter : ["normal", "nsfw"];
    let games = (body.games || []).filter((g) => g && String(g).trim());
    if (!games.length) return sendJson(res, { ok: false, error: "未指定要搜索的游戏" }, 400);
    try {
      const t = await search.startSearchTask({ games, startDate: range.startDate, endDate: range.endDate, contentFilter, startTs: range.startTs, endTs: range.endTs });
      return sendJson(res, { ok: true, started: true, task: t }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 400);
    }
  };
}

// 手动导入搜索记录：上传 JSON 数组，按 modId 合并，导入覆盖原有
function importSearchCache(api) {
  const { sendJson, readBody, search } = api;
  return async (req, res) => {
    const body = await readBody(req);
    let records = body && body.records;
    if (typeof records === "string") {
      try { records = JSON.parse(records); } catch (_) { return sendJson(res, { ok: false, error: "JSON 解析失败，请上传正确的搜索记录数组" }, 400); }
    }
    if (body && body.json && !records) {
      try { records = JSON.parse(body.json); } catch (_) { return sendJson(res, { ok: false, error: "JSON 解析失败，请上传正确的搜索记录数组" }, 400); }
    }
    return sendJson(res, search.importCache(records), 200);
  };
}

// 保存搜索结果：把前端当前结果覆盖写入 search_cache.json
function saveSearchResults(api) {
  const { sendJson, readBody, search } = api;
  return async (req, res) => {
    const body = await readBody(req);
    const results = Array.isArray(body && body.results) ? body.results : [];
    return sendJson(res, search.saveRecords(results), 200);
  };
}

// 导出搜索记录：当前 cache 完整 JSON，前端下载为文件
function exportSearchCache(api) {
  const { search } = api;
  return (req, res) => {
    const cache = search.exportCache();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="gbmd-search-records-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.end(JSON.stringify(cache, null, 2));
  };
}

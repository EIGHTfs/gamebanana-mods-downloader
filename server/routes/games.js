// ============================================================
// gbmd - 路由：游戏列表 / 映射 / 香蕉网游戏信息与角色列表
// P1 从 app.js 拆分。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, cfg, gbApi } = api;

  // ---- 游戏列表（json/gamebanana.com.json：游戏名 + 香蕉网 id + 下载路径根目录）----
  route("GET", "/api/games", (req, res) => {
    return sendJson(res, 200, { ok: true, games: cfg.readGame() });
  });
  route("POST", "/api/games", async (req, res) => {
    const body = await readBody(req);
    const games = (body.games && typeof body.games === "object") ? body.games : cfg.readGame();
    cfg.writeGame(games);
    return sendJson(res, 200, { ok: true, games: cfg.readGame() });
  });

  // ---- 映射（mapping/<游戏名>.json）----
  route("GET", "/api/mapping", (req, res) => {
    const out = {};
    const games = cfg.readGame();
    for (const game of Object.keys(games)) {
      out[game] = cfg.readGameMapping(game) || null;
    }
    return sendJson(res, 200, { ok: true, mapping: out });
  });
  // ---- 手动添加角色映射（文件夹合并新增功能，2026-08-26 用户要求）----
  // POST {game, warehouse, en, zh} → 写入 mapping/<游戏名>.json 的 roles + variants
  route("POST", "/api/mapping/add-role", async (req, res) => {
    const body = await readBody(req);
    try {
      const r = cfg.addRoleMapping(body.game, body.en, body.zh);
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // ---- 香蕉网获取游戏角色列表（手动添加映射时英文名下拉选择，2026-08-26 用户要求）----
  route("GET", "/api/gb-characters", async (req, res, parsed) => {
    const game = String(parsed.query.game || "").trim();
    if (!game) return sendJson(res, 400, { ok: false, error: "missing game" });
    const gameId = cfg.gameIdOf(game);
    if (!gameId) return sendJson(res, 400, { ok: false, error: "unknown game: " + game });
    // 2026-08-27：角色列表持久化 JSON——默认读缓存，refresh=1 强制重新从香蕉网获取
    const forceRefresh = parsed.query.refresh === "1" || parsed.query.refresh === "true";
    try {
      const characters = await gbApi.fetchGameCharacterList(gameId, game, forceRefresh);
      return sendJson(res, 200, { ok: true, count: characters.length, characters, fromCache: !forceRefresh });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // ---- 香蕉网游戏信息：按 id 取游戏名 + 根分类（仓库）（2026-08-26 用户要求）----
  route("GET", "/api/gb-game-info", async (req, res, parsed) => {
    const id = parseInt(parsed.query.id, 10);
    if (!id || id <= 0) return sendJson(res, 400, { ok: false, error: "无效的香蕉网游戏 id" });
    try {
      const info = await gbApi.fetchGameInfo(id);
      if (!info || !info.name) return sendJson(res, 404, { ok: false, error: "未找到该游戏" });
      return sendJson(res, 200, { ok: true, info });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // GET /api/gb-warehouses?game=<name> → 该游戏香蕉网根分类（仓库）列表
  route("GET", "/api/gb-warehouses", async (req, res, parsed) => {
    const game = String(parsed.query.game || "").trim();
    const gameId = cfg.gameIdOf(game);
    if (!gameId) return sendJson(res, 400, { ok: false, error: "unknown game: " + game });
    try {
      const info = await gbApi.fetchGameInfo(gameId);
      // 附上本地 mapping 的仓库映射值（如 Skins → 角色）作提示
      const map = cfg.readGameMapping(game);
      const wm = (map && map.warehouses) || {};
      const roots = ((info && info.roots) || []).map((r) => ({
        id: r.id,
        name: r.name,
        itemCount: r.itemCount,
        local: wm[String(r.name).toLowerCase()] !== undefined ? wm[String(r.name).toLowerCase()] : null
      }));
      return sendJson(res, 200, { ok: true, game: info && info.name, warehouses: roots });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });
};

// ============================================================
// gbmd - 路由：文件夹合并 / 清空空文件夹
// P1 从 app.js 拆分。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, cfg, mergeDirs } = api;

  // POST /api/merge-roles：{game, dryRun} dryRun=true 预览计划；false 执行
  route("POST", "/api/merge-roles", async (req, res) => {
    const body = await readBody(req);
    const dryRun = body.dryRun !== false;
    try {
      const game = String(body.game || "").trim();
      const root = cfg.gameRootOf(game);
      if (!root) return sendJson(res, 400, { ok: false, error: "该游戏未配置下载路径，无法扫描" });
      const dups = mergeDirs.findRoleDuplicates(root, game);
      const result = mergeDirs.executeMerge(dups, dryRun, root);
      return sendJson(res, 200, { ok: true, dryRun, game, root, groups: dups.length, ...result });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });

  // POST /api/cleanup-empty-dirs：{game, dryRun} 空壳/仅含 HTML 目录，dryRun=false 时进 .trash 可恢复
  route("POST", "/api/cleanup-empty-dirs", async (req, res) => {
    const body = await readBody(req);
    const dryRun = body.dryRun !== false;
    try {
      const game = String(body.game || "").trim();
      const root = cfg.gameRootOf(game);
      if (!root) return sendJson(res, 400, { ok: false, error: "该游戏未配置下载路径，无法扫描" });
      const emptyDirs = mergeDirs.findEmptyDirs(root);
      const result = mergeDirs.cleanupEmptyDirs(emptyDirs, dryRun, root);
      return sendJson(res, 200, { ok: true, dryRun, game, root, count: emptyDirs.length, ...result });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
  });
};

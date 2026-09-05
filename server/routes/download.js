// ============================================================
// gbmd - 路由：下载（四步流程 + 任务控制 + 跳过 + 未完成扫描）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, downloader, gbApi, incompleteScan } = api;

  // ---- 下载（四步流程：生成HTML → 查重归位 → 整理 → 正式下载）----
  // 2026-09-01 参照 iwara：/api/receive 为油猴脚本专用接收口，规整 {url}/{links} 后走同一套下载
  const downloadOrReceive = async (req, res, parsed) => {
    const body = await readBody(req);
    let raw = body.links || [];
    if (parsed.pathname === "/api/receive") {
      if (typeof body.url === "string") raw = [body.url];
      else if (Array.isArray(body.urls)) raw = body.urls;
      else if (typeof body.text === "string") raw = body.text.split(/\r?\n/);
      else if (typeof raw === "string") raw = [raw];
    }
    const links = (raw || [])
      .map((s) => String(s).trim())
      .filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
    if (!links.length) return sendJson(res, 400, { ok: false, error: "没有有效的链接" });
    const t = await downloader.startDownloadTask({ mods: links.map((l) => ({ profileUrl: l })) });
    const out = { ok: true, started: true, task: t };
    if (parsed.pathname === "/api/receive") out.received = links.length;
    return sendJson(res, 200, out);
  };
  route("POST", "/api/download", downloadOrReceive);
  route("POST", "/api/receive", downloadOrReceive);

  route("POST", "/api/download-selected", async (req, res) => {
    const body = await readBody(req);
    const selected = (body.items || []).filter((it) => it && (it.profileUrl || (it.modId && String(it.modId).trim())));
    if (!selected.length) return sendJson(res, 400, { ok: false, error: "没有勾选要下载的 mod" });
    const t = await downloader.startDownloadTask({
      mods: selected.map((it) => ({ profileUrl: it.profileUrl || String(it.modId) }))
    });
    return sendJson(res, 200, { ok: true, started: true, task: t });
  });

  route("GET", "/api/task", (req, res) => sendJson(res, 200, { ok: true, task: downloader.getTask() }));
  route("POST", "/api/task/pause", (req, res) => sendJson(res, 200, downloader.pauseTask()));
  route("POST", "/api/task/resume", (req, res) => sendJson(res, 200, downloader.resumeTask()));
  route("POST", "/api/task/stop", (req, res) => sendJson(res, 200, downloader.stopTask()));
  // 2026-09-01 支持单项重试：body 传 { url, path } 只重试匹配项；空 body = 全量重试失败项
  route("POST", "/api/task/retry-failed", async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, 200, downloader.retryFailed(body || {}));
  });
  route("POST", "/api/task/concurrency", async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, 200, downloader.setConcurrency(body.concurrency));
  });
  // 2026-08-27 找回模式开关（不实际下载，只归位/找回/生成 HTML）
  route("POST", "/api/task/restore-mode", async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, 200, downloader.setRestoreMode(body.enabled));
  });
  route("GET", "/api/task/restore-mode", (req, res) => sendJson(res, 200, { ok: true, restoreOnly: downloader.getRestoreMode() }));

  // ---- 下载任务 json 导入/导出（#16-B，2026-09-02 用户要求）----
  route("GET", "/api/task/export", (req, res) => {
    try {
      const t = downloader.getTask() || {};
      const seen = new Set();
      const tasks = [];
      const push = (u, name) => {
        const modId = (() => { try { return String(gbApi.extractModId(u) || "").trim(); } catch (_) { return ""; } })();
        if (!modId || seen.has(modId)) return;
        seen.add(modId);
        tasks.push({ url: u || "", modId, name: name || "" });
      };
      for (const it of t.items || []) push(it.modUrl || it.url || "", it.modName || it.displayName || "");
      for (const p of t.pendingMods || []) push(p.profileUrl || p.url || "", p.name || "");
      const taskJson = { schema: "gbmd-tasks-v1", exportedAt: new Date().toISOString(), count: tasks.length, tasks };
      return sendJson(res, 200, { ok: true, taskJson });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message || String(e) });
    }
  });
  route("POST", "/api/task/import", async (req, res) => {
    try {
      const body = await readBody(req);
      let taskJson = null;
      if (typeof body.json === "string") taskJson = JSON.parse(body.json);
      else if (body.taskJson) taskJson = body.taskJson;
      else taskJson = body;
      const links = incompleteScan.extractLinks(taskJson || {});
      const valid = links.map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
      if (!valid.length) return sendJson(res, 400, { ok: false, error: "导入的任务 json 里没有有效链接" });
      const t = await downloader.startDownloadTask({ mods: valid.map((l) => ({ profileUrl: l })) });
      return sendJson(res, 200, { ok: true, imported: valid.length, started: true, task: t });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "任务 json 解析失败: " + (e.message || String(e)) });
    }
  });

  // ---- 跳过失败项（单条）/ 一键清除失败（全部）（2026-08-26 用户要求加回）----
  route("POST", "/api/skip", async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, 200, downloader.skipItem({ path: body.path, url: body.url }));
  });
  route("POST", "/api/skip-all-failed", (req, res) => sendJson(res, 200, downloader.skipAllFailed()));

  // ---- 未完成任务扫描（#16-A，2026-09-02 用户要求）----
  route("POST", "/api/scan-incomplete", async (req, res) => {
    try {
      const results = await incompleteScan.scanIncomplete();
      const taskJson = incompleteScan.toTaskJson(results);
      const links = incompleteScan.extractLinks(taskJson);
      return sendJson(res, 200, { ok: true, count: results.length, links, taskJson });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message || String(e) });
    }
  });
  route("POST", "/api/scan-incomplete/download", async (req, res) => {
    try {
      const body = await readBody(req);
      const links = Array.isArray(body.links) ? body.links : [];
      const valid = links.map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
      if (!valid.length) return sendJson(res, 400, { ok: false, error: "没有有效的链接" });
      const t = await downloader.startDownloadTask({ mods: valid.map((l) => ({ profileUrl: l })) });
      return sendJson(res, 200, { ok: true, started: true, count: valid.length, task: t });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message || String(e) });
    }
  });
};

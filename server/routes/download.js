// ============================================================
// gbmd - 路由：下载（四步流程 + 任务控制 + 跳过 + 未完成扫描）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

const { createRoute, sendJson, readBody } = require("../framework");
const downloader = require("../lib/downloader");
const gbApi = require("../lib/gb-api");
const incompleteScan = require("../lib/incomplete-scan");

// 模块级 handler 工厂（downloadOrReceive 等）接收 api 依赖对象；
// 模板化后由 framework + 业务模块在本地组装，工厂函数体保持原样。
const api = { sendJson, readBody, downloader, gbApi, incompleteScan };

module.exports = createRoute({


  // ---- 下载（四步流程：生成HTML → 查重归位 → 整理 → 正式下载）----
  // 2026-09-01 参照 iwara：/api/receive 为油猴脚本专用接收口，规整 {url}/{links} 后走同一套下载
  "POST /api/download": downloadOrReceive(api),
  "POST /api/receive": downloadOrReceive(api),

  "POST /api/download-selected": downloadSelected(api),

  "GET /api/task": (req, res) => sendJson(res, { ok: true, task: downloader.getTask() }, 200),
  "POST /api/task/pause": (req, res) => sendJson(res, downloader.pauseTask(), 200),
  "POST /api/task/resume": (req, res) => sendJson(res, downloader.resumeTask(), 200),
  "POST /api/task/stop": (req, res) => sendJson(res, downloader.stopTask(), 200),
  // 2026-09-01 支持单项重试：body 传 { url, path } 只重试匹配项；空 body = 全量重试失败项
  "POST /api/task/retry-failed": async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, downloader.retryFailed(body || {}), 200);
  },
  "POST /api/task/concurrency": async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, downloader.setConcurrency(body.concurrency), 200);
  },
  // 2026-08-27 找回模式开关（不实际下载，只归位/找回/生成 HTML）
  "POST /api/task/restore-mode": async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, downloader.setRestoreMode(body.enabled), 200);
  },
  "GET /api/task/restore-mode": (req, res) => sendJson(res, { ok: true, restoreOnly: downloader.getRestoreMode() }, 200),

  // ---- 下载任务 json 导入/导出（#16-B，2026-09-02）----
  "GET /api/task/export": exportTask(api),
  "POST /api/task/import": importTask(api),

  // ---- 跳过失败项（单条）/ 一键清除失败（全部）（2026-08-26 加回）----
  "POST /api/skip": async (req, res) => {
    const body = await readBody(req);
    return sendJson(res, downloader.skipItem({ path: body.path, url: body.url }), 200);
  },
  "POST /api/skip-all-failed": (req, res) => sendJson(res, downloader.skipAllFailed(), 200),

  // ---- 未完成任务扫描（#16-A，2026-09-02）----
  "POST /api/scan-incomplete": scanIncomplete(api),
  "POST /api/scan-incomplete/download": scanIncompleteDownload(api),
});

// ---- 模块级 handler 工厂：接收 api 解构所需依赖，返回真正的 handler ----

// /api/download 与 /api/receive 共用：规整 {url}/{links} 后启动下载任务
function downloadOrReceive(api) {
  const { sendJson, readBody, downloader } = api;
  return async (req, res, ctx) => {
    const body = await readBody(req);
    let raw = body.links || [];
    if (ctx.pathname === "/api/receive") {
      if (typeof body.url === "string") raw = [body.url];
      else if (Array.isArray(body.urls)) raw = body.urls;
      else if (typeof body.text === "string") raw = body.text.split(/\r?\n/);
      else if (typeof raw === "string") raw = [raw];
    }
    const links = (raw || [])
      .map((s) => String(s).trim())
      .filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
    if (!links.length) return sendJson(res, { ok: false, error: "没有有效的链接" }, 400);
    const t = await downloader.startDownloadTask({ mods: links.map((l) => ({ profileUrl: l })) });
    const out = { ok: true, started: true, task: t };
    if (ctx.pathname === "/api/receive") out.received = links.length;
    return sendJson(res, out, 200);
  };
}

// 勾选下载：前端勾选的 mod 列表启动下载任务
function downloadSelected(api) {
  const { sendJson, readBody, downloader } = api;
  return async (req, res) => {
    const body = await readBody(req);
    const selected = (body.items || []).filter((it) => it && (it.profileUrl || (it.modId && String(it.modId).trim())));
    if (!selected.length) return sendJson(res, { ok: false, error: "没有勾选要下载的 mod" }, 400);
    const t = await downloader.startDownloadTask({
      mods: selected.map((it) => ({ profileUrl: it.profileUrl || String(it.modId) }))
    });
    return sendJson(res, { ok: true, started: true, task: t }, 200);
  };
}

// 导出下载任务为 gbmd-tasks-v1 json（#16-B）
function exportTask(api) {
  const { sendJson, downloader, gbApi } = api;
  return (req, res) => {
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
      return sendJson(res, { ok: true, taskJson }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 500);
    }
  };
}

// 导入 gbmd-tasks-v1 json，提取有效链接启动下载任务（#16-B）
function importTask(api) {
  const { sendJson, readBody, downloader, incompleteScan } = api;
  return async (req, res) => {
    try {
      const body = await readBody(req);
      let taskJson = null;
      if (typeof body.json === "string") taskJson = JSON.parse(body.json);
      else if (body.taskJson) taskJson = body.taskJson;
      else taskJson = body;
      const links = incompleteScan.extractLinks(taskJson || {});
      const valid = links.map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
      if (!valid.length) return sendJson(res, { ok: false, error: "导入的任务 json 里没有有效链接" }, 400);
      const t = await downloader.startDownloadTask({ mods: valid.map((l) => ({ profileUrl: l })) });
      return sendJson(res, { ok: true, imported: valid.length, started: true, task: t }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: "任务 json 解析失败: " + (e.message || String(e)) }, 400);
    }
  };
}

// 未完成任务扫描：返回扫描结果与可导入链接（#16-A）
function scanIncomplete(api) {
  const { sendJson, incompleteScan } = api;
  return async (req, res) => {
    try {
      const results = await incompleteScan.scanIncomplete();
      const taskJson = incompleteScan.toTaskJson(results);
      const links = incompleteScan.extractLinks(taskJson);
      return sendJson(res, { ok: true, count: results.length, links, taskJson }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 500);
    }
  };
}

// 扫描结果直接下载：body.links 校验后启动下载任务（#16-A）
function scanIncompleteDownload(api) {
  const { sendJson, readBody, downloader } = api;
  return async (req, res) => {
    try {
      const body = await readBody(req);
      const links = Array.isArray(body.links) ? body.links : [];
      const valid = links.map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
      if (!valid.length) return sendJson(res, { ok: false, error: "没有有效的链接" }, 400);
      const t = await downloader.startDownloadTask({ mods: valid.map((l) => ({ profileUrl: l })) });
      return sendJson(res, { ok: true, started: true, count: valid.length, task: t }, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: e.message || String(e) }, 500);
    }
  };
}

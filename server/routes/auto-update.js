// ============================================================
// gbmd - 路由：自动更新（/api/auto-update）
// 2026-09-06 新增：服务端代码自动更新 + 优雅重启
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, cfg, autoUpdate } = api;

  // GET /api/auto-update/status
  route("GET", "/api/auto-update/status", (req, res) => {
    const cfgNow = cfg.readConfig();
    const status = autoUpdate.getStatus();
    return sendJson(res, 200, {
      ok: true,
      config: cfgNow.autoUpdate || {},
      status: status
    });
  });

  // POST /api/auto-update/config
  // { enabled, mode, interval, githubRepo?, githubBranch?, githubToken? }
  route("POST", "/api/auto-update/config", async (req, res) => {
    const body = await readBody(req);
    const cfgNow = cfg.readConfig();
    const cur = cfgNow.autoUpdate || {};

    const next = {
      enabled: body.enabled !== undefined ? !!body.enabled : cur.enabled,
      mode: body.mode || cur.mode || "watch",
      interval: body.interval ? parseInt(body.interval, 10) : (cur.interval || 300)
    };
    // github 模式可选字段：保留旧值，body 显式传入才覆盖
    for (const k of ["githubRepo", "githubBranch", "githubToken"]) {
      if (body[k] !== undefined) next[k] = body[k];
      else if (cur[k] !== undefined) next[k] = cur[k];
    }

    cfgNow.autoUpdate = next;
    cfg.writeConfig(cfgNow);

    // 重新启停监控
    autoUpdate.stop();
    autoUpdate.start(next, async () => {
      // 重启回调：保存当前任务状态（已 pause 的任务下次启动自动恢复）
      console.log("[auto-update] 重启回调：任务状态已保存");
    }, (msg) => {
      console.log("[auto-update] " + msg);
    });

    return sendJson(res, 200, { ok: true, autoUpdate: next });
  });

  // POST /api/auto-update/check
  // 手动触发一次 github 模式检查（不等定时轮询）
  route("POST", "/api/auto-update/check", async (req, res) => {
    const cfgNow = cfg.readConfig();
    const au = cfgNow.autoUpdate || {};
    if (!au.enabled || au.mode !== "github") {
      return sendJson(res, 400, { ok: false, error: "仅 github 模式支持手动检查" });
    }
    autoUpdate.checkGitHubUpdate(au);
    return sendJson(res, 200, { ok: true, message: "已触发检查，请稍后查看状态/日志" });
  });

  // POST /api/auto-update/restart
  // 手动触发重启（不依赖文件变更检测）
  route("POST", "/api/auto-update/restart", async (req, res) => {
    autoUpdate.scheduleRestart();
    return sendJson(res, 200, { ok: true, message: "2 秒后重启" });
  });
};

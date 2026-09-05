// ============================================================
// gbmd - 路由：设置（config.json：gbCookie/并发/会话时长/端口/默认下载路径/开关）
// P1 从 app.js 拆分。bug#6：写 gbCookie 时 cleanCookie 清洗脏值。
// ============================================================
"use strict";

// 脱敏：不回传密码哈希/盐与 gbCookie 明文，用 hasGbCookie 表示是否已配置
function publicSettings(c) {
  const { passwordHash, passwordSalt, gbCookie, ...safe } = c;
  return Object.assign({}, safe, {
    hasGbCookie: !!(gbCookie && String(gbCookie).trim())
  });
}

module.exports = function register(api) {
  const { route, routePublic, sendJson, readBody, cfg, cleanCookie } = api;

  // GET /api/status（公开，任意方法）
  routePublic("*", "/api/status", (req, res) => {
    const cfgNow = cfg.readConfig();
    return sendJson(res, 200, { ok: true, needsSetup: !cfgNow.passwordHash, needsAuth: !!cfgNow.passwordHash });
  });

  // GET /api/settings
  route("GET", "/api/settings", (req, res) => {
    return sendJson(res, 200, { ok: true, settings: publicSettings(cfg.readConfig()) });
  });

  // POST /api/settings
  // 2026-09-01 参照 iwara-downloader-server：设置接口脱敏（不回传 gbCookie 明文）、
  // 敏感字段空串跳过不覆盖（留空 = 不改）、支持油猴/手填的「Cookie=...」组合文本。
  route("POST", "/api/settings", async (req, res) => {
    const body = await readBody(req);
    const cfgNow = cfg.readConfig();
    // bug#6 写时清洗：兼容油猴组合文本「Cookie=...」+ JSON 脏值 '{"cookie":"..."}'
    if (typeof body.gbCookie === "string") {
      const cleaned = cleanCookie(body.gbCookie);
      if (cleaned) body.gbCookie = cleaned; // 非空才写，避免空值覆盖
    }
    // 【原代码】const allowed = ["gbCookie", "downloadConcurrency", "sessionHours", "port", "defaultDownloadPath"];
    // 【改为】2026-09-03 用户原话：「这两项我想给现在的server版本加回去」——允许写 downloadToggles
    const allowed = ["gbCookie", "downloadConcurrency", "sessionHours", "port", "defaultDownloadPath", "downloadToggles"];
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      // 敏感字段（gbCookie）为空串时跳过不覆盖：留空 = 不改
      if (k === "gbCookie" && String(body[k]).trim() === "") continue;
      // 下载内容开关只存 files/images 两个布尔，其它字段丢掉
      if (k === "downloadToggles") {
        cfgNow[k] = cfg.normalizeDownloadToggles(body[k]);
        continue;
      }
      cfgNow[k] = body[k];
    }
    cfg.writeConfig(cfgNow);
    return sendJson(res, 200, { ok: true, settings: publicSettings(cfg.readConfig()) });
  });
};

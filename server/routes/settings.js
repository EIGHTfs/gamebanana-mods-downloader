// ============================================================
// gbmd - 路由：设置（config.json：gbCookie/并发/会话时长/端口/默认下载路径/开关）
// 模板化：createRoute 表式导出（"METHOD /path": handler）
// ============================================================
"use strict";

const { createRoute, sendJson, readBody, cleanCookie } = require("../core/index.js");
const cfg = require("../config");

// 脱敏：不回传密码哈希/盐与 gbCookie 明文，用 hasGbCookie 表示是否已配置
function publicSettings(c) {
  const { passwordHash, passwordSalt, gbCookie, ...safe } = c;
  return Object.assign({}, safe, {
    hasGbCookie: !!(gbCookie && String(gbCookie).trim())
  });
}

module.exports = createRoute({
  // GET /api/settings（脱敏后的当前配置）
  "GET /api/settings": (req, res) => {
    return sendJson(res, { ok: true, settings: publicSettings(cfg.readConfig()) }, 200);
  },

  // POST /api/settings
  // 设置接口脱敏（不回传 gbCookie 明文）、敏感字段空串跳过不覆盖（留空 = 不改）、
  // 支持油猴/手填的「Cookie=...」组合文本。
  "POST /api/settings": async (req, res) => {
    const body = await readBody(req);
    const cfgNow = cfg.readConfig();
    // 写时清洗：兼容油猴组合文本「Cookie=...」+ JSON 脏值 '{"cookie":"..."}'
    if (typeof body.gbCookie === "string") {
      const cleaned = cleanCookie(body.gbCookie);
      if (cleaned) body.gbCookie = cleaned; // 非空才写，避免空值覆盖
    }
    // 2026-09-11 bugfix：GB 会话绑定登录浏览器完整 UA（OS+版本号全部一致），
    // gbUserAgent 必须允许前端写入，否则 UA 不匹配时 /api/gb-login-status 始终返回未登录
    // 2026-09-13：sessionRememberHours=记住设备会话时长（默认720h），允许设置页调整
    const allowed = ["gbCookie", "gbUserAgent", "downloadConcurrency", "sessionHours", "sessionRememberHours", "port", "defaultDownloadPath", "downloadToggles"];
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
    return sendJson(res, { ok: true, settings: publicSettings(cfg.readConfig()) });
  },
});

// 公开路由（未登录可访问）：由 app.js 组装到 publicRoutes 白名单
module.exports.public = createRoute({
  // GET /api/status（任意方法；框架按 method 匹配，故同时注册 GET/POST）
  "GET /api/status": (req, res) => {
    const cfgNow = cfg.readConfig();
    return sendJson(res, { ok: true, needsSetup: !cfgNow.passwordHash, needsAuth: !!cfgNow.passwordHash });
  },
  "POST /api/status": (req, res) => {
    const cfgNow = cfg.readConfig();
    return sendJson(res, { ok: true, needsSetup: !cfgNow.passwordHash, needsAuth: !!cfgNow.passwordHash });
  },
});

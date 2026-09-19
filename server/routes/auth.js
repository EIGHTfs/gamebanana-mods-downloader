// ============================================================
// gbmd - 路由：认证（登录 / 登出 / 改密）
// 模板化：createRoute 表式导出；登录/登出为公开路由（module.exports.public）
// ============================================================
"use strict";

const { createRoute, sendJson, readBody, auth } = require("../core/index.js");
const cfg = require("../config");

// 会话 cookie：Max-Age 与 session 有效期一致（勾选「记住此设备」签长会话）
function setSessionCookie(res, token, hours) {
  const cfgNow = cfg.readConfig();
  const maxAge = (hours != null ? hours : (cfgNow.sessionHours || 72)) * 3600;
  res.setHeader("Set-Cookie", `${auth.cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

// POST /api/login：未设密码直接放行（仅提示）；已设密码校验 scrypt 哈希
async function handleLogin(req, res) {
  const body = await readBody(req);
  const cfgNow = cfg.readConfig();
  // 勾选「记住此设备」签长会话（默认 720h），不勾沿用 config.sessionHours（默认 72h）
  const rememberHours = cfgNow.sessionRememberHours || 720;
  const hours = body.remember ? rememberHours : (cfgNow.sessionHours || 72);
  if (!cfgNow.passwordHash) {
    // 初次未设密码 → 只警告，直接视为登录成功（可正常使用）
    const { token } = auth.createSession({ hours });
    setSessionCookie(res, token, hours);
    return sendJson(res, { ok: true, noPassword: true, message: "未设置访问密码，可直接使用（建议尽快设置）" }, 200);
  }
  if (cfg.verifyPassword(body.password || "", cfgNow.passwordHash, cfgNow.passwordSalt)) {
    const { token } = auth.createSession({ hours });
    setSessionCookie(res, token, hours);
    return sendJson(res, { ok: true }, 200);
  }
  return sendJson(res, { ok: false, error: "密码错误" }, 401);
}

async function handleLogout(req, res) {
  auth.destroySession(auth.extractToken(req));
  res.setHeader("Set-Cookie", `${auth.cookieName()}=; Path=/; HttpOnly; Max-Age=0`);
  return sendJson(res, { ok: true }, 200);
}

// 需鉴权路由：改密
module.exports = createRoute({
  // POST /api/change-password
  "POST /api/change-password": async (req, res) => {
    const body = await readBody(req);
    if (!body.password || String(body.password).length < 4) {
      return sendJson(res, { ok: false, error: "密码至少 4 位" }, 400);
    }
    // 已设密码时改密必须验旧密码（防被盗 session 锁死原主）；未设密码（首次设置）无需旧密码
    const cfgNow = cfg.readConfig();
    if (cfgNow.passwordHash && !cfg.verifyPassword(body.oldPassword || "", cfgNow.passwordHash, cfgNow.passwordSalt)) {
      return sendJson(res, { ok: false, error: "旧密码错误" }, 403);
    }
    cfg.setPassword(body.password);
    return sendJson(res, { ok: true }, 200);
  },
});

// 公开路由（未登录可访问）：app.js 组装到 createServer 的 publicRoutes
module.exports.public = createRoute({
  "POST /api/login": handleLogin,
  "POST /api/logout": handleLogout,
});

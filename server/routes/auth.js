// ============================================================
// gbmd - 路由：认证（登录 / 登出 / 改密）
// P1 从 app.js 拆分。登录/登出为公开路由，改密需鉴权。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, routePublic, sendJson, readBody, cfg, auth, setSessionCookie } = api;

  // POST /api/login
  routePublic("POST", "/api/login", async (req, res) => {
    const body = await readBody(req);
    const cfgNow = cfg.readConfig();
    if (!cfgNow.passwordHash) {
      // 2026-08-26：初次未设密码 → 只警告，直接视为登录成功（可正常使用）
      const token = await auth.createSession(cfgNow.sessionHours || 72);
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, noPassword: true, message: "未设置访问密码，可直接使用（建议尽快设置）" });
    }
    if (cfg.verifyPassword(body.password || "", cfgNow.passwordHash, cfgNow.passwordSalt)) {
      const token = await auth.createSession(cfgNow.sessionHours || 72);
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 401, { ok: false, error: "密码错误" });
  });

  // POST /api/logout
  routePublic("POST", "/api/logout", async (req, res) => {
    await auth.destroySession(auth.extractToken(req));
    res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  });

  // POST /api/change-password
  route("POST", "/api/change-password", async (req, res) => {
    const body = await readBody(req);
    if (!body.password || String(body.password).length < 4) {
      return sendJson(res, 400, { ok: false, error: "密码至少 4 位" });
    }
    // bug#5：已设密码时改密必须验旧密码（防被盗 session 锁死原主）；未设密码（首次设置）无需旧密码
    const cfgNow = cfg.readConfig();
    if (cfgNow.passwordHash && !cfg.verifyPassword(body.oldPassword || "", cfgNow.passwordHash, cfgNow.passwordSalt)) {
      return sendJson(res, 403, { ok: false, error: "旧密码错误" });
    }
    cfg.setPassword(body.password);
    return sendJson(res, 200, { ok: true });
  });
};

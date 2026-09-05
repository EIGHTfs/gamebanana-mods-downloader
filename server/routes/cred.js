// ============================================================
// gbmd - 路由：凭证（GB 登录态检测 / cred 明文回传）
// P1 从 app.js 拆分。bug#6：读时 cleanCookie 清洗脏值。
// ============================================================
"use strict";

// 凭证明细（只算元数据，不回传明文）：字符数/项数/各字段有无
function gbCookieCred(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return { cookieChars: 0, cookieItems: 0, hasSess: false, hasRmc: false };
  const items = s0.split(";").map((x) => x.trim()).filter(Boolean);
  return {
    cookieChars: s0.length,
    cookieItems: items.length,
    hasSess: items.some((x) => /^sess=/i.test(x)),
    hasRmc: items.some((x) => /^rmc=/i.test(x))
  };
}

module.exports = function register(api) {
  const { route, sendJson, cfg, gbApi, cleanCookie } = api;

  // GET /api/gb-login-status
  // 2026-09-01 改用官方前端真实会话端点 apiv13（从官方前端 JS 反编译确认）：
  //   GET /apiv13/Member/UiConfig?_sUrl=%2F  →  _bIsLoggedIn、_idMemberRow
  //   GET /apiv13/Member/{id}/ProfilePage    →  _sName、_sProfileUrl
  route("GET", "/api/gb-login-status", async (req, res) => {
    const cfgNow = cfg.readConfig();
    const cookie = cleanCookie(cfgNow.gbCookie); // bug#6 读时清洗
    if (!cookie) {
      return sendJson(res, 200, { ok: true, configured: false, loggedIn: false, cookieSet: false, warnLevel: "err", cred: gbCookieCred(""), detail: "未配置 gbCookie" });
    }
    try {
      // 2026-09-01 用带响应头的 fetch：解析 Set-Cookie 里 rmc 的 Expires 算剩余天数
      const { json: uicfg, setCookies } = await gbApi.fetchJsonHeaders("https://gamebanana.com/apiv13/Member/UiConfig?_sUrl=%2F", {}, 1);
      const loggedIn = !!(uicfg && uicfg._bIsLoggedIn);
      // rmc = remember-me cookie，服务端每次请求会刷新并带 Expires；sess 是会话 cookie 无固定到期
      let expiresAt = 0;
      let remainingDays = null;
      for (const sc of setCookies || []) {
        const m = /^rmc=/i.test(String(sc)) ? sc.match(/Expires=([^;]+)/i) : null;
        if (m) {
          const t = Date.parse(m[1]);
          if (!isNaN(t)) { expiresAt = t; remainingDays = Math.ceil((t - Date.now()) / 86400000); }
        }
      }
      if (!loggedIn) {
        return sendJson(res, 200, { ok: true, configured: true, loggedIn: false, cookieSet: true,
          expiresAt, remainingDays, warnLevel: remainingDays !== null && remainingDays < 0 ? "expired" : "err",
          cred: gbCookieCred(cookie),
          detail: "未登录（会话失效或 Cookie 不完整；GameBanana 会话含 HttpOnly cookie，需用浏览器 DevTools 或油猴 GM_cookie 复制完整 Cookie）" });
      }
      const idRow = uicfg._idMemberRow || 0;
      let username = "";
      let profileUrl = "";
      if (idRow) {
        try {
          const prof = await gbApi.fetchJson(`https://gamebanana.com/apiv13/Member/${idRow}/ProfilePage`, {}, 1);
          username = (prof && prof._sName) || "";
          profileUrl = (prof && prof._sProfileUrl) || "";
        } catch (_) {}
      }
      // warnLevel：剩 ≤7 天 → warn；已过期 → expired；否则 ok
      const warnLevel = remainingDays !== null && remainingDays < 0 ? "expired" : (remainingDays !== null && remainingDays <= 7 ? "warn" : "ok");
      const dayTxt = remainingDays !== null ? `，剩 ${remainingDays} 天` : "";
      return sendJson(res, 200, { ok: true, configured: true, loggedIn: true, cookieSet: true,
        username, idRow, profileUrl, expiresAt, remainingDays, warnLevel,
        cred: gbCookieCred(cookie),
        detail: username ? `已登录：${username}${dayTxt}` : `已登录（用户 id ${idRow}）` });
    } catch (e) {
      return sendJson(res, 200, { ok: true, configured: true, loggedIn: false, cookieSet: true, warnLevel: "err", cred: gbCookieCred(cookie), detail: "检测失败: " + (e.message || String(e)) });
    }
  });

  // GET /api/cred（明文回传，油猴「🔄 注入登录态到浏览器」用；明文直传，需登录会话）
  route("GET", "/api/cred", (req, res) => {
    const cfgNow = cfg.readConfig();
    return sendJson(res, 200, {
      ok: true,
      cookie: cleanCookie(cfgNow.gbCookie), // bug#6 读时清洗
      userAgent: String(cfgNow.gbUserAgent || "")
    });
  });
};

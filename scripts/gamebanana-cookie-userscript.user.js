// ==UserScript==
// @name         GameBanana 下载助手（Cookie + 一键发送到服务器）
// @namespace    gbmd-cred
// @version      4.5.0
// @description  右下角 🍌 面板：显示 GameBanana 登录态/用户名/剩余天数、复制完整 Cookie（含 HttpOnly，sess+rmc）；「📤 发送到服务器」把当前 mod 页链接一键推给 GameBanana Mod Downloader 下载（设了密码会自动用保存的密码登录）；「🔄 注入登录态到浏览器」把服务器保存的 Cookie 写回当前浏览器（GM_cookie 双域写入）；自动同步浏览器 UA 到服务器（GB 会话绑定完整 UA）
// @author       EIGHTfs
// @match        https://gamebanana.com/*
// @match        https://www.gamebanana.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_cookie.list
// @grant        GM_cookie.set
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// @noframes
// @license      MIT
// ==/UserScript==

/* ============================================================
 * 本文件由模板组装生成，请勿手改。
 *   模板: templates/userscript/cookie-fetch/
 *   项目: templates/_downloader/_gamebanana-mods/userscript/
 *   组装: node scripts/build-userscript.js <项目目录> <输出>
 * ============================================================ */
(function () { // dsh-skip-func-length 油猴脚本标准 IIFE 包裹（模板组装，全脚本一体，不可按行拆分）
    "use strict";

    // ---- 项目配置（来自 00-config.json；命名带前缀避免与脚本自有 CFG 冲突）----
    const __US_CFG = {
    "templateDir": "templates/userscript/cookie-fetch",
    "name": "GameBanana 下载助手（Cookie + 一键发送到服务器）",
    "namespace": "gbmd-cred",
    "version": "4.5.0",
    "description": "右下角 🍌 面板：显示 GameBanana 登录态/用户名/剩余天数、复制完整 Cookie（含 HttpOnly，sess+rmc）；「📤 发送到服务器」把当前 mod 页链接一键推给 GameBanana Mod Downloader 下载（设了密码会自动用保存的密码登录）；「🔄 注入登录态到浏览器」把服务器保存的 Cookie 写回当前浏览器（GM_cookie 双域写入）；自动同步浏览器 UA 到服务器（GB 会话绑定完整 UA）",
    "author": "EIGHTfs",
    "match": [
        "https://gamebanana.com/*",
        "https://www.gamebanana.com/*"
    ],
    "IDP": "gbcred-",
    "IDP_BARE": "gbcred",
    "STORE_PREFIX": "gbcred:",
    "LOG_TAG": "gb-cred",
    "SITE_DOMAIN": "gamebanana.com",
    "SITE_DOMAINS": "gamebanana.com,www.gamebanana.com",
    "SITE_NAME": "GameBanana",
    "NOTIFY_TITLE": "GameBanana 凭证",
    "ICON": "data:image/png;base64,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",
    "VER": "4.5.0",
    "SRV_KEY": "gbcred_server",
    "SRV_PWD_KEY": "gbcred_server_pwd",
    "SRV_LIST_KEY": "gbcred_server_list"
};

    const VER = "4.5.0";
    const GB_ICON = "data:image/png;base64,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";
    const SRV_KEY = "gbcred_server";      // 当前选中的服务器地址
    const SRV_PWD_KEY = "gbcred_server_pwd"; // 当前选中的访问密码
    const SRV_LIST_KEY = "gbcred_server_list";

/* ============================================================
 * Iwara 下载助手（油猴）
 *
 * 职责分工：
 *   0. Iwara 是 SPA：脚本只在整页刷新时注入一次。UI 挂在 <html> 上，
 *      换视频/换页不重建、不重拉账号（账号缓存 5 分钟）
 *   1. 点右下角图标立刻弹出面板（同步，不读 Cookie、不发请求）
 *   2. 后台 GET {服务器}/api/account-check
 *      - 能读到 = 服务器在线
 *      - 返回的用户名/id/到期提醒就是网页「检测登录状态」那串
 *   3. 服务器已登录：面板只留「发送视频 + 账号信息」，不展示本机 Cookie/Token
 *   4. 服务器没有凭证：才 GM_cookie 采集，POST /api/settings 回传保存
 *   5. 发送视频：只 POST /api/receive { url }，服务器自己解析下载，不读 Cookie
 *
 * Chrome Tampermonkey 没有 GM_cookie，读不到 HttpOnly 的 cf_clearance。
 * 需要完整 Cookie 时请用 Violentmonkey 或 Firefox Tampermonkey。
 * ============================================================ */

    function ls(key) { try { return localStorage.getItem(key) || ""; } catch (_) { return ""; } }
    function log(...a) { try { console.log("[gb-cred " + VER + "]", ...a); } catch (_) {} }

    /** 解析 JWT exp（秒）→ 毫秒时间戳。access_token 只有约 1 小时，登录到期看 refresh_token。 */
    function storeGet(key) {
        try {
            if (typeof GM_getValue === "function") {
                const v = GM_getValue(key, "");
                if (v !== undefined && v !== null && String(v).trim()) return String(v);
            }
        } catch (_) {}
        try {
            const v = localStorage.getItem("gbcred:" + key);
            if (v && String(v).trim()) return String(v);
        } catch (_) {}
        return "";
    }
    function storeSet(key, val) {
        const s = String(val || "");
        try { if (typeof GM_setValue === "function") GM_setValue(key, s); } catch (_) {}
        try {
            if (s) localStorage.setItem("gbcred:" + key, s);
            else localStorage.removeItem("gbcred:" + key);
        } catch (_) {}
    }

    function normalizeServerBase(url) {
        let s = String(url || "").trim();
        if (!s) return "";
        s = s.replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(s)) s = "http://" + s;
        return s;
    }
    function loadServerList() {
        let list = [];
        try { list = JSON.parse(storeGet(SRV_LIST_KEY) || "[]"); } catch (_) { list = []; }
        if (!Array.isArray(list)) list = [];
        list = list.map((it) => ({ url: normalizeServerBase(it && it.url), password: String((it && it.password) || "") })).filter((it) => it.url);
        const seen = new Set();
        const uniq = [];
        for (const it of list) { if (seen.has(it.url)) continue; seen.add(it.url); uniq.push(it); }
        const legacy = normalizeServerBase(storeGet(SRV_KEY));
        if (legacy && !uniq.some((it) => it.url === legacy)) {
            uniq.unshift({ url: legacy, password: storeGet(SRV_PWD_KEY) });
            saveServerList(uniq);
        }
        return uniq;
    }
    function saveServerList(list) { storeSet(SRV_LIST_KEY, JSON.stringify(list || [])); }
    function currentServer() {
        const list = loadServerList();
        const sel = normalizeServerBase(storeGet(SRV_KEY));
        return list.find((it) => it.url === sel) || list[0] || null;
    }
    function fillServerSelect() {
        const sel = panelEl && panelEl.querySelector("#gbcred-server");
        if (!sel) return;
        const list = loadServerList();
        const cur = currentServer();
        sel.innerHTML = "";
        if (!list.length) {
            const o = document.createElement("option");
            o.value = ""; o.textContent = "尚未添加服务端";
            sel.appendChild(o); return;
        }
        for (const it of list) {
            const o = document.createElement("option");
            o.value = it.url; o.textContent = it.url;
            sel.appendChild(o);
        }
        sel.value = cur ? cur.url : list[0].url;
        if (cur) { storeSet(SRV_KEY, cur.url); storeSet(SRV_PWD_KEY, cur.password); }
    }
    function addServerFromForm() {
        const url = normalizeServerBase(panelEl.querySelector("#gbcred-url-new").value);
        const password = panelEl.querySelector("#gbcred-pwd-new").value || "";
        if (!url) { srvSetStatus("请填写服务器地址", "err"); return; }
        const list = loadServerList();
        if (list.some((it) => it.url === url)) { srvSetStatus("已存在该地址", "err"); return; }
        list.push({ url, password });
        saveServerList(list);
        storeSet(SRV_KEY, url);
        storeSet(SRV_PWD_KEY, password);
        panelEl.querySelector("#gbcred-add-form").style.display = "none";
        fillServerSelect();
        srvSetStatus("已添加 " + url, "ok");
        openPanel();
    }
    function deleteSelectedServer() {
        const sel = panelEl.querySelector("#gbcred-server");
        const url = sel && sel.value;
        if (!url) { srvSetStatus("没有可删除的服务端", "err"); return; }
        const list = loadServerList().filter((it) => it.url !== url);
        saveServerList(list);
        const next = list[0] || { url: "", password: "" };
        storeSet(SRV_KEY, next.url);
        storeSet(SRV_PWD_KEY, next.password);
        fillServerSelect();
        srvSetStatus("已删除 " + url, "ok");
        openPanel();
    }

    /** 读本机 Cookie：GM_cookie 优先（含 HttpOnly 项），不可用时回退 document.cookie。
     *  【差异取优合并】到期计算取 iwara 侧（cf_clearance > 各 cookie 最早到期 > token exp），
     *  诊断文案取 gbmd 侧（diag 说明为什么读不到：未装 GM_cookie / 未授权 / 返回 0 个），
     *  这样「读不到」时用户能直接看到原因，而不是只看到一段空文本。 */
    function readCookieGM() {
        return new Promise((resolve) => {
            const fallback = (why) => {
                const text = document.cookie || "";
                const tokenExp = jwtExpMs(ls("token"));
                resolve({
                    text,
                    count: text ? text.split(";").filter(Boolean).length : 0,
                    source: "document.cookie",
                    diag: why || "GM_cookie 不可用，回退 document.cookie（HttpOnly 项读不到）",
                    expiresAt: tokenExp || (Date.now() + 6 * 3600 * 1000),
                    fetchedAt: Date.now()
                });
            };
            try {
                if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") {
                    return fallback("GM_cookie 未定义（Chrome Tampermonkey 读不到 HttpOnly；请用 Violentmonkey 或 Firefox Tampermonkey）");
                }
                GM_cookie.list({}, (cookies, error) => {
                    if (error) { log("GM_cookie.list error:", error); return fallback("GM_cookie.list 报错：" + JSON.stringify(error)); }
                    if (!Array.isArray(cookies)) return fallback("GM_cookie.list 返回非数组");
                    if (cookies.length === 0) return fallback("GM_cookie.list 返回 0 个（可能未授予 cookie 权限）");
                    const hit = cookies.filter((c) => c && c.domain && String(c.domain).indexOf("gamebanana.com") >= 0);
                    const listSrc = hit.length > 0 ? hit : cookies;
                    const list = listSrc.map((c) => (c && c.name) ? c.name + "=" + (c.value || "") : "").filter(Boolean);
                    const text = list.join("; ");
                    const exps = listSrc.map((c) => toMs(c && c.expirationDate)).filter((n) => n > Date.now());
                    const cf = listSrc.find((c) => c && c.name === "cf_clearance");
                    const cfExp = toMs(cf && cf.expirationDate);
                    const tokenExp = jwtExpMs(ls("token"));
                    let expiresAt = 0;
                    if (cfExp) expiresAt = cfExp;
                    else if (exps.length) expiresAt = Math.min.apply(null, exps);
                    else if (tokenExp) expiresAt = tokenExp;
                    else expiresAt = Date.now() + 6 * 3600 * 1000;
                    resolve({
                        text,
                        count: list.length,
                        source: "GM_cookie（" + listSrc.length + " 个）",
                        diag: "OK",
                        expiresAt,
                        fetchedAt: Date.now()
                    });
                });
            } catch (e) { log("GM_cookie exception:", e); fallback("GM_cookie 异常：" + (e && e.message || e)); }
        });
    }

    /** 仅复制/回传/服务器没凭证时调用。force=true 无视缓存。 */
    function gmRequest(method, url, body, timeout, extraHeaders) {
        return new Promise((resolve) => {
            try {
                if (typeof GM_xmlhttpRequest !== "function") {
                    return resolve({ ok: false, error: "无 GM_xmlhttpRequest 权限" });
                }
                GM_xmlhttpRequest({
                    method,
                    url,
                    timeout: timeout || 8000,
                    data: body !== undefined ? JSON.stringify(body) : undefined,
                    headers: Object.assign(body !== undefined ? { "Content-Type": "application/json" } : {}, extraHeaders || {}),
                    onload: (r) => {
                        let j = null;
                        try { j = JSON.parse(r.responseText); } catch (_) {}
                        let setCookie = "";
                        try {
                            const hdrs = r.responseHeaders || "";
                            // 会话 cookie 名可能带项目前缀（如 <项目>_session —— 同机多项目各用一名，
                            // 避免 iwara/gbmd/gallery 互相覆盖会话）。这里连名字一起取，存完整 name=value，
                            // 后续请求头直接可用；同时兼容旧的无前缀 session。
                            const m = hdrs.match(/Set-Cookie:\s*([A-Za-z0-9_-]*session)=([^;\s]+)/i);
                            if (m) setCookie = m[1] + "=" + m[2];
                        } catch (_) {}
                        resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: j, text: r.responseText, error: "", setCookie });
                    },
                    onerror: (r) => resolve({ ok: false, status: r.status, json: null, text: "", error: r.error || "网络错误" }),
                    ontimeout: () => resolve({ ok: false, status: 0, json: null, text: "", error: "超时" })
                });
            } catch (e) {
                resolve({ ok: false, status: 0, json: null, text: "", error: String(e.message || e) });
            }
        });
    }

    /** GET /api/status，不需要登录。用来判断 needsAuth。 */
    async function probeServer(url) {
        const base = normalizeServerBase(url);
        if (!base) return { ok: false, error: "地址无效", base };
        const r = await gmRequest("GET", base + "/api/status", undefined, 4000);
        if (r.ok && r.json && r.json.ok) return { ok: true, status: r.json, base };
        // 兜底文案说清「连上了但响应不合预期」，别只报 HTTP 200 让人误以为成功
        return { ok: false, error: (r.json && r.json.error) || r.error || ("服务器响应异常（HTTP " + r.status + "，非 /api/status 预期 JSON）"), base };
    }

    /** 用 GM_cookie 读服务器会话 cookie（部分管理器不支持 GM_cookie，返回空串） */
    function readServerSession(base) {
        return new Promise((resolve) => {
            try {
                if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") return resolve("");
                GM_cookie.list({ url: base }, (cookies, error) => {
                    if (error || !Array.isArray(cookies)) return resolve("");
                    const hit = cookies.find((c) => /session$/i.test(String(c.name || "")));
                    resolve(hit ? hit.name + "=" + hit.value : "");
                });
            } catch (_) { resolve(""); }
        });
    }

    async function serverLogin(base, password) {
        const r = await gmRequest("POST", base + "/api/login", { password }, 8000);
        // ── 2026-10-08 修 bug ──────────────────────────────────────────────
        // 现象：服务器设了密码时，油猴面板「添加密码」后报
        //   「❌ 服务器设有密码：HTTP 200（在上方填访问密码）」，密码明明是对的。
        // 根因：旧逻辑要求从**响应头解析 Set-Cookie** 才算登录成功；而脚本管理器
        //   （Tampermonkey/Violentmonkey）默认隐藏响应头的 Set-Cookie → r.setCookie 永远为空
        //   → 密码正确也被判失败（服务端此时确实返回 200 + {ok:true}）。
        // 修法：会话按优先级取，任何一种拿得到就算成功——
        //   ① 响应体里的 token + cookieName（服务端 /api/login 已回传，任何管理器都拿得到）
        //   ② 响应头 Set-Cookie（少数管理器可见）
        //   ③ GM_cookie 读服务器会话 cookie（Violentmonkey / Firefox Tampermonkey）
        //   ④ 都不行：裸请求 /api/status，若 authed=true 说明浏览器 cookie jar 已带上会话
        if (r.status === 401) return { ok: false, error: "密码错误（服务器访问密码不对）" };
        if (!r.ok) return { ok: false, error: (r.json && r.json.error) || r.error || ("HTTP " + r.status) };
        const j = r.json || {};
        let session = "";
        if (j.token) session = (j.cookieName || "session") + "=" + j.token;
        if (!session && r.setCookie) session = r.setCookie;
        if (!session) session = await readServerSession(base);
        if (session) return { ok: true, session };
        const st = await gmRequest("GET", base + "/api/status", undefined, 4000);
        if (st.ok && st.json && st.json.authed) return { ok: true, session: "" };
        return { ok: false, error: "登录成功但拿不到会话：脚本管理器隐藏了 Set-Cookie，且服务端未回传 token（请把服务端与脚本都更新到同一版本）" };

        // ── 旧逻辑（保留备查，勿删）──────────────────────────────────────
        // if (r.ok && r.setCookie) return { ok: true, session: r.setCookie };
        // if (r.status === 401) return { ok: false, error: "密码错误（服务器访问密码不对）" };
        // // 登录 2xx 却拿不到会话 cookie：多半是服务端换了会话 cookie 名或响应头格式变了，
        // // 明确报出来，别让它退化成含糊的「HTTP 200」。
        // if (r.ok) return { ok: false, error: "登录成功但未取到会话 cookie（服务端会话名可能已变，请更新脚本）" };
        // return { ok: false, error: (r.json && r.json.error) || r.error || ("HTTP " + r.status) };
    }

    /** 复制到剪贴板：GM_setClipboard 优先，退 navigator.clipboard。
     *  【差异取优合并】提示统一走面板内 showToast（gbmd 侧做法，面板里能看见），
     *  不再用页面级 GM_notification —— 两条提示路径并存时行为不一致（一个在系统通知、一个在面板）。 */
    function copyText(text, okMsg) {
        return new Promise((resolve) => {
            const done = () => { if (okMsg) showToast(okMsg); resolve(true); };
            try {
                if (typeof GM_setClipboard === "function") {
                    GM_setClipboard(text, { type: "text", mimetype: "text/plain" });
                    done(); return;
                }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, () => resolve(false));
                    return;
                }
            } catch (_) {}
            resolve(false);
        });
    }

    function injectStyle() {
        if (document.getElementById("gbcred-style")) return;
        const style = document.createElement("style");
        style.id = "gbcred-style";
        style.textContent = PANEL_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    let fabEl, panelEl, toastEl;
    let credRefreshing = false;
    let lastAccount = { at: 0, data: null };
    let lastHref = "";
    let spaHooked = false;

    /** 挂到 <html>，避开 SPA 替换 <body> 把按钮带走。 */
    function showToast(msg) {
        if (!ensureUi()) return;
        toastEl.textContent = msg;
        toastEl.style.display = "block";
        setTimeout(() => { toastEl.style.display = "none"; }, 4000);
    }
    function srvSetStatus(msg, cls) {
        if (!panelEl) return;
        const el = panelEl.querySelector("#gbcred-srv-status");
        if (!el) return;
        el.textContent = msg;
        el.className = "srv" + (cls ? " " + cls : "");
        if (cls !== "info") setTimeout(() => { el.textContent = ""; el.className = ""; }, 6000);
    }
    function srvInput() { return panelEl ? panelEl.querySelector("#gbcred-server") : null; }

    /** 秒/毫秒时间戳归一化为毫秒（各项目到期时间格式不一，统一成毫秒）。 */
    function toMs(n) {
        n = Number(n) || 0;
        if (n <= 0) return 0;
        return n < 1e12 ? n * 1000 : n;
    }

    /** 解析 JWT 的 exp（毫秒）；非 JWT 或解析失败返回 0（不用 JWT 的项目自然得 0）。 */
    function jwtExpMs(token) {
        try {
            const p = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            return p && p.exp ? p.exp * 1000 : 0;
        } catch (_) { return 0; }
    }

    /** 会话串 → 请求头。会话串已是完整 name=value（gmRequest 解析 Set-Cookie 时连 cookie 名一起取），
     *  直接用作 Cookie 头——不再拼 "session="，否则会话名带项目前缀（如 gbmd_session）时服务端认不出。 */
    function sessionHeaders(session) {
        return session ? { Cookie: session } : {};
    }

    async function fetchServerCreds(base, session) {
        const r = await gmRequest("GET", base + "/api/cred", undefined, 12000, sessionHeaders(session));
        if (!r.ok || !r.json || !r.json.ok) return { ok: false, error: (r.json && r.json.error) || r.error || ("HTTP " + r.status) };
        return { ok: true, cred: r.json };
    }

    /** 把 Cookie 项写回浏览器：document.cookie 写当前域，GM_cookie.set 兜底 HttpOnly 项。
     *  【差异取优合并】站点可能有多个域（主域与 www 子域都要写回），
     *  域列表取配置 SITE_DOMAINS（逗号分隔）；单域项目照常工作（gbmd 侧的多域写法下沉到内核）。 */
    function applyCookieToBrowser(cookieText) {
        const items = String(cookieText || "").split(";").map((s) => s.trim()).filter((p) => p && !/^=/.test(p) && !/deleted/i.test(p));
        const hosts = String("gamebanana.com,www.gamebanana.com").split(",").map((s) => s.trim()).filter(Boolean);
        let written = 0;
        for (const item of items) {
            const eq = item.indexOf("=");
            if (eq <= 0) continue;
            const name = item.slice(0, eq).trim();
            const value = item.slice(eq + 1).trim();
            if (!name || !value) continue;
            try { document.cookie = name + "=" + value + "; path=/"; written++; } catch (_) {}
            // HttpOnly（如 cf_clearance / sess / rmc）document.cookie 写不进，用 GM_cookie.set 逐域兜底
            if (typeof GM_cookie !== "undefined" && GM_cookie && typeof GM_cookie.set === "function") {
                for (const host of hosts) {
                    try {
                        GM_cookie.set({ url: "https://" + host + "/", name, value, path: "/" }, () => {});
                    } catch (_) {}
                }
            }
        }
        return written;
    }

    /** 注入主流程：GET /api/cred → 写 cookie + localStorage，提示刷新。 */

    /** 面板样式（独立片段承载：CSS 体量大，放常量里便于项目覆盖与审阅） */
    const PANEL_CSS = `
#gbcred-fab{position:fixed;right:14px;bottom:14px;z-index:2147483647;width:56px;height:56px;border-radius:50%;
  padding:0;border:none;cursor:pointer;overflow:hidden;background:#fff;
  box-shadow:0 4px 16px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent;pointer-events:auto}
#gbcred-fab img{width:100%;height:100%;display:block;object-fit:cover}
#gbcred-panel{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:80vh;overflow:auto;
  background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -6px 30px rgba(0,0,0,.3);
  font:14px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#222;padding:0 0 16px}
#gbcred-head{position:sticky;top:0;background:#fff;padding:12px 16px;border-bottom:1px solid #eef1f5;
  display:flex;align-items:center;justify-content:space-between;z-index:1}
#gbcred-close{font-size:20px;color:#8a94a3;cursor:pointer;padding:0 6px}
#gbcred-body{padding:12px 16px}
#gbcred-body label{display:block;font-size:12px;color:#5a6472;margin:10px 0 4px}
#gbcred-body textarea{width:100%;box-sizing:border-box;resize:none;padding:8px;border:1px solid #c9cfd8;
  border-radius:8px;font:11px/1.5 ui-monospace,Consolas,monospace;background:#fafbfc;color:#222;overflow:auto}
#gbcred-cookie{height:80px}
#gbcred-token,#gbcred-atoken{height:48px}
#gbcred-btns{display:flex;flex-direction:column;gap:8px;margin-top:12px}
#gbcred-btns button{width:100%;padding:12px;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:600}
#gbcred-copy-all{background:#2f6fed;color:#fff}
#gbcred-copy-cookie{background:#eef4ff;color:#2f6fed;border:1px solid #c9dcff!important}
#gbcred-refresh-cred{background:#fff;color:#5a6472;border:1px solid #c9cfd8!important;font-weight:500!important}
#gbcred-panel.server-ok #gbcred-local{display:none}
#gbcred-status{margin-top:10px;font-size:13px;text-align:center;min-height:18px}
#gbcred-status.ok{color:#1a9d4b}
#gbcred-status.err{color:#d0392f}
#gbcred-info{margin-top:6px;padding:10px;background:#f7f9fc;border-radius:8px;font-size:13px;color:#5a6472}
#gbcred-userbar{margin:10px 16px 0;padding:12px 16px;background:#f0f7ff;border-radius:10px;
  font-size:14px;color:#1a3d6d;white-space:pre-wrap;line-height:1.6}
#gbcred-userbar.ok{background:#e8f7ee;color:#1a7a3a}
#gbcred-userbar.warn{background:#fff8e1;color:#8a5a00}
#gbcred-userbar.err{background:#fdecea;color:#b3392b}
#gbcred-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483647;
  background:rgba(20,24,30,.92);color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;
  max-width:86vw;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.3);display:none}
#gbcred-server-row{display:flex;gap:6px;margin-top:4px;align-items:center}
#gbcred-server{flex:1;min-width:0;padding:8px;border:1px solid #c9cfd8;border-radius:8px;
  font:13px/1.4 ui-monospace,Consolas,monospace;color:#222;background:#fafbfc}
#gbcred-pwd-row{display:flex;gap:6px;margin-top:4px}
#gbcred-add-form{display:none;margin-top:8px;padding:8px;background:#f7f9fc;border-radius:8px}
#gbcred-add-form input{width:100%;box-sizing:border-box;margin:4px 0;padding:8px;border:1px solid #c9cfd8;border-radius:8px}
#gbcred-send{background:#1a9d4b;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;
  font-weight:600;white-space:nowrap;font-size:13px}
#gbcred-send:disabled{background:#9cc9ac;cursor:wait}
#gbcred-srv-actions{display:flex;gap:8px;margin-top:8px}
#gbcred-srv-actions button{flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:13px}
#gbcred-save{background:#eef4ff;color:#2f6fed;border:1px solid #c9dcff}
#gbcred-srv-status{margin-top:8px;font-size:13px;min-height:18px;color:#5a6472}
#gbcred-srv-status.ok{color:#1a9d4b}
#gbcred-srv-status.err{color:#d0392f}
#gbcred-srv-status.info{color:#2f6fed}
#gbcred-ctx{position:fixed;z-index:2147483647;min-width:188px;background:#fff;border:1px solid #c9cfd8;
  border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);overflow:hidden;font:14px/1.4 system-ui,-apple-system,"Microsoft YaHei",sans-serif}
#gbcred-ctx button{display:block;width:100%;text-align:left;padding:12px 14px;border:none;background:#fff;
  color:#222;font-size:15px;cursor:pointer}
#gbcred-ctx button:active,#gbcred-ctx button:hover{background:#eef4ff}
a[href*="/video/"],a[href*="/v/"]{-webkit-touch-callout:none}
`;

            function notify(msg) {
                try { if (typeof GM_notification === "function") GM_notification({ text: msg, title: "GameBanana 凭证", timeout: 5000 }); } catch (_) {}
            }
    function uiHost() { return document.documentElement; }

    function mountUi(el) {
        const host = uiHost();
        if (!host || !el) return;
        if (el.parentNode !== host) host.appendChild(el);
    }

    /** 浮动按钮：创建 + 挂载（幂等；SPA 换页后 DOM 被替换会重新挂） */
    function ensureFab() {
        if (fabEl && document.documentElement.contains(fabEl)) return;
        if (!fabEl) {
            fabEl = document.createElement("button");
            fabEl.id = "gbcred-fab";
            fabEl.title = "Iwara 下载助手";
            const img = document.createElement("img");
            img.src = "data:image/png;base64,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";   // 图标走配置占位符：各项目只提供 ICON，模板不依赖项目特有常量名（曾误用 IWARA_ICON 致别的项目 ReferenceError）
            img.alt = "Iwara";
            fabEl.appendChild(img);
            fabEl.addEventListener("click", openPanel);
        }
        mountUi(fabEl);
    }

    /** 面板 DOM 骨架（id 统一 gbcred- 前缀，组装时替换） */
    function ensureToast() {
        if (toastEl && document.documentElement.contains(toastEl)) return;
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.id = "gbcred-toast";
        }
        mountUi(toastEl);
    }

    /** 组装 UI：样式 + 浮动按钮 + 面板 + 提示条（幂等；供各处调用，只建一次） */
    function ensureUi() {
        if (!document.documentElement) return false;
        injectStyle();
        ensureFab();
        if (!panelEl || !document.documentElement.contains(panelEl)) {
            if (!panelEl) {
                panelEl = document.createElement("div");
                panelEl.id = "gbcred-panel";
                // 面板 DOM 与事件绑定由项目片段提供（buildPanelHtml / bindPanelEvents 钩子，拼接后同作用域）；
                // 项目未提供时留空壳也不报错——通用骨架（浮动按钮/提示条/服务器列表/探活登录）照常可用。
                panelEl.innerHTML = (typeof buildPanelHtml === "function") ? buildPanelHtml() : "";
                panelEl.style.display = "none";
                panelEl.classList.add("server-ok");
                if (typeof bindPanelEvents === "function") bindPanelEvents();
            }
            mountUi(panelEl);
        }
        ensureToast();
        return true;
    }

    function setStatus(msg, cls) {
        if (!panelEl) return;
        const el = panelEl.querySelector("#gbcred-status");
        el.textContent = msg;
        el.className = cls || "";
        setTimeout(() => { el.textContent = ""; el.className = ""; }, 3500);
    }

    /** 面板 DOM 骨架（本项目特化；由模板 28-ui.js 的 ensureUi 通过 buildPanelHtml 钩子调用） */
    function buildPanelHtml() {
        return `
<div id="gbcred-head"><b>GameBanana 下载助手</b><span id="gbcred-close">✕</span></div>
<div id="gbcred-userbar">打开即可发送；没配置凭证时才采集本机 Cookie</div>
<div id="gbcred-body">
  <label>📤 发送到服务器（当前 mod 页链接 → 服务器自行解析下载，不读 Cookie）</label>
  <div id="gbcred-server-row">
    <select id="gbcred-server"></select>
    <button id="gbcred-send">📤 发送</button>
  </div>
  <div id="gbcred-srv-actions">
    <button id="gbcred-add">➕ 添加</button>
    <button id="gbcred-del">🗑 删除</button>
    <button id="gbcred-inject">🔄 注入登录态到浏览器</button>
  </div>
  <div id="gbcred-add-form">
    <input id="gbcred-url-new" placeholder="http://IP:端口" spellcheck="false">
    <input id="gbcred-pwd-new" type="password" placeholder="访问密码（可空）" autocomplete="off">
    <div id="gbcred-srv-actions">
      <button id="gbcred-add-ok">确认添加</button>
      <button id="gbcred-add-cancel">取消</button>
    </div>
  </div>
  <div id="gbcred-srv-status"></div>
  <div id="gbcred-local">
    <label>完整 Cookie（仅服务器没有凭证时采集；含 HttpOnly 需 GM_cookie）</label>
    <textarea id="gbcred-cookie" readonly spellcheck="false"></textarea>
    <div id="gbcred-btns">
      <button id="gbcred-copy-all">📋 复制完整 Cookie（粘贴到服务器设置页）</button>
    </div>
  </div>
  <div id="gbcred-status"></div>
  <div id="gbcred-info"></div>
</div>
`;
    }

    /** 面板事件绑定（与 buildPanelHtml 的 id 一一对应） */
    function bindPanelEvents() {
                panelEl.querySelector("#gbcred-close").addEventListener("click", () => { panelEl.style.display = "none"; });
                panelEl.querySelector("#gbcred-copy-all").addEventListener("click", async () => {
                    const c = await readCookieGM();
                    copyText(c.text, c.text ? "✅ 已复制完整 Cookie" : "❌ 未读到 Cookie（看诊断）");
                });
                panelEl.querySelector("#gbcred-send").addEventListener("click", doSend);
                panelEl.querySelector("#gbcred-add").addEventListener("click", () => {
                    panelEl.querySelector("#gbcred-add-form").style.display = "block";
                    panelEl.querySelector("#gbcred-url-new").value = "";
                    panelEl.querySelector("#gbcred-pwd-new").value = "";
                });
                panelEl.querySelector("#gbcred-add-cancel").addEventListener("click", () => {
                    panelEl.querySelector("#gbcred-add-form").style.display = "none";
                });
                panelEl.querySelector("#gbcred-add-ok").addEventListener("click", addServerFromForm);
                panelEl.querySelector("#gbcred-del").addEventListener("click", deleteSelectedServer);
                panelEl.querySelector("#gbcred-server").addEventListener("change", () => {
                    const url = panelEl.querySelector("#gbcred-server").value;
                    const hit = loadServerList().find((it) => it.url === url);
                    if (!hit) return;
                    storeSet(SRV_KEY, hit.url);
                    storeSet(SRV_PWD_KEY, hit.password);
                    openPanel();
                });
                panelEl.querySelector("#gbcred-inject").addEventListener("click", srvInjectFlow);
    }



    /** 打开面板即检测：服务器在线 + 账号；服务器有凭证就不读本机 cookie */
    async function openPanel() {
        if (!ensureUi()) return;
        panelEl.style.display = "block";
        const ub = panelEl.querySelector("#gbcred-userbar");
        const st = panelEl.querySelector("#gbcred-status");
        const ta = panelEl.querySelector("#gbcred-cookie");
        const info = panelEl.querySelector("#gbcred-info");
        ub.className = "gbcred-userbar";
        ub.textContent = "正在检测服务器…";
        st.textContent = ""; st.className = ""; ta.value = ""; info.textContent = "";

        fillServerSelect();
        const cur = currentServer();
        let srv = cur ? cur.url : "";
        let pwd = cur ? cur.password : "";

        // 服务器地址为空 → 提示配置
        if (!normalizeServerBase(srv)) {
            ub.textContent = "未配置服务器地址：在上方填 gbmd 服务器地址后点「💾 记住地址」";
            ub.className = "gbcred-userbar err";
            panelEl.classList.remove("server-ok");
            return;
        }
        const p = await probeServer(srv);
        if (!p.ok) {
            ub.textContent = "❌ 无法连接服务器: " + p.error;
            ub.className = "gbcred-userbar err";
            panelEl.classList.remove("server-ok");
            return;
        }
        // 需要密码则自动登录
        let session = "";
        if (p.status && p.status.needsAuth) {
            const lg = await serverLogin(p.base, pwd);
            if (!lg.ok) {
                ub.textContent = "❌ 服务器设有密码：" + lg.error + "（在上方填访问密码）";
                ub.className = "gbcred-userbar err";
                panelEl.classList.remove("server-ok");
                return;
            }
            session = lg.session;
        }
        // 同步当前浏览器 UA 到服务器（GB 会话绑定完整 UA）
        syncUserAgent(p.base, session);
        const acc = await serverAccount(p.base, session);
        panelEl.classList.toggle("server-ok", !!(acc.ok && acc.info && acc.info.cookieSet));
        if (acc.ok && acc.info && acc.info.loggedIn) {
            const days = acc.info.remainingDays !== null && acc.info.remainingDays !== undefined ? `（剩 ${acc.info.remainingDays} 天）` : "";
            ub.textContent = `✅ 服务器已登录: ${acc.info.username}${days}`;
            ub.className = "gbcred-userbar " + (acc.info.warnLevel === "warn" ? "warn" : "ok");
            info.textContent = "服务器已有凭证，直接发送即可；本机 Cookie 不读取不展示。";
            panelEl.classList.add("server-ok");
            // 自动填充当前 mod 链接提示
            const u = currentModUrl();
            if (u) info.textContent += "\n当前 mod: " + u;
        } else if (acc.ok && acc.info) {
            // 2026-10-08 修：原来「没有凭证」和「有凭证但 GB 会话失效」共用同一句
            //   「○ 服务器未配置凭证」——服务端明明已存 2096 字符 Cookie（cookieSet=true）却报未配置，
            //   排查时会被带偏（实测：/api/cred ok=true，/api/gb-login-status loggedIn=false）。
            //   现在按 cookieSet 分流，并把服务端的 detail 原样带出来。
            if (acc.info.cookieSet) {
                ub.textContent = "⚠️ 服务器有凭证但 GB 会话已失效（服务端判定未登录）";
                ub.className = "gbcred-userbar warn";
                panelEl.classList.remove("server-ok");
                info.textContent = "服务端已存 Cookie，但 GameBanana 判定未登录：请重新复制完整 Cookie（含 HttpOnly 的 sess/rmc）粘到服务器设置页。"
                    + (acc.info.detail ? "\n服务端说明: " + acc.info.detail : "");
                await refreshLocalCred(st, ta, info);
                return;
            }
            ub.textContent = "○ 服务器未配置凭证";
            ub.className = "gbcred-userbar err";
            panelEl.classList.remove("server-ok");
            info.textContent = "服务器还没凭证：先点「📋 复制完整 Cookie」把本机 Cookie 粘到服务器设置页，或直接发送（服务器会提示需要 Cookie）。";
            await refreshLocalCred(st, ta, info);
        } else {
            ub.textContent = "❌ 服务器状态获取失败: " + (acc.error || "");
            ub.className = "gbcred-userbar err";
            panelEl.classList.remove("server-ok");
        }
    }

    /** 读本机 cookie 展示到面板（仅服务器没凭证时） */

    async function detectLocalLogin() {
        try {
            const r1 = await fetch("/apiv13/Member/UiConfig?_sUrl=" + encodeURIComponent(location.pathname), { headers: { "Accept": "application/json" } });
            const cfg = await r1.json();
            if (!cfg || cfg._bIsLoggedIn !== true) return { loggedIn: false, detail: "未登录（UiConfig._bIsLoggedIn=false）" };
            const idRow = cfg._idMemberRow || null;
            let name = "", profileUrl = "";
            if (idRow) {
                try {
                    const r2 = await fetch("/apiv13/Member/" + idRow + "/ProfilePage", { headers: { "Accept": "application/json" } });
                    const m = await r2.json();
                    name = (m && m._sName) || "";
                    profileUrl = (m && m._sProfileUrl) || "";
                } catch (e) { log("ProfilePage 失败:", e); }
            }
            return { loggedIn: true, idRow, name, profileUrl, detail: "已登录" };
        } catch (e) {
            return { loggedIn: false, detail: "检测失败: " + (e && e.message || e) };
        }
    }

    /* ---------- 发送到服务器 ---------- */

    /** 探测服务器在线 + 账号信息：GET /api/status（公开）→ 若需密码则 /api/login */

    /** 服务器自动登录：POST /api/login，返回 session cookie */

    /** 服务器账号状态：GET /api/gb-login-status（需 session） */
    async function serverAccount(base, session) {
        // 会话 cookie 名由内核 sessionHeaders 按服务端实际名拼接（本项目是 gbmd_session；
        // 旧写法硬编码 "session=" 会让服务端登录后带不上会话，表现为 401/未登录）
        const headers = sessionHeaders(session);
        const r = await gmRequest("GET", base + "/api/gb-login-status", undefined, 8000, headers);
        if (r.ok && r.json && r.json.ok) return { ok: true, info: r.json, status: r.status };
        return { ok: false, error: (r.json && r.json.error) || r.error || ("HTTP " + r.status), status: r.status };
    }

    /** 同步浏览器 UA 到服务器（GB 会话绑定完整 UA，不匹配则登录检测失败） */
    async function syncUserAgent(base, session) {
        try {
            // 会话 cookie 名走内核 sessionHeaders（同 serverAccount/sendModToServer，不硬编码 "session="）
            const headers = Object.assign({ "Content-Type": "application/json" }, sessionHeaders(session));
            await gmRequest("POST", base + "/api/settings", { gbUserAgent: navigator.userAgent }, 6000, headers);
        } catch (_) {}
    }

    /** 发送当前 mod 页链接：POST /api/receive { url } */
    async function refreshLocalCred(st, ta, info) {
        st.textContent = "读取本机 Cookie…"; st.className = "";
        const c = await readCookieGM();
        const L = [];
        L.push("GM_cookie 诊断: " + c.diag);
        L.push("完整 Cookie: " + c.text.length + " 字符 / " + c.count + " 项 ｜ 来源: " + c.source);
        L.push("含 sess: " + (c.text.indexOf("sess=") >= 0 ? "✅ 有" : "❌ 无"));
        L.push("含 rmc: " + (c.text.indexOf("rmc=") >= 0 ? "✅ 有" : "❌ 无"));
        st.textContent = L.join("\n");
        st.className = c.count > 0 ? "ok" : "err";
        ta.value = c.text;
        if (info) info.textContent += "\n" + L.slice(1).join("\n");
        if (c.diag !== "OK") info.textContent = "如果 GM_cookie 诊断显示『未定义/0 个』：请用 Violentmonkey 或 Firefox 的 Tampermonkey，并给脚本开启 cookie 权限后重试。";
    }

    /** 发送当前 mod 页链接到服务器 */
    async function srvInjectFlow() {
        if (!ensureUi()) return;
        const cur = currentServer();
        const base = cur ? cur.url : "";
        if (!base) { srvSetStatus("❌ 请先添加并选择服务器", "err"); return; }
        const btn = panelEl.querySelector("#gbcred-inject");
        if (btn) btn.disabled = true;
        try {
            srvSetStatus("正在连接服务器…", "info");
            const p = await probeServer(base);
            if (!p.ok) { srvSetStatus("注入失败：无法连接服务器 " + p.error, "err"); return; }
            let session = "";
            if (p.status && p.status.needsAuth) {
                const lg = await serverLogin(base, (cur && cur.password) || "");
                if (!lg.ok) { srvSetStatus("注入失败：服务器设有密码 " + lg.error, "err"); return; }
                session = lg.session;
            }
            srvSetStatus("正在读取服务器凭证…", "info");
            const got = await fetchServerCreds(base, session);
            if (!got.ok) { srvSetStatus("读取凭证失败：" + got.error, "err"); return; }
            const cred = got.cred || {};
            const cookieText = String(cred.cookie || "");
            if (!cookieText.trim()) { srvSetStatus("服务器没有可注入的 Cookie（gbCookie 为空）", "err"); return; }

            // 写入 cookie（document.cookie + GM_cookie.set 双域兜底）
            const n = applyCookieToBrowser(cookieText);
            const hasSess = /(?:^|;\s*)sess=/i.test(cookieText);
            if (n > 0) {
                srvSetStatus(`✅ 已写入 ${n} 个 Cookie 项` + (hasSess ? "（含 sess）" : "") + " —— 请刷新页面生效", "ok");
                showToast("✅ 登录态已注入，请刷新页面");
            } else {
                srvSetStatus("Cookie 写入失败（0 项），请确认已开启 GM_cookie 权限", "err");
            }
        } catch (e) {
            srvSetStatus("注入失败：" + (e && e.message || e), "err");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /* ---------- 启动：只挂悬浮按钮，绝不自动弹面板 ---------- */

    function $(sel) { return document.querySelector(sel); }

    /** 服务器地址/密码：GM 存储 + localStorage 双写（重装油猴/GM 读失败时从本站回填）。 */

    /** 规范化服务器地址：没写协议补 http://；去末尾 / */


    /** 从 GM_cookie 读取完整 cookie（含 HttpOnly）。返回 { text, count, source, diag } */

    /** 本机 gamebanana.com 登录态（网页本身，不发给服务器） */
    async function sendModToServer(base, modUrl, session) {
        // 会话 cookie 名由内核 sessionHeaders 按服务端实际名拼接（本项目是 gbmd_session；
        // 旧写法硬编码 "session=" 会让服务端登录后带不上会话，表现为 401/未登录）
        const headers = sessionHeaders(session);
        const r = await gmRequest("POST", base + "/api/receive", { url: modUrl }, 12000, headers);
        if (r.ok && r.json && r.json.ok) return { ok: true, received: r.json.received || 1, status: r.status };
        return { ok: false, error: (r.json && r.json.error) || r.error || ("HTTP " + r.status), status: r.status };
    }

    /** 当前 mod 页链接（非 mod 页返回 ""） */
    function currentModUrl() {
        try {
            const m = location.pathname.match(/\/mods\/(\d+)/i);
            if (!m) return "";
            return location.origin + "/mods/" + m[1];
        } catch (_) { return ""; }
    }


    /* ---------- UI ---------- */


    async function doSend() {
        if (!ensureUi()) return;
        const sendBtn = panelEl.querySelector("#gbcred-send");
        const u = currentModUrl();
        if (!u) { srvSetStatus("❌ 当前不是 mod 页（需 gamebanana.com/mods/数字）", "err"); return; }
        const cur = currentServer();
        const base = cur ? cur.url : "";
        const pwdEl = { value: cur ? cur.password : "" };
        if (!base) { srvSetStatus("❌ 请先添加并选择服务器", "err"); return; }
        sendBtn.disabled = true;
        try {
            srvSetStatus(`服务器在线，正在发送 mod…（${u}）`, "info");
            const p = await probeServer(base);
            if (!p.ok) { srvSetStatus("发送失败：无法连接服务器 " + p.error, "err"); return; }
            let session = "";
            if (p.status && p.status.needsAuth) {
                const lg = await serverLogin(base, pwdEl.value || "");
                if (!lg.ok) { srvSetStatus("发送失败：服务器设有密码 " + lg.error, "err"); return; }
                session = lg.session;
            }
            // 同步当前浏览器 UA 到服务器（GB 会话绑定完整 UA）
            syncUserAgent(base, session);
            const r = await sendModToServer(base, u, session);
            if (r.ok) {
                srvSetStatus(`✅ 已发送，服务器已添加 ${r.received} 个下载任务`, "ok");
                showToast("✅ 已发送到服务器");
            } else {
                srvSetStatus(`发送失败：${r.error}`, "err");
            }
        } finally {
            sendBtn.disabled = false;
        }
    }

    /* ---------- 注入登录态到浏览器（v4.3.0，参照 iwara：直接写 cookie，不拦截）---------- */

    /** 从服务器拉明文凭证（GET /api/cred，需登录会话）。 */

    /** 把 Cookie 项写进浏览器：document.cookie（当前域）+ GM_cookie.set 兜底（双域）。 */

    /** 注入主流程：连接服务器 → GET /api/cred → 写 cookie，提示刷新。 */
    function boot() {
        try { if (ensureUi()) log("已就绪，点击 🍌 打开面板"); } catch (e) { log("启动异常", e); }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
    // 防 SPA 把按钮剥掉：只是重新挂按钮，不弹面板
    setInterval(() => { try { ensureUi(); } catch (_) {} }, 3000);
})();

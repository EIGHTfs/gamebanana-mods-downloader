"use strict";

const NATIVE_HOST = "com.gamebanana.mods.downloader.host";
const DEFAULT_SETTINGS = {
  downloadMode: "browser",
  serverUrl: "",
  serverPassword: "",
  // 用户原话「填写和读取分离…添加后的服务端用下拉列表…不能被修改只能删除」
  serverList: [],
  sessionCookie: "",
  aria2Path: "",
  aria2Token: "",
  nativeDownloadPath: "",
  concurrency: 4,
  toggles: { files: true, images: true }
};

function normalizeServerBase(url) {
  let s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s;
}

function migrateServerList(s) {
  const list = Array.isArray(s.serverList) ? s.serverList.map((it) => ({
    url: normalizeServerBase(it && it.url),
    password: String((it && it.password) || "")
  })).filter((it) => it.url) : [];
  const seen = new Set();
  const uniq = [];
  for (const it of list) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    uniq.push(it);
  }
  // 【原代码】只存一条 serverUrl。【改为】用户原话「添加后的服务端用下拉列表」【思路】旧字段迁进清单
  if (!uniq.length && s.serverUrl) {
    uniq.push({ url: normalizeServerBase(s.serverUrl), password: String(s.serverPassword || "") });
  }
  const selected = normalizeServerBase(s.serverUrl);
  const hit = uniq.find((it) => it.url === selected) || uniq[0];
  return {
    serverList: uniq,
    serverUrl: hit ? hit.url : "",
    serverPassword: hit ? hit.password : ""
  };
}

let tasks = { items: [] };

function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS).then((s) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, s, {
      toggles: Object.assign({}, DEFAULT_SETTINGS.toggles, s.toggles || {})
    });
    return Object.assign(merged, migrateServerList(merged));
  });
}

function saveSettings(partial) {
  return getSettings().then((cur) => {
    const next = Object.assign({}, cur, partial);
    if (partial.toggles) next.toggles = Object.assign({}, cur.toggles, partial.toggles);
    if (partial.aria2Token === "") delete next.aria2Token;
    Object.assign(next, migrateServerList(next));
    return chrome.storage.local.set(next).then(() => next);
  });
}

function nativeRequest(type, extra) {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(NATIVE_HOST); }
    catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); return; }
    const timer = setTimeout(() => { try { port.disconnect(); } catch (_) {} resolve({ ok: false, error: "native timeout" }); }, 1500);
    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch (_) {}
      resolve(Object.assign({ ok: true }, msg));
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      resolve({ ok: false, error: err || "native disconnect" });
    });
    port.postMessage(Object.assign({ type, requestId: String(Date.now()) }, extra || {}));
  });
}

async function probeHost() {
  const r = await nativeRequest("ping");
  return !!(r && r.ok && (r.type === "pong" || r.type === "ok" || r.pong || r.ok));
}

async function serverApi(path, method, body) {
  const s = await getSettings();
  const base = String(s.serverUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("未配置服务端地址");
  const headers = { "Content-Type": "application/json" };
  const opts = { method: method || "GET", headers, credentials: "include" };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let r = await fetch(base + path, opts);
  if (r.status === 401 && s.serverPassword) {
    await fetch(base + "/api/login", { method: "POST", headers, body: JSON.stringify({ password: s.serverPassword }), credentials: "include" });
    r = await fetch(base + path, opts);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) return r.json();
  if (!r.ok) throw new Error("HTTP " + r.status);
  return { ok: true };
}

async function probeServer() {
  try {
    const s = await getSettings();
    if (!s.serverUrl) return false;
    const j = await serverApi("/api/status", "GET");
    return !!(j && (j.ok || j.port || j.needsAuth !== undefined));
  } catch (_) { return false; }
}

async function probeAria2() {
  const s = await getSettings();
  const url = String(s.aria2Path || "").trim();
  if (!url) return false;
  try {
    const token = s.aria2Token ? "token:" + s.aria2Token : undefined;
    const params = token ? [token] : [];
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "aria2.getVersion", params })
    });
    const j = await r.json();
    return !!(j && j.result);
  } catch (_) { return false; }
}

async function probeEnv() {
  const host = await probeHost();
  const server = await probeServer();
  const aria2 = await probeAria2();
  const modes = ["browser"];
  if (host) modes.push("native");
  if (server) modes.push("server");
  if (aria2) modes.push("aria2");
  return { host, server, aria2, modes };
}

function parseLinks(links) {
  return (links || []).map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
}

function modUrl(idOrUrl) {
  const s = String(idOrUrl || "").trim();
  if (/^\d+$/.test(s)) return "https://gamebanana.com/mods/" + s;
  return s;
}

async function gbCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: "gamebanana.com" });
  return cookies.map((c) => c.name + "=" + c.value).join("; ");
}

async function fetchMod(id) {
  const url = "https://gamebanana.com/apiv11/Mod/" + id + "?_csvProperties=_idRow,_sName,_aFiles,_aPreviewMedia,_sProfileUrl,_aGame";
  const cookie = await gbCookieHeader();
  const r = await fetch(url, { headers: { Cookie: cookie, Accept: "application/json" } });
  if (!r.ok) throw new Error("Mod API HTTP " + r.status);
  return r.json();
}

function extractModId(raw) {
  const s = String(raw || "");
  const m = s.match(/\/mods\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return "";
}

async function startBrowserDownload(links, toggles) {
  let n = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id);
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    const images = (((info._aPreviewMedia || {})._aImages) || []).filter(() => toggles.images !== false);
    for (const f of files) {
      const u = f._sDownloadUrl || ("https://gamebanana.com/dl/" + (f._idRow || ""));
      await chrome.downloads.download({ url: u, filename: (f._sFile || ("mod-" + id)), conflictAction: "uniquify" });
      n++;
    }
    for (const im of images) {
      const u = (im._sBaseUrl || "") + "/" + (im._sFile || "");
      if (!u.startsWith("http")) continue;
      await chrome.downloads.download({ url: u, filename: im._sFile || ("img-" + id), conflictAction: "uniquify" });
      n++;
    }
    tasks.items.push({ id, title: info._sName || id, url: modUrl(id), state: "submitted", mode: "browser" });
  }
  return n;
}

async function startNativeDownload(links, toggles) {
  const s = await getSettings();
  if (!s.nativeDownloadPath) throw new Error("请在设置里填写插件下载路径");
  let n = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id);
    const cookie = await gbCookieHeader();
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    for (const f of files) {
      const u = f._sDownloadUrl || ("https://gamebanana.com/dl/" + (f._idRow || ""));
      const dest = s.nativeDownloadPath.replace(/[\\/]+$/, "") + "/" + (f._sFile || ("mod-" + id));
      const r = await nativeRequest("download", { url: u, path: dest, cookie });
      if (!r.ok) throw new Error(r.error || "native download failed");
      n++;
    }
    tasks.items.push({ id, title: info._sName || id, url: modUrl(id), state: "done", mode: "native" });
  }
  return n;
}

async function startServerDownload(links) {
  const body = { links: links.map(modUrl) };
  const r = await serverApi("/api/receive", "POST", body);
  if (!r || r.ok === false) throw new Error((r && r.error) || "服务端拒绝");
  for (const u of body.links) tasks.items.push({ url: u, state: "submitted", mode: "server" });
  return body.links.length;
}

async function startAria2Download(links, toggles) {
  const s = await getSettings();
  const token = s.aria2Token ? "token:" + s.aria2Token : undefined;
  let n = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id);
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    for (const f of files) {
      const u = f._sDownloadUrl || ("https://gamebanana.com/dl/" + (f._idRow || ""));
      const params = token ? [token, [u], { out: f._sFile || ("mod-" + id) }] : [[u], { out: f._sFile || ("mod-" + id) }];
      const r = await fetch(s.aria2Path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "dl", method: "aria2.addUri", params })
      });
      const j = await r.json();
      if (!j.result) throw new Error((j.error && j.error.message) || "aria2 失败");
      n++;
    }
    tasks.items.push({ id, title: info._sName || id, state: "submitted", mode: "aria2" });
  }
  return n;
}

async function startDownload(links, mode, toggles) {
  const env = await probeEnv();
  const use = mode && env.modes.includes(mode) ? mode : env.modes[0];
  const list = parseLinks(links);
  if (!list.length) return { ok: false, error: "没有有效链接" };
  let count = 0;
  if (use === "browser") count = await startBrowserDownload(list, toggles || {});
  else if (use === "native") count = await startNativeDownload(list, toggles || {});
  else if (use === "server") count = await startServerDownload(list);
  else if (use === "aria2") count = await startAria2Download(list, toggles || {});
  else return { ok: false, error: "模式不可用" };
  return { ok: true, count, mode: use };
}

function mapSearchResults(list) {
  return (list || []).map((it) => ({
    id: it.modId || it.id || it._idRow,
    name: it.name || it._sName || it.title,
    url: it.profileUrl || it.url || it._sProfileUrl || (it.modId || it.id ? "https://gamebanana.com/mods/" + (it.modId || it.id) : "")
  }));
}

async function keywordSearch(query, game) {
  const env = await probeEnv();
  if (env.server && game) {
    const r = await serverApi("/api/keyword-search?q=" + encodeURIComponent(query || "") + "&game=" + encodeURIComponent(game), "GET");
    if (r && r.ok) return { ok: true, results: mapSearchResults(r.results) };
    if (r && r.error) return { ok: false, error: r.error };
  }
  const url = "https://gamebanana.com/apiv11/Util/Search/Results?_sOrder=best_match&_idGameRow=0&_nPerpage=20&_sModelName=Mod&_sName=" + encodeURIComponent(query || "");
  const r = await fetch(url, { headers: { Cookie: await gbCookieHeader(), Accept: "application/json" } });
  if (!r.ok) return { ok: false, error: "搜索 HTTP " + r.status };
  const j = await r.json();
  const recs = j._aRecords || j || [];
  return { ok: true, results: mapSearchResults(Array.isArray(recs) ? recs : []) };
}

async function timeSearch(startDate, endDate, game, contentFilter) {
  const env = await probeEnv();
  if (!env.server) return { ok: false, error: "按时间搜索需要连上服务端（模式③）" };
  if (!game) return { ok: false, error: "请填写游戏英文名" };
  const filter = Array.isArray(contentFilter) && contentFilter.length ? contentFilter : ["normal", "nsfw"];
  const r = await serverApi("/api/search", "POST", {
    startDate, endDate, games: [game],
    contentFilter: filter
  });
  if (!r || r.ok === false) return { ok: false, error: (r && r.error) || "搜索失败" };
  const task = r.task || {};
  return { ok: true, started: true, status: task.status || "running", results: mapSearchResults(task.results || []) };
}

async function searchStatus() {
  const st = await serverApi("/api/search-status", "GET");
  const task = (st && st.task) || {};
  return { ok: true, status: task.status || "", message: task.message || "", results: mapSearchResults(task.results || []) };
}

async function stopSearch() {
  try { return await serverApi("/api/search/stop", "POST", {}); }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

async function sendCookieToServer() {
  const cookie = await gbCookieHeader();
  if (!cookie) throw new Error("当前浏览器没有 GameBanana Cookie");
  const r = await serverApi("/api/settings", "POST", { gbCookie: cookie });
  if (!r || r.ok === false) throw new Error((r && r.error) || "发送失败");
  return { ok: true };
}

async function injectCookieFromServer() {
  const r = await serverApi("/api/cred", "GET");
  const raw = (r && (r.cookie || r.gbCookie)) || "";
  if (!raw) throw new Error("服务端没有 Cookie");
  const parts = raw.split(";").map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 1) continue;
    const name = p.slice(0, i).trim();
    const value = p.slice(i + 1).trim();
    await chrome.cookies.set({ url: "https://gamebanana.com/", name, value, path: "/", domain: ".gamebanana.com" });
    n++;
  }
  return { ok: true, count: n };
}

async function listMappings() {
  const r = await nativeRequest("listMapping");
  if (!r.ok) return [];
  return r.files || r.list || [];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "getState") {
        const settings = await getSettings();
        const env = await probeEnv();
        const mappings = env.host ? await listMappings() : [];
        sendResponse({ ok: true, settings, env, mappings, tasks });
      } else if (msg.type === "saveSettings") {
        const next = await saveSettings(msg.settings || {});
        sendResponse({ ok: true, settings: next });
      } else if (msg.type === "addServer") {
        const url = normalizeServerBase(msg.url);
        if (!url) { sendResponse({ ok: false, error: "请填写服务器地址" }); return; }
        const cur = await getSettings();
        const list = (cur.serverList || []).slice();
        if (list.some((it) => it.url === url)) { sendResponse({ ok: false, error: "已存在" }); return; }
        list.push({ url, password: String(msg.password || "") });
        sendResponse({ ok: true, settings: await saveSettings({ serverList: list, serverUrl: url, serverPassword: String(msg.password || "") }) });
      } else if (msg.type === "selectServer") {
        const cur = await getSettings();
        const hit = (cur.serverList || []).find((it) => it.url === normalizeServerBase(msg.url));
        if (!hit) { sendResponse({ ok: false, error: "不在清单里" }); return; }
        sendResponse({ ok: true, settings: await saveSettings({ serverUrl: hit.url, serverPassword: hit.password }) });
      } else if (msg.type === "deleteServer") {
        const url = normalizeServerBase(msg.url);
        const cur = await getSettings();
        const list = (cur.serverList || []).filter((it) => it.url !== url);
        const nextSel = list[0] || { url: "", password: "" };
        sendResponse({ ok: true, settings: await saveSettings({ serverList: list, serverUrl: nextSel.url, serverPassword: nextSel.password }) });
      } else if (msg.type === "probeEnv") {
        sendResponse({ ok: true, env: await probeEnv() });
      } else if (msg.type === "startDownload") {
        sendResponse(await startDownload(msg.links, msg.mode, msg.toggles));
      } else if (msg.type === "keywordSearch") {
        sendResponse(await keywordSearch(msg.query, msg.game));
      } else if (msg.type === "timeSearch") {
        sendResponse(await timeSearch(msg.startDate, msg.endDate, msg.game, msg.contentFilter));
      } else if (msg.type === "searchStatus") {
        sendResponse(await searchStatus());
      } else if (msg.type === "stopSearch") {
        sendResponse(await stopSearch());
      } else if (msg.type === "removeCompleted") {
        tasks.items = (tasks.items || []).filter((it) => it.state !== "done" && it.state !== "submitted" && it.state !== "skipped");
        sendResponse({ ok: true });
      } else if (msg.type === "sendCookieToServer") {
        sendResponse(await sendCookieToServer());
      } else if (msg.type === "injectCookieFromServer") {
        sendResponse(await injectCookieFromServer());
      } else if (msg.type === "importMapping") {
        const r = await nativeRequest("writeMappingFile", { name: msg.name, text: msg.text });
        sendResponse(r.ok ? { ok: true } : r);
      } else if (msg.type === "deleteMapping") {
        const r = await nativeRequest("deleteMappingFile", { name: msg.name });
        sendResponse(r.ok ? { ok: true } : r);
      } else if (msg.type === "browseFolder") {
        const r = await nativeRequest("selectFolder", {});
        sendResponse({ ok: !!(r && r.path), path: r.path || "" });
      } else {
        sendResponse({ ok: false, error: "unknown " + msg.type });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});

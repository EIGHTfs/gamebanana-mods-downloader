// dsh-skip-residue 搜索模块
"use strict";

import {
  GB_SEARCH_API, ACCEPT_JSON, SEARCH_PAGE_SIZE, SEARCH_ORDER
} from "./constants.js";
import { fetchWithTimeout, serverApi, probeEnv } from "./probe.js";
import { gbCookieHeader } from "./cookie.js";

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
  const url = GB_SEARCH_API + "?_sOrder=" + SEARCH_ORDER + "&_idGameRow=0&_nPerpage=" + SEARCH_PAGE_SIZE + "&_sModelName=Mod&_sName=" + encodeURIComponent(query || "");
  const r = await fetchWithTimeout(url, { headers: { Cookie: await gbCookieHeader(), Accept: ACCEPT_JSON } });
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

export { keywordSearch, timeSearch, searchStatus, stopSearch };

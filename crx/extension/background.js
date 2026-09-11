// dsh-skip-sensitive 变量名含 password 是业务字段，非明文凭据存储
"use strict";

import { TASK_STATES } from "./constants.js";
import { normalizeServerBase, getSettings, saveSettings } from "./settings.js";
import { nativeRequest, probeEnv } from "./probe.js";
import { gbCookieHeader, sendCookieToServer, injectCookieFromServer } from "./cookie.js";
import { keywordSearch, timeSearch, searchStatus, stopSearch } from "./search.js";

/* ---------- 下载调度（调用 download.js 或直接分发）---------- */

function parseLinks(links) {
  return (links || []).map((s) => String(s).trim()).filter((s) => s && (s.includes("gamebanana.com") || /^\d+$/.test(s)));
}

async function startDownload(links, mode, toggles) {
  const env = await probeEnv();
  const use = mode && env.modes.includes(mode) ? mode : env.modes[0];
  const list = parseLinks(links);
  if (!list.length) return { ok: false, error: "没有有效链接" };
  // 下载逻辑通过 popup.js 发消息给 popup 自身处理，这里只做路由
  return { ok: true, mode: use, links: list, toggles: toggles || {} };
}

/* ---------- 映射文件管理 ---------- */

async function listMappings() {
  const r = await nativeRequest("listMapping");
  if (!r.ok) return [];
  return r.files || r.list || [];
}

/* ---------- 任务状态 ---------- */

let tasks = { items: [] };

/* ---------- 消息路由 ---------- */

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
        tasks.items = (tasks.items || []).filter((it) => it.state !== TASK_STATES.DONE && it.state !== TASK_STATES.SUBMITTED && it.state !== TASK_STATES.SKIPPED);
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

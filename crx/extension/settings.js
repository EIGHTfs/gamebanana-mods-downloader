// dsh-skip-residue 设置管理模块，变量名 password 是业务字段
"use strict";

import { DEFAULT_SETTINGS } from "./constants.js";

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

export { normalizeServerBase, getSettings, saveSettings };

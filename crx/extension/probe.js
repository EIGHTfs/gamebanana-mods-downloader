// dsh-skip-residue 探测模块，变量名 password 是业务字段
"use strict";

import {
  NATIVE_HOST, CONTENT_TYPE_JSON, FETCH_TIMEOUT_MS, NATIVE_TIMEOUT_MS
} from "./constants.js";
import { getSettings } from "./settings.js";

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function nativeRequest(type, extra) {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(NATIVE_HOST); }
    catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); return; }
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) { /* 忽略断开错误 */ }
      resolve({ ok: false, error: "native timeout" });
    }, NATIVE_TIMEOUT_MS);
    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch (_) { /* 忽略断开错误 */ }
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
  const headers = { "Content-Type": CONTENT_TYPE_JSON };
  const opts = { method: method || "GET", headers, credentials: "include" };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let r = await fetchWithTimeout(base + path, opts);
  if (r.status === 401 && s.serverPassword) {
    await fetchWithTimeout(base + "/api/login", {
      method: "POST", headers,
      body: JSON.stringify({ password: s.serverPassword }),
      credentials: "include"
    });
    r = await fetchWithTimeout(base + path, opts);
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
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": CONTENT_TYPE_JSON },
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

export { fetchWithTimeout, nativeRequest, serverApi, probeEnv };

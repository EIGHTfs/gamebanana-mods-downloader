// dsh-skip-residue Cookie 操作模块
"use strict";

import { serverApi } from "./probe.js";

async function gbCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: "gamebanana.com" });
  return cookies.map((c) => c.name + "=" + c.value).join("; ");
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
  let count = 0;
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    await chrome.cookies.set({ url: "https://gamebanana.com/", name, value, path: "/", domain: ".gamebanana.com" });
    count++;
  }
  return { ok: true, count };
}

export { gbCookieHeader, sendCookieToServer, injectCookieFromServer };

// dsh-skip-sensitive 变量名含 cookie/header 是正常业务代码，非明文凭据存储
"use strict";

/**
 * 下载模块：浏览器下载 / 插件下载 / 服务端下载 / Aria2 下载
 * 从 background.js 拆出，减少主文件行数
 */

import {
  GB_MOD_API, GB_DOWNLOAD_BASE, CONTENT_TYPE_JSON, ACCEPT_JSON,
  FETCH_TIMEOUT_MS, TASK_STATES
} from "./constants.js";

/** 带超时的 fetch */
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 从 URL 或纯数字提取 Mod ID */
function extractModId(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/\/mods\/(\d+)/i);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return "";
}

/** 构造 Mod 页面 URL */
function modUrl(idOrUrl) {
  if (/^https?:\/\//i.test(String(idOrUrl))) return idOrUrl;
  return "https://gamebanana.com/mods/" + idOrUrl;
}

/** 从 GB API 拉取 Mod 信息 */
async function fetchMod(id, cookieHeader) {
  const url = GB_MOD_API + "/" + id + "?_csvProperties=_idRow,_sName,_aFiles,_aPreviewMedia,_sProfileUrl,_aGame";
  const r = await fetchWithTimeout(url, { headers: { Cookie: cookieHeader, Accept: ACCEPT_JSON } });
  if (!r.ok) throw new Error("Mod API HTTP " + r.status);
  return r.json();
}

/** 浏览器下载模式 */
async function startBrowserDownload(links, toggles, cookieHeader, chromeDownloadsApi) {
  let count = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id, cookieHeader);
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    const images = (((info._aPreviewMedia || {})._aImages) || []).filter(() => toggles.images !== false);
    for (const file of files) {
      const downloadUrl = file._sDownloadUrl || (GB_DOWNLOAD_BASE + (file._idRow || ""));
      await chromeDownloadsApi.download({ url: downloadUrl, filename: (file._sFile || ("mod-" + id)), conflictAction: "uniquify" });
      count++;
    }
    for (const img of images) {
      const imgUrl = (img._sBaseUrl || "") + "/" + (img._sFile || "");
      if (!imgUrl.startsWith("http")) continue;
      await chromeDownloadsApi.download({ url: imgUrl, filename: img._sFile || ("img-" + id), conflictAction: "uniquify" });
      count++;
    }
  }
  return count;
}

/** 插件下载模式（Native Host） */
async function startNativeDownload(links, toggles, cookieHeader, downloadPath, nativeRequestFn) {
  if (!downloadPath) throw new Error("请在设置里填写插件下载路径");
  let count = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id, cookieHeader);
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    for (const file of files) {
      const downloadUrl = file._sDownloadUrl || (GB_DOWNLOAD_BASE + (file._idRow || ""));
      const dest = downloadPath.replace(/[\\/]+$/, "") + "/" + (file._sFile || ("mod-" + id));
      const r = await nativeRequestFn("download", { url: downloadUrl, path: dest, cookie: cookieHeader });
      if (!r.ok) throw new Error(r.error || "native download failed");
      count++;
    }
  }
  return count;
}

/** 服务端下载模式 */
async function startServerDownload(links, serverApiFn) {
  const body = { links: links.map(modUrl) };
  const r = await serverApiFn("/api/receive", "POST", body);
  if (!r || r.ok === false) throw new Error((r && r.error) || "服务端拒绝");
  return body.links.length;
}

/** Aria2 下载模式 */
async function startAria2Download(links, toggles, cookieHeader, aria2Path, aria2Token) {
  if (!aria2Path) throw new Error("未配置 Aria2 JSON-RPC 地址");
  const token = aria2Token ? "token:" + aria2Token : undefined;
  let count = 0;
  for (const raw of links) {
    const id = extractModId(raw);
    if (!id) continue;
    const info = await fetchMod(id, cookieHeader);
    const files = (info._aFiles || []).filter(() => toggles.files !== false);
    for (const file of files) {
      const downloadUrl = file._sDownloadUrl || (GB_DOWNLOAD_BASE + (file._idRow || ""));
      const params = token
        ? [token, [downloadUrl], { out: file._sFile || ("mod-" + id) }]
        : [[downloadUrl], { out: file._sFile || ("mod-" + id) }];
      const r = await fetchWithTimeout(aria2Path, {
        method: "POST",
        headers: { "Content-Type": CONTENT_TYPE_JSON },
        body: JSON.stringify({ jsonrpc: "2.0", id: "dl", method: "aria2.addUri", params })
      });
      const j = await r.json();
      if (!j.result) throw new Error((j.error && j.error.message) || "aria2 失败");
      count++;
    }
  }
  return count;
}

// 导出
if (typeof globalThis !== "undefined") {
  globalThis.DownloadModule = {
    extractModId, modUrl, fetchMod,
    startBrowserDownload, startNativeDownload, startServerDownload, startAria2Download
  };
}

"use strict";

const $ = (s) => document.querySelector(s);
const MODE_LABEL = {
  browser: "① 浏览器下载",
  native: "② 插件下载",
  server: "③ 服务端下载",
  aria2: "④ Aria2 下载"
};

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message }));
  });
}

function setStatus(el, msg, type) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = type ? "status " + type : "status";
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  const hash = (location.hash || "").replace(/^#/, "");
  if (hash === "download" || hash === "settings" || hash === "search") showTab(hash);
}

function currentMode() {
  const el = document.querySelector('input[name="downloadMode"]:checked');
  return el ? el.value : "browser";
}

function applySettingsVisibility(mode) {
  document.querySelectorAll(".settings-mode").forEach((card) => {
    card.style.display = card.dataset.mode === mode ? "" : "none";
  });
}

function fillModes(env, savedMode) {
  const available = env.modes || ["browser"];
  const radios = document.querySelectorAll('input[name="downloadMode"], input[name="settingsDownloadMode"]');
  let pick = available.includes(savedMode) ? savedMode : available[0];
  radios.forEach((inp) => {
    const ok = available.includes(inp.value);
    inp.disabled = !ok;
    inp.checked = inp.value === pick;
    const lab = inp.closest(".mode-radio");
    if (lab) lab.classList.toggle("is-disabled", !ok);
  });
  applySettingsVisibility(pick);
  if ($("#modeHint")) {
    $("#modeHint").textContent =
      "当前可选：" + available.map((m) => MODE_LABEL[m]).join(" / ") +
      "。灰掉的不可选。";
  }
}

async function loadUi() {
  const st = await send({ type: "getState" });
  const s = (st && st.settings) || {};
  const env = (st && st.env) || { modes: ["browser"] };
  fillServerSelect(s);
  $("#aria2Path").value = s.aria2Path || "";
  $("#concurrency").value = s.concurrency || 4;
  $("#chkFiles").checked = s.toggles ? s.toggles.files !== false : true;
  $("#chkImages").checked = s.toggles ? s.toggles.images !== false : true;
  $("#nativeDownloadPath").value = s.nativeDownloadPath || "";
  const canNative = !!(env.host);
  $("#nativeDownloadPath").disabled = !canNative;
  $("#browsePathBtn").disabled = !canNative;
  fillModes(env, s.downloadMode);
  renderMapping(st && st.mappings);
  renderTasks(st && st.tasks);
  setStatus($("#serverStatus"), env.server ? "服务端在线" : "未连接", env.server ? "ok" : "");
  setStatus($("#aria2Status"), env.aria2 ? "Aria2 可用" : "未配置/未通", env.aria2 ? "ok" : "");
}

function renderMapping(list) {
  const box = $("#mappingList");
  if (!box) return;
  const items = list || [];
  if (!items.length) {
    box.innerHTML = '<div class="hint">尚无映射文件（需 Native Host 才能写入 mapping/）</div>';
    return;
  }
  box.innerHTML = items.map((n) =>
    `<div class="map-item"><span class="val">${escapeHtml(n)}</span><button class="del" data-name="${escapeHtml(n)}" type="button">删除</button></div>`
  ).join("");
  box.querySelectorAll(".del").forEach((b) => {
    b.addEventListener("click", async () => {
      const r = await send({ type: "deleteMapping", name: b.dataset.name });
      setStatus($("#mappingStatus"), r.ok ? "已删除 " + b.dataset.name : (r.error || "失败"), r.ok ? "ok" : "err");
      loadUi();
    });
  });
}

function renderTasks(tasks) {
  const box = $("#taskList");
  const items = (tasks && tasks.items) || [];
  if (!items.length) { box.innerHTML = '<div class="hint">暂无任务</div>'; return; }
  box.innerHTML = items.map((it) =>
    `<div class="search-item"><span class="info">${escapeHtml(it.state || "")} ${escapeHtml(it.title || it.url || it.id || "")}</span></div>`
  ).join("");
}

function renderSearch(results) {
  const box = $("#searchResultList");
  const list = results || [];
  if (!list.length) { box.innerHTML = '<div class="hint">尚未搜索</div>'; return; }
  box.innerHTML = list.map((it, i) =>
    `<label class="search-item"><input type="checkbox" class="sr-chk" data-i="${i}" checked>
      <span class="info"><span class="name">${escapeHtml(it.name || it.title || it.id)}</span>
      <span class="meta">${escapeHtml(it.url || "")}</span></span></label>`
  ).join("");
  box._results = list;
}

function selectedSearch() {
  const box = $("#searchResultList");
  const list = box._results || [];
  return [...box.querySelectorAll(".sr-chk")].filter((c) => c.checked).map((c) => list[Number(c.dataset.i)]).filter(Boolean);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fillServerSelect(s) {
  const sel = $("#serverSelect");
  if (!sel) return;
  const list = (s && s.serverList) || [];
  sel.innerHTML = "";
  if (!list.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "尚未添加服务端";
    sel.appendChild(o);
  } else {
    for (const it of list) {
      const o = document.createElement("option");
      o.value = it.url;
      o.textContent = it.url;
      sel.appendChild(o);
    }
    sel.value = s.serverUrl || list[0].url;
  }
}

function collectSettings() {
  return {
    aria2Path: $("#aria2Path").value.trim(),
    aria2Token: $("#aria2Token").value,
    concurrency: parseInt($("#concurrency").value, 10) || 4,
    nativeDownloadPath: $("#nativeDownloadPath").value.trim(),
    downloadMode: currentMode(),
    toggles: { files: $("#chkFiles").checked, images: $("#chkImages").checked }
  };
}

function bind() {
  bindTabs();
  document.querySelectorAll('input[name="downloadMode"], input[name="settingsDownloadMode"]').forEach((inp) => {
    inp.addEventListener("change", () => {
      if (inp.disabled || !inp.checked) return;
      document.querySelectorAll('input[name="downloadMode"], input[name="settingsDownloadMode"]').forEach((other) => {
        other.checked = other.value === inp.value;
      });
      applySettingsVisibility(inp.value);
      send({ type: "saveSettings", settings: { downloadMode: inp.value } });
    });
  });
  $("#saveBtn").addEventListener("click", async () => {
    const r = await send({ type: "saveSettings", settings: collectSettings() });
    $("#saveStatus").textContent = r.ok ? "已保存" : (r.error || "失败");
    await loadUi();
  });
  $("#serverAddBtn").addEventListener("click", () => {
    $("#serverAddForm").style.display = "block";
    $("#serverUrlNew").value = "";
    $("#serverPasswordNew").value = "";
  });
  $("#serverAddCancel").addEventListener("click", () => { $("#serverAddForm").style.display = "none"; });
  $("#serverAddConfirm").addEventListener("click", async () => {
    const r = await send({ type: "addServer", url: $("#serverUrlNew").value.trim(), password: $("#serverPasswordNew").value });
    setStatus($("#serverStatus"), r.ok ? "已添加" : (r.error || "失败"), r.ok ? "ok" : "err");
    if (r.ok) { $("#serverAddForm").style.display = "none"; await loadUi(); }
  });
  $("#serverDelBtn").addEventListener("click", async () => {
    const url = $("#serverSelect").value;
    if (!url) return;
    const r = await send({ type: "deleteServer", url });
    setStatus($("#serverStatus"), r.ok ? "已删除" : (r.error || "失败"), r.ok ? "ok" : "err");
    await loadUi();
  });
  $("#serverSelect").addEventListener("change", async () => {
    const r = await send({ type: "selectServer", url: $("#serverSelect").value });
    if (r.ok) await loadUi();
  });
  $("#testServerBtn").addEventListener("click", async () => {
    await send({ type: "saveSettings", settings: collectSettings() });
    const r = await send({ type: "probeEnv" });
    setStatus($("#serverStatus"), r.env && r.env.server ? "服务端在线" : (r.error || "未连接"), r.env && r.env.server ? "ok" : "err");
    fillModes(r.env || {}, currentMode());
  });
  $("#testAria2Btn").addEventListener("click", async () => {
    await send({ type: "saveSettings", settings: collectSettings() });
    const r = await send({ type: "probeEnv" });
    setStatus($("#aria2Status"), r.env && r.env.aria2 ? "Aria2 可用" : "未通", r.env && r.env.aria2 ? "ok" : "err");
    fillModes(r.env || {}, currentMode());
  });
  $("#batchBtn").addEventListener("click", async () => {
    const lines = $("#batchInput").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const r = await send({
      type: "startDownload",
      links: lines,
      mode: currentMode(),
      toggles: { files: $("#chkFiles").checked, images: $("#chkImages").checked }
    });
    setStatus($("#batchStatus"), r.ok ? "已提交 " + (r.count || lines.length) + " 项" : (r.error || "失败"), r.ok ? "ok" : "err");
    loadUi();
  });
  $("#clearBtn").addEventListener("click", () => { $("#batchInput").value = ""; });
  $("#kwSearchBtn").addEventListener("click", async () => {
    setStatus($("#searchStatus"), "搜索中…");
    const r = await send({ type: "keywordSearch", query: $("#kwInput").value.trim(), game: $("#searchGame").value.trim(), nsfw: $("#filterNsfw").checked, normal: $("#filterNormal").checked });
    if (!r.ok) { setStatus($("#searchStatus"), r.error || "失败", "err"); return; }
    renderSearch(r.results);
    setStatus($("#searchStatus"), "共 " + (r.results || []).length + " 条", "ok");
  });
  $("#timeSearchBtn").addEventListener("click", async () => {
    setStatus($("#searchStatus"), "按时间搜索中…");
    const contentFilter = [];
    if ($("#filterNormal").checked) contentFilter.push("normal");
    if ($("#filterNsfw").checked) contentFilter.push("nsfw");
    const r = await send({
      type: "timeSearch",
      game: $("#searchGame").value.trim(),
      startDate: $("#searchStart").value,
      endDate: $("#searchEnd").value,
      contentFilter
    });
    if (!r.ok) { setStatus($("#searchStatus"), r.error || "失败", "err"); return; }
    for (let i = 0; i < 90; i++) {
      const st = await send({ type: "searchStatus" });
      renderSearch(st.results);
      setStatus($("#searchStatus"), (st.message || st.status || "搜索中") + "（" + ((st.results || []).length) + "）", st.status === "done" ? "ok" : "");
      if (st.status && st.status !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
  $("#stopSearchBtn").addEventListener("click", async () => {
    const r = await send({ type: "stopSearch" });
    setStatus($("#searchStatus"), r.ok ? "已停止搜索" : (r.error || "停止失败"), r.ok ? "ok" : "err");
  });
  $("#downloadSearchBtn").addEventListener("click", async () => {
    const items = selectedSearch();
    const links = items.map((it) => it.url || it.id).filter(Boolean);
    const r = await send({
      type: "startDownload",
      links,
      mode: currentMode(),
      toggles: { files: $("#chkFiles").checked, images: $("#chkImages").checked }
    });
    setStatus($("#searchStatus"), r.ok ? "已提交下载" : (r.error || "失败"), r.ok ? "ok" : "err");
  });
  $("#searchSelectAll").addEventListener("click", () => document.querySelectorAll(".sr-chk").forEach((c) => { c.checked = true; }));
  $("#searchSelectNone").addEventListener("click", () => document.querySelectorAll(".sr-chk").forEach((c) => { c.checked = false; }));
  $("#removeCompletedBtn").addEventListener("click", async () => {
    await send({ type: "removeCompleted" });
    loadUi();
  });
  $("#sendCookieBtn").addEventListener("click", async () => {
    const r = await send({ type: "sendCookieToServer" });
    setStatus($("#batchStatus"), r.ok ? "已发送 Cookie" : (r.error || "失败"), r.ok ? "ok" : "err");
  });
  $("#injectCookieBtn").addEventListener("click", async () => {
    const r = await send({ type: "injectCookieFromServer" });
    setStatus($("#batchStatus"), r.ok ? "已注入 Cookie" : (r.error || "失败"), r.ok ? "ok" : "err");
  });
  $("#importMappingBtn").addEventListener("click", () => $("#importMappingFile").click());
  $("#importMappingFile").addEventListener("change", async (ev) => {
    const files = [...(ev.target.files || [])];
    for (const f of files) {
      const text = await f.text();
      const r = await send({ type: "importMapping", name: f.name, text });
      setStatus($("#mappingStatus"), r.ok ? "已导入 " + f.name : (r.error || "失败"), r.ok ? "ok" : "err");
    }
    ev.target.value = "";
    loadUi();
  });
  $("#browsePathBtn").addEventListener("click", async () => {
    const r = await send({ type: "browseFolder" });
    if (r && r.path) $("#nativeDownloadPath").value = r.path;
  });
}

bind();
loadUi().catch((e) => setStatus($("#batchStatus"), String(e && e.message || e), "err"));

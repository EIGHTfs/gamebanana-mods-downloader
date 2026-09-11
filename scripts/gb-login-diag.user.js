// ==UserScript==
// @name         GB 登录诊断工具
// @namespace    gbmd-diag
// @version      1.0.0
// @description  诊断 GB 登录态：UA / cookie / v13 UiConfig 实测结果，一键复制全部
// @author       EIGHTfs
// @match        https://gamebanana.com/*
// @match        https://www.gamebanana.com/*
// @grant        GM_cookie.list
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    function addBtn() {
        if (document.getElementById("gb-diag-btn")) return;
        const btn = document.createElement("button");
        btn.id = "gb-diag-btn";
        btn.textContent = "🔍 诊断";
        btn.title = "GB 登录诊断";
        Object.assign(btn.style, {
            position: "fixed", right: "14px", bottom: "80px", zIndex: 2147483647,
            width: "48px", height: "48px", borderRadius: "50%", border: "none",
            background: "#e74c3c", color: "#fff", fontSize: "20px", cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,.3)"
        });
        btn.addEventListener("click", runDiag);
        document.documentElement.appendChild(btn);
    }

    function showPanel(html) {
        let el = document.getElementById("gb-diag-panel");
        if (!el) {
            el = document.createElement("div");
            el.id = "gb-diag-panel";
            Object.assign(el.style, {
                position: "fixed", left: "10px", right: "10px", top: "10px",
                zIndex: 2147483647, maxHeight: "90vh", overflow: "auto",
                background: "#1a1a2e", color: "#eee", padding: "16px",
                borderRadius: "12px", fontSize: "13px", fontFamily: "monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "1.5",
                boxShadow: "0 8px 32px rgba(0,0,0,.6)"
            });
            document.documentElement.appendChild(el);
        }
        el.innerHTML = html;
    }

    function readCookieGM() {
        return new Promise((resolve) => {
            try {
                if (typeof GM_cookie === "undefined" || !GM_cookie || typeof GM_cookie.list !== "function") {
                    resolve({ text: document.cookie, source: "document.cookie", error: "GM_cookie不可用" });
                    return;
                }
                GM_cookie.list({}, (cookies, error) => {
                    if (error) { resolve({ text: document.cookie, source: "document.cookie", error: String(error) }); return; }
                    const gb = (cookies || []).filter(c => c && c.domain && c.domain.includes("gamebanana.com"));
                    const list = gb.map(c => c.name + "=" + c.value).filter(Boolean);
                    resolve({ text: list.join("; "), source: "GM_cookie(" + gb.length + "个)", cookies: gb });
                });
            } catch (e) {
                resolve({ text: document.cookie, source: "document.cookie", error: e.message });
            }
        });
    }

    async function runDiag() {
        const btn = document.getElementById("gb-diag-btn");
        if (btn) { btn.textContent = "⏳"; btn.disabled = true; }

        const L = [];
        const sep = "─".repeat(50);

        // 1. UA
        const ua = navigator.userAgent;
        L.push("【1】浏览器 UA:");
        L.push(ua);
        L.push(sep);

        // 2. Cookie
        const ck = await readCookieGM();
        L.push("【2】Cookie 来源: " + ck.source);
        if (ck.error) L.push("⚠ " + ck.error);
        const hasSess = /(?:^|;\s*)sess=/.test(ck.text);
        const hasRmc = /(?:^|;\s*)rmc=/.test(ck.text);
        const hasCfBm = /(?:^|;\s*)__cf_bm=/.test(ck.text);
        const hasCfClearance = /(?:^|;\s*)cf_clearance=/.test(ck.text);
        L.push("含 sess: " + (hasSess ? "✅" : "❌"));
        L.push("含 rmc: " + (hasRmc ? "✅" : "❌"));
        L.push("含 __cf_bm: " + (hasCfBm ? "✅ 有" : "❌ 无"));
        L.push("含 cf_clearance: " + (hasCfClearance ? "✅ 有" : "❌ 无"));
        L.push("总长度: " + ck.text.length + " 字符");

        // 列出所有cookie名称
        if (ck.cookies) {
            L.push("所有cookie名: " + ck.cookies.map(c => c.name).join(", "));
        }

        // 提取关键cookie的值
        const sessMatch = ck.text.match(/(?:^|;\s*)sess=([^;]+)/);
        const rmcMatch = ck.text.match(/(?:^|;\s*)rmc=([^;]+)/);
        const cfBmMatch = ck.text.match(/(?:^|;\s*)__cf_bm=([^;]+)/);
        const cfClearMatch = ck.text.match(/(?:^|;\s*)cf_clearance=([^;]+)/);
        if (sessMatch) L.push("sess值: " + sessMatch[1].substring(0, 20) + "...");
        if (rmcMatch) L.push("rmc值: " + rmcMatch[1].substring(0, 20) + "...");
        if (cfBmMatch) L.push("__cf_bm值: " + cfBmMatch[1]);
        if (cfClearMatch) L.push("cf_clearance值: " + cfClearMatch[1].substring(0, 40) + "...");
        L.push(sep);

        // 3. v13 UiConfig 实测（浏览器内fetch）
        L.push("【3】浏览器 fetch v13 UiConfig:");
        try {
            const r = await fetch("/apiv13/Member/UiConfig?_sUrl=" + encodeURIComponent(location.pathname), {
                headers: { "Accept": "application/json" }
            });
            const d = await r.json();
            L.push("_bIsLoggedIn: " + d._bIsLoggedIn);
            L.push("_idMemberRow: " + (d._idMemberRow || "(无)"));

            if (d._bIsLoggedIn && d._idMemberRow) {
                try {
                    const r2 = await fetch("/apiv13/Member/" + d._idMemberRow + "/ProfilePage", {
                        headers: { "Accept": "application/json" }
                    });
                    const m = await r2.json();
                    L.push("用户名: " + (m._sName || "(无)"));
                    L.push("主页: " + (m._sProfileUrl || "(无)"));
                } catch (e) {
                    L.push("获取用户名失败: " + e.message);
                }
            }
        } catch (e) {
            L.push("fetch失败: " + e.message);
        }
        L.push(sep);

        // 4. 对比信息
        L.push("【4】请求 URL:");
        L.push(location.origin + "/apiv13/Member/UiConfig?_sUrl=" + encodeURIComponent(location.pathname));
        L.push("Referer: " + location.href);
        L.push(sep);

        // 组装结果
        const result = L.join("\n");
        showPanel(result + "\n\n<button id='gb-diag-copy' style='margin-top:8px;padding:8px 16px;border:none;border-radius:6px;background:#2f6fed;color:#fff;cursor:pointer;font-size:14px'>📋 复制全部</button> <button id='gb-diag-close' style='padding:8px 16px;border:none;border-radius:6px;background:#555;color:#fff;cursor:pointer;font-size:14px'>✕ 关闭</button>");

        document.getElementById("gb-diag-copy").addEventListener("click", () => {
            if (typeof GM_setClipboard === "function") GM_setClipboard(result, "text");
            else navigator.clipboard.writeText(result).catch(() => {});
            document.getElementById("gb-diag-copy").textContent = "✅ 已复制";
        });
        document.getElementById("gb-diag-close").addEventListener("click", () => {
            document.getElementById("gb-diag-panel").remove();
        });

        if (btn) { btn.textContent = "🔍"; btn.disabled = false; }
    }

    addBtn();
    setInterval(addBtn, 5000);
})();

#!/usr/bin/env node
// ============================================================
// page-shot.mjs —— 通用网页截图脚本（模板下发件，下游**可选接入**）
//
// 用途：改完前端后做「真实渲染自检」——自动登录 + 逐个标签页截图 + 收集前端错误，
//   而不是只 curl 看 HTML（curl 拿不到 JS 渲染后的页面）。
//
// 可选接入方式：在项目 assemble.json 的 files 里加一行
//   "templates/tools/page-shot.mjs": "scripts/page-shot.mjs"
//   （不加就不下发；三个下游项目共用同一套 .tab[data-tab] 结构，默认流程直接可用）
//
// 用法：
//   node scripts/page-shot.mjs                                  # 自动推导端口 + 自动登录 + 逐标签截图
//   node scripts/page-shot.mjs --base http://<host>:8642 --password <访问密码>
//   node scripts/page-shot.mjs --tabs download,search,settings   # 只截指定标签
//   node scripts/page-shot.mjs --plan shots.json                 # 自定义步骤（见下）
//   node scripts/page-shot.mjs --help
//
// 参数（都可用环境变量兜底）：
//   --base <url>        起始地址；默认 http://127.0.0.1:<server/config.json 的 port>
//   --password <pwd>    访问密码（走 #pwd 自动登录）；env PAGE_SHOT_PWD
//   --out <dir>         截图目录；默认 <系统临时目录>/page-shots-<时间戳>（不碰仓库）
//   --tabs a,b,c        要截的标签；默认自动发现页面上的 .tab[data-tab=…]
//   --no-full           只截视口（默认整页 fullPage）
//   --plan <file>       自定义步骤 JSON（数组），每步支持：
//                         {"goto":"/path"} | {"click":"选择器"} | {"fill":["选择器","值"]}
//                         | {"wait":1500} | {"shot":"名字"}
//   --timeout <ms>      单步超时（默认 30000）
//
// 浏览器来源（与 headless-browser-env.mjs 同一套约定，无需硬编码路径）：
//   ① 环境变量 DSH_PAGE_CHROME / DSH_PAGE_LIBS / DSH_PAGE_FONTCONF / DSH_PAGE_PWROOT
//   ② <DSH_HOME>/browser-env.json（跑 `node headless-browser-env.mjs register` 生成）
//   ③ 自动探测：pwviewer/browsers、playwright 缓存、系统 chromium
//   截图用 headless_shell 也可以（只有过 Cloudflare 挑战才必须完整 chrome）。
//
// 退出码：0 成功；2 环境/参数问题；1 运行异常。
// ============================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const has = (name) => argv.includes("--" + name);

if (has("help") || argv.includes("-h")) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

// ---------- 项目根与端口（脚本位于 <repo>/scripts/ 或模板里的 templates/tools/） ----------
function findRepoRoot() {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "server", "config.json")) || fs.existsSync(path.join(dir, "assemble.json"))) return dir;
    dir = path.resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = findRepoRoot();
function portFromConfig() {
  for (const p of [path.join(ROOT, "server", "config.json"), path.join(ROOT, "server", "config.example.json")]) {
    try { const c = JSON.parse(fs.readFileSync(p, "utf8")); if (c && c.port) return Number(c.port); } catch (_) { /* 继续找 */ }
  }
  return 0;
}
const PORT = portFromConfig() || 8642;
const BASE = (flag("base", process.env.PAGE_SHOT_BASE) || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const PASSWORD = flag("password", process.env.PAGE_SHOT_PWD) || "";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(flag("out", process.env.PAGE_SHOT_OUT) || path.join(os.tmpdir(), "page-shots-" + STAMP));
const FULL = !has("no-full");
const TIMEOUT = Number(flag("timeout", "30000")) || 30000;
const WANT_TABS = (flag("tabs", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const PLAN_FILE = flag("plan", "");

// ---------- 浏览器环境：env → <DSH_HOME>/browser-env.json → 自动探测 ----------
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
function readRegistry() {
  const cands = [process.env.PAGE_SHOT_REGISTRY, path.join(DSH_HOME, "browser-env.json")].filter(Boolean);
  for (const c of cands) { try { return { path: c, data: JSON.parse(fs.readFileSync(c, "utf8")) }; } catch (_) { /* 下一个 */ } }
  return { path: path.join(DSH_HOME, "browser-env.json"), data: {} };
}
const REG = readRegistry();
const firstExisting = (list) => { for (const p of list) if (p && fs.existsSync(p)) return p; return ""; };

function findChrome() {
  const reg = REG.data;
  const explicit = [process.env.DSH_PAGE_CHROME, process.env.PAGE_SHOT_CHROME, reg.chrome].filter(Boolean);
  const hit = firstExisting(explicit);
  if (hit) return hit;
  const roots = [process.env.DSH_PAGE_PWROOT, process.env.PAGE_SHOT_PWROOT, reg.pwroot, reg.sharedRoot && path.join(reg.sharedRoot, "pwviewer")].filter(Boolean);
  const subs = ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell"];
  for (const root of roots) {
    const base = path.join(root, "browsers");
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).filter((x) => /^chromium/i.test(x)).sort().reverse()) {
      const p = firstExisting(subs.map((s) => path.join(base, d, s)));
      if (p) return p;
    }
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((x) => /^chromium/i.test(x)).sort().reverse()) {
      const p = firstExisting(["chrome-linux64/chrome", "chrome-linux/chrome"].map((s) => path.join(cache, d, s)));
      if (p) return p;
    }
  }
  return "";
}
function findPwRoot() {
  const reg = REG.data;
  const cands = [process.env.DSH_PAGE_PWROOT, process.env.PAGE_SHOT_PWROOT, reg.pwroot].filter(Boolean);
  for (const start of [ROOT, path.dirname(new URL(import.meta.url).pathname)]) {
    let dir = start;
    for (let i = 0; i < 5; i++) { dir = path.resolve(dir, ".."); cands.push(dir, path.join(dir, "pwviewer")); }
  }
  return cands.find((p) => p && fs.existsSync(path.join(p, "node_modules", "playwright"))) || "";
}

const CHROME = findChrome();
const PWROOT = findPwRoot();
const LIBS = process.env.DSH_PAGE_LIBS || process.env.PAGE_SHOT_LIBS || REG.data.libs || "";
const FONTS = process.env.DSH_PAGE_FONTCONF || process.env.PAGE_SHOT_FONTS || REG.data.fontconf || "";
let chromium = null;
try { chromium = require("playwright").chromium; } catch (_) {
  try { chromium = require(path.join(PWROOT, "node_modules", "playwright")).chromium; } catch (_) { chromium = null; }
}
if (!chromium || !CHROME) {
  console.error("❌ 缺无头浏览器环境（playwright=" + !!chromium + " chrome=" + (CHROME || "无") + "）");
  console.error("   解决：node headless-browser-env.mjs register（生成 " + REG.path + "），或设 DSH_PAGE_CHROME / DSH_PAGE_PWROOT");
  process.exit(2);
}

// ---------- 跑起来 ----------
const shots = [];
const errors = [];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log("═══ 网页截图 ═══");
  console.log("  地址    : " + BASE);
  console.log("  浏览器  : " + CHROME);
  console.log("  libs    : " + (LIBS || "(无)") + " | fonts: " + (FONTS || "(无)"));
  console.log("  输出    : " + OUT);

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env: Object.assign({}, process.env, LIBS ? { LD_LIBRARY_PATH: LIBS } : {}, FONTS ? { FONTCONFIG_FILE: FONTS } : {}),
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on("pageerror", (e) => errors.push({ type: "pageerror", text: String(e).slice(0, 300) }));
  page.on("console", (m) => { if (m.type() === "error") errors.push({ type: "console.error", text: m.text().slice(0, 300) }); });

  const shot = async (name) => {
    const file = path.join(OUT, String(shots.length).padStart(2, "0") + "-" + name.replace(/[^\w.-]/g, "_") + ".png");
    await page.screenshot({ path: file, fullPage: FULL }).catch((e) => console.log("  ⚠ 截图失败 " + name + ": " + e.message));
    shots.push({ name, file });
    console.log("  📷 " + name + " → " + file);
  };

  console.log("\n① 打开 " + BASE);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: TIMEOUT });

  // 自动登录：页面上有 #pwd 就填密码提交（模板家族统一用 #pwd/#btn）
  if (await page.$("#pwd")) {
    if (!PASSWORD) { console.log("  ⚠ 页面要求登录但未提供 --password/PAGE_SHOT_PWD，跳过登录"); }
    else {
      console.log("② 自动登录");
      await page.fill("#pwd", PASSWORD);
      const rem = await page.$("#remember"); if (rem) await rem.check().catch(() => {});
      const btn = (await page.$("#btn")) || (await page.$("button[type=submit]"));
      if (btn) { await btn.click(); } else { await page.press("#pwd", "Enter"); }
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForTimeout(1000);
  await shot("landing");

  // 逐个标签页截图：自动发现 .tab[data-tab=…]
  const tabs = await page.$$eval(".tab[data-tab]", (els) => els.map((e) => e.getAttribute("data-tab"))).catch(() => []);
  const wanted = WANT_TABS.length ? tabs.filter((t) => WANT_TABS.includes(t)) : tabs;
  if (wanted.length) {
    console.log("③ 逐标签截图（发现 " + tabs.join(",") + "）");
    for (const t of wanted) {
      const el = await page.$('.tab[data-tab="' + t + '"]');
      if (!el) continue;
      await el.click().catch(() => {});
      await page.waitForTimeout(1200);
      await shot("tab-" + t);
    }
  } else {
    console.log("③ 未发现 .tab[data-tab] 标签，跳过逐标签截图");
  }

  // 自定义步骤
  if (PLAN_FILE) {
    const steps = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
    console.log("④ 自定义步骤 " + steps.length + " 步（" + PLAN_FILE + "）");
    for (const s of steps) {
      if (s.goto) await page.goto(s.goto.startsWith("http") ? s.goto : BASE + s.goto, { waitUntil: "domcontentloaded", timeout: TIMEOUT }).catch((e) => console.log("  ⚠ goto 失败: " + e.message));
      if (s.click) await page.click(s.click).catch((e) => console.log("  ⚠ click 失败 " + s.click + ": " + e.message));
      if (s.fill) await page.fill(s.fill[0], s.fill[1]).catch((e) => console.log("  ⚠ fill 失败 " + s.fill[0] + ": " + e.message));
      if (s.wait) await page.waitForTimeout(Number(s.wait) || 1000);
      if (s.shot) await shot(s.shot);
    }
  }

  const index = { base: BASE, at: new Date().toISOString(), full: FULL, chrome: CHROME, libs: LIBS, fonts: FONTS, shots, errors };
  const indexPath = path.join(OUT, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  await browser.close();

  console.log("\n═══ 结果 ═══");
  console.log("  截图 " + shots.length + " 张 → " + OUT);
  console.log("  索引 " + indexPath);
  console.log("  前端错误 " + errors.length + " 条" + (errors.length ? "（前 3 条）" : "（无 ✓）"));
  for (const e of errors.slice(0, 3)) console.log("    · [" + e.type + "] " + e.text.slice(0, 120));
  process.exit(0);
})().catch((e) => { console.error("FATAL: " + String((e && e.stack) || e).slice(0, 500)); process.exit(1); });

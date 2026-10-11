// ============================================================
// GameBanana Mod Downloader - hash 反查（按游戏分文件版，2026-09-02改造）
//   索引从全局 3 文件（gb/local/html-name）改为「每游戏一个文件」：
//     json/index/<游戏名>.json  →  { game, gb: {...}, local: {...}, name: {...} }
//   游戏名 = gb-api fetchGameInfo(gameId)._sName（GB 官方英文名，稳定权威）。
//   启动时合并全部游戏文件进内存（查询/搜索跨游戏全库），写入按游戏拆分：
//     · rebuild(game?)：game 指定 → 只重建该游戏索引；不指定 → 全部游戏
//     · ingestModDir：下载增量更新该游戏文件（obj.game 定位）
//   旧全局 3 文件（json/gb-hash-index.json 等）首次启动自动按 game 拆分迁移后删除。
//   查询：本地表优先（能定位到本地路径），无则查 GB 表（只有线上信息）。
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");

const JSON_DIR = process.env.GBMD_JSON_DIR ? path.resolve(process.env.GBMD_JSON_DIR) : path.join(__dirname, "..", "..", "json");
const INDEX_DIR = path.join(JSON_DIR, "index"); //userdata-manifest.json dir json/index .json 按游戏拆分的哈希/原名索引
const LEGACY_FILES = [
  path.join(JSON_DIR, "gb-hash-index.json"),
  path.join(JSON_DIR, "local-hash-index.json"),
  path.join(JSON_DIR, "html-name-index.json")
];
const organize = require("./organize"); // 2026-08-26 下载时/rebuild 时自动整理
// 2026-10-12：可选动作的实现（重写 description.html / 补算图片内容 md5），与 CLI 脚本共用同一份
const { rebuildFromObj, loadDone, saveDone } = require("./rebuild-html");
const cfg = require("../config"); // 2026-08-30 autoOrganize 开关
const mapping = require("./mapping"); // 2026-09-02 游戏名→索引文件名复用字符替换映射文件（illegalChars.json）
const { parseIndexObj, readIndexObj } = require("./index-html");

// ---------- 内存表（跨游戏全库合并，查询用）----------
let gbIndex = new Map();      // hash -> {modId, modName, author, game, url, fileName, gbMd5}
let localIndex = new Map();   // hash -> {modDir, file, hash, gbMd5}
let nameIndex = new Map();    // GB 原名(短名/压缩包名) -> {modId, modName, author, game, url, kind}
// 2026-10-11 新增：**去掉后缀的 GB 原名** -> 同名条目（查询不带后缀时用，如输入 69b46e18405cc 命中 69b46e18405cc.jpg）
//   只存在于内存（不落盘、不进 name 表），由 mergeAll 重建 + ingest 时增量补；首见优先。
let stemIndex = new Map();
/** 取名字的「无后缀」形态（小写、去尾部 .ext） */
function stemOf(name) {
  return String(name || "").toLowerCase().trim().replace(/\.[a-z0-9]+$/i, "");
}
let loadedGames = new Map();  // game -> { game, gb: Map, local: Map, name: Map }（每游戏内存副本）
let buildState = { running: false, lastAt: 0, lastMs: 0, error: "" };

// ---------- 文件读写 ----------
function loadMap(file) {
  try {
    const obj = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Map(Object.entries(obj || {}));
  } catch (_) { return new Map(); }
}

function saveMap(file, map) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(map), null, 2));
    return true;
  } catch (_) { return false; }
}

// 2026-09-02：游戏名来自 gbApi fetchGameInfo(id)._sName（GB 官方英文名，权威稳定）。
//   索引文件名复用 mapping.sanitizeName（走 mapping/illegalChars.json 字符替换映射：
//   冒号→全角、斜杠→空格等，与下载目录命名规则一致），不再单独写一套下划线替换。
function sanitizeGameName(g) {
  return mapping.sanitizeName(g) || "unknown";
}

function gameIndexFile(game) {
  return path.join(INDEX_DIR, sanitizeGameName(game) + ".json");
}

// 读单游戏索引文件（无 → null）
function loadGameFile(game) {
  try {
    const obj = JSON.parse(fs.readFileSync(gameIndexFile(game), "utf8"));
    return {
      game: obj.game || game,
      gb: new Map(Object.entries(obj.gb || {})),
      local: new Map(Object.entries(obj.local || {})),
      name: new Map(Object.entries(obj.name || {}))
    };
  } catch (_) { return null; }
}

// 写单游戏索引文件
function saveGameFile(game, g) {
  try {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(gameIndexFile(game), JSON.stringify({
      game: g.game || game,
      gb: Object.fromEntries(g.gb),
      local: Object.fromEntries(g.local),
      name: Object.fromEntries(g.name)
    }, null, 2));
    return true;
  } catch (_) { return false; }
}

// 合并进全局查询表（全库）
function mergeInto(globalMap, perGameMap) {
  for (const [k, v] of perGameMap) if (!globalMap.has(k)) globalMap.set(k, v);
}

function mergeAll() {
  gbIndex = new Map();
  localIndex = new Map();
  nameIndex = new Map();
  for (const g of loadedGames.values()) {
    mergeInto(gbIndex, g.gb);
    mergeInto(localIndex, g.local);
    mergeInto(nameIndex, g.name);
  }
  // 2026-10-11：同步重建「无后缀名」索引（只登记真正带后缀的名字，首见优先）
  stemIndex = new Map();
  for (const [k, v] of nameIndex) {
    const st = stemOf(k);
    if (st && st !== k && !stemIndex.has(st)) stemIndex.set(st, { ...v, matchedName: k });
  }
}

// ---------- 旧全局文件一次性迁移（json/gb-hash-index.json 等 → json/index/<游戏>.json）----------
// 旧条目值带 game 字段（gbMeta.game），按 game 拆分；game 缺失归 "unknown"。
function migrateLegacy() {
  try { fs.mkdirSync(INDEX_DIR, { recursive: true }); } catch (_) {}
  const hasNew = (() => {
    try { return fs.readdirSync(INDEX_DIR).some((f) => f.endsWith(".json")); } catch (_) { return false; }
  })();
  if (hasNew) return;
  const gb = loadMap(LEGACY_FILES[0]);
  const local = loadMap(LEGACY_FILES[1]);
  const name = loadMap(LEGACY_FILES[2]);
  if (!gb.size && !local.size && !name.size) return;
  const bucket = new Map(); // game(原始名) -> {game, gb, local, name}
  const getBucket = (game) => {
    const raw = String(game || "unknown").trim() || "unknown"; // 存原始名，文件名才用 sanitize
    if (!bucket.has(raw)) bucket.set(raw, { game: raw, gb: new Map(), local: new Map(), name: new Map() });
    return bucket.get(raw);
  };
  for (const [k, v] of gb) getBucket(v && v.game).gb.set(k, v);
  for (const [k, v] of local) getBucket(v && v.game).local.set(k, v);
  for (const [k, v] of name) getBucket(v && v.game).name.set(k, v);
  let migrated = 0;
  for (const g of bucket.values()) {
    if (saveGameFile(g.game, g)) migrated++;
  }
  // 迁移成功后才删旧文件
  if (migrated > 0) {
    for (const f of LEGACY_FILES) { try { fs.unlinkSync(f); } catch (_) {} }
    console.log(`[hash-index] 旧全局索引已迁移：${migrated} 个游戏文件 → json/index/`);
  }
  return migrated;
}

// ---------- HTML 索引块解析（抽到 lib/index-html.js，P2 去重）----------

// ---------- 启动加载 ----------
function load() {
  try { migrateLegacy(); } catch (_) {}
  loadedGames = new Map();
  let files = [];
  try { files = fs.readdirSync(INDEX_DIR).filter((f) => f.endsWith(".json")); } catch (_) {}
  for (const f of files) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, f), "utf8"));
      const g = {
        game: obj.game || f.replace(/\.json$/, ""),
        gb: new Map(Object.entries(obj.gb || {})),
        local: new Map(Object.entries(obj.local || {})),
        name: new Map(Object.entries(obj.name || {}))
      };
      loadedGames.set(g.game, g);
    } catch (_) {}
  }
  mergeAll();
  return { gb: gbIndex.size, local: localIndex.size, name: nameIndex.size, games: loadedGames.size };
}

// ---------- 查询（HTML 反查）----------
// 返回 { source: "local"|"gb"|"html", ... }；找不到返回 null
// 优先 hash 精确（本地表→GB 表），再按 GB 原名（短名/压缩包名）反查 HTML 索引
// 2026-08-26：GB 原名查询忽略后缀——输入 "69b46e18405cc" 或 "69b46e18405cc.jpg" 都命中
function queryByHash(hash) {
  const raw = String(hash || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const local = localIndex.get(key);
  if (local) return { source: "local", ...local };
  const gb = gbIndex.get(key);
  if (gb) return { source: "gb", ...gb };
  // HTML 反查：GB 原名（图片短名如 69b46e18405cc.jpg / 压缩包名）
  const byName = nameIndex.get(key);
  if (byName) return { source: "html", ...byName, file: byName.fileName || byName.file || key, kind: byName.kind || "file", modDir: "" };
  // 2026-10-11 修：**忽略已记录名的后缀**再查一次——原来只在「查询带后缀」时补后缀（方向反了，
  //   输入 69b46e18405cc 命不中已记录的 69b46e18405cc.jpg）。现在用 stemIndex 双向覆盖：
  //   查询不带后缀 → 直接命中；查询带后缀 → 用其无后缀形态命中。
  const byStem = stemIndex.get(key.replace(/\.[a-z0-9]+$/i, ""));
  if (byStem) return { source: "html", ...byStem, file: byStem.fileName || byStem.matchedName || key, kind: byStem.kind || "file", modDir: "" };
  // 旧逻辑（只在查询带后缀时补全后缀；已被 stemIndex 覆盖，注释保留备查）：
  // const noExt = key.replace(/\.[a-z0-9]+$/i, "");
  // if (noExt !== key) {
  //   const byName2 = nameIndex.get(noExt);
  //   if (byName2) return { source: "html", ...byName2, file: byName2.fileName || byName2.file || key, kind: byName2.kind || "file", modDir: "" };
  //   for (const ext of [".jpg", ".png", ".jpeg", ".gif", ".webp"]) {
  //     const cand = nameIndex.get(noExt + ext);
  //     if (cand) return { source: "html", ...cand, file: cand.fileName || cand.file || key, kind: cand.kind || "file", modDir: "" };
  //   }
  // }
  return null;
}

// ---------- GB 表模糊搜索（2026-08-26：当离线 mod 目录用）----------
// 按 mod 名/作者 模糊匹配 GB 表，按 modId 去重；标注该 mod 是否本地已下载（本地表命中任一 hash）。
// 返回 [{modId, modName, author, game, url, fileCount, hasLocal}]
function searchGb(keyword, gameFilter) {
  const q = String(keyword || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const gf = String(gameFilter || "").trim().toLowerCase();
  const mods = new Map(); // modId -> 聚合
  for (const info of gbIndex.values()) {
    const name = String(info.modName || "").toLowerCase();
    const author = String(info.author || "").toLowerCase();
    if (!name.includes(q) && !author.includes(q)) continue;
    if (gf && String(info.game || "").toLowerCase() !== gf) continue;
    const modId = String(info.modId || (info.url || "").replace(/^.*mods\/(\d+).*$/, "$1") || info.modName || "");
    if (!mods.has(modId)) {
      mods.set(modId, {
        modId, modName: info.modName || "", author: info.author || "",
        game: info.game || "", url: info.url || "", fileCount: 0, hasLocal: false
      });
    }
    const m = mods.get(modId);
    m.fileCount++;
    // hasLocal：任一文件 hash 在本地表
    if (!m.hasLocal) {
      const hk = String(info.gbMd5 || "").toLowerCase().trim();
      if (hk && localIndex.has(hk)) m.hasLocal = true;
    }
  }
  return [...mods.values()].sort((a, b) => String(b.modName).localeCompare(String(a.modName), "en"));
}

// ---------- 下载时增量追加（2026-08-26：每次新下载顺手更新）----------
// 从单个 mod 目录的 description.html 提取，更新该游戏（obj.game）的索引文件（只增不删）
// 2026-10-12：延迟落盘标记——批量收尾时每个 mod 目录都写一次游戏索引，而单份索引 15–26MB
//   （Impact.json 26.4MB / Waves.json 21.4MB / Rail.json 16.8MB / Zero.json 15.7MB），
//   数千目录 ⇒ 几十 GB 写盘、收尾 634 秒、/api/* 被堵死。改为：批量期间只更新内存，结束后各写一次。
const dirtyGames = new Set();

/**
 * 批量结束后统一落盘：把 deferSave 期间标记为脏的游戏索引各写一次。
 * @returns {number} 实际写入的游戏数
 */
function flushDirtyGames() {
  let saved = 0;
  for (const game of dirtyGames) {
    const g = loadedGames.get(game);
    if (g && saveGameFile(game, g)) saved++;
  }
  dirtyGames.clear();
  return saved;
}

/**
 * 把某个 mod 目录的文件/图片名与 hash 并入反查索引。
 * @param {string} modDir
 * @param {{deferSave?: boolean}} [opts] deferSave=true 时只更新内存，由调用方在批量结束后 flushDirtyGames()
 */
function ingestModDir(modDir, opts) {
  if (!modDir || !fs.existsSync(path.join(modDir, "description.html"))) return { gbAdded: 0, localAdded: 0 };
  const obj = readIndexObj(modDir);
  if (!obj) return { gbAdded: 0, localAdded: 0 };

  const game = obj.game || "unknown";
  let g = loadedGames.get(game);
  if (!g) {
    g = loadGameFile(game) || { game, gb: new Map(), local: new Map(), name: new Map() };
    loadedGames.set(game, g);
  }

  const gbMeta = {
    modId: obj.modId || (obj.url || "").replace(/^.*mods\/(\d+).*$/, "$1") || "",
    modName: obj.name || "",
    author: obj.author || "",
    game: obj.game || "",
    url: obj.url || ""
  };

  let gbAdded = 0, localAdded = 0;

  const putGb = (gbMd5, fileName) => {
    const key = String(gbMd5 || "").toLowerCase().trim();
    if (!key) return;
    if (!g.gb.has(key)) { g.gb.set(key, { ...gbMeta, fileName, gbMd5: key }); gbAdded++; }
    if (!gbIndex.has(key)) gbIndex.set(key, { ...gbMeta, fileName, gbMd5: key });
  };
  // 本地表条目同时带 GB 元信息（双表命中时网页能显示 mod 名/作者/游戏/链接）
  const putLocal = (hk, fileName, kind) => {
    const key = String(hk || "").toLowerCase().trim();
    if (!key) return;
    if (!g.local.has(key)) { g.local.set(key, { modDir, file: fileName, hash: key, gbMd5: key, kind, ...gbMeta }); localAdded++; }
    if (!localIndex.has(key)) localIndex.set(key, { modDir, file: fileName, hash: key, gbMd5: key, kind, ...gbMeta });
  };

  const putName = (name, kind) => {
    const key = String(name || "").toLowerCase().trim();
    if (!key) return;
    const entry = { modId: gbMeta.modId, modName: gbMeta.modName, author: gbMeta.author, game: gbMeta.game, url: gbMeta.url, fileName: name, kind };
    if (!g.name.has(key)) g.name.set(key, entry);
    if (!nameIndex.has(key)) nameIndex.set(key, entry);
    // 2026-10-11：同时登记「无后缀名」形态，供不带后缀的查询命中
    const st = stemOf(key);
    if (st && st !== key && !stemIndex.has(st)) stemIndex.set(st, { ...entry, matchedName: key });
  };
  for (const f of obj.files || []) {
    putGb(f.gbMd5, f.file);
    putLocal(f.gbMd5, f.file, "file");
    putLocal(f.hash, f.file, "file");
    putName(f.file, "file");
  }
  for (const im of obj.images || []) {
    putLocal(im.hash, im.file || im.gbFile || "", "image");
    putName(im.file || im.gbFile || "", "image");
  }

  if (opts && opts.deferSave) dirtyGames.add(game);
  else saveGameFile(game, g);
  return { gbAdded, localAdded, saved: 1 };
}

// ---------- 重建（2026-09-02 支持按游戏）----------
// rebuild(game?)：game 指定 → 只重建该游戏；不指定 → 全部已配置游戏（含默认位置子目录）
// 与旧表合并追加（只增不删）
// ---------- 重建（2026-09-02 支持按游戏）----------
// rebuild(game?)：game 指定 → 只重建该游戏；不指定 → 全部已配置游戏（含默认位置子目录）
// 与旧表合并追加（只增不删）
// 2026-10-12：rebuild 新增可选动作（**都由调用方显式开启，默认关**）——
//   opts.html = true → 遍历时顺带重写 description.html（把描述区 GB 图片外链本地化等生成侧修复
//                      应用到存量；实测 ≈6.5ms/目录，16k 目录 ≈1 分 45 秒，轻活）
//   opts.md5  = true → 顺便补算图片内容 md5 写回索引（⚠️ 重活：逐个读图片内容，实测读盘 ≈7–8MB/s，
//                      曾把 /api/task 拖到无响应 ⇒ 默认关，勾了才跑）
// 用模块级变量传递：rebuild 本身是单飞（buildState.running 把关），不存在并发串味。
let rebuildOpts = {};

async function rebuild(gameFilter, opts) {
  rebuildOpts = opts || {};
  // ⑤ 断续：进度文件只影响「重写 HTML」这一步 —— 索引构建必须照常走完（跳过目录会让索引缺项）
  if (rebuildOpts.resume && !rebuildOpts.stateFile) {
    // 与 CLI 脚本同一个默认位置（项目根/.rebuild-html-state.json），两处进度可互相续跑
    rebuildOpts.stateFile = path.join(__dirname, "..", "..", ".rebuild-html-state.json");
  }
  if (rebuildOpts.stateFile && rebuildOpts.resume) rebuildOpts.done = loadDone(rebuildOpts.stateFile);
  if (buildState.running) return { running: true, error: "正在重建中" };
  buildState.running = true;
  buildState.error = "";
  const t0 = Date.now();
  try {
    const games = cfg.readGame() || {};
    const targets = gameFilter
      ? [String(gameFilter).trim()]
      : Object.keys(games);
    let htmls = 0;
    // 2026-10-12：可选动作的计数（opts.html / opts.md5 开启时才有值），累计后写进 buildState
    //   供 GET /api/hash-index-status 显示「这次重建重写了多少 HTML / 补了多少 md5」
    let htmlRewritten = 0, htmlFailed = 0, md5Filled = 0;
    for (const game of targets) {
      const root = cfg.gameRootOf(game);
      if (!root || !fs.existsSync(root)) continue;
      let g = loadedGames.get(game) || loadGameFile(game) || { game, gb: new Map(), local: new Map(), name: new Map() };

      const counter = { htmls: 0, steps: 0 };
      await walkDir(root, root, g, counter);
      htmls += counter.htmls;
      htmlRewritten += counter.htmlRewritten || 0;
      htmlFailed += counter.htmlFailed || 0;
      md5Filled += counter.md5Filled || 0;
      // 2026-08-26 用户决定：自动空壳清理已取消（曾误清 1672 个目录）——以后由用户
      //   手动触发整理，不再 rebuild 时自动清理。

      loadedGames.set(game, g);
      saveGameFile(game, g);
      // 每处理完一个游戏存一次进度 —— 中断后带 resume 再跑可跳过已重写的目录
      if (rebuildOpts.stateFile && rebuildOpts.done) saveDone(rebuildOpts.stateFile, rebuildOpts.done);
    }
    mergeAll(); // 各游戏重建完成后合并进全库查询表
    buildState.lastAt = Date.now();
    buildState.lastMs = Date.now() - t0;
    buildState.htmlRewritten = htmlRewritten;
    buildState.htmlFailed = htmlFailed;
    buildState.md5Filled = md5Filled;
    return { ok: true, htmls, htmlRewritten, htmlFailed, md5Filled, gb: gbIndex.size, local: localIndex.size, name: nameIndex.size, games: loadedGames.size, ms: buildState.lastMs };
  } catch (e) {
    buildState.error = e.message || String(e);
    return { ok: false, error: buildState.error };
  } finally {
    buildState.running = false;
  }
}

// 目录遍历：递归扫描目录树，收集 description.html 反查（htmls 计数 + 节流计数走 counter）
async function walkDir(dir, gameRoot, g, counter) {
  let ents = [];
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    // 2026-08-31 修复：不再跳过 . 开头目录——.代理人/.NPC 等隐藏仓库区里的旧 HTML
    //   也存绝对下载路径，重建时必须遍历并替换为相对路径（所有 HTML）
    if (e.name === ".trash" || e.name === ".git" || e.name === "@eaDir") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkDir(p, gameRoot, g, counter);
    } else if (e.name === "description.html") {
      const obj = readIndexObj(dir);
      if (obj) {
        counter.htmls++;
        // 2026-10-12：可选动作放在 indexModFiles 之前 —— md5 补算写回的是 obj.images[].hash，
        //   先补算再建索引，索引里才会带上新 hash（同一遍遍历完成，不再二次走盘）
        if (rebuildOpts.html || rebuildOpts.md5) {
          // ⑤ 断续：resume 时跳过**已重写过的目录** —— 只跳这一步，索引构建照常（跳过整个目录会让索引缺项）
          const alreadyDone = !!(rebuildOpts.resume && rebuildOpts.done && rebuildOpts.done.has(dir));
          if (alreadyDone) {
            counter.htmlSkipped = (counter.htmlSkipped || 0) + 1;
          } else {
            const r = rebuildFromObj(obj, dir, { md5: !!rebuildOpts.md5 });
            if (r.status === "changed") counter.htmlRewritten = (counter.htmlRewritten || 0) + 1;
            else if (r.status === "failed") counter.htmlFailed = (counter.htmlFailed || 0) + 1;
            counter.md5Filled = (counter.md5Filled || 0) + (r.md5Filled || 0);
            if (rebuildOpts.done) rebuildOpts.done.add(dir);
          }
        }
        rewriteHtmlRelPath(dir, gameRoot);
        const gbMeta = buildGbMeta(obj);
        indexModFiles(obj, dir, g, gbMeta);
        indexMd5DiskImages(dir, g, gbMeta);
        organizeExternalFiles(dir, gameRoot, gbMeta);
      }
    }
    if (++counter.steps % 300 === 0) await new Promise((r) => setImmediate(r));
  }
}

// ---- 2026-08-31：HTML 下载路径以相对路径记录；重建时按 HTML
//   当前所在相对路径替换（手动移动文件夹后重建可纠正）----
function rewriteHtmlRelPath(dir, gameRoot) {
  try {
    const relDir = path.relative(gameRoot, dir) || "";
    const hp = path.join(dir, "description.html");
    const hStr = fs.readFileSync(hp, "utf8");
    const hEsc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    let newH = String(hStr).replace(/下载路径：[^\n<]*/, "下载路径：" + (relDir ? hEsc(relDir) : "-"));
    // JSON 索引块里的 dir 字段同步为相对路径
    newH = String(newH).replace(/"dir":\s*"[^"]*"/, '"dir": ' + JSON.stringify(relDir));
    if (newH !== hStr) fs.writeFileSync(hp, newH, "utf8");
  } catch (_) {}
}

// 由 HTML 索引块对象构建 GB 元信息
function buildGbMeta(obj) {
  return {
    modId: obj.modId || (obj.url || "").replace(/^.*mods\/(\d+).*$/, "$1") || "",
    modName: obj.name || "",
    author: obj.author || "",
    game: obj.game || "",
    url: obj.url || ""
  };
}

// 把 HTML 的 files/images 列表写入 g 的三张索引表（gb/local/name）
function indexModFiles(obj, dir, g, gbMeta) {
  for (const f of obj.files || []) {
    const key = String(f.gbMd5 || "").toLowerCase().trim();
    if (key && !g.gb.has(key)) g.gb.set(key, { ...gbMeta, fileName: f.file, gbMd5: key });
    const lk = String(f.hash || "").toLowerCase().trim();
    if (lk && !g.local.has(lk)) g.local.set(lk, { modDir: dir, file: f.file, hash: lk, gbMd5: key, kind: "file", ...gbMeta });
    if (key && !g.local.has(key)) g.local.set(key, { modDir: dir, file: f.file, hash: key, gbMd5: key, kind: "file", ...gbMeta });
    const nk = String(f.file || "").toLowerCase().trim();
    if (nk && !g.name.has(nk)) g.name.set(nk, { modId: gbMeta.modId, modName: gbMeta.modName, author: gbMeta.author, game: gbMeta.game, url: gbMeta.url, fileName: f.file, kind: "file" });
  }
  for (const im of obj.images || []) {
    const lk = String(im.hash || "").toLowerCase().trim();
    if (lk && !g.local.has(lk)) g.local.set(lk, { modDir: dir, file: im.file || im.gbFile || "", hash: lk, gbMd5: lk, kind: "image", ...gbMeta });
    const nk = String(im.file || im.gbFile || "").toLowerCase().trim();
    if (nk && !g.name.has(nk)) g.name.set(nk, { modId: gbMeta.modId, modName: gbMeta.modName, author: gbMeta.author, game: gbMeta.game, url: gbMeta.url, fileName: im.file || im.gbFile || "", kind: "image" });
  }
}

// 2026-08-26 补全（垃圾桶反查）：旧版下载的 HTML 图片 hash 为空，但磁盘图片是
//   md5 名（内容 hash）——扫描目录里 md5 名图片文件，用文件名(=内容hash)直接建本地索引，
//   使垃圾桶里同 hash 的图片（内容 md5 名）也能反查到所属 mod 目录。
function indexMd5DiskImages(dir, g, gbMeta) {
  try {
    const diskFiles = fs.readdirSync(dir);
    for (const dn of diskFiles) {
      const dm = String(dn).match(/^([0-9a-f]{32})\.(jpg|jpeg|png|webp|gif)$/i);
      if (!dm) continue;
      const dk = dm[1].toLowerCase();
      if (!g.local.has(dk)) g.local.set(dk, { modDir: dir, file: dn, hash: dk, gbMd5: dk, kind: "image", ...gbMeta });
    }
  } catch (_) {}
}

// 2026-08-26：手动建立 HTML 反查时顺带清理——不在 HTML 列表的
//   外部 mod 遗留文件 → 移入本游戏根垃圾桶（.trash）。移入保留原名，
//   将来下载其真正所属 mod 时 trash-restore 按原名自动找回归位。
function organizeExternalFiles(dir, gameRoot, gbMeta) {
  try {
    // 2026-08-26：垃圾桶保留来源目录结构
    let relDir = "";
    try { relDir = path.relative(gameRoot, dir); } catch (_) {}
    const org = cfg.readConfig().autoOrganize ? organize.organizeDir(dir, path.join(gameRoot, ".trash"), gbMeta.modId, relDir) : { moved: [] };
    if (org.moved && org.moved.length) {
      console.log("[rebuild-organize]", (dir.split("/Mods/")[1] || dir).slice(0, 50), "→ 移出", org.moved.length, "个外部文件");
    }
  } catch (_) {}
}

function status() {
  const games = {};
  for (const [g, m] of loadedGames) games[g] = { gb: m.gb.size, local: m.local.size, name: m.name.size };
  return {
    ...buildState,
    // 2026-10-12：可选动作计数（opts.html / opts.md5）——未跑过时给 0，面板不必处理 undefined
    htmlRewritten: buildState.htmlRewritten || 0,
    htmlFailed: buildState.htmlFailed || 0,
    md5Filled: buildState.md5Filled || 0,
    gb: gbIndex.size, local: localIndex.size, name: nameIndex.size, games, total: gbIndex.size + localIndex.size,
  };
}

module.exports = { load, rebuild, queryByHash, searchGb, ingestModDir, flushDirtyGames, status };
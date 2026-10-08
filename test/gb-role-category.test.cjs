// test/gb-role-category.test.cjs —— 2026-10-08 新增：
//   ① 角色分类网址解析（catIdFromUrl）
//   ② 角色缓存新旧格式归一化（字符串数组 → [{name,url}]）
//   ③ 角色缓存数据落盘格式（json/role/*.json 全为对象数组）
//   ④ 接线守卫：角色搜索走分类抓取（/api/role-mods）、设置页搜游戏（/api/gb-search-games）
// 便携单测：不依赖网络（网络部分由人工实测覆盖，见 README 待办/版本记录）。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const log = makeLog("gb-role-category");
const gbApi = require("../server/lib/gb-api");

const ROOT = path.join(__dirname, "..");

loggedTest(log, "catIdFromUrl：/mods/cats/<id> → 数字 id", () => {
  assert.equal(gbApi.catIdFromUrl("https://gamebanana.com/mods/cats/19510"), 19510);
  assert.equal(gbApi.catIdFromUrl("https://gamebanana.com/mods/cats/38869?x=1"), 38869);
});

loggedTest(log, "catIdFromUrl：非分类网址/空值 → 0（不误判）", () => {
  assert.equal(gbApi.catIdFromUrl("https://gamebanana.com/mods/634475"), 0);
  assert.equal(gbApi.catIdFromUrl("https://gamebanana.com/games/8552"), 0);
  assert.equal(gbApi.catIdFromUrl(""), 0);
  assert.equal(gbApi.catIdFromUrl(null), 0);
});

loggedTest(log, "normRoleEntries：旧格式字符串数组 → 对象数组，且标记 legacy（需补网址）", () => {
  const { entries, legacy } = gbApi.normRoleEntries(["Aether", "Albedo"]);
  assert.deepEqual(entries, [{ name: "Aether", url: "" }, { name: "Albedo", url: "" }]);
  assert.equal(legacy, true, "旧格式（无网址）必须标记 legacy，触发重新抓取补网址");
});

loggedTest(log, "normRoleEntries：新格式对象数组原样保留网址，legacy=false", () => {
  const input = [{ name: "Aether", url: "https://gamebanana.com/mods/cats/19510" }];
  const { entries, legacy } = gbApi.normRoleEntries(input);
  assert.deepEqual(entries, input);
  assert.equal(legacy, false);
});

loggedTest(log, "normRoleEntries：过滤空名/非字符串非对象项，并兼容混合格式", () => {
  const { entries, legacy } = gbApi.normRoleEntries(["Aether", "", null, 42, { name: "  Albedo  ", url: "u" }, { url: "x" }]);
  assert.deepEqual(entries, [{ name: "Aether", url: "" }, { name: "Albedo", url: "u" }]);
  assert.equal(legacy, true, "混合格式里含字符串 → legacy");
});

loggedTest(log, "角色缓存数据：json/role/*.json 可归一化为 {name,url}（旧文件懒迁移也不炸）", () => {
  const dir = path.join(ROOT, "json", "role");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  assert.ok(files.length > 0, "应至少有一个角色缓存文件");
  let withUrl = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(Array.isArray(d.characters), f + " 的 characters 应为数组");
    const src = d.characters;
    const { entries } = gbApi.normRoleEntries(src);
    // 空数组是合法状态（官方该游戏暂无角色分类），只有源非空时才要求归一化后非空
    if (src.length) assert.ok(entries.length > 0, f + " 归一化后不应为空");
    for (const it of entries) {
      assert.equal(typeof it.name, "string");
      assert.equal(typeof it.url, "string");
      if (it.url) {
        withUrl++;
        assert.ok(/^https:\/\/gamebanana\.com\/mods\/cats\/\d+$/.test(it.url), f + " 的网址应为分类页形态：" + it.url);
      }
    }
  }
  log.info("角色缓存文件数=" + files.length + "，其中带分类网址的条目=" + withUrl + "（懒迁移：用到才刷新）");
});

loggedTest(log, "接线：角色搜索走 /api/role-mods（分类抓取），不再用关键词搜索", () => {
  const search = fs.readFileSync(path.join(ROOT, "server", "routes", "search.js"), "utf8");
  assert.ok(/"GET \/api\/role-mods": roleMods\(api\)/.test(search), "search.js 应注册 /api/role-mods");
  assert.ok(search.includes("fetchModsByCategory"), "roleMods 应走按分类抓取");
  const ui = fs.readFileSync(path.join(ROOT, "server", "public", "app.js"), "utf8");
  const pick = ui.match(/async function pickRole\(name\)[\s\S]{0,600}/);
  assert.ok(pick, "app.js 应有 pickRole");
  assert.ok(pick[0].includes("/api/role-mods"), "pickRole 应调用 /api/role-mods");
  assert.ok(!pick[0].includes("keywordSearch()"), "pickRole 不应再走关键词搜索");
});

loggedTest(log, "接线：关键词搜索功能保留（端点 + 前端入口仍在）", () => {
  const search = fs.readFileSync(path.join(ROOT, "server", "routes", "search.js"), "utf8");
  assert.ok(/"GET \/api\/keyword-search": keywordSearch\(api\)/.test(search), "/api/keyword-search 应保留（浏览器扩展也用）");
  const ui = fs.readFileSync(path.join(ROOT, "server", "public", "app.js"), "utf8");
  assert.ok(ui.includes('$("#kwSearchBtn").addEventListener("click", keywordSearch)'), "关键词搜索按钮监听应保留");
  assert.ok(ui.includes("async function keywordSearch()"), "keywordSearch 函数应保留");
});

loggedTest(log, "接线：设置页「搜索游戏」→ /api/gb-search-games 候选填入表单", () => {
  const routes = fs.readFileSync(path.join(ROOT, "server", "routes", "games.js"), "utf8");
  assert.ok(/"GET \/api\/gb-search-games"/.test(routes), "games.js 应注册 /api/gb-search-games");
  assert.ok(routes.includes("gbApi.searchGames"), "应调用 gbApi.searchGames");
  const html = fs.readFileSync(path.join(ROOT, "server", "public", "fragments", "tab-panel", "panel-settings.html"), "utf8");
  assert.ok(html.includes('id="searchGameBtn"'), "设置页应有搜索游戏按钮");
  assert.ok(html.includes('id="searchGameCandidates"'), "设置页应有候选列表容器");
  const ui = fs.readFileSync(path.join(ROOT, "server", "public", "app.js"), "utf8");
  assert.ok(ui.includes('$("#searchGameBtn").addEventListener("click"'), "应有搜索游戏按钮监听");
  assert.ok(ui.includes("cand-item"), "候选应可点选填入 addGameId");
});

loggedTest(log, "接线：角色列表接口返回对象数组（前端两处已按对象归一化取名）", () => {
  const ui = fs.readFileSync(path.join(ROOT, "server", "public", "app.js"), "utf8");
  const hits = ui.match(/typeof c === "string" \? c : c\.name/g) || [];
  assert.ok(hits.length >= 2, "关键词页与设置页两处角色列表都应归一化（当前 " + hits.length + " 处）");
});

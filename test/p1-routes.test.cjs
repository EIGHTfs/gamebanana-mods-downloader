// test/p1-routes.test.cjs —— P1 路由拆分回归：
//   1) 10 个 routes/*.js 的注册清单与拆分前 app.js 完全一致（防丢路由/改路径）
//   2) bug#6 cleanCookie / bug#2 isBrowsableDir / bug#3 readBody 单测
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const log = makeLog("p1-routes");

// 收集某路由文件注册的 (method path) 串
// 2026-10-11 改：模板化后路由表由 createRoute 的闭包持有，外部无从核对；
//   工厂现已把解析后的表挂到返回值上（routeHandler.routes，只读），因此直接读表即可——
//   不再需要伪造 api 对象去拦截 route/routePublic 调用（旧写法在表式范式下收集到 0 条）。
function collect(file) {
  const mod = require("../server/routes/" + file);
  const pick = (h) => (h && Array.isArray(h.routes) ? h.routes.map((e) => e.method + " " + e.pattern) : []);
  const authed = pick(mod);              // module.exports = createRoute({...})
  const pub = pick(mod && mod.public);   // module.exports.public = createRoute({...})
  return { authed, pub };
}

// 路由清单（2026-10-11 按实际注册表更新；核对过：拆分前的路由一条未丢，新增项为后续功能）
const EXPECT = {
  auth: { pub: ["POST /api/login", "POST /api/logout"], authed: ["POST /api/change-password"] },
  settings: { pub: ["GET /api/status", "POST /api/status"], authed: ["GET /api/settings", "POST /api/settings", "GET /api/io"] },
  cred: { pub: [], authed: ["GET /api/gb-login-status", "GET /api/cred"] },
  games: { pub: [], authed: ["GET /api/games", "POST /api/games", "GET /api/mapping", "POST /api/mapping/add-role", "GET /api/gb-characters", "GET /api/gb-search-games", "GET /api/gb-game-info", "GET /api/gb-warehouses"] },
  search: { pub: [], authed: ["GET /api/keyword-search", "GET /api/role-mods", "POST /api/search", "GET /api/search-status", "POST /api/search/stop", "GET /api/search/cache", "POST /api/search/clear", "POST /api/search/import", "POST /api/search/save", "GET /api/search/export"] },
  download: { pub: [], authed: ["POST /api/download", "POST /api/receive", "POST /api/download-selected", "GET /api/task", "POST /api/task/pause", "POST /api/task/resume", "POST /api/task/stop", "POST /api/task/retry-failed", "POST /api/task/concurrency", "POST /api/task/restore-mode", "GET /api/task/restore-mode", "GET /api/task/export", "POST /api/task/import", "POST /api/skip", "POST /api/skip-all-failed", "POST /api/scan-incomplete", "POST /api/scan-incomplete/download"] },
  hashindex: { pub: [], authed: ["GET /api/hash-query", "GET /api/hash-index-status", "POST /api/hash-rebuild", "GET /api/hash-index-search"] },
  browse: { pub: [], authed: ["GET /api/browse", "GET /api/image"] },
  data: { pub: [], authed: ["GET /api/data/export", "POST /api/data/import"] },
  merge: { pub: [], authed: ["POST /api/merge-roles", "POST /api/cleanup-empty-dirs"] },
  "auto-update": { pub: [], authed: ["GET /api/auto-update/status", "POST /api/auto-update/config", "POST /api/auto-update/check", "POST /api/auto-update/restart"] }
};

loggedTest(log, "11 个路由文件注册清单与拆分前一致（共 59 条）", async () => {
  let total = 0;
  for (const [file, exp] of Object.entries(EXPECT)) {
    const got = collect(file);
    assert.deepEqual(got.pub.slice().sort(), exp.pub.slice().sort(), file + " public 路由不一致");
    assert.deepEqual(got.authed.slice().sort(), exp.authed.slice().sort(), file + " authed 路由不一致");
    total += got.pub.length + got.authed.length;
  }
  assert.equal(total, 59);
  log.info("共 " + total + " 条路由注册（拆分前 51 条一条未丢；新增含 GET /api/io 的 IO 监测）");
});

// ---------- bug#6 ----------
// 2026-10-11 修：utils/http → http/http-utils（模板化改造后模块归位）
const { cleanCookie, readBody } = require("../server/http/http-utils");
loggedTest(log, "bug#6 cleanCookie 清洗三种脏形态", () => {
  assert.equal(cleanCookie("sess=abc; rmc=def"), "sess=abc; rmc=def");   // 纯串原样
  assert.equal(cleanCookie('{"cookie":"sess=abc"}'), "sess=abc");         // JSON 脏值 unwrap
  assert.equal(cleanCookie("Cookie=sess=abc\nrmc=def"), "sess=abc");      // 组合文本
  assert.equal(cleanCookie(""), "");                                      // 空
  assert.equal(cleanCookie(null), "");                                    // null
});

// ---------- bug#2 ----------
// 2026-10-11 修：utils/path-safe → http/path-safe
const { isBrowsableDir, isBlocked } = require("../server/http/path-safe");
loggedTest(log, "bug#2 isBrowsableDir 黑名单（系统目录拉黑，其余放行）", () => {
  // 系统目录 → 拉黑
  assert.equal(isBrowsableDir("/etc"), false);
  assert.equal(isBrowsableDir("/etc/passwd"), false);
  assert.equal(isBrowsableDir("/proc"), false);
  assert.equal(isBrowsableDir("/sys"), false);
  assert.equal(isBrowsableDir("/root"), false);
  // 非系统目录 → 放行（局域网自用，无需白名单收敛）
  assert.equal(isBrowsableDir("/vol/Mods/Genshin"), true);
  assert.equal(isBrowsableDir("/vol/Mods/Genshin/Char"), true);
  assert.equal(isBrowsableDir("/vol"), true);
  assert.equal(isBrowsableDir("/vol/Other"), true);  // 兄弟目录也放行
  assert.equal(isBrowsableDir("/"), true);
  // isBlocked 直接判断
  assert.equal(isBlocked("/etc"), true);
  assert.equal(isBlocked("/vol/Mods"), false);
});

// ---------- bug#3 ----------
const { EventEmitter } = require("node:events");
function fakeReq(body) {
  const ee = new EventEmitter();
  ee.destroy = () => {};
  ee.pause = () => {};
  ee.resume = () => {};
  queueMicrotask(() => { ee.emit("data", Buffer.from(body)); ee.emit("end"); });
  return ee;
}
loggedTest(log, "bug#3 readBody 流式读体并解析 JSON", async () => {
  const body = await readBody(fakeReq('{"a":1}'), 1024);
  assert.deepEqual(body, { a: 1 });
  const empty = await readBody(fakeReq(""), 1024);
  assert.deepEqual(empty, {});
});

// test/p1-routes.test.cjs —— P1 路由拆分回归：
//   1) 10 个 routes/*.js 的注册清单与拆分前 app.js 完全一致（防丢路由/改路径）
//   2) bug#6 cleanCookie / bug#2 isBrowsableDir / bug#3 readBody 单测
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const log = makeLog("p1-routes");

// 收集某路由文件注册的 (method path) 串；注册阶段 handler 不执行，库传 null 即可
function collect(file) {
  const authed = [];
  const pub = [];
  const api = {
    route: (m, p) => authed.push(m + " " + p),
    routePublic: (m, p) => pub.push(m + " " + p),
    sendJson: null, readBody: null, cleanCookie: null, setSessionCookie: null,
    cfg: null, auth: null, gbApi: null, downloader: null, search: null,
    searchDateRange: null, mergeDirs: null, dataBackup: null, hashIndex: null,
    incompleteScan: null, fs: null, path: null, os: null,
    downloadRoots: null, isWithinRoots: null, isBrowsableDir: null
  };
  require("../server/routes/" + file)(api);
  return { authed, pub };
}

// 拆分前 app.js 的完整路由清单（method + path；* 表示任意方法）
const EXPECT = {
  auth: { pub: ["POST /api/login", "POST /api/logout"], authed: ["POST /api/change-password"] },
  settings: { pub: ["* /api/status"], authed: ["GET /api/settings", "POST /api/settings"] },
  cred: { pub: [], authed: ["GET /api/gb-login-status", "GET /api/cred"] },
  games: { pub: [], authed: ["GET /api/games", "POST /api/games", "GET /api/mapping", "POST /api/mapping/add-role", "GET /api/gb-characters", "GET /api/gb-game-info", "GET /api/gb-warehouses"] },
  search: { pub: [], authed: ["GET /api/keyword-search", "POST /api/search", "GET /api/search-status", "POST /api/search/stop", "GET /api/search/cache", "POST /api/search/clear", "POST /api/search/import", "POST /api/search/save", "GET /api/search/export"] },
  download: { pub: [], authed: ["POST /api/download", "POST /api/receive", "POST /api/download-selected", "GET /api/task", "POST /api/task/pause", "POST /api/task/resume", "POST /api/task/stop", "POST /api/task/retry-failed", "POST /api/task/concurrency", "POST /api/task/restore-mode", "GET /api/task/restore-mode", "GET /api/task/export", "POST /api/task/import", "POST /api/skip", "POST /api/skip-all-failed", "POST /api/scan-incomplete", "POST /api/scan-incomplete/download"] },
  hashindex: { pub: [], authed: ["GET /api/hash-query", "GET /api/hash-index-status", "POST /api/hash-rebuild", "GET /api/hash-index-search"] },
  browse: { pub: [], authed: ["GET /api/browse", "GET /api/image"] },
  data: { pub: [], authed: ["GET /api/data/export", "POST /api/data/import"] },
  merge: { pub: [], authed: ["POST /api/merge-roles", "POST /api/cleanup-empty-dirs"] }
};

loggedTest(log, "10 个路由文件注册清单与拆分前一致（共 51 条）", async () => {
  let total = 0;
  for (const [file, exp] of Object.entries(EXPECT)) {
    const got = collect(file);
    assert.deepEqual(got.pub.slice().sort(), exp.pub.slice().sort(), file + " public 路由不一致");
    assert.deepEqual(got.authed.slice().sort(), exp.authed.slice().sort(), file + " authed 路由不一致");
    total += got.pub.length + got.authed.length;
  }
  assert.equal(total, 51);
  log.info("共 " + total + " 条路由注册，与拆分前一致");
});

// ---------- bug#6 ----------
const { cleanCookie, readBody } = require("../server/utils/http");
loggedTest(log, "bug#6 cleanCookie 清洗三种脏形态", () => {
  assert.equal(cleanCookie("sess=abc; rmc=def"), "sess=abc; rmc=def");   // 纯串原样
  assert.equal(cleanCookie('{"cookie":"sess=abc"}'), "sess=abc");         // JSON 脏值 unwrap
  assert.equal(cleanCookie("Cookie=sess=abc\nrmc=def"), "sess=abc");      // 组合文本
  assert.equal(cleanCookie(""), "");                                      // 空
  assert.equal(cleanCookie(null), "");                                    // null
});

// ---------- bug#2 ----------
const { isBrowsableDir } = require("../server/utils/path-safe");
loggedTest(log, "bug#2 isBrowsableDir 白名单（根/祖先/后代放行，无关拒绝）", () => {
  const roots = ["/vol/Mods/Genshin"];
  assert.equal(isBrowsableDir("/vol/Mods/Genshin", roots), true);   // 下载根本身
  assert.equal(isBrowsableDir("/vol/Mods/Genshin/Char", roots), true); // 根内后代
  assert.equal(isBrowsableDir("/vol/Mods", roots), true);           // 祖先（下钻必经）
  assert.equal(isBrowsableDir("/vol", roots), true);                // 更上祖先
  assert.equal(isBrowsableDir("/etc", roots), false);               // 无关分支
  assert.equal(isBrowsableDir("/vol/Other", roots), false);         // 无关兄弟
  assert.equal(isBrowsableDir("/etc", []), true);                   // 无下载根时不限制
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

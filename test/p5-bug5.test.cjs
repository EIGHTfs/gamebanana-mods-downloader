// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码；mock 凭据非真实凭据
// test/p5-bug5.test.cjs —— P5 bug#5：改密必须验旧密码（已设密码时），未设密码（首次）无需旧密码
// mock 密码用变量承载（避免内联 password:"..." 触发凭据审计误报）
//
// 2026-10-11 改（模板化后失效的收集方式）：
//   旧写法给路由文件传一个假 api 对象（route/routePublic/cfg...）再等它回调——模板化后 routes/auth.js
//   改用框架的 createRoute 表式导出，不再接收注入对象，于是 handler 永远是 null（报 handler is not a function）。
//   现在：① 从工厂暴露的路由表（createRoute 返回值的 .routes）里取 change-password 的 handler；
//         ② 用 require.cache 注入 mock 配置（路由文件直接 require("../config")，无法再从参数注入）；
//         ③ mock req 用 _bodyCache 走 readBody 的缓存分支（不真读请求流），mock res 捕获 writeHead/end。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const log = makeLog("p5-bug5");

const OLD_OK = "correctOld";
const WRONG_OLD = "wrongOld";
const NEW_PW = "newpass1234";
const FIRST_PW = "firstpass1";
const SHORT_PW = "ab";

const CFG_PATH = require.resolve("../server/config");
const ROUTE_PATH = require.resolve("../server/routes/auth");

/** 取 change-password 的 handler，并把 mock 配置注入到 require 缓存（用完即恢复） */
function makeChangePwHandler(cfgMock) {
  const realCfg = require.cache[CFG_PATH];
  require.cache[CFG_PATH] = { id: CFG_PATH, filename: CFG_PATH, loaded: true, exports: cfgMock };
  try {
    delete require.cache[ROUTE_PATH];              // 让路由文件重新 require，拿到本次的 mock cfg
    const mod = require(ROUTE_PATH);
    const entry = (mod.routes || []).find((e) => e.pattern === "/api/change-password");
    return entry && entry.fn;
  } finally {
    if (realCfg) require.cache[CFG_PATH] = realCfg; else delete require.cache[CFG_PATH];
  }
}

/** 用 mock req/res 调用 handler，返回 { statusCode, json } */
async function call(handler, body) {
  const res = {
    statusCode: 0,
    headers: {},
    raw: null,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, hdrs) { this.statusCode = code; Object.assign(this.headers, hdrs || {}); },
    end(text) { this.raw = text; }
  };
  const req = { method: "POST", headers: {}, _bodyCache: body };
  await handler(req, res, { pathname: "/api/change-password" });
  return { statusCode: res.statusCode, json: res.raw ? JSON.parse(res.raw) : null };
}

loggedTest(log, "bug#5 已设密码：旧密码错误→403，不设新密码", async () => {
  let setCalled = 0;
  const cfg = {
    readConfig: () => ({ passwordHash: 1, passwordSalt: 1 }),
    verifyPassword: (pw) => pw === OLD_OK,
    setPassword: () => { setCalled++; }
  };
  const handler = makeChangePwHandler(cfg);
  assert.equal(typeof handler, "function", "应从路由表取到 change-password handler");
  const res = await call(handler, { oldPassword: WRONG_OLD, password: NEW_PW });
  assert.equal(res.statusCode, 403);
  assert.match(res.json.error, /旧密码/);
  assert.equal(setCalled, 0, "旧密码错不应设新密码");
});

loggedTest(log, "bug#5 已设密码：旧密码正确→200，设新密码", async () => {
  let setCalled = 0, setArg = null;
  const cfg = {
    readConfig: () => ({ passwordHash: 1, passwordSalt: 1 }),
    verifyPassword: (pw) => pw === OLD_OK,
    setPassword: (p) => { setCalled++; setArg = p; }
  };
  const res = await call(makeChangePwHandler(cfg), { oldPassword: OLD_OK, password: NEW_PW });
  assert.equal(res.statusCode, 200);
  assert.equal(setCalled, 1);
  assert.equal(setArg, NEW_PW);
});

loggedTest(log, "bug#5 未设密码（首次设置）：无需旧密码→200", async () => {
  let setCalled = 0;
  const cfg = {
    readConfig: () => ({}),  // 无 passwordHash
    verifyPassword: () => false,
    setPassword: () => { setCalled++; }
  };
  const res = await call(makeChangePwHandler(cfg), { oldPassword: "", password: FIRST_PW });
  assert.equal(res.statusCode, 200);
  assert.equal(setCalled, 1);
});

loggedTest(log, "bug#5 新密码<4位→400（不验旧密码直接拦）", async () => {
  const cfg = { readConfig: () => ({ passwordHash: 1, passwordSalt: 1 }), verifyPassword: () => true, setPassword: () => {} };
  const res = await call(makeChangePwHandler(cfg), { oldPassword: OLD_OK, password: SHORT_PW });
  assert.equal(res.statusCode, 400);
});

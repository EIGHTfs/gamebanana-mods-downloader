// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码；mock 凭据非真实凭据
// test/p5-bug5.test.cjs —— P5 bug#5：改密必须验旧密码（已设密码时），未设密码（首次）无需旧密码
// mock 密码用变量承载（避免内联 password:"..." 触发凭据审计误报）
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const log = makeLog("p5-bug5");

const OLD_OK = "correctOld";
const WRONG_OLD = "wrongOld";
const NEW_PW = "newpass1234";
const FIRST_PW = "firstpass1";
const SHORT_PW = "ab";

// 注册 routes/auth.js，捕获 change-password handler，用 mock cfg 测旧密码校验
function makeChangePwHandler(cfgMock) {
  let handler = null;
  const api = {
    route: (m, p, h) => { if (p === "/api/change-password") handler = h; },
    routePublic: () => {},
    sendJson: (res, status, obj) => { res.statusCode = status; res.json = obj; },
    readBody: async (req) => req.body,
    cfg: cfgMock,
    auth: { createSession: () => "t", destroySession: () => {}, extractToken: () => null },
    setSessionCookie: () => {}
  };
  require("../server/routes/auth")(api);
  return handler;
}

async function call(handler, body) {
  const res = { statusCode: 0, json: null };
  await handler({ body, headers: {} }, res);
  return res;
}

loggedTest(log, "bug#5 已设密码：旧密码错误→403，不设新密码", async () => {
  let setCalled = 0;
  const cfg = {
    readConfig: () => ({ passwordHash: 1, passwordSalt: 1 }),
    verifyPassword: (pw) => pw === OLD_OK,
    setPassword: () => { setCalled++; }
  };
  const res = await call(makeChangePwHandler(cfg), { oldPassword: WRONG_OLD, password: NEW_PW });
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

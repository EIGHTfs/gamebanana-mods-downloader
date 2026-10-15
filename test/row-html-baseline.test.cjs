// test/row-html-baseline.test.cjs —— 2026-10-15 新增：rowHtml 输出等价性基准
//
// 用途：**拆 rowHtml（圈复杂度 51 → 拆到 <10）之前**先钉死它的输出。
//   拆分/重构渲染函数最容易出的事就是 HTML 悄悄变了（多一个空格、少一个属性、分支写反），
//   而页面看起来"差不多"⇒ 必须用逐字节基准挡住。
//
// 做法：把**真实拼接产物** server/public/app.js 放进 vm 沙箱执行（DOM 全吞、定时器停掉），
//   取到真实的 rowHtml（及其依赖 esc/typeIcon/fmtSize/isTaskEnded/fmtSpeed），
//   用一组覆盖每条分支的夹具渲染，把全部输出拼起来算 sha256 与基准值比对。
//
// 基准更新（仅在**故意**改行为时）：ROW_BASELINE_SHOW=1 node --test test/row-html-baseline.test.cjs
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const log = makeLog("row-html-baseline");

// 沙箱里跑的是**真实产物**，它自身还有与渲染无关的异步初始化；即便上面已把 fetch/定时器停掉，
// 仍可能有漏网链路在测试结束后 reject。本测试只对 rowHtml 的输出负责，故兜住这类事件，
// 避免它们把文件级用例判红（否则每次都要人肉分辨"是不是渲染坏了"）。
process.on("unhandledRejection", () => {});

// 拆分前的基准值（2026-10-15 采集，21 个夹具）。重构 rowHtml 后必须保持一致。
const EXPECTED_SHA = "501068bb9e532e05ef2176d8090031ea16423c82a073f3c9096ebf43e380ed94";

/** 加载真实产物，返回沙箱全局（含 rowHtml） */
function loadApp() {
  const appPath = path.join(__dirname, "..", "server", "public", "app.js");
  const src = fs.readFileSync(appPath, "utf8");
  // DOM/网络全吞的桩：任何属性/调用都返回自身，避免产物顶层代码抛错
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "then" ? undefined : stub)),
    set: () => true, apply: () => stub, construct: () => stub
  });
  const sandbox = {
    console, Math, JSON, Date, URL, RegExp, Error, Number, String, Array, Object, Boolean,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    // 定时器停掉：产物的 init() 会起轮询，基准只需要渲染函数
    setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    // fetch 永不 resolve：产物的自身初始化链（搜索/更新等）会引用沙箱里没有的全局而抛错，
    //   本测试只关心 rowHtml 的纯渲染，不需要让那些链路跑起来
    fetch: () => new Promise(() => {}), localStorage: stub, navigator: stub, location: stub
  };
  // window/document 用「代理沙箱本身」：读未知属性给桩（吞 DOM），写则落到沙箱（保留产物自己的全局）
  const domProxy = new Proxy(sandbox, {
    get: (t, k) => (k in t ? t[k] : stub),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  sandbox.window = domProxy;
  sandbox.document = domProxy;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 8000 });
  return sandbox;
}

/** 覆盖 rowHtml 每条分支的夹具 */
function fixtures() {
  const base = { type: "file", url: "https://gamebanana.com/dl/1", path: "/p/a.zip", displayName: "a.zip" };
  return [
    ["pending 无结果", { ...base }, 0, { results: [], activeItems: [] }, {}],
    ["成功", { ...base }, 0, { results: [{ ok: true, size: 1234 }], activeItems: [] }, {}],
    ["跳过-已存在", { ...base }, 0, { results: [{ skipped: true, exists: true }], activeItems: [] }, {}],
    ["跳过-已忽略", { ...base }, 0, { results: [{ skipped: true, exists: false }], activeItems: [] }, {}],
    ["GB 侧不可用", { ...base }, 0, { results: [{ gbUnavailable: true }], activeItems: [] }, {}],
    ["失败带错误", { ...base }, 0, { results: [{ ok: false, error: "网络超时" }], activeItems: [] }, {}],
    ["失败无错误", { ...base }, 0, { results: [{ ok: false }], activeItems: [] }, {}],
    ["skipReason 追加", { ...base, skipReason: "游戏未配置下载路径" }, 0, { results: [{ ok: false }], activeItems: [] }, {}],
    ["buildError 追加", { ...base, buildError: "构建失败" }, 0, { results: [], activeItems: [] }, {}],
    ["可重试（有 path）", { ...base }, 0, { results: [{ ok: false }], activeItems: [] }, {}],
    ["可清除（error 无 path）", { type: "error", url: "https://gamebanana.com/mods/1", displayName: "x" }, 0, { results: [{ ok: false }], activeItems: [], status: "done" }, {}],
    ["收尾卡住行（无结果 + 已结束）", { ...base }, 0, { results: [], activeItems: [], status: "done" }, {}],
    ["图片缩略图", { ...base, type: "image", path: "/p/a.png", displayName: "a.png" }, 0, { results: [{ ok: true }], activeItems: [] }, {}],
    ["gif 缩略图", { ...base, type: "image", isGif: true, path: "/p/a.gif", displayName: "a.gif" }, 0, { results: [{ ok: true }], activeItems: [] }, {}],
    ["下载中（含速度）", { ...base }, 0, { results: [], activeItems: [{ idx: 0, received: 50, total: 100, speed: 2048 }] }, {}],
    ["下载中无 total", { ...base }, 0, { results: [], activeItems: [{ idx: 0, received: 50, total: 0 }] }, {}],
    ["结果带 size", { ...base }, 0, { results: [{ ok: true, size: 2048 }], activeItems: [] }, {}],
    ["未开始但已知 size", { ...base, size: 4096 }, 0, { results: [], activeItems: [] }, {}],
    ["失败文本可复制", { ...base }, 0, { results: [{ ok: false, error: "<b>x</b> & y" }], activeItems: [] }, {}],
    ["doneMap 覆盖结果", { ...base }, 0, { results: [{ ok: false }], activeItems: [] }, { 0: { ok: true, size: 9 } }],
    ["无 path 无 url", { type: "file" }, 0, { results: [], activeItems: [] }, {}]
  ];
}

loggedTest(log, "rowHtml 输出逐字节基准（拆分前后必须一致）", () => {
  const app = loadApp();
  assert.equal(typeof app.rowHtml, "function", "产物里应能取到 rowHtml");
  assert.equal(typeof app.esc, "function", "依赖 esc 应可用（说明整包加载正常）");

  const parts = [];
  for (const [name, item, idx, task, doneMap] of fixtures()) {
    const html = app.rowHtml(item, idx, task, doneMap);
    assert.equal(typeof html, "string", name + " 应返回字符串");
    assert.ok(html.length > 20, name + " 输出不应为空");
    parts.push(name + "\u0000" + html);
  }
  const sha = crypto.createHash("sha256").update(parts.join("\u0001"), "utf8").digest("hex");
  // 打到 stdout：采集基准时要能直接从终端拿到（log.info 是写文件的）
  console.log("[row-html-baseline] sha256 = " + sha + "  （夹具 " + parts.length + " 例）");
  if (process.env.ROW_BASELINE_SHOW === "1") return;   // 采集模式：只打印
  assert.equal(sha, EXPECTED_SHA, "rowHtml 输出与基准不一致（HTML 被改动了）");
});

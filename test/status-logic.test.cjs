// test/status-logic.test.cjs —— 状态判定专项检查门禁
//
// 为什么要有它（2026-10-11 两次真实事故）：
//   ① 前端 taskStats/rowHtml 用 `status !== "running" && status !== "preparing"` 当「任务已结束」
//      ⇒ 暂停被误判 ⇒ 在途行冒出重试/跳过按钮
//   ② 后端 retryFailed 用 stillRunning 取反当结束 ⇒ 暂停态点「重试失败」把 3 万多条尚未轮到下载的项
//      全部重新入队、清空结果表 ⇒ 任务文件反复重写、写盘 ≈76–95MB/s，服务被拖到接口超时
// 两道防线：代码侧收敛为统一 helper（isTaskEnded/isTaskActive），测试侧用 scripts/check-status-logic.mjs
//   机械拦截「排除式状态比较」与「私自拼已结束集合」。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");

const log = makeLog("status-logic");
const SCRIPT = path.join(__dirname, "..", "scripts", "check-status-logic.mjs");

loggedTest(log, "状态判定检查：无排除式结束判定 / 无私自定义「已结束」集合", () => {
  let out = "";
  try {
    out = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  } catch (e) {
    const detail = String((e && (e.stdout || e.message)) || e);
    assert.fail("check-status-logic 未通过（排除式状态判定或私自定义结束集合）：\n" + detail);
  }
  assert.match(out, /状态判定检查通过/);
});

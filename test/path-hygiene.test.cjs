// test/path-hygiene.test.cjs —— 脚本路径卫生门禁
//
// 规则（2026-10-11）：**所有脚本都不要硬编码路径**。
// 本测试跑 scripts/check-hardcoded-paths.mjs：脚本/测试里出现写死的绝对路径（/volume1/…、
// /usr/local/bin/node、C:\…）即失败；确有必要的（平台规定路径、测试夹具、node 候选搜索列表）
// 需在代码里显式加 `path-check-ok: <理由>` 豁免——让「为什么这个路径必须写死」留在代码里。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");

const log = makeLog("path-hygiene");
const SCRIPT = path.join(__dirname, "..", "scripts", "check-hardcoded-paths.mjs");

loggedTest(log, "脚本路径卫生：无硬编码绝对路径（豁免需显式标注）", () => {
  let out = "";
  try {
    out = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  } catch (e) {
    const detail = String((e && (e.stdout || e.message)) || e);
    assert.fail("check-hardcoded-paths 未通过（存在硬编码绝对路径）：\n" + detail);
  }
  assert.match(out, /路径检查通过/);
});

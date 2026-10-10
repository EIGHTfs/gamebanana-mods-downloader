// test/template-parity.test.cjs —— 模板回流一致性门禁（调用模板自带的官方检测命令）
//
// 规则：**每次都把模板回流，免得又意外**。项目侧的改动若不回流模板，下次组装会被模板覆盖
//   （2026-10-11 实测踩过：start.sh 的 /tmp 硬编码修复被组装覆盖，路径卫生门禁随即变红）。
//
// 检测用的是**模板仓库自带的官方命令**，不自己实现匹配逻辑：
//   bash setup.sh --to <项目清单> --check     # 只做清单一致性检查，不组装；不一致退出码 1（可挂 CI）
// 模板 README「--check：清单一致性检查」一节写明：清单某条两端内容不同即报「不一致」，
//   此时应把改动补进模板再重新组装。
//
// 模板仓库默认同级（../bench-template，可用 TEMPLATE_REPO 覆盖）；部署端没有模板仓库时自动跳过。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const log = makeLog("template-parity");
const ROOT = path.join(__dirname, "..");
const TEMPLATE = process.env.TEMPLATE_REPO || path.join(ROOT, "..", "bench-template");

loggedTest(log, "模板回流一致性：用模板自带 setup.sh --check 校验清单两端同步", () => {
  const setup = path.join(TEMPLATE, "setup.sh");
  if (!fs.existsSync(setup)) {
    log.info("未找到模板仓库（" + TEMPLATE + "）→ 跳过（部署端无模板仓库属正常）");
    return;
  }
  let out = "";
  try {
    out = execFileSync("bash", [setup, "--to", path.join(ROOT, "assemble.json"), "--check"],
      { cwd: TEMPLATE, encoding: "utf8", timeout: 120000 });
  } catch (e) {
    const detail = String((e && (e.stdout || e.stderr || e.message)) || e);
    assert.fail("模板一致性检查未通过（项目侧改了却没回流模板，下次组装会被覆盖）：\n" + detail);
  }
  log.info("模板 setup.sh --check 通过：" + String(out).trim().split("\n").slice(-1)[0]);
});

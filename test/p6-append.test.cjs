// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码
// ============================================================
// P6 便携测试：导入=纯追加（不覆盖）+ 任务事件日志
// 2026-09-05 用户规则：
//   · 导入/提交一律「追加」——运行中/暂停中/准备中直接追到 pendingMods；
//   · done（已完成）→ 列表保留展示，但新任务开始（导入）前清空旧批次 → 追加到空；
//   · stopped（已终止=按钮清空队列）→ 追加到空（新建批次）；
//   · 没有「覆盖」路径，看起来像覆盖的操作实际都是「追加到空」。
// 便携：不依赖本机 json/index 数据、不触发下载循环、不联网。
// ============================================================
"use strict";
require("./helpers/test-log.cjs");
require("../server/lib/cjs-bootstrap.cjs");

const test = require("node:test");
const assert = require("node:assert/strict");

const { planForAppend } = require("../server/lib/downloader");

// 便携的 extractModId：只看数字尾巴，不依赖 GB 网络/数据
function extractModId(u) {
  const s = String(u || "");
  const m = s.match(/(\d+)\/?$/);
  return m ? m[1] : "";
}

const URL_A = "https://gamebanana.com/mods/691122";
const URL_B = "https://gamebanana.com/mods/704164";
const URL_C = "https://gamebanana.com/mods/631577";
const ID_A = "691122";
const ID_B = "704164";
const ID_C = "631577";

test("planForAppend: 无任务 → reset=new（追加到空，全部接收）", () => {
  const plan = planForAppend(null, [URL_A, URL_B], extractModId);
  assert.equal(plan.reset, "new");
  assert.deepEqual(plan.append, [URL_A, URL_B]);
  assert.equal(plan.dedupSkipped, 0);
  assert.equal(plan.listSkipped, 0);
});

test("planForAppend: running 任务 → reset=null（直接追加，不清空旧列表）", () => {
  const t = { status: "running", pendingMods: [{ profileUrl: URL_A, name: "old" }], items: [] };
  const plan = planForAppend(t, [URL_B, URL_C], extractModId);
  assert.equal(plan.reset, null);
  assert.deepEqual(plan.append, [URL_B, URL_C]);
  // 旧 pendingMods 原样保留
  assert.equal(t.pendingMods.length, 1);
  assert.equal(t.pendingMods[0].profileUrl, URL_A);
});

test("planForAppend: paused 任务 → reset=null（直接追加）", () => {
  const t = { status: "paused", pendingMods: [], items: [] };
  const plan = planForAppend(t, [URL_A], extractModId);
  assert.equal(plan.reset, null);
  assert.deepEqual(plan.append, [URL_A]);
});

test("planForAppend: preparing 任务 → reset=null（直接追加）", () => {
  const t = { status: "preparing", pendingMods: [], items: [] };
  const plan = planForAppend(t, [URL_A], extractModId);
  assert.equal(plan.reset, null);
  assert.deepEqual(plan.append, [URL_A]);
});

test("planForAppend: done 任务 → reset=done（新任务开始前清空旧批次，追加到空）", () => {
  const t = { status: "done", pendingMods: [], items: [{ modUrl: URL_A, path: "/x" }] };
  const plan = planForAppend(t, [URL_B], extractModId);
  assert.equal(plan.reset, "done");
  // done 清空批次：旧 items 不参与去重跳过（追加到空）
  assert.deepEqual(plan.append, [URL_B]);
  assert.equal(plan.listSkipped, 0);
});

test("planForAppend: stopped 任务 → reset=stopped（终止=清空，追加到空）", () => {
  const t = { status: "stopped", pendingMods: [], items: [{ modUrl: URL_A, path: "/x" }] };
  const plan = planForAppend(t, [URL_B], extractModId);
  assert.equal(plan.reset, "stopped");
  assert.deepEqual(plan.append, [URL_B]);
  assert.equal(plan.listSkipped, 0);
});

test("planForAppend: 本批内重复 modId 只留一个（dedupSkipped 计数）", () => {
  const plan = planForAppend(null, [URL_A, URL_A, URL_B], extractModId);
  assert.deepEqual(plan.append, [URL_A, URL_B]);
  assert.equal(plan.dedupSkipped, 1);
});

test("planForAppend: 已在列表（pendingMods/items 同 modId）→ 跳过（listSkipped 计数）", () => {
  const t = {
    status: "running",
    pendingMods: [{ profileUrl: URL_A, name: "a" }],
    items: [{ modUrl: URL_B, path: "/b" }]
  };
  const plan = planForAppend(t, [URL_A, URL_B, URL_C], extractModId);
  assert.deepEqual(plan.append, [URL_C]);
  assert.equal(plan.listSkipped, 2);
});

test("planForAppend: 无法解析 modId 的链接照常接收（不丢）", () => {
  const plan = planForAppend(null, ["not-a-url", URL_A], extractModId);
  assert.deepEqual(plan.append, ["not-a-url", URL_A]);
});

test("planForAppend: 空 urls → append 为空数组", () => {
  const plan = planForAppend(null, [], extractModId);
  assert.deepEqual(plan.append, []);
  assert.equal(plan.reset, "new");
});

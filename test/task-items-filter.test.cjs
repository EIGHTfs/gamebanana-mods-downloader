// test/task-items-filter.test.cjs —— 2026-10-12 新增
// 「进度列表移除方式」的筛选语义回归（getTaskItems 的 filter=group / open / done / all）
//
// 背景：c2d6e42「P0-2 接口瘦身」后前端固定用 filter=open ⇒ 每个文件一完成就从列表消失；
//   而本项目最初的期望是「整组移除」：该 mod 还有文件在下载时，已下完的预览图仍留在列表里可见，
//   直到该 mod 整组完成才一起消失。为此 getTaskItems 新增 filter="group"（按 targetDir 分组）。
//
// 做法：用**注入的假任务/假结果**调用真实的 getTaskItems（不写 json/download_task.json、不联网），
//   与项目既有测试规范一致（只测纯逻辑与可注入项）。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const dl = require("../server/lib/downloader.js");

const log = makeLog("task-items-filter");

// 假任务：modA 三项（两张图已下完、压缩包未完成）；modB 两项（都已下完）
function fakeTask() {
  const items = [
    { targetDir: "/G/modA", name: "a1.jpg", type: "image" },
    { targetDir: "/G/modA", name: "a2.jpg", type: "image" },
    { targetDir: "/G/modA", name: "a.zip", type: "file" },
    { targetDir: "/G/modB", name: "b1.jpg", type: "image" },
    { targetDir: "/G/modB", name: "b.zip", type: "file" },
  ];
  const results = { 0: { ok: true }, 1: { ok: true }, 3: { ok: true }, 4: { ok: true } };
  return { items, resultAt: (i) => results[i] || null };
}
const idxOf = (r) => r.items.map((x) => x.idx);

loggedTest(log, "filter=group：整组未完成时，该组**已完成**的项也保留（预览图不消失）", () => {
  const t = fakeTask();
  const r = dl.getTaskItems({ filter: "group", limit: 100, task: t, resultAt: t.resultAt });
  assert.deepEqual(idxOf(r), [0, 1, 2], "modA 三项都应在（含已完成的两张图）；modB 整组已完成 → 不在");
  assert.equal(r.total, 3);
});

loggedTest(log, "filter=open：每个文件完成即移除（对照行为）", () => {
  const t = fakeTask();
  const r = dl.getTaskItems({ filter: "open", limit: 100, task: t, resultAt: t.resultAt });
  assert.deepEqual(idxOf(r), [2], "只剩未完成的那一项");
});

loggedTest(log, "filter=done / all：语义不变", () => {
  const t = fakeTask();
  assert.deepEqual(idxOf(dl.getTaskItems({ filter: "done", limit: 100, task: t, resultAt: t.resultAt })), [0, 1, 3, 4]);
  assert.deepEqual(idxOf(dl.getTaskItems({ filter: "all", limit: 100, task: t, resultAt: t.resultAt })), [0, 1, 2, 3, 4]);
});

loggedTest(log, "非法 filter 回落到 open（默认）；稀疏数组空位跳过", () => {
  const t = fakeTask();
  t.items[3] = undefined;                       // 造一个空位
  const r1 = dl.getTaskItems({ filter: "bogus", limit: 100, task: t, resultAt: t.resultAt });
  assert.deepEqual(idxOf(r1), [2], "非法 filter 应等同 open，且跳过空位");
  const r2 = dl.getTaskItems({ filter: "group", limit: 100, task: t, resultAt: t.resultAt });
  assert.deepEqual(idxOf(r2), [0, 1, 2], "group 模式下空位不影响分组判定");
});

loggedTest(log, "分页：offset/limit 只影响返回切片，total 是全量", () => {
  const t = fakeTask();
  const r = dl.getTaskItems({ filter: "group", offset: 1, limit: 1, task: t, resultAt: t.resultAt });
  assert.deepEqual(idxOf(r), [1]);
  assert.equal(r.total, 3, "total 是筛选后的全量，不是本页条数");
  assert.equal(r.filter, "group");
});

loggedTest(log, "未注入任务且模块无当前任务 → 返回空结果（不抛错）", () => {
  const r = dl.getTaskItems({ filter: "group" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
  assert.equal(r.total, 0);
});

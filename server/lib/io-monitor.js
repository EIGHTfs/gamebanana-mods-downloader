// ============================================================
// IO 监测（项目自带探针）：真实读写速率 + 按来源归因
//
// 为什么需要（2026-10-11 实测驱动）：
//   磁盘被大量读写时，日志里往往只看到「某类操作在连刷」，看不出到底是谁在占 IO——
//   排查只能靠外部 strace/iotop（NAS 上还没有）。本模块把两件事做进项目：
//     ① 采样 /proc/self/io 拿**进程真实**读写字节数 → 算出速率（每 intervalMs 一次，超阈值打日志）
//     ② 提供 count(label, bytes) 让各读写点**自报用量** → 归因表直接回答「谁在读/谁在写」
//
// 用法：
//   const io = require("./io-monitor");
//   io.start({ intervalMs: 10000, logThresholdMBps: 2 });   // 启动时调用一次
//   io.count("hash", fileSize);                             // 各读写点自报（label 自定，累计）
//   io.snapshot()                                           // → 速率 + 累计 + 归因表（/api/io 用它）
//
// 兼容：非 Linux（无 /proc/self/io）自动降级为「只统计 count() 归因」，不影响任何功能。
// ============================================================
"use strict";

const fs = require("fs");

const PROC_IO = "/proc/self/io";
let started = false;
let intervalMs = 10000;
let logThresholdMBps = 2;
let timer = null;
let startedAt = 0;
let prev = null;          // 上一次采样 { t, readBytes, writeBytes, syscr, syscw }
let last = null;          // 最近一次采样（同上）
const byLabel = new Map(); // label -> 累计字节（由各读写点自报）

function readProcIo() {
  try {
    const txt = fs.readFileSync(PROC_IO, "utf8");
    const get = (k) => {
      const m = txt.match(new RegExp("^" + k + ":\\s*(\\d+)", "m"));
      return m ? Number(m[1]) : 0;
    };
    return { t: Date.now(), readBytes: get("read_bytes"), writeBytes: get("write_bytes"), syscr: get("syscr"), syscw: get("syscw") };
  } catch (_) {
    return null; // 非 Linux 或无权限 → 降级
  }
}

/** 人类可读体积（B/KB/MB/GB，1 位小数） */
function human(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

function sample(doLog) {
  const cur = readProcIo();
  if (!cur) return;
  if (last) prev = last;
  last = cur;
  if (!doLog || !prev) return;
  const dt = Math.max(1, (cur.t - prev.t) / 1000);
  const rMB = (cur.readBytes - prev.readBytes) / 1048576 / dt;
  const wMB = (cur.writeBytes - prev.writeBytes) / 1048576 / dt;
  if (rMB >= logThresholdMBps || wMB >= logThresholdMBps) {
    console.log(`[io] 读 ${rMB.toFixed(2)} MB/s · 写 ${wMB.toFixed(2)} MB/s｜自上次采样新增读写调用 ${cur.syscr - prev.syscr}/${cur.syscw - prev.syscw}` +
      (byLabel.size ? "｜归因: " + topLabels(3).map((x) => `${x.label} ${human(x.bytes)}`).join(" / ") : ""));
  }
}

/** 启动周期采样（幂等；无 /proc/self/io 时只启用归因统计） */
function start(opts = {}) {
  if (started) return { ok: true, already: true };
  started = true;
  startedAt = Date.now();
  if (opts.intervalMs) intervalMs = opts.intervalMs;
  if (opts.logThresholdMBps != null) logThresholdMBps = opts.logThresholdMBps;
  const probe = readProcIo();
  if (!probe) return { ok: true, enabled: false, reason: "无 /proc/self/io（非 Linux？）" };
  last = probe;
  timer = setInterval(() => sample(true), intervalMs);
  if (timer.unref) timer.unref();
  return { ok: true, enabled: true, intervalMs };
}

/** 各读写点自报用量（label 自定；bytes 可为文件大小/条目数等，仅用于归因对比） */
function count(label, bytes) {
  const k = String(label || "other");
  byLabel.set(k, (byLabel.get(k) || 0) + (Number(bytes) || 0));
}

/** 归因表（按用量降序） */
function topLabels(limit) {
  const arr = [...byLabel.entries()].map(([label, bytes]) => ({ label, bytes, human: human(bytes) }));
  arr.sort((a, b) => b.bytes - a.bytes);
  return limit ? arr.slice(0, limit) : arr;
}

/** 快照：真实速率 + 累计 + 归因表（供 GET /api/io） */
function snapshot() {
  if (!last) last = readProcIo();
  const out = {
    ok: true,
    enabled: !!last,
    intervalMs,
    uptimeMs: startedAt ? Date.now() - startedAt : 0,
    byLabel: topLabels(20)
  };
  if (last) {
    out.self = { readBytes: last.readBytes, writeBytes: last.writeBytes, syscr: last.syscr, syscw: last.syscw };
    if (prev) {
      const dt = Math.max(1, (last.t - prev.t) / 1000);
      out.rate = {
        readMBps: Number(((last.readBytes - prev.readBytes) / 1048576 / dt).toFixed(3)),
        writeMBps: Number(((last.writeBytes - prev.writeBytes) / 1048576 / dt).toFixed(3)),
        windowSec: Math.round(dt)
      };
    }
    out.selfHuman = { read: human(last.readBytes), write: human(last.writeBytes) };
  }
  return out;
}

/** 停止采样（测试/退出用） */
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
  return { ok: true };
}

module.exports = { start, stop, count, snapshot, topLabels, human };

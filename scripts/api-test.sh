#!/usr/bin/env bash
# ============================================================
# scripts/api-test.sh —— gbmd 相关接口全测（读 + 写），验收口径 = 实际 HTTP 实测
#
# 为什么要有这个脚本：卡死类问题（收尾索引重写 / /api/task 34MB / 追加去重 O(n×m)）
#   全部发生在**写接口**上，而只测读接口是测不出来的——本脚本把读接口与写接口一起测，
#   并给出每个接口的耗时/体积，便于用「修前 vs 修后」的数字验收。
#
# 用法（网址与密码一律走参数/环境变量，脚本内不写死任何地址与口令）：
#   scripts/api-test.sh <base-url> [password]           # 例：scripts/api-test.sh http://<本机IP>:8642 '你的密码'
#   GB_BASE=http://host:8642 GB_PWD=xxx scripts/api-test.sh
#   scripts/api-test.sh <base-url> <password> --update  # 先触发一次自动更新再测（会重启服务）
#
# 安全性：写接口只做「导出全量 mod → 原样导入」——全部命中「已在列表」⇒ 追加 0、不产生新下载、
#   可重复执行；并且会把任务状态恢复到测试前的原状（原本 paused 就留 paused，原本 running 就恢复 running）。
#   不会调用 stop / retry-failed / skip 等破坏性接口。
#
# 退出码：0 = 全部通过（读接口 <1s、写接口 <5s、写后读接口仍 <1s）；1 = 有失败项
# ============================================================
set -u

BASE="${1:-${GB_BASE:-}}"
PWD_="${2:-${GB_PWD:-}}"
DO_UPDATE=0
for a in "$@"; do [ "$a" = "--update" ] && DO_UPDATE=1; done

if [ -z "$BASE" ] || [ -z "$PWD_" ]; then
  echo "用法: $0 <base-url> [password] [--update]" >&2
  echo "  或: GB_BASE=<url> GB_PWD=<password> $0" >&2
  echo "  网址与密码必须由参数/环境变量提供（脚本内不写死）" >&2
  exit 2
fi
BASE="${BASE%/}"

CK="$(mktemp)"
TMPD="$(mktemp -d)"
FAIL=0
cleanup() { rm -f "$CK"; rm -rf "$TMPD"; }
trap cleanup EXIT

login() {
  curl -s -m 10 -c "$CK" -X POST -H 'Content-Type: application/json' \
    -d "{\"password\":\"$PWD_\"}" "$BASE/api/login" >/dev/null 2>&1
}
# 请求并打印 "HTTP码 体积B 耗时s"；失败打印 超时
req() { # req <method> <path> [outfile] [body-file]
  local method="$1" path="$2" out="${3:-/dev/null}" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -m 60 -b "$CK" -o "$out" -w '%{http_code}  %{size_download}B  %{time_total}s' \
      -X "$method" -H 'Content-Type: application/json' --data-binary @"$body" "$BASE$path" 2>/dev/null || echo "超时 ✗"
  else
    curl -s -m 60 -b "$CK" -o "$out" -w '%{http_code}  %{size_download}B  %{time_total}s' \
      -X "$method" "$BASE$path" 2>/dev/null || echo "超时 ✗"
  fi
}
# 判定耗时是否超阈值（毫秒比较）：耗时取自 curl 输出最后一个字段（如 0.001079s）
check_ms() { # check_ms <耗时字符串> <上限ms> <名称>
  local t="$1" lim="$2" name="$3"
  local ms
  case "$t" in *超时*) printf '  ⚠ %-38s %s\n' "$name" "$t"; FAIL=1; return;; esac
  ms=$(printf '%s' "$t" | awk '{v=$NF; gsub(/s$/,"",v); printf "%d", v*1000}')
  if [ "${ms:-999999}" -gt "$lim" ]; then printf '  ⚠ %-38s %s（>%sms）\n' "$name" "$t" "$lim"; FAIL=1
  else printf '  ✓ %-38s %s\n' "$name" "$t"; fi
}

echo "═══ gbmd 接口全测  base=$BASE ═══"
login
if [ "$DO_UPDATE" = "1" ]; then
  echo "── 触发自动更新（--update）──"
  curl -s -m 60 -b "$CK" -X POST "$BASE/api/auto-update/check" 2>/dev/null | head -c 120; echo ""
  echo "   等重启 75s…"; sleep 75; login
fi

echo "── ① 读接口（阈值 1000ms）──"
for ep in "/api/status" "/api/task" "/api/task/items?filter=open&limit=200" \
          "/api/task/items?filter=all&limit=200" "/api/task/done?limit=200" "/api/io" \
          "/api/task/restore-mode"; do
  out="$TMPD/r.json"; t=$(req GET "$ep" "$out")
  check_ms "$t" 1000 "$ep"
done
t=$(req GET "/api/task/export" "$TMPD/export.json"); check_ms "$t" 1000 "/api/task/export"

echo "── ② 摘要内容（应无 items/resultsMap，体积 KB 级）──"
req GET "/api/task" "$TMPD/summary.json" >/dev/null
node -e '
const fs=require("fs");const p=process.argv[1];
try{
  const t=(JSON.parse(fs.readFileSync(p,"utf8"))||{}).task||{};
  const hasHeavy=(t.items!==undefined)||(t.resultsMap!==undefined)||(t.pendingMods!==undefined);
  console.log("   体积字段检查: "+(!hasHeavy?"无 items/resultsMap/pendingMods ✓":"仍含重字段 ✗")
    +"  itemsTotal="+t.itemsTotal+" 成功="+t.okCount+" 跳过="+t.skippedCount+" 失败="+t.failCount
    +" pendingModsCount="+t.pendingModsCount);
  if(hasHeavy) process.exit(3);
  if(t.itemsTotal===undefined) { console.log("   ⚠ 摘要缺少 itemsTotal（摘要接口异常）"); process.exit(3); }
}catch(e){ console.log("   （摘要解析失败："+e.message+"）"); process.exit(3); }' "$TMPD/summary.json" || FAIL=1

echo "── ③ 写接口：追加路径（原样导入全量 ⇒ 全命中已在列表，追加 0、不产生新下载）──"
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
fs.writeFileSync(process.argv[2], JSON.stringify({ taskJson: d.taskJson || {} }));
console.log("   待导入 mods: "+((d.taskJson||{}).count||0)+"（预期全部命中已在列表）");' \
  "$TMPD/export.json" "$TMPD/import.json" || FAIL=1

# 记录测试前状态，结束后恢复
req GET "/api/task" "$TMPD/before.json" >/dev/null
BEFORE_STATUS=$(node -e 'try{console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task||{}).status||"")}catch(e){console.log("")}' "$TMPD/before.json")

# ── 安全门禁：done/stopped 下导入会「清空旧批次」（把已完成列表重置掉），绝不能在此时测试 ──
SKIP_WRITE=0
case "$BEFORE_STATUS" in
  paused|running|preparing) : ;;
  *) SKIP_WRITE=1
     echo "  ⚠ 当前状态 ${BEFORE_STATUS:-未知}：**跳过追加测试**——done/stopped 下导入会清空旧批次（已完成列表会被重置）";;
esac

if [ "$SKIP_WRITE" = "0" ]; then
S=$(date +%s%N)
IMP=$(req POST "/api/task/import" "$TMPD/import-resp.json" "$TMPD/import.json")
E=$(date +%s%N)
IMPMS=$(( (E - S) / 1000000 ))
printf '  POST /api/task/import  → %s ms\n' "$IMPMS"
printf '  响应: %s\n' "$(head -c 140 "$TMPD/import-resp.json" 2>/dev/null)"
printf '  响应体积: %s B\n' "$(wc -c < "$TMPD/import-resp.json" 2>/dev/null || echo 0)"
if [ "$IMPMS" -gt 5000 ]; then echo "  ⚠ 追加耗时 >5000ms（历史上 O(n×m) 去重曾达 120,035ms）"; FAIL=1
else echo "  ✓ 追加耗时在 5000ms 内"; fi
# 响应体积：写接口应回摘要（KB 级）。>50KB 说明又把完整 task（含 items/pendingMods）塞进了响应
RSZ=$(wc -c < "$TMPD/import-resp.json" 2>/dev/null || echo 0)
if [ "$RSZ" -gt 51200 ]; then echo "  ⚠ 响应体积 ${RSZ}B >50KB（写接口应回摘要，不回完整 task）"; FAIL=1
else echo "  ✓ 响应体积为摘要级（${RSZ}B）"; fi
fi

# 恢复原状态：原本 paused 就恢复 paused（追加动作会把 paused 自动带成 running，必须按回去）；原本 running 保持不动
NOW_STATUS=$(req GET "/api/task" "$TMPD/after.json" >/dev/null; node -e 'try{console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task||{}).status||"")}catch(e){console.log("")}' "$TMPD/after.json")
case "$BEFORE_STATUS" in
  paused) if [ "$NOW_STATUS" != "paused" ]; then req POST "/api/task/pause" "$TMPD/restore.json" >/dev/null; echo "  （已恢复原状态：暂停，避免留下自动开始的下载）"
          else echo "  （保持 paused，与原状态一致）"; fi;;
  running|preparing) echo "  （原状态 ${BEFORE_STATUS}，保持下载中，不做动作）";;
  *)                 echo "  （原状态 ${BEFORE_STATUS:-未知}，不做动作）";;
esac

echo "── ④ 写后服务仍响应（阈值 1000ms）──"
for ep in "/api/status" "/api/task" "/api/io"; do
  t=$(req GET "$ep" /dev/null); check_ms "$t" 1000 "写后 $ep"
done

echo "── ⑤ IO 归因 ──"
req GET "/api/io" "$TMPD/io.json" >/dev/null
node -e '
const fs=require("fs");
try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
console.log("   读 "+((d.rate||{}).readMBps)+" MB/s  写 "+((d.rate||{}).writeMBps)+" MB/s");
for(const x of (d.byLabel||[]).slice(0,4)) console.log("   归因 "+x.label+" "+x.human);}catch(e){console.log("   （IO 数据不可用）");}' \
  "$TMPD/io.json"

echo
if [ "$FAIL" = "0" ]; then echo "✅ 接口全测通过"; exit 0; fi
echo "❌ 接口全测有失败项（见上面 ⚠）"; exit 1

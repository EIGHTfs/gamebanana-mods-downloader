#!/usr/bin/env bash
# ============================================================
# scripts/shot-progress.sh —— 下载进度页截图（含打码），元素选择**固化在此**
#
# 为什么单独成脚本：进度页要「看得出在下载、看不出下的具体是什么」，涉及一组元素选择器；
#   每次现推容易漏（实测踩过：漏了 .item-name 与进行中列表，文件名原样露出）。
#
# 用法（参数化，不硬编码地址/密码）：
#   GB_BASE=http://<本机IP>:8642 GB_PWD=<访问密码> bash scripts/shot-progress.sh
#   GB_OUT=/tmp/shots bash scripts/shot-progress.sh          # 指定输出目录
#   bash scripts/shot-progress.sh --redact-blur 10            # 追加参数透传给 page-shot.mjs
#
# 打码范围（保留进度可读性）：
#   · 分组头：mod 标识（香蕉网 URL + mod 名）  → .mod-group-head > span:first-child
#   · 分组头：目标目录（含 NAS 路径）          → .mod-group-dir
#   · 行内：文件名                             → .item-name
#   · 进行中列表：文件名（无专属 class）        → 文本正则按扩展名（zip/7z/rar/jpg…）
#   · 缩略图                                  → --redact-images
#   · 兜底文本                                → 香蕉网域名 / /volume 路径 / 「来自 …」
#   · 保留                                    → 进度条、统计行、速度、状态文字、顶栏品牌（--redact-exclude .brand-block）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${GB_BASE:?请设置 GB_BASE（例如 http://<本机IP>:8642）}"
PASS="${GB_PWD:?请设置 GB_PWD（访问密码）}"
OUT="${GB_OUT:-$(mktemp -d)/gbmd-progress}"

node scripts/page-shot.mjs \
  --base "$BASE" --password "$PASS" \
  --theme dark --tabs progress --no-full \
  --redact ".mod-group-head > span:first-child, .mod-group-dir, .item-name" \
  --redact-text "gamebanana\.com|/volume|来自|\.(zip|7z|rar|jpg|jpeg|png|gif|webp)" \
  --redact-images --redact-exclude ".brand-block" \
  --out "$OUT" "$@"

echo "截图目录: $OUT"

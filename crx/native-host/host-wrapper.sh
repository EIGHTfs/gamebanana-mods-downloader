#!/usr/bin/env bash
# native-host wrapper（由 install-linux.sh 重新生成；此处默认指向本仓库 crx/）
# 若移动了仓库位置，重跑 crx/native-host/install-linux.sh 即可自动更新本文件。
export GAMEBANANA_MODS_DOWNLOADER_CRX_DIR="/vol1/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/gamebanana-mods-downloader/crx"
exec "/usr/bin/node" "/vol1/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/gamebanana-mods-downloader/crx/native-host/host.cjs"

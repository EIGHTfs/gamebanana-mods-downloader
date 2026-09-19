// 自动更新（gbmd 风格项目实例）：从框架引入工厂，只在这里传项目参数。
// 框架实现见 server/framework/update/auto-update.js（createAutoUpdate），
// 本文件不重复框架代码，仅作为 gbmd 风格的项目参数包装层。
// 存放规则：风格模板 server/lib/ 资产，由 assemble.json 下发到项目 server/lib/auto-update.js。
"use strict";

const { createAutoUpdate } = require("../update/auto-update.js");

module.exports = createAutoUpdate({
  projectName: "gamebanana-mods-downloader",
  defaultRepo: "EIGHTfs/gamebanana-mods-downloader",
  // gbmd 特有运行态数据（github 模式绝不覆盖）
  extraExclude: ["json/gamebanana.com.json"],
  // 前端框架文件（index.html / style.css 含 @frag 指令）：改由组装器热更新，不重启服务
  extraWatchExclude: ["index.html", "public/index.html", "style.css", "public/style.css"],
  // gbmd 特有可执行脚本（tarball 解压后恢复可执行位）
  extraChmodScripts: [
    "crx/native-host/install-linux.sh",
    "crx/native-host/host-wrapper.sh"
  ]
});

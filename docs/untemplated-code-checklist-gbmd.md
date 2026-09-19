# gbmd 未模板化代码检查清单（2026-09-20）

判定基准：**模板化 = 该文件在 `assemble.json` 里声明了 `src→dst`（组装下发，模板改了自动同步）**。
未模板化 = 项目里存在但不在清单声明内的文件，按原因分五类。

- 模板真源：`dl-server-template/server/`（framework / templates / project/blueprint）
- 项目：`gamebanana-mods-downloader/`
- 已核对日期：2026-09-20（清理 server/templates、server/project、server/framework 残留之后）

---

## A 类：模板有源、项目有副本、清单漏声明（最典型的未模板化，组装不同步）

模板 `_gbmd-style/public/` 下有 6 个文件：app.js、favicon.ico、favicon.png、logo.png、path-picker.js、style.css。
清单只下发其中 2 个（app.js、logo.png），**另外 3 个项目里有副本但清单没声明**，模板若更新它们项目不会同步。

| # | 文件 | 判定依据 | 建议 |
|---|---|---|---|
| A1 | `server/public/path-picker.js` | md5 `27e40e66` 与模板 `server/templates/_gbmd-style/public/path-picker.js` **逐字相同**；`fragments/scripts.html` 引用了它 | 清单补条目：`server/templates/_gbmd-style/public/path-picker.js → server/public/path-picker.js` |
| A2 | `server/public/favicon.png` | 模板 `_gbmd-style/public/favicon.png` 存在；`brand.json` 的 `icon=favicon.png` 引用它；已入库但清单无下发条目（对比：logo.png 有下发条目，favicon 漏了） | 清单补条目：`server/templates/_gbmd-style/public/favicon.png → server/public/favicon.png` |
| A3 | `server/public/favicon.ico` | 模板 `_gbmd-style/public/favicon.ico` 存在；已入库但清单无条目 | 清单补条目：`server/templates/_gbmd-style/public/favicon.ico → server/public/favicon.ico`（若项目不再用 ico 也可删） |

## B 类：与模板化模块并存的旧位置副本（双份实现，需二选一）

模板框架 `server/framework/` 各模块已按清单下发到 `server/core|store|update|...`，但项目里 `server/lib/` 还留着同名旧版。

| # | 文件 | 引用情况 | 判定 | 建议 |
|---|---|---|---|---|
| B1 | `server/lib/app-log.js` | `server/core/index.js` 用 `require("./app-log")` → **core/app-log.js（模板化版）**；lib/ 版**无人引用** | 旧布局残留（框架平铺时代的位置） | 核实无引用后删除（先进 .trash） |
| B2 | `server/lib/json-dir.js` | `server/core/index.js` 用 `require("../store/json-dir.js")`（模板化版）；但 `lib/downloader.js`、`lib/search.js` 等按 require-sibling 就近解析到 **lib/ 版** | 两版并存且 **diff 有差异**（lib/ 版首行「运行态 JSON 目录：仓库根 json/」，store/ 版为模板工厂） | 对比差异：若 lib/ 版是项目定制，应改为统一用模板版或说明保留理由 |
| B3 | `server/lib/auto-update.js` | 被 `app.js`、`config.js`、`routes/auto-update.js` 引用；首行注明「自动更新（项目实例）：从框架引入工厂」——是**调用模板工厂 `update/auto-update.js` 的包装层** | 包装层有业务价值（自研），但目录易与模板工厂混淆 | 保留可接受；建议注释注明关系，或改名避免混淆 |

## C 类：游离/废弃文件（非代码问题，属清理类）

| # | 文件 | 状态 | 建议 |
|---|---|---|---|
| C1 | `server/lib/auto-update.js.bak-createAutoUpdate` | 废弃备份，`.gitignore` 的 `*.bak*` 已覆盖（未入库） | 删除或移 .trash |
| C2 | `server/public/.trash-20260916-flat-fragments/`（5 个 html） | 项目内嵌的回收站目录，`.gitignore` 的 `**/.trash-*/` 已覆盖（未入库） | 移出或删除 |
| C3 | `gbmd-userdata-2026-09-15.zip` | 根目录数据备份，`.gitignore` 的 `*.zip` 已覆盖（未入库） | 移 .trash 或另存备份目录 |

## D 类：运行期文件（gitignore 覆盖，正常不入库，非问题）

- `server/config.json`（密码 scrypt hash）、`server/server.log`、`gamebanana-mods-downloader.pid`

## E 类：项目自研业务代码（非模板范畴，清单备查，不动）

- `server/app.js`（入口）、`server/boot.cjs`（零依赖 CJS 启动器，start.sh 调用）、`server/config.js`（配置管理）
- `server/lib/`：downloader、gb-api、hash-index、incomplete-scan、index-html、mapping、merge-dirs、organize、search（业务库）
- `server/routes/`：auth、auto-update、browse、cred、data、download、games、hashindex、merge、search、settings（业务路由）
- `crx/`（浏览器扩展）、`scripts/`、`json/`、`mapping/`、`docs/`、`start*.sh`/`start*.bat`

---

## 汇总建议

1. **A1/A2/A3**：补 3 条 assemble.json 下发条目（path-picker.js、favicon.png、favicon.ico），下次组装自动同步模板版本——这是本次检查最有价值的修复
2. **B1**：确认无人引用后清理 lib/app-log.js；**B2**：对比差异后统一 json-dir 实现；**B3**：保留（自研包装层）
3. **C1/C2/C3**：按 safe-delete-trash 移 .trash 清理
4. 修复后重跑组装 + 启动自检验证

（本清单为检查产物，待人工复核后决定是否执行修复与入库）

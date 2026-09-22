# MediaCli 命令层代码审查报告（非 ffmpeg 部分）

- 审查日期：2026-09-22
- 审查范围：`cmd/` 下除 `cmd_ffmpeg.js` 外的 12 个命令（约 7,300 行），以及其依赖的 `lib/`、`index.js`
- 关联文档：`docs/CODE-REVIEW-20260919.md`、`docs/FFMPEG-CMD-REVIEW-20260921.md`（本篇只看命令层，ffmpeg 除外）
- 复现脚本：`temp/audit_cmd.cjs`（短别名冲突 / 死选项 / 约定一致性静态扫描）

---

## 0. 结论先行

**整体评价：工程底线合格，架构收敛不足，存在 4 处会静默改变业务结果的问题。**

| 维度 | 评分 | 说明 |
|---|---|---|
| 工程化（lint/CI/格式） | ★★★★☆ | ESLint+Prettier(error) 零告警、CI 覆盖 Node 20/22/24、有一套 P2 回归测试 |
| 代码质量 | ★★★☆☆ | 注释质量高（大量"此前/根因"说明），但重复脚手架多、隐式契约多 |
| 架构设计 | ★★☆☆☆ | 12 个命令各写一遍 builder + 扫描/规划/执行/汇报四层耦合在一个 handler |
| 业务逻辑正确性 | ★★★☆☆ | 9 处确认缺陷，其中 4 处导致功能静默失效或删除范围超出预期 |
| 数据安全/可逆性 | ★★★★☆ | 默认回收站删除、`moveSafe`、Zip Slip/Zip Bomb 防护、走 delete-primary-except 做得好 |
| 测试覆盖 | ★★☆☆☆ | 14 个测试文件仅 3 个触达命令层，7 个命令零测试 |

**必须先修的三件事**（按危害排序）：

1. `remove` 的 `--corrupted/--badchars` 绕过了"多条件 AND"判定 —— 会发生超出用户预期的删除（P0）。
2. `rename` 的伴随文件重命名字段名错位（`associatedExts` vs `extraExts`）—— 功能从未生效（P0）。
3. `rename` 的批内重名检测有并发竞态 + `entry.fixenc` 笔误 —— 静默少改/A 改名的乱码兜底失效（P0）。

---

## 1. 审查范围与方法

| 文件 | 行数 | 定位 |
|---|---|---|
| `cmd_remove.js` | 1759 | 条件化删除/搬移（已做 plan/run 分层） |
| `cmd_pick.js` | 1364 | 照片智能挑选（时间线/事件聚类/哈希去重） |
| `cmd_rename.js` | 1088 | 文件名清洗/替换/乱码修复/模板/媒体元数据 |
| `cmd_zipu.js` | 707 | ZIP 编码识别与解压 |
| `cmd_compress.js` | 611 | 图片压缩（sharp） |
| `cmd_moveup.js` | 538 | 目录扁平化/按类型归拢 |
| `cmd_prefix.js` | 531 | 加前缀/序号/净化重命名 |
| `cmd_move.js` | 413 | 按文件名日期归档到 YYYYMM |
| `cmd_dcim.js` | 422 | 按 EXIF 拍摄日期重命名 |
| `cmd_decode.js` | 333 | 乱码文本解码猜测 |
| `cmd_lr.js` | 140 | Lightroom 输出目录搬运 |
| `cmd_run.js` | 65 | 空壳命令 |

方法：逐文件通读 + 交叉验证被调用的 lib 实现（helper/core/rename/file/encoding/date_parse/capabilities/errors/config）+ 静态扫描（`temp/audit_cmd.cjs`）+ 实测（`eslint`、`npm test`）。

---

## 2. 架构问题

### A1. 命令层没有统一骨架，重复脚手架占比过高（P1）

`include/exclude/extensions/regex/doit/auto-confirm/output/jobs` 这 8 个通用选项在 8 个命令里手写了一遍，连 describe 都重复。后果：

- `--auto-confirm` 只在 9/13 命令里声明（`cmd_lr/cmd_zipu/cmd_decode/cmd_run` 缺失），且只有 9 个命令调用 `initAutoConfirm()` → **脚本化/自动化在 lr、zipu 上完全不可用**（它们直接 `inquirer.prompt`，共 5 处绕过 `command_utils`）。
- 同一短别名在不同命令含义不同：`-e` 在多数命令是 `--extensions`，在 `cmd_zipu` 是 `--encoding`；`-t` 在 dcim 是 `--template`、在 decode 是 `--to-enc`。
- `--jobs` 在 `cmd_prefix` 里声明了但从未读取。

建议：抽 `lib/cmd_options.js` 提供 `withCommonOptions(ya)` / `withFilterOptions(ya)` / `withWriteOptions(ya)`，各命令只挂自己的专有选项；`--auto-confirm` 提到 `index.js` 全局注册（它本质是全局开关）。

### A2. handler 混四层职责，无法测试也无法复用（P1）

除 `remove`（已拆 `planRemoveTasks`/`runRemoveTasks`）和 `ffmpeg`（plan/build/run）外，其余命令都是"扫描 → 计算目标名 → 弹确认 → 执行 → 打印"一条龙。典型代价：

- `cmd_moveup.js:163` `processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList)` —— 8 个位置参数，靠约定传 `Set` 做副作用回传。
- 核心算法（`preRename`、`createNewNameByMode`、`selectForDay`、`checkConditions`）都是模块私有函数，**没有任何单测能直接触达**。

建议统一 `plan(argv) -> Task[]` → `report(tasks)` → `confirm()` → `apply(tasks)` 三段式，plan 层为纯数据（纯函数、可单测、可 `--report json` 输出供外部审计）。这是把测试覆盖率提上来的唯一低成本路径。

### A3. Task 对象是隐式契约，已发生字段漂移（P1）

任务对象没有 schema，字段在各层"约定传递"：

- 产出国 wellbeing不一致：`cmd_rename.js` 写 `entry.associatedExts`，消费方 `lib/rename.js:53,128` 读 `f.extraExts` → 功能死链（见 B4）。
- `remove` 用 `shouldRemove/desc/src/size`，`rename` 用 `outPath/outName/outBase`，`compress` 用 `dst/tmpDst/dstExists/shouldSkip/skipReason`，`zipu` 用 `done/skipped/error`。
- 各命令把整个 `argv` 塞进每个条目（`{...entry, argv}`），随后 `log.logInfo(LOG_TAG, argv)` 又把整个 argv 打一遍 → 日志体积与噪声双高，且 `--doit` 模式下 argv 被写进文件日志（含路径，隐私面）。

建议：定义 `lib/task.js`（JSDoc typedef + 构造函数 + 校验），argv 改由闭包传入而不是塞进任务。

### A4. 并发策略分裂（P2）

`lib/config.js` 定义了四档 `JOBS`（cpuIntensive/ioBound/externalTool/metadata），但命令层仍有 **12 处直接写 `cpus().length`**（compress 1、move 2、pick 5、remove 3、rename 1）。

- `cmd_moveup.js` 硬编码 `concurrency: 4`（两处），与 JOBS 无关。
- `cmd_pick.js` 的 `--jobs` 只作用于 `pFilter`/`parseFilesByName`，**真正耗时的复制阶段用 `cpus().length`**（第 666 行），`--jobs` 在写盘阶段失效。

建议：`resolveConcurrency(argv.jobs, config.JOBS.ioBound())` 一处收敛，并让 `--jobs` 全局生效。

### A5. 三套错误处理体系并存（P2）

1. `lib/errors.js`：`MediaCliError` / `ErrorTypes` / `ErrorHandler.handle()`，其返回值协议 `{recoverable, action}` 全仓库**只有 `cmd_lr.js` 的 `withErrorHandling` 用了一次**，`handleError` 的返回值在其它调用点被丢弃。
2. 命令内 `try/catch` + 自造统计（remove 的 `errorStats`、compress 的 `failedTasks`、pick 的 `status:"error"`）。
3. `helper.validateInput` 抛的是**普通 Error**，不走 ErrorTypes；而 `cmd_move/zipu/remove` 又各自手写了一份目录校验（三种不同写法）。

建议：统一为"业务层抛 `MediaCliError`（带 type）→ `index.js` 统一格式化 + 退出码"，删掉未被落实的 `recoverable/action` 协议，或真的全仓落地。

### A6. dry-run 语义不统一（P1）

- 好基线：默认 `--doit=false`（除 pick 外）。
- `cmd_pick.js:258` 用 `argv.dryRun = argv.dryRun ?? !argv.doit` 做补丁式兼容，两套语义并存。
- **`cmd_pick.js` 在 dry-run 下仍写盘**：`filelist_*.json`（366-391）与 `picked_*.json`（518）不受 `dryRun` 控制 → 用户以为在预览，实际在工作目录生成了文件。
- **`cmd_lr.js` 完全没有 dry-run 选项**，但会整目录 `fs.move`；它只用一条 `inquirer` 确认兜底。

建议：dry-run 约定为"零副作用"，pick 的报表写入延后到 `--doit`；lr 补齐 `--doit`。

### A7. i18n 只覆盖了 describe，UI 正文仍是硬编码（P2）

静态扫描确认：命令里用到的 `t("...")` key **0 缺失**（`lib/i18n.js` 覆盖完整）。但以下仍是硬编码字符串，中英切换时不一致：

- `cmd_moveup.js`：全部确认提示（`Are you sure to move all files to top sub folder?` 等）
- `cmd_zipu.js`：两处 `inquirer` 提示
- `cmd_remove.js:996-1005`：操作汇总表头
- `cmd_pick.js:1309-1362`：10 处 `console.log` 统计输出（同时绕过 `lib/debug.js`，不受 `--verbose`/文件日志管辖）

---

## 3. 业务逻辑与正确性缺陷清单

> 优先级：P0 = 影响结果正确性或数据安全，建议立即修；P1 = 行为与设计不符/易踩坑；P2 = 一致性/可维护性。

| # | 位置 | 问题 | 影响 | 级别 |
|---|---|---|---|---|
| B1 | `cmd_remove.js:1699-1727` + `1396-1403` | `--corrupted/--badchars` 不在 `checkConditions` 的 AND 组合里，只要命中即 `shouldRemove=true`；与 `--pattern/--size/--width` 组合时，**严格模式下也会删除不满足其它条件的文件** | 删除范围超出用户预期，且违反自述的"严格=全部满足"语义 | **P0** |
| B2 | `cmd_remove.js:1022` | 输出 `To undo this operation, use: mediac undo --log <file>`，但 `index.js` **没有注册 `undo` 命令** | 用户相信可回滚，实际不可 | **P0** |
| B3 | `cmd_rename.js:1081` vs `lib/rename.js:53,128` | 产出 `associatedExts`，消费 `extraExts` → "重命名主文件时同步重命名字幕/封面"**从未生效** | 功能静默失效，关联文件残留旧名 | **P0** |
| B4 | `cmd_rename.js:1060` | `entry.fixenc` 应为 `argv.fixenc`（entry 上从无该字段）→ fixenc 后新名仍含乱码时的跳过兜底**永不触发** | 可能产出不可控文件名 | **P0** |
| B5 | `cmd_rename.js:773-816, 1079` | `handlePathConflicts` 的检查（`fs.pathExists`/`seenPaths.has`）与登记（`state.seenPaths.add`）分别在 await 前后，pMap 并发下多任务可通过同一检查 → 第二阶段 `SkipExists` 静默跳过 | 实际改名数 < 报表数，且用户不知道哪些没改 | **P0** |
| B6 | `cmd_prefix.js:177-189, 269-274, 314` | `getAutoModePrefix`/`MODE_DIR`/`MODE_MEDIA` 直接下标 `dirParts[0..2]`，浅目录（如 `C:\a\b\`）下为 `undefined` → `.includes/.length` TypeError | 整批命令崩溃 | P1 |
| B7 | `cmd_prefix.js:219-225` | 模块级可变状态 `nameDupSet/nameDupIndex`（当前靠"必须串行"注释 + `494-497` 串行循环兜着） | 进程内二次调用/未来改并发即错；改为局部 Map 并显式传参 | P1 |
| B8 | `cmd_moveup.js:44-51` | `--mode` 提供 5 个 choices，除 `clean` 外**行为完全一致**（源码注释已承认） | 制造"有策略"的假象；建议删除或实现（SEQ 已在 prefix 存在） | P1 |
| B9 | `cmd_moveup.js:225-234` | 分类用 `getFileTypeByExt`，而 `IMAGE_FORMATS` **不含 RAW**（`.cr2/.nef/.arw/.dng`…）→ RAW 落进"文件"而非"图片"目录 | 归档结果与摄影师预期不符 | P1 |
| B10 | `cmd_move.js:133` | `--max-depth` 默认 **1**，即默认只处理根目录一层；多数人预期是递归 | 大量文件被"静默跳过"而用户不知情 | P1 |
| B11 | `cmd_pick.js:806-824` | 仅按文件名解析日期，**无 EXIF 兜底**，尽管项目已依赖 `exiftool-vendored` 且 `lib/exif.js` 已封装 | 被改名/扫描件无日期 → 静默丢弃，挑选结果偏低再 primary reason 无报警 | P1 |
| B12 | `cmd_pick.js:419-433` | `excludedFiles` 用**文件名 basename** 建集合 → 不同目录的同名照片被一并排除 | 误排除（相机 IMG_0001.jpg 极普遍） | P1 |
| B13 | `cmd_pick.js:258, 366-391, 518` | dry-run 下仍写 `filelist_*.json` / `picked_*.json` | "预览"不干净 | P1 |
| B14 | `cmd_lr.js:47-49, 71-83` | `if (!root)` 不可达（`path.resolve` 必返回非空，缺参会先 TypeError）；目标路径依赖路径里出现 `RAW/` 段，匹配不上时 `fileDst === 父目录` → `pathExists` 恒真 → **全部静默 skip** | 用户看到"0 moved"但无原因；另缺 `--doit` | P1 |
| B15 | `cmd_zipu.js:117` / `cmd_prefix.js:123` | `--tcsc`（繁转简）、`--jobs` 声明后从未实现 | 用户以为生效 | P1 |
| B16 | `cmd_dcim.js:45, 387-421` | `--backup` 声明未使用（实际只认 `--backup-dir`）；备份**扁平化到单目录**，同名冲突用秒级时间戳，同一秒内二次冲突会被 `fs.copy` 覆盖 | 备份中的文件可能被覆盖丢失 | P1 |
| B17 | `cmd_remove.js:685-700` | `argv.directories` 分支不可达（builder 未声明该选项）且未按 projection 校验路径 | 死代码；若将来启用会因 `fs.stat` 抛错 | P2 |
| B18 | `cmd_decode.js:296-306` | `tryDecodeText` 已按质量降序返回，`decodeText` 再 `reverse()` 变升序 → `forEach(showResults)` 打印顺序是"差→好"，靠 `pop()` 才取到最好的（**结果对，显示与注释都反了**）；且重复排序 | 输出误导，易被后人"修正"成 bug | P2 |
| B19 | `cmd_move.js:366-395` | 规划阶段高并发，执行阶段按月**串行** | 大批量慢；建议受限并发 + 失败明细 | P2 |
| B20 | `cmd_compress.js:498-502` | 临时文件 `_tmp@hash@tmp_` 无统一清理钩子（`ffmpeg_run` 才有 `installTempCleanupHooks`），中断即残留 | 磁盘残留；建议 extract 出通用 temp 清理 | P2 |
| B21 | `cmd_pick.js:597-601` | `outDir` 默认 `"output"`（用于报表），但 `copyPickedFiles` 仅在显式 `--output` 时才复制 | 两处 outDir 语义不一致，用户困惑 | P2 |

---

## 4. 做得好的部分（应保留并被推广）

这些是此前几轮加固的成果，质量高于平均值，建议把它们固化为模式推广到其余命令：

1. **`remove` 的 plan/run 分层**（`planRemoveTasks` / `runRemoveTasks`）—— 唯一的命令层架构样板。
2. **`lib/rename.js` 的两阶段并发重命名**（临时名 → 最终名）—— 正确消灭了链式重命名 A→B、B→C 的 TOCTOU 竞态，且失败回滚。
3. **`cmd_zipu.js` 的 Zip Slip + Zip Bomb 双重防护**（`resolveSafeEntryPath` 三层校验 + 绝对/压缩比双上限），并导出供单测。
4. **`helper.safeRemove` 回收站语义 + 失败返回 `null`**，且所有调用点都做了 `if (!dest)` 判定（此前多处"删失败却计成功"已修）。
5. **`filenameSafe` / `isReservedWindowsName` / NFC 归一化**、`moveSafe` 的 EXDEV 降级 —— 跨平台细节到位。
6. **单位与口径修正**：Cmd_remove的 `--sizel/--sizer` 由 1000 改 1024 并改包含边界；`include/exclude` 由互斥改交集。
7. **`capabilities.js` 的能力探测 memo 化**，消除了"必须先跑 compress"的隐式前提。
8. **`date_parse.js` 统一 move/pick 的日期解析与时区** —— 消 Duplicateimpl。

---

## 5. 工程化与测试现状（实测数据）

| 项 | 结果 |
|---|---|
| `npx eslint cmd lib index.js` | **0 error / 0 warning**（prettier 规则已收紧为 error） |
| `npm run check`（语法检查） | CI 已启用 |
| CI 矩阵 | Node 20.x / 22.x / 24.x，`npm run check` + `lint` + `test` |
| `node --test "test/*.js"` | 全绿，约 41 个 suite |
| 触达命令层的测试 | **仅 3 个**：`test_remove_command.js`(9 项)、`test_decode_command.js`(6 项)、`test_zipu_path.js`(仅 `resolveSafeEntryPath`) |
| 零测试命令 | `move` / `moveup` / `pick` / `prefix` / `dcim` / `compress` / `rename` / `lr` / `run` |

**主要风险：命令层几乎处于"靠注释保护"状态。** 上述 B3～B5 这类"字段名错位 / 并发竞态"的问题，只要有 plan 层纯函数测试就能秒杀发现，但现在完全没有防线。

---

## 6. 改进路线图

### P0（建议本周处理，均为事实性缺陷）

1. `remove`：把 `corrupted/badchars` 纳入 `checkConditions` 的 AND 组合（或至少在确认提示里明示"与其余条件为 OR"）—— B1
2. `remove`：删除/替换 `mediac undo` 提示，改为输出可执行的恢复脚本或明确告知需手工恢复 —— B2
3. `rename`：`associatedExts` → `extraExts` 统一字段名（并补一条契约测试防复发）—— B3
4. `rename`：`entry.fixenc` → `argv.fixenc`；把 `seenPaths` 的冲突登记改为「规划串行阶段统一占位」或在 `preRename` 前做一次纯内存冲突消解 —— B4 / B5
5. `pick`：dry-run 不写盘（延后到 `--doit`）—— B13
6. `lr` / `zipu`：接入 `initAutoConfirm` + `command_utils.confirmDangerousAction`，让 `-A`/`MEDIAC_AUTO_CONFIRM` 生效，同时删掉 `--tcsc` 或实现它

### P1（两周内，架构收敛）

7. 抽 `lib/cmd_options.js`：`withCommonOptions / withFilterOptions / withWriteOptions`，命令 builder 从 ~250 行降到 ~60 行
8. `rename` 与 `move` 试点 plan/apply 分层的三段式重构，产出纯函数 `buildRenameTasks(argv, entries)` + `writeTasksToJson`，建立第一条命令层单测线
9. 统一并发：`resolveConcurrency(argv.jobs, config.JOBS.*)` 替换 12 处 `cpus().length` 与 `concurrency: 4`
10. 统一 dry-run 约定：`plan` 零副作用，`apply` 才写；建立 `--report <json>` 让所有危险操作可审计
11. 业务口径补齐：`moveup` 的 RAW 归入图片分类 / `move` 的 `--max-depth` 默认值与语义 / `pick` 增加 EXIF 兜底日期 / `pick` 排除集改用相对路径而非 basename
12. 错误处理收口：`helper.validateInput` 抛 `MediaCliError`，删除三份手写目录校验

### P2（后续）

13. Task schema 化 + 契约测试（防 B3 类漂移）
14. i18n 收口：`moveup`/`zipu`/`remove`/`pick` 的 UI 正文全部走 `t()`
15. `pick` 的 `console.log` 报表迁到 `lib/debug.js`，统一受 `--verbose` 与文件日志管辖
16. 测试补到命令层 ≥60%（优先 plan 层纯函数：`preRename` / `createNewNameByMode` / `selectForDay` / `processBurstGroups` / `checkConditions` / `buildJsonOutput`）

---

## 附录：本次使用的核验手段

- 静态扫描脚本：`temp/audit_cmd.cjs`（短别名冲突、声明未读取的选项、`initAutoConfirm` 覆盖率、直连 `inquirer`、`console.log`、`cpus().length`）
- 交叉验证：`lib/rename.js`、`lib/file.js`、`lib/helper.js`、`lib/core.js`、`lib/encoding.js`、`lib/date_parse.js`、`lib/capabilities.js`、`lib/config.js`、`lib/errors.js`
- 实测：`node node_modules/eslint/bin/eslint.js cmd lib index.js`（全绿）、`node --test "test/*.js"`（全绿）
- 说明：`temp/` 已被 `.gitignore` 与 ESLint ignores 排除，不会污染仓库门禁

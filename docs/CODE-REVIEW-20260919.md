# MediaCli 代码审查报告（独立复审）

- 项目：`C:\Home\Projects\media-cli.js`（mediac v2.0.0，ESM / Node CLI）
- 报告日期：2026-09-19 21:58 (+0800)
- 审查范围：全仓库 `index.js` + `cmd/`(15) + `lib/`(24) + `test/` + `scripts/` + `tools/` + 工程配置
- 验证环境：**Node v22.22.2（V8 12.4.254.21）**、Windows 10、git-bash
- 审查方式：静态通读 + 实际执行门禁命令 + 关键结论逐条代码取证
- 本轮**包含安全议题**（既有报告明确排除），并补充工程门禁有效性验证
- 与既有文档关系：`docs/TODO-FIXES-20260919.md`（373 行）已记录三轮共 37 项修复，本报告**不重复其已修复项**，仅保留「仍存在」「修复不完整」「结论需更正」三类，详细差异见第 8 节

---

## 0. 结论摘要

一句话结论：**代码功能密度高、注释与 i18n 覆盖度罕见地好，但当前 HEAD 在任何 Node 22 环境上完全无法启动，且现有的三道质量门禁（check / test / lint）全部失效，无法拦截此类问题；架构层面 `cmd_shared.js` 事实上已演化为被 8 个模块依赖的"隐性核心库"，`lib/` 与 `cmd/` 的职责边界、大量死代码与死配置是主要结构性负担。**

### 实测门禁结果（本报告全部结论的基础）

| 检查项 | 命令 | 实测结果 | 判定 |
| ------ | ---- | -------- | ---- |
| 语法检查 | `npm run check` | `cmd/cmd_shared.js`、`lib/exif.js` 报 `SyntaxError`，`exit 1` | ❌ 失败 |
| 单元测试 | `npm test` | 35 用例 / 通过 28 / **失败 7** | ❌ 失败 |
| 代码检查 | `npx eslint .` | 扫描 111 文件，**报告 0 个问题**（含上述语法错误文件） | ⚠️ 无拦截能力 |
| 代码格式化 | `npx prettier --check` | **14 个文件**不符合配置 | ⚠️ 未接入流程 |
| CLI 可用性 | `node index.js --help` | `SyntaxError`，未打印帮助 | ❌ 不可用 |
| 持续集成 | `.github/` 是否存在 | 不存在 | ❌ 缺失 |

### 问题严重度分布

| 级别 | 数量 | 性质 |
| ---- | ---- | ---- |
| **P0 阻断 / 数据风险** | 4 | 程序无法启动、安全漏洞、失败被计为成功 |
| **P1 高** | 8 | 功能静默失效、死配置、跨平台/版本不一致 |
| **P2 中** | 12 | 并发、状态、重复实现、健壮性 |
| **P3 低 / 工程卫生** | 8 | 文档漂移、死资产、格式化、仓库整洁 |
| 合计 | 32 | — |

### 代码规模画像

| 层次 | 文件数 | 行数 | 说明 |
| ---- | ------ | ---- | ---- |
| `cmd/` | 15 | 10,413 | 命令层，单文件 400–1,868 行 |
| `lib/` | 24 (js) | 9,959 | 其中 `i18n.js` 单文件 1,292 行 |
| `index.js` | 1 | 137 | 入口 |
| **生产代码小计** | **40** | **20,509** | — |
| `test/` | 5 | 582 | 覆盖率极低 |
| `scripts/` + `tools/` + `labs/` | 30 | 3,593 | 辅助/实验，未纳入 `npm files` |
| **仓库源码合计** | **75** | **23,511** | 不含 `node_modules` 与 `temp/` |

单文件体量 TOP6：`cmd_ffmpeg.js` 1,868 → `cmd_remove.js` 1,654 → `cmd_pick.js` 1,348 → `lib/i18n.js` 1,292 → `cmd_rename.js` 1,060 → `lib/core.js` 1,043。**前 6 个文件占生产代码的 39%。**

---

## 1. P0 — 阻断级（4 项）

### P0-1 声明式资源管理 `using` 超出运行时能力 → 整个 CLI 无法启动

**这是本报告的头号问题，优先级高于其他所有条目。**

| 项 | 内容 |
| -- | ---- |
| 位置 | `lib/exif.js:107`、`lib/exif.js:141`、`cmd/cmd_shared.js:422` |
| 声明 | `package.json:8` → `"engines": { "node": ">=22" }` |
| 文档 | `README.md:136` → `Node.js (v18+)` |
| 实际 | `using` 需要 **Node ≥ 24（V8 13.6）**；Node 22（V8 12.4）在**解析阶段**即报错 |
| 影响面 | `index.js:17` 直接 `import * as exif from "./lib/exif.js"` → **任何子命令均无法执行**；`cmd_shared.js` 另被 8 个命令模块引用 |

取证：

```
$ node --check lib/exif.js
lib/exif.js:107
        using etl = new exiftool.ExifTool()
              ^^^
SyntaxError: Unexpected identifier 'etl'

$ node index.js --help
（同上 SyntaxError，未输出任何帮助文本）

$ npm test
# tests 35 / pass 28 / fail 7        ← 7 个失败全部源于此
```

根因追溯：`docs/CHANGES-20260919.md:44` 记载「新增 `engines.node >= 22`（代码使用 `using` 声明式资源管理）」，即**引擎下限是依据一个错误假设设定的**；同时 `docs/TODO-FIXES-20260919.md:6` 注明验证环境为 **Node v24.15.0**——在 Node 24 上恰好可用，因此该问题在既有审查中被整体掩盖。

**修复建议（二选一，推荐前者）**

1. **改为 `try/finally` 手动释放**（3 处），`exiftool.ExifTool` 的 `end()` 返回 Promise，配 `await` 使用即可；这样 `engines` 可回到 `>=18`，对一个面向全球安装的 npm CLI 而言兼容性收益最大。
2. 若坚持使用 `using`：`engines` 与 README 同步改为 `>=24`，并在入口增加版本前置校验（见 P1-7）。

> 建议同时把 3 处的 `using etl = ...` 收敛为**模块级单例 ExifTool**（见 P1-5），可一并解决。

---

### P0-2 质量门禁三重失效：`lint` 报告 0 问题、`check`/`test` 失败被忽略

| 子项 | 证据 | 后果 |
| ---- | ---- | ---- |
| ESLint 形同虚设 | `npx eslint . --format json` → `files linted: 111, total msgs: 0`；**对含硬语法错误的 `cmd_shared.js` 同样返回 `messages: []`** | lint 绿灯不代表代码可运行 |
| 规则被大面积关闭 | `eslint.config.js:29-34` 关闭 `no-unused-vars`、`no-empty`、`no-fallthrough`、`no-prototype-builtins`、`no-useless-assignment` | 直接导致 ~20 个文件保留未使用的 `handleError` / `parseArgs` / `argv` 导入而不被提示 |
| Prettier 未接入 | `eslint.config.js:10` 设 `"prettier/prettier": "off"`，却仍在 `:39-43` 加载插件；`npx prettier --check` 实测 **14 个文件**不合规 | 插件与配置文件成为纯负担 |
| 无 CI | 无 `.github/` 目录 | `check`/`test`/`lint` 全靠人工记得执行，实测全部处于失败状态 |
| `check` 脚本定义过窄 | `scripts/check_syntax.cjs:17` 仅遍历 `cmd/` 与 `lib/` | `index.js`、`tools/`、`scripts/`、`test/` 的语法错误不会被发现 |

**修复建议**

1. `eslint.config.js`：恢复 `no-unused-vars`（设为 `error`，允许 `^_` 前缀）、`no-empty`（`allowEmptyCatch: false`）、`no-fallthrough`；开启 `"prettier/prettier": "error"`。
2. `check_syntax.cjs` 的目录列表改为「仓库根下所有 `.js`，排除 `node_modules`/`temp`」，并顺带校验 `package.json` 的 `engines` 与代码中 `using`/`??=` 等新语法的兼容性。
3. 增加最小 CI（哪怕是单 job：`npm ci && npm run check && npm run lint && npm test`）。这是**唯一能防止 P0-1 复发**的机制。

---

### P0-3 ZIP 解压路径穿越（Zip Slip）— 可写出到任意目录

| 项 | 内容 |
| -- | ---- |
| 位置 | `cmd/cmd_zipu.js:448-451` |
| 代码 | ```js\nconst fileNameParts = path.parse(entryName)\nconst dstDir = path.join(zipDir, fileNameParts.dir)\nconst dstFile = path.join(dstDir, fileNameParts.base)\n``` |
| 成因 | `entryName` 在 `:426` 由包内原始字节解码而来，可为 `../../evil.txt`；`path.join` 会**归一化 `..`**，把目标推离 `zipDir` |
| 缺失 | 全仓库无 `path.relative(zipDir, dstFile).startsWith("..")` 之类的包含性校验 |
| 落盘 | `:502` 左右以 `fs.rename(tmpDstFile, dstFile)` 写入，可覆盖解压目录外的任意文件（含用户任意可写路径） |

**修复建议**：解码 `entryName` 后归一化并剥离前导 `../`，再断言 `dstFile` 位于 `zipDir` 内，否则 `entry.drain()/autodrain()` 跳过并计入「BadName」；同时把同样的校验补到 `tmpDstFile`（`cmd_zipu.js:451`）。

---

### P0-4 删除/移动失败被计为成功（统计与操作日志双重失真）

既有文档称此项「已修复」（`TODO-FIXES-20260919.md:39`），实测**修复不完整**：失败路径仍返回 `undefined`，而调用方全部不检查返回值。

| 位置 | 代码 | 问题 |
| ---- | ---- | ---- |
| `lib/helper.js:509-511` | `console.error(...); return undefined` | 由 `catch` 返回 `undefined`，**不抛错** |
| `cmd/cmd_remove.js:923` | `const destPath = await helper.safeRemove(task.src)` | `destPath` 可能为 `undefined` |
| `cmd/cmd_remove.js:926-933` | 紧接着 `operationLog.push({ dest: destPath, ... })` | 操作日志记录 `dest: undefined`，"撤销"能力失效 |
| `cmd/cmd_remove.js:945` | `++removedCount` | **无条件自增**，未删除也计入成功 |
| `cmd/cmd_remove.js:1033-1035` | `moveToOutputDir` 的 `catch` 同样 `return undefined` | `:903` 处照旧按成功记录 move 日志 |
| `cmd/cmd_moveup.js:325` | `await helper.safeRemove(td);` 丢弃返回值 | 目录未移走仍计入 `delCount` |
| `cmd/cmd_compress.js:568`、`cmd/cmd_ffmpeg.js:495` | 同样丢弃返回值 | 源文件残留而流程认为已清理 |

补充风险：`lib/helper.js:475-479` 把回收站固定为 `pathRoot(filepath)/Deleted_By_Mediac/<date>`，即**磁盘根目录**（本机 `C:\Deleted_By_Mediac\` 已实际存在）。非管理员账户在盘根创建目录会因权限失败，恰好触发上述「失败即计成功」链路，两者叠加构成静默数据残留。

**修复建议**

1. `safeRemove` 失败时 **throw**（或返回 `null`）并保留原始错误；三处调用方显式判定返回值，失败则计入 `errorStats` 而非成功。
2. 回收站位置改为 `os.homedir()/.mediac/deleted/<date>`（或用户级 AppData），彻底规避盘根权限问题。
3. 操作日志改为「先写日志再执行」或「执行成功后写日志」，避免出现与事实相反的 `dest` 记录。

---

## 2. P1 — 高（8 项）

### P1-1 `presets.yaml` 整套是死配置，从未被加载

| 证据 | 结论 |
| ---- | ---- |
| `lib/ffmpeg_presets.js:15` | `import { loadPresetsFromYaml, mergePresets }`，其中 **`mergePresets` 全文件仅此一处出现**（未使用） |
| `lib/ffmpeg_presets.js:609` | `initPresetsAsync()` 定义、`:889` 导出，**全仓库无任何调用点** |
| `package.json:24` | `files` 白名单包含 `presets.yaml` |

即：项目把 `presets.yaml` 打进 npm 包，却没有任何代码读取它；实际生效的只有 `ffmpeg_presets.js` 内硬编码的 `PRESET_*` 常量集，两者内容重复且可能已经漂移。用户修改 `presets.yaml` 不会产生任何效果。

**建议**：二选一收口——要么在命令初始化阶段 `await initPresetsAsync()` 并让 YAML 覆盖/合并硬编码默认值（同时补 `preset_loader.js` 的字段白名单校验，见 P1-8）；要么删除 `presets.yaml`、`preset_loader.js` 及 `package.json` 中的白名单条目。

### P1-2 批处理失败即中断，无回滚、无断点续跑

| 位置 | 问题 |
| ---- | ---- |
| `cmd/cmd_move.js:386-403` | `try` 包裹整个 `for` 循环：任一文件 `fs.move` 失败，**当月剩余文件全部不再处理**，且只打印一次错误 |
| `cmd/cmd_move.js:229-246` | `checkMove` 经 `pMap` 在移动前并发计算 `fileDst`；不同源目录的同名同月文件会得到相同目标路径，移动循环 `:387-391` 直接 `continue` → 文件留在原地却被计入 `skipped`（静默漏移） |
| `cmd/cmd_moveup.js:300-303` | `cleanupEmptyDirs` 仅做集合差就删除/移走目录，**未校验目录确实为空**；移动失败或目录内含非媒体文件时会被整目录移入回收站 |
| `cmd/cmd_moveup.js:281` | 汇总输出使用 `totalCount` 而非 `movedCount`，数字虚高 |

**建议**：`try` 下沉到循环体内逐文件 catch；目标名按 `fileDst` 去重预分配；删除目录前 `readdir` 确认空；修正汇总口径。

### P1-3 解压：无 zip bomb 防护 + `--override` 无确认直接递归删除

| 位置 | 问题 |
| ---- | ---- |
| `cmd/cmd_zipu.js:469-507` | 全程未累计 `entry.vars.uncompressedSize`，无单条/总量解压上限（原 2GB 保护在 `:252-257` 已被注释） |
| `cmd/cmd_zipu.js:264-266` | `if (f.override) { !testMode && (await fs.remove(zipDir)) }` — 走 `fs.remove` 硬删除，**非 `safeRemove`、无二次确认** |
| `cmd/cmd_zipu.js:495-531` | 解压失败仅置 `f.done = false`，既不清理 `_*.tmp` 残留也不回滚已解出的条目 |

**建议**：加累计解压体积/压缩比上限并在超限时中止；`--override` 改走 `safeRemove` 并要求显式确认；失败路径清理临时文件与当次产物目录。

### P1-4 `rename` 的同批重名检测是死分支 → 预览结果 ≠ 实际结果

```
cmd/cmd_rename.js:504   const seenPaths = new Set()
cmd/cmd_rename.js:774   } else if (seenPaths.has(newPath)) {     // 永不成立
cmd/cmd_rename.js:779   (p) => seenPaths.has(p),                 // 永不成立
```

`seenPaths` 全文件**没有任何 `.add()` 调用**（已用 grep 逐一确认），因此 `:774` 分支为死代码。当同批两个源文件映射到同一目标名时，`:409` 仅打印告警，`outPath` 未消歧；实际执行时靠 `cmd_shared.js:53` 的存在性检查跳过。结果是 **dry-run 预览显示的重命名计划与真实执行结果不一致**——这是用户最不易察觉的一类问题。

**建议**：补齐 `seenPaths.add(newPath)`，或在规划阶段直接按目标路径去重分配唯一名，并让预览与执行共用同一份计划数据结构。

### P1-5 `exiftool` 实例按文件创建，峰值进程数为 CPU 核数²

```
lib/exif.js:88-94   function createExif() { return new exiftool.ExifTool({ maxProcs: os.cpus().length, ... }) }
lib/exif.js:141     using etl = createExif()          // 在 pMap 回调内，逐文件新建
lib/exif.js:163     外层并发 = cpus().length
```

外层并发 × 每实例 `maxProcs` → 峰值可达 **cpus² 个 exiftool 进程**（本机 8 核即 64 个进程）。此外 `:107` 的 `readSingleExif` 用默认配置 `new exiftool.ExifTool()` 每文件起一个新实例，而 `exiftool-vendored` 官方推荐的正是**长驻单例**。既有文档的「能关但用法不正确」结论成立。

**建议**：模块级单例（含 `process.on("exit")` 统一 `end()`），并考虑用 `readAllTags` 的批量接口替代逐文件调用。

### P1-6 `cmd_ffmpeg`：软解分支为死代码、负码率、无中断清理

| 位置 | 问题 |
| ---- | ---- |
| `cmd/cmd_ffmpeg.js:989-994` → `:1492` | 10bit H264 分支设置 `newEntry.useCPUDecode = true`，但 `createFFmpegArgs` 只读取 `useCUDA`，**从不引用 `useCPUDecode`** → 该分支永不生效，仍走硬解并可能失败 |
| `cmd/cmd_ffmpeg.js:1601-1603` | `if (!useCUDA) tempFilters = "hwupload_cuda," + tempFilters` — 软解路径却强行插入 CUDA 上传滤镜，无 N 卡环境必然失败 |
| `cmd/cmd_ffmpeg.js:1376` | `srcVideoBitrate = ivideo?.bitrate \|\| fileBitrate - 48*1000 \|\| 0` → 码率未知时得到**负数** `-48000`，污染 `videoBitScale` |
| `cmd/cmd_ffmpeg.js:726-730` | 只在 `finally` 清理 `fileDstTemp`；全项目无 `SIGINT`/`SIGTERM` 钩子，execa（`:1737`）也未设 `timeout` → Ctrl+C 或 ffmpeg 挂起会残留 `*_tmp@hash@tmp_` 文件 |
| `cmd/cmd_ffmpeg.js:485-495` | 删除源文件的判据仅为 `t.dstExists`（来自 `fs.pathExists`），上次中断残留的 0 字节坏文件同样满足 → **可能删除源文件而产物是坏的**，且无回滚 |
| `cmd/cmd_ffmpeg.js:668-677` | dst 已存在的分支 `return` 时未设置 `entry.ok`，成功项被漏计 |

**建议**：让 `createFFmpegArgs` 真正消费 `useCPUDecode`；按实际 hwaccel 选择上传滤镜；码率加 `Math.max(0, …)`；注册信号清理 + execa `timeout`；删除源文件前增加产物可读性/大小校验。

> 注：既有文档第 6 节列出的「`shell: true` + 手工拼引号」**已然过时**——当前 `cmd_ffmpeg.js:1730-1745` 已是 `shell: false` + 数组传参，并有实测注释。该项应从待办中关闭（详见第 8 节）。

### P1-7 版本声明与文档三处互不一致，且入口无前置校验

| 来源 | 声明 |
| ---- | ---- |
| `package.json:8` | `"node": ">=22"` |
| `README.md:136` | `Node.js (v18+)` |
| 代码实际要求 | `>= 24`（因 `using`） |
| 既有审查验证环境 | Node v24.15.0 |

**建议**：入口 `index.js` 顶部加入版本硬校验（`process.versions.node` 主版本 < 要求值时输出可读提示并 `exit 1`），把"不可用的堆栈错误"变成"明确的版本提示"；同时三方声明统一。

### P1-8 配置与用户输入缺少校验（YAML 预设、正则）

| 位置 | 问题 |
| ---- | ---- |
| `lib/preset_loader.js:117-119` | `yaml.load()` 后仅判 `typeof === "object"`，预设字段拼错会**静默忽略**，`processPresets` 只捕获 `extends` 异常 |
| `cmd/cmd_shared.js:738-739` | `new RegExp(pattern, "ui")` 直接编译**用户输入的正则**，且未 try/catch → 非法正则抛错、构造复杂度不受控（ReDoS） |
| `cmd/cmd_compress.js:481-483` | `--suffix` 未经 `filenameSafe` 处理（而 `cmd_ffmpeg.js:1080` 对同类参数做了处理）→ `--suffix ../x` 可越目录写出 |
| `cmd/cmd_zipu.js:642-648` | 编码判定 `chr.filter(i => i.confidence >= 85 && ...)` 后取首条，误判即整批文件名错乱 |

**建议**：YAML 增加字段白名单 + 未知字段告警；用户正则统一经「长度限制 + try/catch + 降级为字面匹配」包装；`--suffix` 过 `filenameSafe`。

---

## 3. P2 — 中（12 项）

### 3.1 并发与状态

| # | 位置 | 问题 | 建议 |
| - | ---- | ---- | ---- |
| P2-1 | `cmd/cmd_compress.js:276 / :297 / :573`、`cmd/cmd_ffmpeg.js:538` | 并发策略四处不一致：满核、半核、`cpus()*8`、无上限 | 统一为具名常量 `DEFAULT_JOBS`，并按任务类型 clamp |
| P2-2 | `lib/file.js:57` `walkLastUpdatedAt`、`lib/tryfp.js:6` `conf`、`cmd/cmd_rename.js:504` `seenPaths` | 模块级可变状态跨调用共享，不可重入、测试相互污染 | 改为参数注入或工厂函数 |
| P2-3 | `cmd/cmd_compress.js:601-603` | 运行期改写 `config.SHARP_SUPPORT_HEIC / VIPS_BIN_PATH`，`cmd_shared.js:353,363` 隐式读取；且 `:604-607` catch 后继续执行 | 改为显式能力对象注入 |
| P2-4 | `lib/image_hash.js:189` | `hashResults.push(...)` 在并发回调内执行，完成顺序不定 → 破坏 `dedupByHashes` 声称的确定性顺序 | 改为 `results[i] = ...` 下标写入 |
| P2-5 | `lib/image_hash.js:382,386,632,713` | 同一文件被 `sharp` 重复解码约 4 次 | 复用一次 pipeline / metadata |
| P2-6 | `lib/exif.js:181-183` | 直接改写 `tags.CreateDate.zone`，而该对象已进入 `exifCache` → 副作用外泄 | 复制后再改写 |

### 3.2 正确性与健壮性

| # | 位置 | 问题 | 建议 |
| - | ---- | ---- | ---- |
| P2-7 | `cmd/cmd_rename.js:760-765` | `abc.txt → ABC.txt` 在 Windows 上 `pathExists` 命中自身，被误判为冲突并生成 `ABC_1.txt` | 比较 `toLowerCase()` 后的路径 |
| P2-8 | `cmd/cmd_shared.js:59,136,172`、`cmd/cmd_prefix.js:400-403` | `fs.rename` 跨卷抛 `EXDEV` 未回退为 copy+unlink；`prefix` 去重只查内存表不查磁盘 | 统一 `moveSafe()` helper；去重同时查 `pathExists` |
| P2-9 | `cmd/cmd_remove.js:1240-1249` | 参数注释为 K 但按 1000 换算，且用严格 `>` / `<` 排除边界值（与 `checkFileDimensions` 的 `>=` / `<=` 不一致） | 统一 1024 进制与 `>=` / `<=` |
| P2-10 | `cmd/cmd_move.js:86` vs `cmd/cmd_pick.js:792` | 文件名日期解析：一处固定 `Asia/Shanghai`，一处用本机时区；且两者正则不同（分隔符必选 vs 可选） | 抽出共享 `parseDateFromName()` |
| P2-11 | `cmd/cmd_pick.js:137-140` | `dry-run` 默认 **false**，即默认**执行复制**；而 `remove`/`move`/`moveup` 均默认预览（`const testMode = !argv.doit`） | 统一为默认预览，破坏性/写入类操作强制显式开关 |
| P2-12 | `lib/helper.js:456`、全仓库 | `filenameSafe` 不处理 Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1`…）；全仓库无 `normalize("NFC")`；无 `MAX_PATH` 260 校验 | 补保留名拦截、Unicode 规范化、路径长度校验 |

> 另需注意：`cmd/cmd_pick.js:599-611` 存在「先 `pathExists` 再 `fs.copy`」的 TOCTOU，且 `fs-extra` 的 `copy` 默认 `overwrite: true`；`cmd/cmd_remove.js:871` 的执行阶段与扫描阶段之间存在同类窗口。建议改为 `overwrite: false` 并捕获 `EEXIST`、执行前复核 `mtime`/`size`。

---

## 4. P3 — 低 / 工程卫生（8 项）

| # | 项 | 证据 | 建议 |
| - | -- | ---- | ---- |
| P3-1 | **README 命令表漂移** | `README.md:49-64` 列出 `organize`/`oz`（**该命令不存在**），遗漏 `execute`/`run`、`test`/`tt`；缺失别名 `pk`、`px`、`fxn`、`rmf`、`aconv`/`vconv`/`avconv` | 按 `cmd/cmd_*.js` 的 `command`/`aliases` 重新生成表格 |
| P3-2 | **死资产 `lib/words.json`** | 961 KB，全仓库零引用，却因 `package.json:21` 的 `files: ["lib"]` 被打进 npm 包 | 删除（`lib/notes.txt` 同样零引用，一并清理） |
| P3-3 | **死文件 `lib/cue-parse.js`** | 325 行，全仓库（含 test）零引用 | 删除；如需保留，移入 `labs/` |
| P3-4 | **`cmd_run.js` 空实现** | `:72-86` 全部逻辑被注释，仅在 `index.js:76` 注册为 `execute`/`run`，执行无任何效果 | 实现或移除并更新 README |
| P3-5 | **i18n 死键 59 / 378** | 实测：词典 378 键，代码引用 319，**59 键零引用**、缺失键 0 | 清理死键；并给 `getText` 加非生产环境的 `[missing i18n]` 提示 |
| P3-6 | **错误码 17 / 30 零引用** | 实测：`ErrorCodes` 定义 30 个，**17 个从未以 `ErrorTypes.X` 形式被引用**（`FILE_ALREADY_EXISTS`、`INVALID_PATH`、`FFMPEG_NOT_FOUND`、`SHARP_ERROR`、`INTERNAL_ERROR` 等） | 按「保留在用的 13 个 + 删除其余」收敛 |
| P3-7 | **格式化未接入** | `npx prettier --check` → 14 个文件不合规（含 `lib/i18n.js`、`lib/errors.js`、`cmd/cmd_remove.js`） | 开启 `prettier/prettier` 规则并执行一次 `npm run prettier:fix` |
| P3-8 | **仓库卫生** | 根目录残留 Box-Agent 会话目录 `2026-09-19-897124a8/`、`2026-09-19-d37243e7/`（已在 `.gitignore`）、`remove_operation_1789817502896.log`、`test/temp/`（1.5 MB / 340 个 `.bin` 用例产出）、未跟踪的 `data/`（34 文件） | 约定「运行产物一律落在 `temp/`」，为 `test/temp/` 增加清理脚本或忽略规则 |

---

## 5. 死代码 / 重复实现汇总

既有文档（`TODO-FIXES-20260919.md:359-370`）已清理过一轮死代码（删除 `lib/ffmpeg_presets_old.js` 等 6 个文件、18 个依赖）。本轮**仍可复现**的剩余项：

| 类型 | 清单 |
| ---- | ---- |
| 零引用文件 | `lib/cue-parse.js`、`lib/words.json`、`lib/notes.txt` |
| 零引用导出（`lib/core.js` 为主） | `asyncFilterAll`、`asyncMapAll`、`asyncMapGroup`、`asyncFilterSeq`、`asyncSome`、`asyncEvery`、`compareIntl`、`compareIntlBy`、`countOccurrences`、`groupByCount`、`createMapWithKeyField`、`deepClone`、`pickSimpleValues`、`pickTrueValues`、`updateObject`、`takeRandom`、`getRandomElements`、`parallel` 等 20+ 项（`core.js` 导出 50+，多数属内部实现） |
| 零引用导出（其他） | `lib/exif.js:114 showExifDate`、`lib/image_hash.js:557 hammingDistance` / `:887 computeHashDedup`、`lib/fixmetadata.js:478 getDebugInfo`、`lib/preset_loader.js:169 getPresetSearchPaths`、`lib/path-merge.js:47 mergePathChecked`、`lib/tryfp.js` 的 `tryCatch`/`trySmart`/`setNoneValue`、`lib/tools.js` 的 `md5Hash`/`hashCode`/`isSameFileXXH64Partial` |
| 重复实现 | 哈希（`helper.js:633` vs `tools.js:12`）、大小格式化（`helper.js:284` vs `:307`）、try 包装（`core.js:875` vs `tryfp.js:101`）、`removeQuotes`（`core.js:863` vs `cue-parse.js:32`）、临时文件名模板 `_tmp@hash@tmp_`（`cmd_ffmpeg.js:928` vs `cmd_compress.js:481`）、错误日志落盘（`writeErrorFile` vs `writeFailedLog`）、确认提示（`cmd_remove`/`cmd_move` 手写 inquirer vs `cmd_moveup:134 confirmOperation` vs `cmd_pick:573 confirmAction`） |

### 已确认的具体逻辑缺陷（同属死代码范畴）

| 位置 | 缺陷 |
| ---- | ---- |
| `lib/core.js:140-164` `asyncMapParallel` | 当 `concurrency` 为 `undefined` 时 `promises.length === concurrency` 恒为假 → 只在最后一个元素 flush，**并发限制完全失效**；且 `results` 为完成序，与文档声称的顺序不符 |
| `lib/core.js:439` | 正则只含 `%x%` / `{x}`，但回调读取 `p3`/`p4` → `@name@` / `!name!` 永不匹配（与注释矛盾） |
| `lib/core.js:753,351`、`lib/file.js` | 用 `{}` 作 `seen`/`counts` 容器，key 为 `__proto__`/`toString` 时会误判；应改 `Map`/`Object.create(null)` |
| `lib/core.js:287` | `/\p{ASCII}/u` 只要**任一**字符为 ASCII 即命中 → 含中文的路径会误入 ASCII 分支 |
| `lib/media_parser.js:134` | `bitDepth: data["bits_per_raw_sample"] \|\| data["bits_per_raw_sample"]` — 两个操作数完全相同，备选字段 `bits_per_sample` 永远取不到 |
| `lib/helper.js:669-681` | 哈希流的 Promise 未监听 `error` 事件 → 文件消失时**永不 settle**；`:679` 还 `reject(字符串)` 而非 `Error` |
| `lib/file.js:208-214` | 目录遍历用 `fs.stat`（跟随符号链接）→ 符号链接成环时无限递归；应改 `lstat` 并跳过链接 |
| `lib/tools.js:120,151` | `hashCache` 以路径为键、无 `mtime` 失效 → 文件改动后返回旧哈希，导致 `DUP` 误判并跳过移动 |

---

## 6. 架构评估与改进建议

### 6.1 分层现状

```
index.js (137)  ── yargs 装配 + 全局错误兜底
   │
   ├── cmd/  (15 个命令, 10,413 行)  ← handler 内混入：参数校验 / 遍历 / 过滤 / 执行 / 统计 / 输出
   │      └── cmd_shared.js (814)    ← 被 8 个命令模块 import 的"隐性核心库"
   │
   └── lib/  (24 模块, 9,959 行)
          ├── core.js (1,043)   ← 纯函数，却含路径领域函数 comparePathSmart / isUNCPath
          ├── helper.js (756)   ← IO + 领域，却含纯格式化 humanSize / humanDuration
          ├── file.js (325)     ← 自成一套遍历 + 格式化 + FileEntry，与 core/helper 三方重叠
          └── i18n.js (1,292)   ← 单文件内联 378 个 key
```

### 6.2 主要结构性问题

1. **`cmd_shared.js` 是架构风险的核心。** 它既做重命名（`renameOneFile`）、又做图片压缩（`resizeFunc`）、又做文件名过滤（`buildFilter`）、又做 vips 调用，被 `cmd_ffmpeg`/`cmd_compress`/`cmd_dcim`/`cmd_move`/`cmd_pick`/`cmd_prefix`/`cmd_rename`/`cmd_remove` 共 8 个模块依赖。低内聚、高扇入，任何改动都会波及全部命令——这也解释了为什么 P1-4、P1-6、P2-3 这类问题总是出现在它的调用边上。
2. **`core.js` 与 `helper.js` 边界失守**：路径领域函数进了 `core`，纯格式化函数进了 `helper`，而 `file.js` 又实现了第三套遍历/格式化。同名能力（哈希、大小格式化、try 包装）在 2–3 处各有一份实现。
3. **`lib/` 与 `cmd/` 的职责切分不彻底**：命令模块体量最高达 1,868 行，参数校验、业务规则、执行、统计、渲染全在一个文件内，导致核心逻辑未导出、无法单测（如 `cmd_remove.js:1343 checkConditions`、`cmd_move.js:211 checkMove`）。
4. **i18n 单文件 1,292 行内联全部词条**，且无 key 类型约束、无缺失检测、`t()` 的占位符替换用 `String.replace` 的字符串形式（值含 `$&`/`$'` 时会被当作替换指令解析——`lib/i18n.js:1242`）。

### 6.3 建议的目标结构

```
lib/
  core/           纯函数：集合、并发、排序、对象（无 IO、无领域知识）
  fs/             file.js + path-merge.js + 哈希缓存 → 统一文件系统层
  media/          exif / image_hash / ffmpeg_presets / media_parser / mediainfo
  text/           encoding / unicode / i18n（拆为 locales/*.json + 校验脚本）
  cli/            errors / error-codes / debug / arg_parser / command_utils
cmd/
  <命令>/index.js     handler 仅做编排
  <命令>/plan.js      纯函数：输入 → 执行计划（可单测）
  <命令>/run.js       副作用：执行计划 + 进度 + 统计
```

配套三项机制（对应 P0-2、P1-6、P0-4）：

- **统一临时文件注册表** + `SIGINT`/`SIGTERM`/`exit` 清理钩子，取代 6 处散落的 temp 清理。
- **统一破坏性操作契约**：`--doit` 显式确认、默认 dry-run、统一 `confirmDangerousAction`、统一操作日志（支持断点续跑）。
- **统一能力探测**：`ffmpeg`/`vips`/`sharp`/`GPU` 的能力探测结果一次性注入，禁止运行期改写 `config` 单例。

---

## 7. 建议推进顺序

| 批次 | 内容 | 理由 |
| ---- | ---- | ---- |
| **第 1 批（立即）** | P0-1（`using` → try/finally 或 engines ≥24）、P0-2（修 lint 配置 + 加最小 CI） | 前者让 CLI 恢复可用；后者防止同类问题再次悄悄进入仓库。**不含安全项之外任何依赖，可独立验证** |
| **第 2 批（本周）** | P0-3（Zip Slip）、P0-4（safeRemove 返回值 + 回收站位置）、P1-4（`seenPaths`） | 全部是"改几行、防数据损失"的高 ROI 项 |
| **第 3 批（本周）** | P1-1（presets 收口）、P1-2（批处理容错）、P1-5（exif 单例）、P1-6（ffmpeg 死分支/负码率/超时） | 消除静默失效与资源浪费 |
| **第 4 批（两周）** | P2 全部 + P3-2/3/4（死资产与死命令）、P3-5/6（i18n 与错误码收敛） | 降低维护面 |
| **第 5 批（常规）** | 架构分层重构（第 6.3 节）、`cmd_shared.js` 拆分、`cmd_ffmpeg.js` / `cmd_remove.js` / `cmd_pick.js` 拆分 | 改动大、需回归测试护住，建议在第 1–4 批稳定后启动 |

**验证基线的建议**：先补一张「命令 → 回归脚本」的最小矩阵（`test/test_cli_smoke.js`：对 `--help`、各命令 `--dry-run`、非法参数、`--version` 做 smoke 断言），再启动第 5 批重构，否则拆分会失去安全网。

---

## 8. 与既有 `docs/TODO-FIXES-20260919.md` 的差异

### 8.1 需更正的既有结论（3 项）

| 既有结论 | 出处 | 实测更正 |
| -------- | ---- | -------- |
| 「`engines.node >= 22`，因为代码使用 `using`」 | `CHANGES-20260919.md:44`、`TODO-FIXES:64` | **结论错误**：`using` 需 Node ≥ 24。该设定是 P0-1 的直接根因 |
| 「`npm test` → 43/43 通过」 | `TODO-FIXES:24,194` | 在 **Node v24.15.0** 下成立；在 Node 22.22.2 下实测 **35 用例 / 28 通过 / 7 失败**。跨版本一致性缺口本身即缺陷 |
| 「`cmd_ffmpeg` 的 `shell: true` + 手工拼引号 → 元字符会截断命令」 | `TODO-FIXES:390`（第 6 节） | **已过时**：当前 `cmd_ffmpeg.js:1728-1745` 已是 `shell: false` + 数组传参，并附实测注释。该项应从待办关闭 |

### 8.2 「已修复」但实际不完整（1 项）

| 既有声明 | 出处 | 更正 |
| -------- | ---- | ---- |
| 「`safeRemove` 补返回值 + 失败时不再静默吞错」 | `TODO-FIXES:39` | **修复不完整**：失败路径仍 `return undefined`（`helper.js:509-511`），而 `cmd_remove.js:923/945`、`cmd_moveup.js:325`、`cmd_compress.js:568`、`cmd_ffmpeg.js:495` 全部未校验返回值 → 「未删/未移却计成功」依然存在（见 P0-4） |

### 8.3 本轮新增（既有报告未覆盖）

安全性议题（既有报告明确排除）：**P0-3 Zip Slip**、`--override` 无确认硬删除（P1-3）、用户正则 ReDoS 与未捕获（P1-8）、`--suffix` 路径穿越（P1-8）。
工程门禁有效性：**P0-2**（ESLint 111 文件 0 问题的实证、规则自我阉割、prettier 未接入、无 CI、`check` 脚本范围过窄）。
跨版本一致性：**P0-1 / P1-7**。
新增逻辑缺陷：`createMapWithKeyField` 式原型污染（P2）、`media_parser.js:134` 自比较、`helper.js:669` 无 `error` 监听、`file.js:208` 符号链接成环、`tools.js:120` 哈希缓存无失效。

---

## 9. 附：本报告的取证方法

所有 P0/P1 结论均以可复现命令或代码原文为证，未采信推测：

```bash
# 语法 / 运行
node --check lib/exif.js            # SyntaxError
node index.js --help                # SyntaxError, exit 1
npm run check                       # exit 1
npm test                            # 35 tests, 28 pass, 7 fail

# 门禁有效性
npx eslint . --format json          # 111 files, 0 messages
npx prettier --check "cmd/**/*.js" "lib/**/*.js" index.js   # 14 files warn

# 量化统计（脚本计算，非估算）
#   i18n：词典 378 键 / 引用 319 / 死键 59 / 缺失 0
#   错误码：定义 30 / 零引用 17

# 交叉验证（grep 逐一确认）
grep -n "seenPaths" cmd/cmd_rename.js                 # 无 .add()
grep -rn "mergePresets" lib/ffmpeg_presets.js         # 仅 import 行
grep -rn "initPresetsAsync" cmd lib index.js          # 仅定义与导出
grep -rn "cue-parse" cmd lib index.js test            # 零引用
grep -rn "safeRemove(" cmd lib                        # 9 处调用，均为丢弃返回值
```

---

*报告生成：2026-09-19 21:58 (+0800)。本轮仅新增本报告文件，未修改任何源码、未创建 commit。*

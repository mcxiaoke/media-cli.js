# media-cli.js 待修复问题列表（整合版）

- 项目：`C:\Home\Projects\media-cli.js`（mediac v2.0.0，ESM / Node CLI）
- 本文档日期：2026-09-19
- 来源：整合 `review-bd-20260919.md` 与 `review-dsf-20260919.md` 两份独立审查报告（两份原件已备份至 `temp/backups/reviews-20260919/` 并从 `docs/` 移除，避免三份文档结论漂移）
- 验证环境：Node **v24.15.0**（Windows 10，git-bash）
- 范围：功能缺陷、Bug、代码质量、工程架构与可维护性；不含安全议题
- 图例：`[已修复]` = 本轮已改并验证；`[待修复]` = 尚未处理；`[搁置]` = 有意不修，附理由

---

## 一、修复进度总览

| 状态 | 数量 | 说明 |
| ---- | ---- | ---- |
| ✅ 已修复 | 19 | 均通过复现脚本或端到端冒烟验证 |
| ⬜ 待修复 | 21 | 按模块分组列于第三节 |
| ⏸️ 有意搁置 | 6 | 改动大 / 影响面广 / 需你先做设计决策，列于第四节 |

本轮已修复项的备份位于 `temp/backups/review-fix-20260919/`，可用 `git diff` 逐项复核。

---

## 二、已修复清单（19 项）

### 2.1 数据正确性（最高优先级）

| # | 位置 | 问题 | 修复 |
| - | ---- | ---- | ---- |
| 1 | `lib/helper.js` | **`filenameSafe` 静默删除文件名中所有小写字母 `s`**：字符类误写成 `\\s`（字面反斜杠+s）而非 `\s`。实测 `test.jpg`→`tet.jpg`、`abc.psd`→`abc.pd`、`s.jpg`→`.jpg` | 改为 `\s`，1 字符 |
| 2 | `lib/helper.js` | `safeRemove` 无 `return`（`cmd_remove` 的操作日志 `dest` 恒为 `undefined`，"撤销"形同虚设）+ 空 catch 吞掉全部异常（删除失败被当成功）+ 重名回退仅一层（第三次同名即失败） | 补返回值、失败时 `console.error`、重名递增后缀循环 |
| 3 | `lib/tools.js` | `md5Short` 用 `slice(limit)` 方向反了，`md5Short('abc')` 返回 24 字符而非 8 | 改为 `slice(0, limit)` |
| 4 | `lib/encoding.js` | `RE_CHARS_MOST_USED` 模板串尾部残留正则定界符 `/`，导致该正则**永不匹配**（`test('abc')===false`） | 删除残留 `/` |

### 2.2 功能缺陷

| # | 位置 | 问题 | 修复 |
| - | ---- | ---- | ---- |
| 5 | `cmd/cmd_dcim.js` | `ErrorTypes.PROCESS_ERROR` 不存在（×3），值为 `undefined` → 错误分类/退出码查表/处理器匹配全部失效 | 替换为 `PROCESSING_FAILED`（退出码 2002） |
| 6 | `cmd/cmd_move.js` | dry-run 下 `movedCount++` 与"已移动"日志无条件执行，**统计造假**（实际没移动却报告已移动） | 拆分支，仅真实移动时计数 |
| 7 | `cmd/cmd_lr.js` | 目标已存在属正常跳过，却被计入"失败"，`operation.completed` 数字失真 | 引入 `SKIPPED` 标记，单独统计 |
| 8 | `cmd/cmd_compress.js` | `--overwrite` 一路传递但 `preCompress` 从不校验，**参数撒谎**（重新压缩全部静默 skip） | 判断改为 `pathExists && !f.overwrite` |
| 9 | `cmd/cmd_remove.js` | 必需条件校验漏项：`--audio` / `--mtime` / `--ctime` 单独使用被错误拒绝 | 补齐为 10 项条件判定 |
| 10 | `cmd/cmd_remove.js` | `--width abc` 解析为 `NaN`，而 `NaN == 0` 为 false → 绕过必需条件校验后以空条件继续执行 | 引入 `posNum()` 有限正数校验 |
| 11 | `cmd/cmd_remove.js` | `--video` 在 builder 中声明但 handler **从未读取**（死选项） | 新增 `checkVideoParams()` 并接入条件管线 |
| 12 | `cmd/cmd_remove.js` | `--pattern` 强制按正则解释、`--regex` 开关被忽略；非法正则抛 `SyntaxError` 被上层 catch 后**该文件静默跳过**（本应删除的文件集体"消失"） | 尊重 `--regex`；非法正则降级为字面匹配并告警 |
| 13 | `cmd/cmd_zipu.js` | testMode 下 purge 无守卫，仅靠 `UnzipOneFile` 返回 `undefined` 这一副作用"侥幸"安全 | 显式加 `!testMode` 守卫；提示数量改用实际集合 |
| 14 | `cmd/cmd_ffmpeg.js` | `acc + t.info?.duration \|\| 0` 因 `+` 优先级高于 `\|\|`，**任一条 duration 缺失即把累计值清零** | 加括号 `acc + (t.info?.duration \|\| 0)` |
| 15 | `cmd/cmd_ffmpeg.js` | 元数据时间戳用 12 小时制 `hh`，下午 17:50 写成 `05:50` | 改为 `HH` |

### 2.3 国际化与工程配置

| # | 位置 | 问题 | 修复 |
| - | ---- | ---- | ---- |
| 16 | `lib/i18n.js` | 9 个键在代码中使用但词典缺失，`t()` 缺失时原样返回 key → **界面直接显示英文 key** | 补齐全部 9 键（含 `{{count}}` 插值验证） |
| 17 | `package.json` | 无 `engines` 字段，而代码使用 `using` 声明式资源管理（Node ≥22） | 加 `"engines": { "node": ">=22" }` |
| 18 | `package.json` | `files` 白名单不含 `presets.yaml`，`npm publish` 后用户拿不到预设文件 | 加入 `presets.yaml` |
| 19 | `test/test_helper.js` | 上述关键行为无回归保护 | 补 3 条测试（`filenameSafe` 保留 `s`、仍清除非法字符、`md5Short` 长度） |

### 2.4 附带的结构性改进

| 位置 | 说明 |
| ---- | ---- |
| `cmd/cmd_remove.js` `checkConditions` | 原为 5 个布尔值穷举 **32 种组合、约 90 行**分支表达"全部条件 AND"，新增条件需再补 16 个分支。重构为条件列表 + `every()`（18 行）。**已用全部 1024 种输入组合暴力验证与原实现完全等价**，并借此让 `--video` 成为第 6 个条件而非新增 16 个分支 |
| `lib/debug.js` `flushFileLog` | 写入后未清缓存，重复 flush 导致日志双写累积 |
| `lib/core.js` `parallel()` | 用 `splice` 修改调用方原数组（副作用），改为操作副本 |

### 2.5 修复验证证据

```
npm run check   →  全部 *.js 通过
npm test        →  25/25 通过（含新增 3 条回归测试）

filenameSafe('test.jpg')        'tet.jpg'   → 'test.jpg'      ✅
filenameSafe('abc.psd')         'abc.pd'    → 'abc.psd'       ✅
md5Short('abc').length          24          → 8               ✅
RE_CHARS_MOST_USED.test('abc')  false       → true            ✅
ErrorTypes.PROCESSING_FAILED    undefined   → 退出码 2002      ✅
safeRemove 连续同名删除          第 3 次失败  → 4/4 成功        ✅
checkConditions 等价性           1024/1024 组合全部等价         ✅
9 个 i18n 键                     显示英文 key → 中文正常渲染    ✅

cmd_remove 端到端冒烟（dry-run，未删任何文件）：
  --sizel 2       → 正确匹配 2 个大文件
  --pattern big   → 正确匹配 1 个
  --pattern "a["  → 明确告警 BadRegex（旧版静默跳过全部文件）
  --video du=10   → 被接受且参与判定（旧版报"未提供删除条件"）
```

---

## 三、待修复问题列表（21 项）

按模块分组，每项标注证据来源与修复建议。**优先级**：🔴 高（功能失效或数据风险）／🟡 中（行为异常）／⚪ 低（质量与一致性）。

### 3.1 `pick` 命令（照片智能挑选）—— 🔴 两条去重路径全部失效

**T-1 🔴 感知哈希去重冷路径：计算结果被丢弃**
- 位置：`cmd/cmd_pick.js:1165-1177`
- 证据（本轮复核确认仍在）：`else` 分支中 `computeHashDedup()` 的返回值赋给局部 `results` 后**从未使用**，紧接着把 `hashResults` 全量重置为 `{aHash:null, pHash:null}` → 下游 `validHashes` 恒为空 → 去重循环一次都不执行
- 影响：无缓存（冷启动）时 `--hash-dedup` **静默失效**，还白付一遍全量哈希计算开销
- 建议：直接消费 `results.hashes` 或 `results.toRemove`，不要重置

**T-2 🔴 感知哈希去重热路径：缓存永不命中**
- 位置：`lib/image_hash.js:148`（`cached.mtime !== file.mtime` 严格比较）与 `:178`（walk 模式下 `f.mtime` 是 **Date 对象**）
- 证据（本轮复核确认仍在）：Date 写入缓存 JSON 后序列化为字符串，读回比较恒不等
- 影响：每次 `pick` 都全量重算哈希，大目录耗时数分钟，缓存文件反复无意义重写
- 建议：统一 mtime 口径（进入哈希层前归一化为秒级数字）
- 备注：T-1 与 T-2 叠加导致该功能**从未按设计工作过**；两者共用同一套去重循环，建议一并修

**T-3 🟡 复制目标仅用 basename，同名文件互相覆盖**
- 位置：`cmd/cmd_pick.js:506` 与 `:561`（`path.join(year, month, path.basename(f.path))`）
- 影响：不含源目录层级，不同源目录下的同名文件（`IMG_0001.jpg` 极常见）并发复制时互相覆盖，**照片静默丢失**（源仍在，但输出结果少一张）
- 建议：目标路径纳入源目录相对路径，或冲突时递增后缀

**T-4 🟡 `parseFilesByName` 不读 EXIF**
- 位置：`cmd/cmd_pick.js:743-784`
- 影响：文件名解析失败时兜底用 mtime，而微信/网盘/翻拍场景的 mtime 是**复制时间**，导致日期分组错位、`day-limit` 失真
- 备注：项目已依赖 `exiftool-vendored` 却未使用

### 3.2 `rename` / `prefix`（批量重命名）—— 🔴 数据风险

**T-5 🔴 并发重命名 TOCTOU：链式重命名可覆盖目标文件**
- 位置：`cmd/cmd_shared.js:53-59`（`pathExists` 检查）与 `:84-100`（`pMap` 并发 `fs.rename`）
- 影响：链式重命名（A→B 且 B→C）时，任务 1 检查 B 不存在 → 任务 2 把 B 改成 C → 任务 1 `rename(A, B)` 覆盖任务 2 刚生成的内容（Windows 上也可能 EPERM 失败）。批量整理相册时偶发且难以复现，**属数据丢失级别**
- 建议：链式重命名按拓扑序串行，或先统一 rename 到临时名再二次 rename
- 搁置原因见第四节（改动大）

**T-6 🟡 `cmd_prefix` 模块级可变状态并发不安全**
- 位置：`cmd/cmd_prefix.js:219-220`（`nameDupSet` / `nameDupIndex`）被 `:489` 的 `pMap(..., {concurrency: cpus().length*4})` 并发读写
- 影响：`++nameDupIndex` 与 `nameDupSet.add()` 存在竞态，可能生成重名文件
- 同类：`cmd/cmd_rename.js:503` 的 `encodingErrorCount`、`lib/file.js:57` 的 `walkLastUpdatedAt`（跨调用共享，导致第二次 walk 前几秒不刷进度条）

**T-7 ⚪ `cmd_prefix` 重名回退路径用 `dir` 而非 `outputDir`**
- 位置：`cmd/cmd_prefix.js:385`（主路径用 `outputDir`）与 `:402`（回退路径用 `dir`）
- 影响：指定 `--output` 且目标已存在时，会在**源目录**里去找重名

### 3.3 `remove` / `compress`（删除与压缩）

**T-8 🟡 `cmd_remove` 的 `--output` / `--output-tree` 是死选项**
- 位置：`cmd/cmd_remove.js:331` 与 `:337`（builder 中声明），handler 中**从未读取**（本轮复核确认）
- 影响：用户指定输出目录不生效，删除操作仍走 `safeRemove`

**T-9 🟡 `cmd_compress` 成功摘要只打印最后一条**
- 位置：`cmd/cmd_compress.js:404-411`（`doneTasks.slice(-1)`）
- 影响：批量压缩时用户只能看到最后一个文件结果

**T-10 ⚪ 大小边界语义不统一**
- `checkFileSize` 用严格 `>` / `<`，而 `checkFileDimensions` 用 `<=` / `>=`，`compress` 的 `min-size` 用严格 `>`
- 影响：等于阈值的文件在不同命令中行为不同，且与 describe 描述不符

**T-11 ⚪ `getDirectorySize` 的 `concurrency` 参数无效且可能漏算**
- 位置：`lib/file.js:141-180`
- 证据（上轮实测）：concurrency=8 与 1 耗时几乎相同（133ms vs 131ms）
- 根因：`while (queue.length > 0)` 在队列瞬时为空时 worker 直接退出，不等待其他 worker 入队；且 `totalSize +=` 为并发读改写
- 备注：当前唯一调用点已被注释（`cmd/cmd_zipu.js:267`），故影响有限

### 3.4 `ffmpeg`（转码链路）

**T-12 🟡 `vc` / `ac` 别名映射为 `videoCopy` / `audioCopy`（语义可疑）**
- 位置：`lib/ffmpeg_presets.js:652-653`、`:660-661`
- 影响：用户 `--ffargs "vc=h264"` 得到 `-c:v copy`（流复制）而非 H.264 编码，**静默得到错误产物**
- 说明：`cmd_ffmpeg.js:370-371` 的注释声明 `vc = video codec`，与实现矛盾
- 搁置原因见第四节（语义歧义，需你决策）

**T-13 🟡 `hevc_speed` 预设帧率逻辑可能生成 `fps=0`**
- 位置：`lib/ffmpeg_presets.js:409`（`framerate: 25`）+ `:420`（complexFilter 中 `fps={framerate}`）
- 影响：24 / 23.976fps 电影素材可能算出 `dstFrameRate=0` → `fps=0` → ffmpeg 报无效参数
- 备注：需真实 24fps 素材端到端复现确认

**T-14 🟡 `prepareFFmpegCmd` 无容错：单个坏文件导致整批崩溃**
- 位置：`cmd/cmd_ffmpeg.js:1042-1045`（catch 打日志后 `throw error`，`pMap` 无兜底）
- 影响：目录里混入一个坏文件，几十个正常文件全部不处理；与代码注释意图 `Skip[Error]` 相反
- 关联：`lib/tryfp.js` 把 `JSON.parse` 的 SyntaxError 直接 rethrow，导致 `getMediaInfo` 的 ffprobe↔mediainfo fallback 失效

**T-15 ⚪ `ffmpeg` 硬编码 NVIDIA `scale_cuda` 与 `libfdk_aac`**
- 位置：`lib/ffmpeg_presets.js`（`scale_cuda` ×3、`libfdk_aac` ×17）
- 影响：无 GPU / 非 N 卡环境无 CPU 降级路径；`libfdk_aac` 非自由编码器，官方 ffmpeg 构建默认不含 → 音频编码步骤报 Unknown encoder
- 搁置原因见第四节（环境绑定，需你确认目标环境）

### 3.5 编码与文本处理

**T-16 🟡 `unicode.js` 判定函数污染：换行、`|`、`/`、`}` 被判为"中文/日文/韩文"**
- 位置：`lib/unicode.js:117-120`（`REGEX_CHINESE_ANY` / `REGEX_CHINESE_ALL`）、`:197`（`REGEX_ONLY_HANGUL`）、`:78`（`REGEX_HAS_HIRA_OR_KANA`）
- 证据（本轮复核确认仍在）：
  ```
  strOnlyChinese("ab\ncd")  → true   应为 false
  strOnlyChinese("a|b")     → true   应为 false
  strOnlyHangul("abc/")     → true   应为 false
  REGEX_HAS_HIRA_OR_KANA.test("}") → true
  ```
- 根因：`REGEX_CHINESE_ALL` 缺少分组括号（`^A|B|C+$` 被解析为 `(^A)|B|(C+$)`）；`REGEX_ONLY_HANGUL` 中 `\\u00a1` 写成双反斜杠（字面反斜杠+u）
- 影响：这些函数被 `rename` / `decode` / `zipu` 用于语言检测与清洗，会把合法文件名误判而跳过或改写
- 搁置原因见第四节（影响面广）

**T-17 🟡 `cmd_decode` 只按 UTF-8 读取文件**
- 位置：`cmd/cmd_decode.js:181`（`fs.readFileSync` 无编码参数）
- 影响：乱码文件读进来时已变 U+FFFD，而 `lib/encoding.js:303-307` 对 U+FFFD 短路判定"无乱码" → **decode 命令对自身目标文件基本无效**（它是"为乱码而生"的命令）

**T-18 ⚪ `arg_parser` 冒号切分与 required 校验**
- 位置：`lib/arg_parser.js:100`（用 `/;|:|#/` 切分键值对）、`:166-173`（required 校验）
- 影响：值含冒号的写法（如 `size=16:9`）抛 `INVALID_FORMAT`；`parseArgs({q:'', required:true})` 返回 `{q:null}` 不报错
- 搁置原因见第四节（改分隔符会破坏既有 `--ffargs` 写法）

**T-19 ⚪ `lib/tools.js` `hashCache` 永不清理**
- 位置：`lib/tools.js:118`
- 影响：长时间运行内存单调增长

### 3.6 工程与质量体系

**T-20 🔴 `npm test` 刻意排除两个失败测试文件，门禁形同虚设**
- 位置：`package.json:11`（仍为 `node --test test/test_encoding.js test/test_helper.js test/test_file.js`）
- 证据（本轮复核确认仍在）：
  - `test/test_remove_command.js`：**7 用例中 6 个失败**
  - `test/test_decode_command.js`：**1 用例失败**
- 两个失败文件的根因（属测试自身缺陷，非源码问题）：
  1. `test_remove_command.js` 给 `builder()` 传 `{}` 而非 yargs 实例 → `TypeError: ya.option is not a function`
  2. `test_remove_command.js` mock 了 `console.log`，但源码走 `log` 模块 → 断言收集不到输出
  3. `test_decode_command.js` 用 `spawnSync` 跑 CLI，被 `index.js:35` 的顶层 `await main()` 干扰
- 影响：**测试门禁给出"全绿"假象**，是本次审查中最需纠正的工程习惯问题
- 建议：修好两个测试文件后把 `test` 脚本改为 `node --test test/` 全量；同时把 `npm run check` 一并纳入提交前流程
- 搁置原因见第四节（改测试等于动门禁本身，需你确认）

**T-21 🟡 其它质量问题（合并列出）**
- `lib/helper.js:500`、`cmd/cmd_shared.js:292` 两处 `catch (error) {}` 完全静默
- `index.js:35` 顶层 `await main()` 无 `.catch()`；`index.js:112-114` 的 catch 只打印 `err.message` **不设退出码** → 脚本报错仍以 **exit 0** 结束，CI / 批处理串联会误判成功
- 全仓库**无** `process.on('uncaughtException' / 'unhandledRejection')`，而 `CLAUDE.md:98` 声称已实现（文档与实现不符）
- `lib/errors.js:171` 的 `ErrorHandler.handle()` 内部直接 `process.exit()`——库层终止进程，不利复用与测试
- `lib/error-codes.js` 定义 1000–3xxx 分段错误码，但代码中无一处构造带数字码的错误；`getExitCodeForType` 是唯一消费者且几乎不被调用
- `cmd/cmd_compress.js` 并发策略不统一：`buildCompressTasks` 用 `cpus().length`，`runCompression` 用 `cpus().length / 2`（非整数）
- `cmd/cmd_compress.js:239` 的 `needBar` 逻辑与 `command_utils.shouldShowProgressBar` 重复实现
- `lib/command_utils.js` 229 行中 13 个导出函数（`createProgressBar`、`withProgressBar`、`writeJsonReport`、`createWalkOptions`、`buildFileFilter` 等）**全部无人调用**；其中 `createProgressBar` 把 preset **对象**塞进 `format` 字段（应为字符串模板）
- `lib/helper.js:678` 的 `killProcess` 用 `execa("taskkill /F /T /IM " + procName + ".exe /T")` 整串拼接（execa 期望「可执行文件 + 参数数组」），且 `/T` 重复两次
- 生产路径残留 `console.log`：`lib/ffmpeg_presets.js:747`（每次创建 preset 刷屏）、`lib/arg_parser.js:337-357`（未调用的 `testParse()`）、`lib/fixmetadata.js:416-432`、`lib/encoding.js:274`、`lib/cue-parse.js:263-322`
- `cmd/cmd_ffmpeg.js` 中三个 `console.log`（`ARGV:` / `FFARGS:` / `MERGED ARGV:`）**属你未提交的在改代码**（HEAD 中原本是 `log.info`），未动

### 3.7 死代码与冗余依赖（⚪ 低，合并）

- `lib/ffmpeg_presets_old.js`（711 行，全仓库零引用）
- `lib/walk.js`（零引用，且 `:26` 用 `this.walk(...)` 调用普通函数 → `this` 为 undefined，**一跑就崩**）
- `lib/shared.js`（仅 7 行版权头，零引用）
- `lib/cue-extractor.js` / `lib/cue-split.js`（无外部引用）；CUE 三件套另有 `cue-parse.js:254` 顶层 `await testParse()`（import 即崩）与 `cue-split.js` 导入不存在的导出名
- `cmd/cmd_run.js`（86 行主体全被注释，只打印 argv）
- **18 个依赖从未被 import**：`@nodelib/fs.walk`、`@vingle/bmp-js`、`cnchar`、`cnchar-trad`、`crypto-random-string`、`exit-hook`、`fastest-levenshtein`、`fkill`、`image-hash`、`mediainfo.js`、`micromatch`、`node-taglib-sharp-extend`、`object-inspect`、`open`、`p-queue`、`path-scurry`、`radash`、`regenerate`；另有 `got` / `throat` / `global-agent` / `upath` 仅被 `labs/` 使用
- 重复实现：`fixEncoding` ×3、`validateInput` ×2、`hammingDistance` ×3、`humanSize` / `formatBytes` ×2、preset API 两套
- `cmd/cmd_moveup.js` 的 `MODE_DIR` / `MODE_PREFIX` / `MODE_MEDIA` / `MODE_AUTO` 四个分支**逐字相同**（本轮复核确认仍在），`--mode` 除 `clean` 外无行为差异
- `cmd/cmd_dcim.js` 的 `--check-date` builder 默认 `false`，但 `exif.checkFiles(files, checkDate = true)` 默认 `true`——两处默认值语义相反
- `lib/i18n.js` 另有 59 个已定义零使用的死键

---

## 四、有意搁置的问题（6 项）

以下问题确实存在且已核实，但**改动大、影响面广、或需要你先做设计决策**，本轮未动。

| # | 问题 | 搁置理由 | 若要做需要什么 |
| - | ---- | -------- | -------------- |
| S-1 | **T-5 并发重命名 TOCTOU**（可覆盖文件） | 需把 `renameFiles` 从并发改为按拓扑序串行，会改变性能特征与失败语义 | 你的确认：接受串行化带来的速度下降？ |
| S-2 | **T-16 `unicode.js` 判定函数污染** | 这些函数被 `rename` / `decode` / `zipu` 多处依赖，修正后**会改变现有文件名清洗行为**（可能影响你已整理好的文件名规则） | 需要你确认：现有清洗行为是否已"将错就错"形成习惯 |
| S-3 | **T-12 `vc` / `ac` 别名语义** | `vc` 到底该是 codec 还是 copy 存在歧义；改错会**静默产出错误视频**（比现状更危险） | 需要你定义语义（建议 `vc`→codec，copy 另设别名） |
| S-4 | **T-15 `scale_cuda` / `libfdk_aac` 硬编码** | 属环境绑定决策，你本机是 N 卡 + 自建 ffmpeg，改默认值会影响你的日常使用 | 需要你确认目标环境（是否要 CPU 降级路径） |
| S-5 | **T-18 `arg_parser` 分隔符** | 冒号改分隔符会破坏你既有 `--ffargs` 写法与 `presets.yaml` 中的参数串 | 需要你确认现有写法，或新增转义规则而非改分隔符 |
| S-6 | **T-20 测试门禁** | 修两个失败测试文件属中等工作量，且"改测试"等于动门禁本身 | 需要你确认：直接修测试，还是重写为可控的集成测试 |

**另有未纳入本轮的两项大改动**（两份报告均有提及，但超出"改动小收益大"范围）：

- **`cmd_pick` 感知哈希去重整体重写**（T-1 + T-2 + 两套同构实现合并 + O(n²) 去重未桶化）。修 T-1/T-2 是必要的，但建议连同 `image_hash.js` 的双实现一起收敛，否则修完仍是"两份几乎同构的代码"。
- **`cmd_ffmpeg` 的 `shell: true` + 手工拼引号**（`:1724-1729`）。Windows cmd.exe 下 `&` `|` `%` `^` 等元字符会截断命令或触发变量展开，`Movie&Show.mp4` 这类文件名必现异常。改为 `execa` 参数数组形式会触及所有转码调用路径，回归面大。

---

## 五、建议的推进顺序

| 阶段 | 内容 | 预估 |
| ---- | ---- | ---- |
| 立即 | 跑一次你日常的真实任务（`dcim` / `compress` / `remove`），确认本轮 19 项修复在真实数据上行为符合预期 | 半小时 |
| 本周 | T-1 + T-2（pick 去重两路径）、T-8（remove 死选项）、T-4（pick 读 EXIF） | 半天 |
| 本周 | T-16（unicode 判定，需先决策 S-2）、T-17（decode 编码）、T-20（测试门禁，需先决策 S-6） | 半天 |
| 两周 | T-5（rename TOCTOU，需先决策 S-1）、T-13/T-14（ffmpeg 帧率与容错）、T-3（pick 覆盖） | 1–2 天 |
| 常规 | T-21 与 3.7 的质量项、死代码清理、依赖裁剪 | 可分批 |

**最先该验证的一项**：`filenameSafe` 修复后，输出文件名不再被吞掉字母 `s`。这直接影响你已生成的文件名——建议先在一个小目录上试跑 `prefix` 或 `compress`，确认新文件名符合预期后再批量使用。

---

## 六、文档维护说明

- 本轮两份原始报告（`review-bd-20260919.md`、`review-dsf-20260919.md`）已从 `docs/` 移除，原件备份于 `temp/backups/reviews-20260919/`（行数校验一致：351 行 / 476 行）
- 移除原因：避免三份文档结论漂移；本文件已整合两份报告的全部有效结论，并按"已修 / 待修 / 搁置"重新归类
- 本轮修复的代码备份位于 `temp/backups/review-fix-20260919/`（16 个文件原样），可用 `git diff` 逐项复核
- 修复完成后建议：把本文档中已完成的项移动到"已修复"章节并注明日期，保持单一事实来源
- 未提交任何 commit（遵守项目 Git 红线）

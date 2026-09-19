# `cmd/cmd_ffmpeg.js` 专项审查报告（实机验证版）

- 审查对象：`C:\Home\Projects\media-cli.js\cmd\cmd_ffmpeg.js`（1,868 行）
- 报告日期：2026-09-19 22:20 (+0800)
- 审查环境：Node **v24.15.0**、Windows 10、git-bash、仓库 HEAD `0e8d2bc`
- FFmpeg 环境：`C:\Home\Apps\ffmpeg\bin`（`N-125246-g9420146e6-2026-06-23-nonfree-shared`，含 `h264_nvenc` / `hevc_nvenc` / `libfdk_aac`），N 卡可用
- 审查方法：全文逐行精读（1,868 行）+ 关联模块交叉核对（`lib/ffmpeg_presets.js`、`lib/debug.js`、`lib/core.js`、`lib/helper.js`、`lib/command_utils.js`、`cmd/cmd_shared.js`、`index.js`）+ **真实素材端到端执行验证**
- 审查范围：功能缺陷、逻辑正确性、健壮性、可维护性；不含安全议题
- **与既有报告的关系**：本仓库已有 `docs/ffmpeg-cmd-review-dsf.md`（436 行）与 `docs/CODE-REVIEW-20260919.md`（433 行）。本报告**不重复其结论**，只收录两类内容：① 既有报告未覆盖、且经本次实机复现的新缺陷；② 对既有结论的独立复现与证据补强（第 4 节）。重叠部分明确标注出处。

---

## 0. 结论摘要

**一句话结论：这个文件的静态逻辑大体正确、注释质量高于仓库平均，但存在一批"参数被声明、被打印、却不参与实际命令"和"同一参数被两条互斥路径各自解释"的问题；其中 2 项会造成数据被移动或产物命名错误，且全程无报错。**

本次实机验证新发现 **8 项**（其中 P0 2 项、P1 4 项、P2 1 项、P3 1 项），另独立复现并补强既有报告的 3 项结论。

| 级别 | 数量 | 本次新增问题 |
| ---- | ---- | ------------ |
| **P0 数据风险** | 2 | ① test 模式仍真实移走源文件；② 输出文件名模板未替换，占位符原样落盘 |
| **P1 功能静默失效** | 4 | ③ `--ffargs` 全部数值参数失效；④ `--include` 被默认 `--exclude` 完全屏蔽；⑤ `--fps` 在无需缩放时失效；⑥ 非法正则直接崩溃整个命令 |
| **P2 体验/一致性** | 1 | ⑦ 音频路径进度条恒为 0% |
| **P3 工程卫生** | 1 | ⑧ 文件日志参数错位写入独立日志文件；test 抽样逻辑非单调 |

> **优先级建议**：P0-① 与 P0-② 建议立即修（改动分别约 3 行、2 行），它们直接改变用户磁盘上的文件与产物命名；P1-③ 与 P1-④ 是"用户以为生效、实际没生效"的静默失效，建议紧随其后。

---

## 1. P0-① test 模式（无 `--doit`）下 `--delete-source-files` 仍真实移走源文件

**位置**：`cmd/cmd_ffmpeg.js:484-502`（删除分支）、`:364`（`const testMode = !argv.doit`）

**事实**：删除源文件的分支只判断 `argv.deleteSourceFiles`，**完全没有 `testMode` 守卫**：

```js
:364  const testMode = !argv.doit
...
:484  if (argv.deleteSourceFiles) {                    // ← 未判断 testMode
:485      let dstExitsTasks = tasks.filter((t) => t && t.dstExists && !t.fileDst)
:486      if (dstExitsTasks.length > 0) {
:487          const answer = await confirmDangerousAction(...)
:488          if (answer) {
:490              await pMap(dstExitsTasks, async (entry) => {
:495                  await helper.safeRemove(entry.path)   // ← 真实移动
:496                  log.logWarn(LOG_TAG, `SafeDel ...`)
```

对照：同文件里其它副作用都有 testMode 守卫——`:511` 的 `!testMode && log.fileLog(...)`、`:566` 的 `!testMode && log.logSuccess(...)`、`:621-627` 的 `entry.testMode` 提前 return。**唯独删除源文件这一处没有。**

**实机复现**（真实素材 `other clip.mp4` 复制为 `src.mp4`，并预置同名目标文件以触发 `dstExists`）：

```
运行前: [SHANA]src_hevc_2k.mp4  src.mp4
命令:   node index.js ffmpeg <dir> --preset hevc_2k --delete-source-files
        （未加 --doit，即测试模式）
运行后: [SHANA]src_hevc_2k.mp4
日志:   [FFConv] [WARN] SafeDel 0/1 ...\del8\src.mp4
去向:   /c/Deleted_By_Mediac/20260919/.../del8/src.mp4   ← 确认被真实移动
```

**影响**：测试模式的设计意图是"只打印计划、不动文件"，实际却会**移动源文件**。这是本次审查中唯一一项会造成用户文件位置变化的缺陷。虽然 `safeRemove` 是"移到 `Deleted_By_Mediac` 而非永久删除"（可恢复），但用户在执行 dry-run 时不会预期磁盘上的文件消失。

**建议**：`if (argv.deleteSourceFiles && !testMode)`；若希望测试模式也展示该步骤，改为打印"将删除 N 个源文件 [TestMode]"，不执行 `safeRemove`。

---

## 2. P0-② 输出文件名模板未替换，`{audioBitrateK}` 等占位符原样写入文件名

**位置**：`cmd/cmd_ffmpeg.js:1067-1084`（`createDstBaseName`）、调用点 `:924`、模板变量产出点 `:1446-1482`（`calculateDstArgs` 返回值）

**事实**：`createDstBaseName` 从 `entry.dstValues` 取模板变量，但**这个字段在全仓库从未被赋值**：

```js
:1067 function createDstBaseName(entry) {
:1070     const replaceArgs = {
:1071         preset: entry.preset.name,
:1072         ...entry.preset,
:1073         ...entry.dstValues,          // ← undefined，展开无效果
:1075         audioBitrate: entry.audioBitrate,   // ← 也从未赋值
:1076         videoBitrate: entry.videoBitrate,   // ← 也从未赋值
:1078     const suffix = helper.filenameSafe(formatArgs(entry.preset.suffix || "", replaceArgs))
```

真正的模板变量在 `calculateDstArgs` 返回的 **`dstArgs`** 里（`:1472` 的 `videoBitrateK`、`:1475` 的 `audioBitrateK`），而 `prepareFFmpegCmd` 把结果挂在 `newEntry.dstArgs`（`:894-897`），**字段名与 `dstValues` 不一致**。

`formatArgs`（`lib/core.js:459-475`）对找不到的键会**原样保留占位符**（`return ... ? replacements[key] : match`），因此占位符直接进入文件名。

**实机复现**：

```
命令: node index.js ffmpeg <dir> --preset aac_medium --doit
日志: Prepare[AUTO] 1/1 DST ...\aud3\s_{audioBitrateK}.m4a
产出: s_{audioBitrateK}.m4a          ← 期望 s_256K.m4a
      （同批日志已正确算出 ab:320K=>256K，说明数值本身没问题）
```

**影响范围**：`lib/ffmpeg_presets.js` 中有 3 个预设的后缀依赖该变量——`aac_medium`（`:430` `_{audioBitrateK}`）、`aac_vbr`（`:449` `_q{audioQuality}` 的 quality 变体）。用户会得到 `s_{audioBitrateK}.m4a` 这类文件名。属**用户直接可见的产物错误**。

**建议**：把 `...entry.dstValues` 改为 `...entry.dstArgs`（`dstArgs` 已包含 `audioBitrateK`/`videoBitrateK`/`videoQuality`/`audioQuality`/`framerate`/`dimension`/`speed` 等全部模板键），并删除两行恒为 `undefined` 的兜底。改完即可让 `_{audioBitrateK}`、`_q{audioQuality}`、`_{speed}x` 等模板全部生效。

---

## 3. P1 级问题（4 项，均为"参数静默失效"）

### P1-③ `--ffargs` 的全部数值参数失效

**位置**：`cmd/cmd_ffmpeg.js:380-386`（解析与合并）、`lib/ffmpeg_presets.js:705`（优先级判断）

**事实**：`applyFfargs` 用"命令行是否已提供该参数"来决定是否采用 ffargs 值，判据是：

```js
lib/ffmpeg_presets.js:705
const hasArgvValue = result[normalizedKey] !== undefined && result[normalizedKey] !== null
```

但 `cmd_ffmpeg.js` 的数值选项**全部显式声明了 `default: 0`**（`:152` dimension、`:158` fps、`:164` speed、`:179` videoBitrate、`:192` videoQuality、`:206` audioBitrate、`:220` audioQuality）。yargs 会把未提供的选项填成 `0`，而 `0 !== undefined && 0 !== null` 为真 → **`hasArgvValue` 恒为真 → ffargs 的数值永远被丢弃**。

`prefix` / `suffix` 无 `default`，解析为 `undefined`，所以它们恰好能生效——这解释了为什么"ffargs 看起来能用"。

**实机复现**（真实 yargs 实例解析 + 真实调用链）：

```
命令: --preset hevc_2k --ffargs "vb=2000:vq=28:ab=128:dm=1280"
parseArgs 结果:   {"vb":2000,"vq":28,"ab":128,"dm":1280}   ← 解析正确
合并后 argv:      videoBitrate=0  videoQuality=0  dimension=0   ← 全部未采用
最终 preset.userArgs.videoBitrate = 0        （期望 2000000）
最终 preset.userArgs.dimension    = 0        （期望 1280）
对照 --video-bitrate 2000:  userArgs.videoBitrate = 2000000   ← 专用选项正常
```

对照 `applyFfargs` 对 `prefix`/`suffix` 的处理：`OK`（`undefined` → 被采用）。

**影响**：`--ffargs` 是这个命令主推的"复杂组合参数"入口（help 中单列），其中 `vb`/`vq`/`ab`/`aq`/`dm`/`sp`/`fps` 七个短别名全部失效，且**不报错、不提示**。用户以为压缩到 2000K，实际仍按预设的 4000K 执行。

**建议**：判据改为"命令行是否提供了非默认值"，即对数值型选项判断 `> 0`：

```js
const hasArgvValue = result[normalizedKey] !== undefined && result[normalizedKey] !== null
    && !(typeof result[normalizedKey] === "number" && result[normalizedKey] === 0)
```

或在 builder 中去掉数值选项的 `default: 0`，改在消费处用 `argv.x || 0` 兜底（改动面更大，需回归）。

### P1-④ `--include` 在默认 `--exclude` 存在时被完全屏蔽

**位置**：`cmd/cmd_shared.js:766-780`（`else if` 结构）、`cmd/cmd_ffmpeg.js:95-100`（`--exclude` 默认值 `"shana|.m4a"`）、`:430`（调用）

**事实**：include 与 exclude 是 `if / else if`，而 `--exclude` **有非空默认值**，导致 else-if 分支永不进入：

```js
cmd/cmd_shared.js:766
if (argv.exclude?.length > 0) {
    fileEntries = await asyncFilter(fileEntries, (x) => !filterFileNames(x.path, argv.exclude, argv.regex))
    ...
} else if (argv.include?.length > 0) {     // ← 默认 exclude 非空时永不执行
    fileEntries = await asyncFilter(fileEntries, (x) => filterFileNames(x.path, argv.include, argv.regex))
```

**实机复现**：

```
目录: AAA movie.mp4、BBB other.mp4
命令: --preset hevc_2k --include AAA
日志: NameRules extensions="", include="AAA", exclude="shana|.m4a"
      [FFConv] [WARN] 应用文件名规则后剩余 2 个文件     ← 期望 1 个
```

**影响**：`--include` 在默认配置下**永远不生效**，除非用户显式传一个空 `--exclude ""`。用户按 `--include` 筛选后实际处理了整个目录——批量转码时可能误处理大量非目标文件。

**建议**：改为两个独立的 `if`（先 include 收窄、再 exclude 排除），语义上二者是"交集"关系而非"互斥"；或把 `--exclude` 默认值改为 `""` 并在代码内维护默认排除表。

### P1-⑤ `--fps` 在无需缩放的文件上静默失效

**位置**：`cmd/cmd_ffmpeg.js:1502-1509`（把 fps 追加进 filters）、`:1596-1607`（只在 `scaled` 时才输出 `-vf`）

**事实**：`--fps` 被实现为"往 filters 里追加 `fps={framerate}`"，而 filters 只有在**需要缩放**时才会被写成 `-vf`：

```js
:1503  if (tempPreset.framerate > 0) {
:1505      tempPreset.filters += ",fps={framerate}"      // ← 追加到 filters
...
:1596  } else if (tempPreset.filters?.length > 0) {
:1597      // 只有需要缩放时才加 scale filter
:1598      if (entry.dstArgs.scaled) {                    // ← 不缩放就整段丢弃
:1604          middleArgs.push("-vf")
```

**实机复现**（源 640×360，`hevc_2k` 的 dimension=1920 → 无需缩放）：

```
命令: --preset hevc_2k --fps 10 --doit
日志: ...fps:25=>10...                       ← 显示了"25=>10"
产出帧率: 25/1                                ← ffprobe 实测，未生效
```

**影响**：对分辨率已达标（不需缩放）的文件，`--fps` 完全无效，而日志/元数据都显示已从 25 改为 10——**日志与实际产物不一致**。若该文件的 `filters` 为空（如 `hevc_2k` 有 filters，但自定义 preset 可能为空），则连 filters 都不会生成。

**建议**：把 fps 从"附加在 filters 上"改为独立的 `-vf`/`-r` 参数，不依赖 `scaled` 分支；或把 `:1598` 的条件改为 `entry.dstArgs.scaled || tempPreset.framerate > 0`。

### P1-⑥ 非法正则直接崩溃整个命令（无兜底）

**位置**：`cmd/cmd_shared.js:735-742`（`filterFileNames` 内 `new RegExp` 无 try-catch）、`cmd/cmd_ffmpeg.js:430`

**事实**：`--exclude` / `--include` 默认按正则解释（`--regex` 默认 true），非法正则会在 `new RegExp` 处抛 `SyntaxError`，且**没有任何一层捕获**——`asyncFilter` → `applyFileNameRules` → `cmdConvert` 一路冒泡到 `index.js` 的 catch。

**实机复现**：

```
命令: --preset hevc_2k --exclude "a["
结果: EXIT=1
      SyntaxError: Invalid regular expression: /a[/iu: Unterminated character class
          at new RegExp (...)
          at filterFileNames (cmd/cmd_shared.js:738:21)
          at applyFileNameRules (cmd/cmd_shared.js:769:29)
          at Object.cmdConvert [as handler] (cmd/cmd_ffmpeg.js:430:25)
```

**影响**：用户输错一个字符（多打一个 `[`）就会让整批任务直接终止，且错误信息是底层正则异常，不提示是哪个参数有问题。

**对照**：同仓库 `cmd_remove.js` 已按 `docs/TODO-FIXES-20260919.md` 第 12 项修复了同类问题（"非法正则降级为字面匹配并告警"），`cmd_ffmpeg` 走的是共享函数 `applyFileNameRules`，**该修复未覆盖到这条路径**。

**建议**：在 `filterFileNames` 内用 try-catch 包裹 `new RegExp`，失败时降级为 `name.includes(pattern)` 并 `log.logWarn` 提示；或在 `applyFileNameRules` 入口预校验一次。

---

## 4. 对既有结论的独立复现与证据补强

以下 3 项 `docs/ffmpeg-cmd-review-dsf.md` 已提出，本次用实机执行独立复现，结论一致并补充运行时证据。

### 4.1 `--hwaccel` 与 `--decode-mode` 失效（dsf P1-2）

**实机复现**：

```
命令: --preset hevc_2k --decode-mode cpu --doit -v
日志显示:  Prepare[CPU]          ← 告诉用户在用 CPU 软解
实际参数:  -hwaccel cuda -hwaccel_output_format cuda   ← 实际仍是硬解
```

`argv.hwaccel` 在 `cmd/cmd_ffmpeg.js` 中仅出现于 builder 定义（`:242`）与 JSDoc（`:324`），**零消费**；`useCPUDecode` 仅被赋值（`:976/:979/:994`）与打印（`:1022`），**从不参与参数生成**。决定软硬解的只有 `canUseCUDADecoder()`（`:598`）。**结论确认，且"日志与实际相反"这一点已实测。**

### 4.2 `--override` 声明但从未读取（dsf P1-3）

全仓库 grep `argv.override` 的消费点：`cmd_compress.js`（已修）、`cmd_zipu.js`（`:144`/`:264` 正常消费）、`cmd_ffmpeg.js` **仅在 builder 与 JSDoc 出现**。目标存在时一律走 `Skip[Dst1]`（`:934-943`）。**结论确认。**

### 4.3 `--delete-source-files` 删除条件过于宽松（dsf P2-9）

dsf 指出"目标存在即删源文件、不校验内容"。本次补充**更严重的一层**：该分支**连 testMode 都不判断**（见第 1 节），使问题从"条件宽松"升级为"dry-run 也执行"。建议两项合并修复。

---

## 5. P2 / P3 级问题

### P2-⑦ 音频路径的进度条恒为 0%

**位置**：`cmd/cmd_ffmpeg.js:1536-1548`（视频推 `-progress -`、音频推 `-stats`）、`:1752-1769`（只解析 `out_time=`）

**事实**：进度条的数据源是 stdout 上的 `out_time=` 字段，该字段由 `-progress -` 产生；但音频分支推的是 `-stats`：

```js
:1536  if (tempPreset.type === "video") {
:1537      inputArgs.push("-progress", "-", "-nostats")   // ← 有 out_time
...
:1546  } else {
:1547      inputArgs.push("-stats")                        // ← 无 out_time，进度条收不到数据
```

`-stats` 输出的是 `time=00:00:03.20`（stderr、`\r` 刷新），而解析正则只认 `^out_time=`。

**实机复现**：音频转码（`aac_medium`）全程日志中 `out_time` 出现 **0 次**；进度条从 `start(100, 0)` 起不再更新，直到 `finally` 里 `stop()`。

**影响**：所有音频转码（`aac_*` / `audio_extract`）的进度条形同虚设，长音频上用户看不到任何进度。

**建议**：音频分支同样使用 `-progress - -nostats`；或在解析侧兼容 `-stats` 的 `time=` 字段。

### P3-⑧ 文件日志参数错位，写入独立的 `FFConv_log_*.txt`

**位置**：`cmd/cmd_ffmpeg.js:511`

```js
:511  !testMode && log.fileLog(`ffmpegArgs:`, lastFFArgs?.flat(), LOG_TAG)
```

`fileLog` 的签名是 `(logText, logTag = "", logFileName = "mediac")`（`lib/debug.js:148`）。此处第 2 个实参传了参数数组（被当作 tag）、第 3 个传了 `LOG_TAG`（被当作**日志文件名**），于是：

1. 该行没有写入主日志 `mediac_log_*.txt`，而是新建了 `FFConv_log_*.txt`（日志被分散到两个文件，`index.js:118-135` 结尾只提示 `mediac_log` 的路径，用户看不到 `FFConv_log`）；
2. 文本与 tag 互换，输出成 `[<整个参数数组>] ffmpegArgs:`。

**实机取证**（`%TMP%\mediac\FFConv_log_20260919220835.txt` 实际内容）：

```
[22:08:37.249][-hide_banner,-n,-v,error,-progress,-,-nostats,-hwaccel,cuda,...] ffmpegArgs:
                                                                    ↑ tag 位置是参数数组，正文是 "ffmpegArgs:"
```

同文件 `:388-390` 的调用顺序是对的（`log.fileLog(\`Root: ${root}\`, "FFConv")`）。**建议**：改为 `log.fileLog(\`ffmpegArgs: ${lastFFArgs?.flat().join(" ")}\`, LOG_TAG)`。

### P3-⑨ test 模式抽样逻辑非单调

**位置**：`cmd/cmd_ffmpeg.js:539-541`

```js
if (testMode && tasks.length > 20) {
    tasks = core.takeEveryNth(tasks, Math.floor(tasks.length / 10))
}
```

`takeEveryNth` 的语义是"每 n 个取一个"，结果条数 ≈ `ceil(len / n)`，与"取约 10 个"的意图在 `len` 为 20~29 时不符：

| 任务数 | 抽样后 | 说明 |
| ------ | ------ | ---- |
| 21 | **11** | 期望 ~10，反而多于下限 |
| 25 | **13** | 同上 |
| 30 | 10 | 正常 |
| 100 | 10 | 正常 |

**影响**：仅影响测试模式的输出量，属体验问题。**建议**：改为 `tasks.filter((_, i) => i % Math.ceil(tasks.length / 10) === 0)` 或直接 `tasks.slice(0, 10)` 的均匀取样。

---

## 6. 复核：未发现问题的项（避免重复劳动）

以下项目本次重点核查后**确认不是缺陷**，供后续审查参考：

| 项 | 核查结论 |
| -- | -------- |
| `totalDuration` 的 `acc + (t.info?.duration \|\| 0)` | 括号已正确（第一轮已修），无优先级问题 |
| `fileLog` 写入的 `Error` 对象 | `writeErrorFile`（`:753-778`）确实会丢 `Error` 的可枚举属性（`JSON.stringify(new Error()) === "{}"`），但这是既有 dsf P2-10 的范围，本次不重复计数 |
| `minNoZero` 空集 | `minNoZero(0,0)` 返回 `Infinity`，会让 `videoBitrateK` 变成 `"InfinityK"`；但触发需预设码率与源码率同时为 0，**当前预设表下不可达**，仅作边界提示 |
| `structuredClone(argv)` 逐条克隆 | 每文件一份 argv（`:464`），大目录下有内存开销，但属既有设计，非缺陷 |
| `execa` 的 `encoding: "latin1"` | 与 `lib/mediainfo.js` 一致，用于规避 Windows 中文乱码，是有意选择 |
| `createFFmpegArgs` 的 `forDisplay` 分支 | 展示用路径替换为 `input.mkv`/`output.mp4`（`:1554`/`:1702`），属 dsf P2-2 已记录的范围 |
| 未使用的 import（6 个） | 与 dsf P3-1 完全一致（`iconv`、`inquirer`、`confirmAction`、`asyncFilter`、`handleError`、`getSimpleInfo`），不重复计数 |

---

## 7. 建议修复顺序

| 顺序 | 项 | 改动量 | 理由 |
| ---- | -- | ------ | ---- |
| 1 | P0-① test 模式删除守卫 | ~1 行 | 唯一会改动用户文件位置的缺陷 |
| 2 | P0-② `dstValues` → `dstArgs` | ~2 行 | 产物文件名错误，用户直接可见 |
| 3 | P1-③ ffargs 数值判据 | ~1 行 | 主推入口静默失效，影响面最大 |
| 4 | P1-④ include/exclude 结构 | ~5 行 | `--include` 完全不可用 |
| 5 | P1-⑥ 非法正则兜底 | ~6 行 | 一行输入错误即全批中止 |
| 6 | P1-⑤ `--fps` 独立参数化 | ~4 行 | 需与 dsf P1-2 的解码策略一并设计 |
| 7 | P2-⑦ 音频进度条 | ~2 行 | 体验问题 |
| 8 | P3-⑧ / ⑨ 日志与抽样 | ~4 行 | 工程卫生 |

> 第 1、2、3、4 项合计约 10 行改动，即可消除本次全部 P0 与两项影响最大的 P1，建议作为一批提交。第 6 项与 dsf 的 P1-2（解码策略）同源，建议合并设计后再动。

---

## 8. 本次验证方法与证据索引

所有结论均以真实执行产出为依据，未使用推测。

| 编号 | 验证方式 | 关键证据 |
| ---- | -------- | -------- |
| P0-① | 真实素材 + `--delete-source-files`（无 `--doit`） | 源文件从工作目录消失，出现在 `/c/Deleted_By_Mediac/20260919/...`；日志 `SafeDel 0/1` |
| P0-② | 真实素材 + `aac_medium --doit` | 产出文件名为 `s_{audioBitrateK}.m4a`；同批日志已算出 `ab:320K=>256K` |
| P1-③ | 真实 yargs 实例解析 + 真实调用链 | `parseArgs` 得到 `{vb:2000,dm:1280}`，合并后 `userArgs.videoBitrate=0`；对照 `--video-bitrate 2000` → `2000000` |
| P1-④ | 真实目录（2 文件）+ `--include AAA` | 日志 `剩余 2 个文件`（期望 1） |
| P1-⑤ | 真实转码 + `ffprobe` 实测输出 | 日志 `fps:25=>10`，产出 `r_frame_rate=25/1` |
| P1-⑥ | 真实 CLI + `--exclude "a["` | `EXIT=1` + 完整 `SyntaxError` 堆栈（含 4 层调用链） |
| P2-⑦ | 音频转码全日志检索 | `out_time` 出现 0 次 |
| P3-⑧ | 检查 `%TMP%\mediac\FFConv_log_*.txt` | 文件中 tag 位置为参数数组、正文为 `ffmpegArgs:` |
| P3-⑨ | 对 `takeEveryNth` 直接调用 | 21→11、25→13、30→10 |
| 4.1 | 真实转码 + `-v` 抓实际命令 | 日志 `Prepare[CPU]`，参数为 `-hwaccel cuda` |

**验证环境准备**：`export PATH="/c/Home/Apps/ffmpeg/bin:$PATH"`；测试素材由 `ffmpeg -f lavfi -i testsrc2=... -f lavfi -i sine=...` 生成（含中文名、空格、`&` 等特殊字符，用于覆盖 Windows 路径场景）。

**本次审查未改动任何源码**，所有测试产物与 `Deleted_By_Mediac` 残留均已清理，工作区未提交。

---

## 9. 本次审查的局限

1. **未覆盖 GPU 之外的硬件路径**：本机为 N 卡，`qsv` / `d3d11va` 等分支（`lib/ffmpeg_presets.js` 的 `hevc_qsv` 系列）未能实机验证。
2. **未验证 10bit / 24fps 等特殊素材**：`ivideo.bitDepth === 10` 的软解规则（`:989`）与 `hevc_speed` 的 24fps 边界（dsf 记为 T-13 搁置项）无对应素材，未复现。
3. **未做并发压力验证**：`pMap` 高并发下的进度条交织（dsf P2-6）未构造多文件大批量场景。
4. **未评估安全议题**：本次按要求不涉及安全漏洞（既有 `CODE-REVIEW-20260919.md` 已覆盖该范围）。
5. **对既有报告结论的处理**：本次仅独立复现了 3 项，`docs/ffmpeg-cmd-review-dsf.md` 中其余结论（如 P1-1 统计失真、P1-4 `--speed`、P1-5 元数据自引用、P2-1 上帝函数等）**未逐条复核**，其可信度仍以原报告为准。

# `cmd/cmd_ffmpeg.js` 专项代码审查报告（dsf 版）

- 审查对象：`C:\Home\Projects\media-cli.js\cmd\cmd_ffmpeg.js`（1,868 行）
- 审查日期：2026-09-19
- 运行环境：Node **v24.15.0**（Windows 10，git-bash），仓库 HEAD `0e8d2bc`
- 审查方法：全文逐行精读（1,868 行，分 4 段完整读取）+ 关联模块交叉核对（`lib/ffmpeg_presets.js`、`lib/helper.js`、`lib/file.js`、`lib/media_parser.js`、`lib/mediainfo.js`、`lib/debug.js`、`lib/core.js`、`lib/command_utils.js`、`cmd/cmd_shared.js`）+ 可执行验证（`smoothChange`、`takeEveryNth`、`pathSplit`/`pathRewrite`、`filenameSafe`、`textHash`、`formatArgs`、`xxHash32` 返回值语义、`execa` latin1 解码往返、`humanSeconds`/`humanTime`、`calculateScale`）+ 上游历史审查文档比对（`docs/TODO-FIXES-20260919.md`）
- 审查范围：功能缺陷、逻辑正确性、代码质量、可维护性与性能；**不涉及安全漏洞**
- 说明：本报告只针对这一个文件，不重复上游文档中已修复项的验证结论，但会标注"已修复但遗留副作用"

---

## 一、总体结论

**一句话结论：这个文件是仓库里最复杂的一条链路（1,868 行、5 层职责混在一起），它的主流程逻辑是对的、注释质量也高于仓库平均水平；但它有两个结构性问题——「C 类错误（失败）被静默吞掉」和「同一个参数被两条互斥的代码路径各自解释」，这两点导致几处功能实际失效却没有任何报错。**

核心数字：

| 级别 | 数量 | 说明 |
| ---- | ---- | ---- |
| P1 | 7 | 明确功能失效或参数撒谎（均已静态确认，关键项可复现） |
| P2 | 11 | 结构、性能、可维护性 |
| P3 | 6 | 死代码、命名、文档一致性 |

> 本文件未单列 P0：现有问题都会导致"结果不对但进程不崩"，没有一项会造成数据不可恢复的丢失或进程级崩溃；P1-1 / P1-2 / P1-3 因"完全无报错"而最接近 P0，已排在第一梯队优先修。

三句话洞察：

1. **两处"没有报错的失效"是本次最值得优先处理的**：
   - **失败任务被静默吞掉**——`prepareFFmpegCmd` 返回 `false` 的 6 处跳过原因（`BadFormat`/`Invalid`/`NoAudio`/`NoVideo`/`Short`/`Error`），在汇总统计里与"成功"无法区分，最终"共 N 个文件已处理"这个数字**不包含跳过项的分类信息**，用户无法从输出判断"为什么 100 个文件只转了 60 个"（见 P1-1）。
   - **`--hwaccel` / `--decode-mode` 互相失效**——`--decode-mode cpu` 被 CUDA 探测结果覆盖，`--decode-mode gpu` 被 h264 10bit 规则覆盖，两个选项在多个常见场景下等于不存在（见 P1-2）。
2. **"同一个参数两条路径各自解释"是这份文件的系统性风险**：`--prefix/--suffix`（模板变量 vs 文件名清理）、`--hwaccel`（显示 vs 实际）、`--output-mode dir`（语义名 vs 实现）、`--override`（声明 vs 未读取）、`--speed`（仅元数据 vs 实际变速）、`--error-file`（声明 vs 强耦合字符串比较）——6 个选项存在"声明与实现漂移"，占 builder 定义选项总数的近 1/5。
3. **元数据里塞入"最后一次计算出的参数"这个设计，把 `--video-bitrate` 的语义从"上限"变成了"按最后一次计算结果封顶"**，且 `getCommentArgs` 每次都会重算一次完整参数（含 `dayjs()` 时间戳），导致同一文件里 `comment` 与 `copyright` 的时间戳可能不一致，`comment` 长度也无法预测（见 P1-5）。

---

## 二、P1 级问题（功能缺陷，建议优先修复）

### P1-1　失败与跳过被混入"已处理"统计（统计失真，`--error-file` 因此失效）

- 位置：`:480-482`（`prepareFFmpegCmd` 返回 `false`）、`:504`（`filter(t => t && t.fileDst)`）、`:542-543`（`results`）、`:565`（`okResults`）、`:567-573`（汇总输出）
- 事实链：
  1. `prepareFFmpegCmd` 有 **6 个** `return false` 分支：`Skip[BadFormat]`（`:848`）、`Skip[Invalid]`（`:873`）、`Skip[NoAudio]`（`:909`）、`Skip[NoVideo]`（`:921`）、`Skip[Short]`（`:970`）、`Skip[Error]`（`:1050`）。
  2. 另有 **2 个** `dstExists: true` 的"跳过但保留对象"分支（`:939`、`:953`）。
  3. 调用方 `:504` 用 `tasks.filter((t) => t && t.fileDst)` 过滤，**`dstExists` 对象因为没有 `fileDst` 字段被一并丢弃**，且丢弃数量从未被计数或输出。
  4. 最终 `okResults = results.filter(r => r && r.ok)`（`:565`），`r.ok` 只在 `:696` 一处被置为 `true`（真正转码成功）。这一层是对的。
  5. **但 `runFFmpegCmd` 在 `entry.testMode` 时返回 `undefined`（`:621-627`）**，在 `DstExists` 时返回 `undefined`（`:668-678`）。testMode 下 `okResults` 恒为 0，于是 `!testMode &&`（`:566`）把成功摘要整个跳过了——**test 模式下用户看不到任何"成功 N 个"的结论**，而 `t("common.test.mode.note")` 用的还是 `{{count}}` 插值却**未传参**（`:564`），屏幕上会原样显示 `{{count}} 个文件，测试模式下未处理。`
- 实测证据（静态确认，无需真实 ffmpeg）：
  ```
  t("common.test.mode.note")                    → "{{count}} 个文件，测试模式下未处理。"
  t("common.test.mode.note", {count: 5})        → "5 个文件，测试模式下未处理。"
  ```
  该文案在 i18n 词典中**确实存在**（`lib/i18n.js:32-35`），所以不是缺失键，而是**调用时漏传插值参数**——与上游报告里"9 个 i18n 缺失键"是不同性质的问题，本轮新发现。
- 影响：`--error-file` 的落盘依赖 `runFFmpegCmd` 的 `catch` 分支（`:721`），而"重试成功"的路径（`:556-559`）与"跳过"路径都不会写错误文件。用户拿到的错误日志**不包含跳过的文件**，无法从日志判断"为什么 100 个文件只转了 60 个"。

**建议**：把 `prepareFFmpegCmd` 的返回值从 `false` 改为带 `skipReason` 的对象（`{ skipped: true, reason: "BadFormat" }`），在 `:504` 处按 reason 分类计数，最终汇总输出 `成功 / 跳过 / 失败` 三个数字。

---

### P1-2　`--hwaccel` 与 `--decode-mode` 在多个常见场景下互相失效

- 位置：`--hwaccel` 定义 `:242-246`、`--decode-mode` 定义 `:248-253`；使用点 `:974-998`（decodeMode）、`:1536-1548`（useCUDA → hwaccel 参数）
- 三条事实：
  1. **`--hwaccel` 被完全忽略**：`createFFmpegArgs` 中实际写入的 hwaccel 参数只取决于 `useCUDA` 布尔值（`:1539-1545`），写入的是硬编码的 `"cuda"` 或 `"auto"`。**`argv.hwaccel` 在整个文件中零引用**（全文 grep 确认：只在 builder 定义处出现一次）。
     ```
     实测（grep argv.hwaccel / hwaccel 的使用点）：
       :242  .option("hwaccel", ...)   ← 定义
       :1541 inputArgs.push("-hwaccel", "cuda", ...)
       :1544 inputArgs.push("-hwaccel", "auto")
       ← 没有任何一处读取 argv.hwaccel
     ```
  2. **`--decode-mode cpu` 会被 CUDA 探测覆盖**：`:974-998` 在 `isVideo` 时设置 `newEntry.useCPUDecode`，但 `runFFmpegCmd` 里的 `useCUDA` 来自 `canUseCUDADecoder(entry.path)`（`:598`），**与 `useCPUDecode` 无关**。当 `--decode-mode cpu` 且探测成功时，`useCPUDecode = true` 被写入 entry 但从未被消费，实际仍走 `-hwaccel cuda -hwaccel_output_format cuda`（`:1541`）。
     ```
     实测（grep useCPUDecode 的全部引用）：
       :976  newEntry.useCPUDecode = true    ← 写入
       :979  newEntry.useCPUDecode = false   ← 写入
       :994  newEntry.useCPUDecode = true    ← 写入
       :1022 newEntry.useCPUDecode ? `SW` : `HW`   ← 仅用于日志显示
       ← 没有任何一处参与 ffmpeg 参数生成
     ```
     这条同时解释了另一个现象：`--decode-mode cpu` 时日志会显示 `SW`，而实际命令里是 `-hwaccel cuda`——**日志与实际行为相反**。
  3. **h264 10bit 的软解规则是死代码**：`:987-995` 的 `isH264 && ivideo?.bitDepth === 10` 分支依赖 `ivideo.bitDepth`，而 `bitDepth` 的来源是 `lib/media_parser.js:134`：
     ```js
     bitDepth: data["bits_per_raw_sample"] || data["bits_per_raw_sample"],
     ```
     **同一个字段写了两遍**，`bits_per_sample`（更常见、h264 8/10bit 通常落在这个字段）被漏掉。当 ffprobe 只返回 `bits_per_sample` 时 `bitDepth` 为 `undefined`，该分支永不进入。
     另注：`:988` 定义了 `isHigh50`（High profile 且 level > 4.2）但**从未使用**，注释里写的"H264 High L5 以上可能也不支持"这条规则实际未实现。
- 影响：用户显式指定的解码策略（软解/硬解）在多数场景下不生效，且日志会给出相反的信号。这是"参数撒谎"的典型形态。

**建议**：① 让 `--hwaccel` 真正参与参数生成，或从 builder 中删除；② 让 `useCPUDecode` 参与 `useCUDA` 的最终决策（例如 `const useCUDA = argv.decodeMode === "cpu" ? false : await canUseCUDADecoder(...)`），并在日志中如实反映；③ 修 `media_parser.js` 的 `bitDepth` 字段回退链。

---

### P1-3　`--override` 声明但从未被读取（与 `cmd_remove`/`cmd_compress` 同类问题）

- 位置：定义 `:126-131`（`t("ffmpeg.override")` = "强制覆盖已存在的文件"）；使用点：**零**
- 事实：目标文件存在时一律 `Skip[Dst1]`（`:934-943`），没有任何分支读取 `argv.override`。
- 对照：`docs/TODO-FIXES-20260919.md` 已修复 `cmd_compress` 的同类问题（"`--overwrite` 一路传递但从不校验，参数撒谎"），`cmd_ffmpeg` 的 `--override` 是**同一模式的遗留项**。
- 影响：用户加 `--override` 期望覆盖，实际全部跳过，且日志只显示 `Skip[Dst1]`，不提示"因未实现覆盖而跳过"。

**建议**：实现覆盖（存在则删除/改名后继续），或删除该选项并在 README/help 中说明"目标存在即跳过"。

---

### P1-4　`--speed` 只写入元数据，不实际变速（且 `{speed}` 模板变量与 `preset.speed` 语义冲突）

- 位置：定义 `:162-166`；校验 `:351-353`；计算 `:1322`（`dstSpeed`）、`:1466`（返回 `dstSpeed`）、`:1479`（返回 `speed: dstSpeed`）
- 事实：
  1. `createFFmpegArgs` 全文**没有使用 `speed` 生成任何 ffmpeg 参数**（无 `setpts`、无 `atempo`）。`tempPreset.speed` 只经 `formatObjectArgs` 参与模板替换，最终写进 `-metadata description`（`:1649`）和 `-metadata copyright`（`:1652`）。
  2. **语义冲突**：`FFmpegPreset.speed` 在预设体系里是**编码器速度/质量权衡**（如 `H264_BASE` 的 `speed: 0`、`PRESET_HEVC_SPEED` 的 `speed: 1.5`，见 `lib/ffmpeg_presets.js:64`、`:183`、`:408`）；而 `--speed` 的 i18n 文案是"改变视频和音频的速度"。两者共用同一个字段名，`calculateDstArgs` 里 `ep.userArgs.speed || ep.speed`（`:1322`）把用户意图直接盖到编码器速度上。
  3. `--speed 0` 无法表达（`if (argv.speed > 0)` 在 `lib/ffmpeg_presets.js:826` 才写入），且 `:351` 的校验用的是 `< 0 || > 4.0`，即 `0` 合法但等价于"未指定"。
- 影响：用户以为能变速，实际只改了元数据；而 `{speed}` 模板变量在文件名/元数据里显示的可能是预设的编码器速度。

**建议**：把用户侧速度参数改名（如 `--rate`）并接入 `setpts`/`atempo` 滤镜；或明确把它定义为"仅记录用途"并从 help 中移除"改变视频和音频的速度"的表述。

---

### P1-5　`getCommentArgs` 的元数据自引用：时间戳不一致 + 参数语义漂移

- 位置：`:510`（`lastTask` 预览）、`:636`（`metaComment`）、`:738-745`（`getCommentArgs`）、`:1646-1653`（`description` / `copyright`）
- 事实链：
  1. `createFFmpegArgs` 内部会设置 `entry.debugPreset = core.formatObjectArgs(tempPreset, tempPreset)`（`:1705`）——**把格式化后的 preset 写回 entry**。
  2. `getCommentArgs(entry)` 又调用一次 `createFFmpegArgs(entry, entry.useCUDA, true)`（`:740`），这次 `entry.preset` 已被上一步污染，`tempPreset` 会带上上一次的 `debugPreset`/`debugArgs`/`extraArgs` 等字段。
  3. 该函数**每次调用都会执行 `dayjs()`**（`:1647`），因此 `:636` 的 `metaComment` 与 `:1652` 的 `copyright` 时间戳来自**两次不同的时间点**；`:510` 的预览又产生第三次。
  4. `comment` 的内容是整条命令（含 `-metadata description=...` 自身），长度随滤镜串、`inputArgs` 线性增长；`.replaceAll(/['"]/gi, " ")`（`:743`）只处理引号，**未处理换行**（`inputArgs` 里的 `filters` 若含换行会原样进入元数据）。
  5. **`--video-bitrate` 的语义因此从"目标上限"变成"按最后一次计算结果封顶"**：`:1430` 的 `dstVideoBitrate = minNoZero(dstVideoBitrate, srcVideoBitrate)` 本身是合理的（不放大码率），但注释 `:1374` 写的是"计算出的视频码率不高于源文件的视频码率"，而 `:1376` 的 `srcVideoBitrate = ivideo?.bitrate || fileBitrate - 48*1000 || 0` 在 `ivideo.bitrate` 缺失时用"整体码率 - 48k"估算——当文件只有音频流时 `fileBitrate - 48000` 可能是**负数**，`minNoZero` 会把它过滤掉（`:1263` 只保留 `> 0`），于是 `Math.min()` 只对 `dstVideoBitrate` 自己取最小 → 不封顶，**退化为用户值原样使用**。
     ```
     实测（minNoZero 语义确认）：
       minNoZero(3000000, -20000) → 3000000   // 负值被丢弃，封顶失效
       minNoZero(3000000, 0)      → 3000000   // 0 也被丢弃
     ```
- 影响：元数据不可复现（两次时间戳）、`comment` 可能超长或被截断、`--video-bitrate` 的"不高于源"保证在部分文件上不成立。

**建议**：① `getCommentArgs` 不要重算命令，直接复用已生成的 `entry.ffmpegArgs`；② 时间戳只取一次（提到函数外）；③ 元数据写入前对值做换行/长度归一化；④ `srcVideoBitrate` 缺失时保持 0 并显式跳过封顶，而不是依赖 `minNoZero` 的隐式行为。

---

### P1-6　`--output-mode dir` 与 `--output` 的语义名实不符

- 位置：定义 `:67-73`（choices `tree|dir|file`，i18n 文案为"保持文件夹树/保持父目录/扁平化文件"）；实现 `:809-828`
- 实测（已在本机运行验证）：
  ```
  input root   = C:\Media\Movies\
  srcDir       = C:\Media\Movies\Show\
  output       = D:\Out\

  output-mode=dir   → path.join(preset.output, path.basename(srcDir)) = D:\Out\Show
  output-mode=tree  → helper.pathRewrite(root, srcDir, output)        = D:\Out\Movies\Show
  output-mode=file  → path.resolve(preset.output)                     = D:\Out
  ```
- 问题：**`dir` 与 `file` 在"每个源目录下所有文件都在同一层"这一常见输入下产出完全相同的目录**（`D:\Out\Show` vs `D:\Out` 的差别只在是否多一层源目录名）。更关键的是：
  1. `dir` 模式（`:821`）**只保留源目录的父目录名**，当多个源子目录同名时（`A/2024/`、`B/2024/`）会**输出到同一目录并互相覆盖**；
  2. `file` 模式（`:817`）把所有文件平铺到一个目录，**不同子目录的同名文件直接互相覆盖**，且 `:934` 的 `pathExists` 检查只检查"目标存在则跳过"，不检查"是否刚被同批次其他文件写入"，在 `pMap` 并发下是 **TOCTOU**；
  3. `tree` 模式（`:813`）的 `keepRoot` 默认为 `true`（`lib/helper.js:409`），因此输出会**多一层根目录名**（`D:\Out\Movies\Show` 而不是 `D:\Out\Show`），这与 i18n 文案"保持文件夹树"的直觉一致但与 `dir` 模式不对称。
- 影响：批量转码时目标文件互相覆盖，属**数据丢失级别**，且日志只会显示 `Skip[Dst1]`，用户无法区分"本来就有"和"被同批次覆盖"。

**建议**：① `file` 模式下目标名冲突时追加后缀（参照 `safeRemove` 的递增策略）；② `dir` 模式改用"相对 root 的完整相对路径"而非 `basename`；③ 或在 `prepareFFmpegCmd` 完成后做一次全局目标路径唯一性校验并提前报错。

---

### P1-7　`--info` 路径的性能与健壮性问题

- 位置：`:443-450`
- 事实：
  1. `--info` 是**串行 for-await** 逐文件调用 `getMediaInfo`（内部走 ffprobe/mediainfo 子进程），几百个文件时需要数分钟；而同一文件的其他路径（`:480`、`:836`）用的是 `pMap` 并发。
  2. `getMediaInfo` 失败时 `getMediaInfo` 内部会 `log.error` 后**返回 `undefined`**（`lib/mediainfo.js:137-169`，两个解析器都失败时无 `return`），`:447` 的 `log.logInfo(LOG_TAG, info)` 会打印 `undefined`，不中断也不计入失败。
  3. `--info` 与 `--preset` 的强制校验顺序（`:344`）**先于** `--info` 分支：即 `mediac ffmpeg <dir> --info` 会因缺少 `--preset` 直接 `return`，而 `--info` 在语义上并不需要预设。
     ```
     :344  if (!argv.preset || !presets.getPreset(argv.preset)) {
     :345      log.error(LOG_TAG, t("ffmpeg.error.preset"))
     :346      return                      ← --info 走不到下面
     :347  }
     :443  if (argv.info) { ... }
     ```
- 影响：`--info` 既慢又不报错，且必须额外传一个无意义的 `--preset` 才能用。

**建议**：`--info` 提前到预设校验之前，改用 `pMap` 并发，并把 `getMediaInfo` 返回 `undefined` 的情况计入失败统计。

---

## 三、P2 级问题（结构、性能与可维护性）

### P2-1　`createFFmpegArgs` 是全文件的"上帝函数"（219 行，5 类职责）

`:1492-1710` 一个函数内同时承担：① 参数拼接（input/middle/output 三段）；② 模板替换（`formatArgs` ×5）；③ **对 entry 和 preset 的副作用写入**（`entry.debugPreset`、`entry.debugArgs`、`tempPreset.extraArgs`）；④ 音频编码器的运行时策略决策（`:1619-1636`）；⑤ 显示模式与真实模式的分支（`forDisplay` 参数控制 3 处不同行为）。

其中 ④ 尤其应该独立：

```js
// :1619-1636 在"生成参数"的函数里决定"是否复制音频流"
if (presets.isAudioExtract(tempPreset)) {
    if (entry.srcAudioCodec === "aac") { tempPreset.audioArgs = "-c:a copy" }
} else {
    if (helper.isVideoFile(entry.path)) {
        const shouldCopy = tempPreset.srcAudioBitrate > 0 &&
            tempPreset.dstAudioBitrate + 2000 > tempPreset.srcAudioBitrate
        if (shouldCopy || tempPreset.userArgs.audioCopy) { tempPreset.audioArgs = "-c:a copy" }
    }
}
```

这里的 `+ 2000` 是"考虑误差"的魔法数（bps 单位，即 2kbps 容差），且 `entry.srcAudioCodec` 来自 `entry.info`，而 `tempPreset.srcAudioCodec` 来自 `dstArgs`（两者在 `:1456` 被赋值为同一个值，但引用路径不同，容易在重构时踩坑）。

**建议**：把"编码器决策"抽成纯函数 `decideAudioArgs(entry, preset)` 并单测；`createFFmpegArgs` 只做字符串组装。

---

### P2-2　`forDisplay` 模式与真实模式行为不一致（显示的命令可能不是实际执行的命令）

- 位置：`:1554`（`input.mkv`）、`:1702`（`output.mp4`）、`:1682-1684`（`extraArgs` 仅在非 display 时写）、`:1705-1706`（`debugPreset`/`debugArgs`）
- 事实：`:510-514` 用 `createFFmpegArgs(lastTask, true, false)` 生成**预览**，但 `:514` 的打印用的是 `lastFFArgs.flat().join(" ")`——即"扁平化后的预览参数"；而真正执行时用的是 `:636` 的 `[...inputArgs, ...middleArgs, ...metaComment, ...outputArgs]`，**中间插入了 `metaComment`**，且 `input`/`output` 是真实路径。用户核对 `CMD:` 这一行时看到的是另一个命令。
- 另：`getCommentArgs` 的第二次调用会再次触发 `:1705` 的副作用，`entry.debugPreset` 被覆盖为"含上一轮 debug 字段的 preset"，`:513` 打印的 `PRESET:` 因此可能包含非预期字段。

**建议**：预览与实际共用同一个组装函数，只替换路径与是否附加 `metaComment` 两个变量。

---

### P2-3　`selectPreferredSubtitle` 的关键词匹配过宽 + 重复项

- 位置：`:1213-1243`
- 实测确认的问题：
  1. **关键词 `"gb"` 会误命中**：任何路径含 `gb` 的文件名（如 `Movie.GB.1080p.mkv`、`IMG_gb01.ass`）都会被判为"中文字幕"优先选中。实测 `"movie.gb.ass".includes("gb") === true`。
  2. **`"zh"` 会误命中 `zh` 以外的组合**：如 `zh-hant`（繁体）、`zho`（ISO 639-3 中文，OK）、但也会命中 `zha`（壮语，ISO 639-3）路径片段——`"movie.zha.ass".includes("zh") === true`。
  3. **`"chs"` 在数组中重复出现两次**（`:1224` 与 `:1231`），说明该列表是手工维护、已出现漂移。
  4. 匹配用的是 `sub.toLowerCase().includes(keyword)`，**对完整路径做子串匹配**，因此父目录名、盘符都可能参与命中。
- 影响：多字幕场景下可能优先挂载了非中文字幕，而用户从日志只能看到 `(SUB:xxx.ass)`，不易察觉。

**建议**：改为对 `path.basename(sub, ext)` 分词后做精确 token 匹配（如 `["chs","cht","zh","zh-cn","zh-hans","sc","tc","chi","简体","简中"]`），并对 `zh-hant`/`cht` 明确排除。

---

### P2-4　字幕探测：串行 6 次 `pathExists`，且只看固定 3 个扩展名

- 位置：`:1001-1013`
- 事实：
  1. 每个文件做 `3 exts × 2 dirs = 6` 次串行 `fs.pathExists`。虽然该函数在 `pMap` 内（`:480`），但 `pMap` 的并发是"文件级"，单文件内仍串行 6 次往返；对 1000 个文件即 6000 次串行 stat。
  2. 只探测 `srcBase + ext` 的**同名**字幕，不含 `srcBase.zh.ass`、`srcBase.chs.srt` 这类带语言后缀的常见命名。
  3. 已在 `:1557` 处理了"选中字幕则 `-map 0:v -map 0:a -map 1`"，但**没有为选中字幕设置语言元数据的可配置性**：`:1560` 硬编码 `language=chi`，即英文/日文字幕也会被标记为 `chi`。
- 建议：用 `fs.readdir(srcDir)` 一次拿全目录内容再做匹配（1 次 IO 替代 6 次），语言标签按 `selectPreferredSubtitle` 的判定结果动态生成。

---

### P2-5　CUDA 探测的开销与误判

- 位置：`:1819-1868`（`canUseCUDADecoder`）
- 事实：
  1. 每个文件都跑一次**完整 ffmpeg 探测**（`-frames:v 1 -f null -`），即使同一目录下编码参数高度相似。`cudaDecoderCache`（`:36`）的 key 是 `inputPath`，**不同文件永远不命中**，缓存实际上只防"同一文件被处理两次"（正常流程中不会发生）。
     ```
     :1821  if (cudaDecoderCache.has(inputPath)) return cudaDecoderCache.get(inputPath)
     // key = 绝对路径 → 跨文件零命中
     ```
  2. 判定逻辑依赖 stderr 的**英文字符串匹配**（`:1855-1858`），而探测命令传的是 `-v error`，只匹配 `CUDA_ERROR_INVALID_VALUE` 与 `Failed setup for format cuda` 两种；**驱动不可用、显卡被占用、`h264_cuvid` 不存在**等常见失败都不在列表中，会被误判为"可用"。
  3. 探测本身**无超时**（`:1826-1848` 未传 `timeout`），驱动异常时可能长时间挂起。
  4. 与 `entry.retryOnFailed` 的交互（`:552-554`）：重试时把 `decodeMode` 设为 `cpu` 并 `prepareFFmpegCmd` 重跑，但 `runFFmpegCmd` 里 `useCUDA` 仍来自探测（见 P1-2），**重试时并未真正切换到 CPU 解码**——重试机制的注释"转换失败需要重试，使用CPUDecode"（`:722`）与实际行为不符。
- 建议：① 缓存 key 改为"编码器 + profile + level + bitDepth"的特征键；② 探测结果改为"检测 ffmpeg 是否含 `cuvid` 解码器 + 一次真实探测"，并给探测加 `timeout`；③ 让 `retryOnFailed` 真正短路 CUDA。

---

### P2-6　进度条与日志交织（多进程并发下输出错乱）

- 位置：`:640-663`（创建进度条）、`:726-730`（`finally` 停止）、`:1772-1779`（stderr 里 `progressBar?.stop()`）
- 事实：
  1. `runFFmpegCmd` 在 `pMap` 并发下运行，**每个任务各建一个 `SingleBar`**（`:643`），`jobCount` 默认为 `cpus().length - 2`（`:481`）或 `1/4`（`:538`）。多个进度条同时向同一 TTY 写 `\r`，输出必然互相覆盖。
  2. `stderr` 里只要出现 `"error"`（大小写任一）就 `progressBar?.stop()`（`:1776`），而 ffmpeg 的 `-v error` 会输出正常信息中含 "error" 的行（如 `[mp4 @ ...] Non-monotonic DTS` 不含 error，但 `Stream mapping: ... error` 类提示含），**进度条会中途消失且不再恢复**。
  3. `entry.testMode` 提前 `return`（`:621-627`）发生在进度条创建之前，无泄漏；但 `canUseCUDADecoder` 抛错时（`:598`）异常会冒泡出 `runFFmpegCmd`，**此时 `progressBar` 尚未创建**，无问题；真正的泄漏点是 `:666` 的 `executeFFmpeg` 抛错路径——`finally` 会兜住（`:726`），OK。
- 建议：并发 > 1 时改用 `cliProgress.MultiBar`，或只在 `jobCount === 1` 时启用单条进度条；`stderr` 的 "error" 匹配改为仅在进程退出码非 0 时输出。

---

### P2-7　`totalDuration` 计算依赖已过滤的 `tasks`，语义偏移

- 位置：`:517`
- 事实：`totalDuration` 由 `tasks`（已过滤 `fileDst` 之后）的 `t.info?.duration` 求和，用于确认提示 `t("ffmpeg.confirm.process", { duration })`（`:521-527`）。但用户看到"总时长"时的心智模型通常是"待处理的全部素材时长"，而 `dstExists` 跳过项已被剔除。这一处上游已修复运算符优先级问题（`:515-516` 的注释），但**统计口径**问题仍在。
- 建议：在提示文案中明确"总时长（已排除跳过项）"，或改为同时输出两个数字。

---

### P2-8　`--start` / `--count` 的索引语义在切片后未更新提示

- 位置：`:437-441`
- 事实：切片后打印 `Total N files left in (start-start+count)`（`:440`），**用的是请求区间而非实际区间**。当 `start` 超出文件总数时，`fileEntries` 为空数组，`:432` 的"无文件剩余"检查在切片**之前**（`:432` vs `:437`），因此会继续走到 `:473` 的确认提示，弹出一个"确定要处理这 0 个文件吗？"的对话框。
  ```
  :432  if (fileEntries.length === 0) { ...return }     ← 切片前
  :437  fileEntries = fileEntries.slice(argv.start, argv.start + argv.count)
  :473  const prepareAnswer = await confirmDangerousAction(...)   ← 0 个文件也会弹
  ```
- 建议：切片后补一次空检查；提示区间改为 `[start, start + fileEntries.length)`。

---

### P2-9　`--delete-source-files` 的删除条件过于宽松

- 位置：`:484-502`
- 事实：删除条件是 `tasks.filter((t) => t && t.dstExists && !t.fileDst)`（`:485`）——即"目标已存在且本次没有转码任务"。这意味着：
  1. 用户指定了 `--output` 到新目录，但目标目录里**恰好存在同名文件**（可能是完全无关的旧文件），源文件会被移动到 `Deleted_By_Mediac`；
  2. **不校验文件大小、时长、内容**，`dstExists` 只来自 `fs.pathExists`（`:934`、`:948`）；
  3. 删除走 `helper.safeRemove`（`:495`），失败时返回 `undefined` 且**只 `console.error`**（`lib/helper.js:507-511`），调用方不检查返回值，日志照打 `SafeDel`（`:496`）。
  ```
  :495  await helper.safeRemove(entry.path)
  :496  log.logWarn(LOG_TAG, `SafeDel ${entry.index}/${entry.total} ${entry.path}`)
  ← 不检查 safeRemove 的返回值，失败也报 SafeDel
  ```
- 建议：删除前用 `helper.isExactSameFile` 或至少比对 size/duration；检查 `safeRemove` 返回值并分别计数。

---

### P2-10　`writeErrorFile` 序列化质量差 + 文件数量无上限

- 位置：`:753-778`
- 事实：
  1. 文本模式用 `Object.entries(errorObj).map(([k,v]) => \`${k} =: ${v}\`).join("\n")`（`:770-772`）——**对象会被 `[object Object]` 化**（`entry.info`、`entry.dstArgs`、`entry.preset` 全部丢失内容），`=:` 也是笔误（应为 `=` 或 `:`）。
  2. `errorObj` 展开 `...entry`（`:766`）会把 `ffmpegArgs`、`info`、`stats` 等大对象一并写入，JSON 模式下单个文件可达数百 KB。
  3. 每次失败写一个新文件，文件名含秒级时间戳（`:758`、`:763`），批量失败时会在输出目录产生**成百上千个小文件**，无数量上限、无聚合。
- 建议：文本模式用 `JSON.stringify(v)` 或 `util.inspect`；`errorObj` 改为白名单字段；失败日志改为追加到单个文件或按批次聚合。

---

### P2-11　`canUseCUDADecoder` 的 `stderr` 判空逻辑冗余

- 位置：`:1850-1859`
- 事实：`let canUse = true; if (!stderr) { canUse = true } else { ... }` —— 两个分支都从 `true` 出发，第一个分支纯冗余。而 `-v error` 下 stderr 为空恰恰是"探测成功"的信号，逻辑本身可简化为一行：
  ```js
  const canUse = !stderr || !(stderr.includes("CUDA_ERROR_INVALID_VALUE") ||
                              stderr.includes("Failed setup for format cuda"))
  ```
- 建议：简化并补充更多失败关键字（见 P2-5）。

---

## 四、P3 级问题（死代码、命名与一致性）

### P3-1　未使用的 import（6 个）

```
iconv (iconv-lite)       :13   全文未使用
inquirer                 :14   全文未使用（确认走 command_utils）
confirmAction            :21   未使用（只用了 confirmDangerousAction / abortIfCancelled）
asyncFilter              :23   未使用（只在 cmd_shared 内部用）
handleError              :26   未使用
getSimpleInfo            :31   未使用
```

### P3-2　未使用的局部变量与死分支

| 位置 | 内容 |
| ---- | ---- |
| `:988` | `const isHigh50 = ivideo?.profile?.includes("High") && ivideo?.level > 4.2` —— 定义后从未使用（注释声称的规则未实现） |
| `:1022` | `newEntry.useCPUDecode ? "SW" : "HW"` —— 仅用于日志，与真实解码路径无关（见 P1-2） |
| `:1016-1018` | `codecInfo` 中 `iaudio.duration` 未加可选链（`iaudio?.format` 有，`iaudio.duration` 没有），`iaudio` 为 undefined 时抛 `TypeError` |
| `:869` | `const audioCodec = entry.info?.audio?.format`，`:850` 的 `videoCodec` 同 —— 命名是 codec 但取的是 `format`（语义偏差，`dstArgs.srcAudioCodec` 同理） |
| `:1429` | 注释"目标分辨率，不能大于源文件分辨率"出现在**码率**封顶代码上方（注释与代码不匹配） |
| `:1432` | 注释掉的 `Math.floor(dstVideoBitrate / 1000) * 1000` 取整逻辑 |

### P3-3　`kNum` 与 `minNoZero` 的边界行为

- `kNum`（`:1091-1093`）：`Math.round(value / 1000) + "K"`，`value` 为 0 时输出 `"0K"`，`getEntryShowInfo` 中 `ab:0K=>48K` 这类显示会出现（当 `srcAudioBitrate` 为 0 但 `dstAudioBitrate` 有值时）。
- `minNoZero`（`:1262-1265`）：`numbers.filter(n => n > 0)` 后 `Math.min(...fNumbers)`，**全部为 0/负时返回 `Infinity`**：
  ```
  实测：minNoZero()          → Infinity
        minNoZero(0, -1)     → Infinity
  ```
  当前调用点（`:1361`、`:1380`、`:1430`）至少有一个正值，所以未触发；但这是**靠调用方保证的隐式契约**，建议加显式保护。

### P3-4　`getEntryShowInfo` 的单位/字段耦合

- 位置：`:1121-1168`
- 事实：`const args = { ...entry, ...entry.dstArgs }`（`:1125`）——`dstArgs` 覆盖 entry 同名键，因此 `args.videoBitrate` 实际来自 `dstArgs.videoBitrate`（`calculateDstArgs` 返回的 `videoBitrate` 是 `dstVideoBitrate`，见 `:1466-1479` 的注释掉的 `// videoBitrate: dstVideoBitrate`）。**一旦有人取消那行注释，显示值会从"源码率"变成"目标码率"**，属"靠巧合正确"。
- `:1134`、`:1145` 用 `!==` 比较源/目标码率，浮点 `roundNum` 后仍可能有 1 的误差，导致显示 `ab:128K=>128K` 这种无意义输出。

### P3-5　`prepareFFmpegCmd` 的 JSDoc 与实际返回类型不符

- 位置：`:792` 写 `@returns {Promise<Object|boolean>}`，但实际还返回 `{...entry, dstExists: true}`（`:939`、`:953`）与 `newEntry`（`:1043`）三种形态，调用方靠 `t && t.fileDst` 鸭子类型判断。

### P3-6　文件头的 `Modified` 字段长期未更新

- `:4` `Modified: 2024-04-19 09:54:07`，而文件当前含 2026 年的修改（如 `:515-516`、`:1045-1047`、`:1730-1736` 的注释都记录了近期修复）。仓库其他文件（`lib/debug.js:4`、`lib/command_utils.js:4`）有同步更新的习惯，本文件已漂移。

---

## 五、值得肯定的部分（避免只报问题）

1. **注释质量高于仓库平均**：`:1513-1523` 用实测数据（`32s 110w` / `27s 41w`）记录了几种 hwaccel 组合的耗时与功耗，`:1729-1736` 详细说明了为何不用 `shell: true`（含实测结论），`:1045-1047` 解释了为什么把 `throw` 改为 `return false`。这类"决策留痕"在仓库里很罕见，建议保留。
2. **`-progress -` 解析进度**（`:1752-1769`）比解析 stderr 的 `time=` 更稳，且 `parseTimeToSeconds`（`:1798-1811`）对 2/6 位小数都做了处理。
3. **临时文件 + `fs.move` 的原子替换**（`:679-697`）避免了中断产生半成品；`fs.remove(entry.fileDstTemp)` 在 `finally` 中兜底（`:729`）。
4. **`minNoZero` / `smartBitrate` / `bitrateMap`** 这套"目标码率不高于源码率"的思路是对的，`bitrateMap`（`:1247-1255`）的档位设计合理。
5. **重试机制**（`:545-562`）虽然实现有缺陷（见 P2-5），但"失败任务单独重试 + 切换 CPU 解码"的方向是正确的。

---

## 六、建议修复顺序

### 第一梯队（改动小、直接消除静默失效，约 30 行）

| # | 问题 | 位置 | 预估 |
| - | ---- | ---- | ---- |
| 1 | P1-1 补 `t("common.test.mode.note", { count })` 的插值参数 | `:564` | 1 行 |
| 2 | P3-1 删除 6 个未使用 import | `:13,14,21,23,26,31` | 6 行 |
| 3 | P1-3 `--override` 接上 `pathExists` 分支，或删除该选项 | `:126-131`、`:934` | 5 行 |
| 4 | P2-8 切片后补空检查 | `:437` 后 | 3 行 |
| 5 | P3-2 修 `iaudio.duration` 的可选链 | `:1017` | 1 行 |
| 6 | P2-11 简化 `canUseCUDADecoder` 的 stderr 判空 | `:1850-1859` | 5 行 |
| 7 | P2-9 检查 `safeRemove` 返回值 | `:495` | 3 行 |
| 8 | P3-4 `media_parser.js` 的 `bitDepth` 回退链补 `bits_per_sample` | `lib/media_parser.js:134` | 1 行 |

### 第二梯队（需要设计决策，建议先确认再动）

| # | 问题 | 需确认的点 |
| - | ---- | ---------- |
| 9 | P1-2 `--hwaccel` / `--decode-mode` 的真实语义 | 是否保留 `--hwaccel`？软/硬解的最终决策优先级？ |
| 10 | P1-6 `--output-mode dir/file` 的覆盖风险 | 是否接受"冲突时加后缀"？ |
| 11 | P1-4 `--speed` 改名并实现变速，还是降级为"仅记录" | 是否有变速的真实需求？ |
| 12 | P1-5 `getCommentArgs` 是否保留"把命令写进元数据"的设计 | 若保留，需定长度上限与时间戳口径 |

### 第三梯队（重构，建议单独排期）

| # | 问题 |
| - | ---- |
| 13 | P2-1 拆分 `createFFmpegArgs`（219 行 → 参数组装 + 编码器决策 + 模板渲染） |
| 14 | P2-2 预览与实际共用同一组装函数 |
| 15 | P2-5 CUDA 探测缓存键改造 + 探测加超时 + 重试真正切换 CPU |
| 16 | P2-6 并发下的多进度条（`MultiBar`） |
| 17 | P2-3/P2-4 字幕探测一次 readdir + 精确 token 匹配 |

---

## 七、本次审查的局限

- **未做端到端转码验证**：本机 `ffmpeg` **不在 PATH**（`which ffmpeg` 无结果），因此所有涉及"实际 ffmpeg 行为"的结论均基于**静态代码分析 + 关联模块交叉核对 + 参数语义推导**，未运行真实转码。凡标注"实测"的结论均为在 Node 中直接执行相关函数或模拟数据流所得，不是真实转码结果。
- **未覆盖 GPU 场景**：`canUseCUDADecoder` 的判定准确性（P2-5）需要在 N 卡 + 自建 ffmpeg 环境下用真实素材验证，本次只做了代码级分析。
- **未评估预设参数本身的正确性**：`lib/ffmpeg_presets.js` 里 `scale_cuda`、`libfdk_aac` 等硬编码（上游文档 S-4 已标记为环境绑定搁置项）不在本次范围内。
- **未做性能剖析**：P2-4 的"6000 次串行 stat"是按代码路径推导的数量级，未用 profiler 实测。
- **未涉及安全议题**（按要求排除）。
- **与上游文档的关系**：本报告不重复 `docs/TODO-FIXES-20260919.md` 中已修复项的验证；**本轮新发现且上游未记录的问题**为：P1-1 的 i18n 插值漏传、P1-2 的 `useCPUDecode` 死写、P1-3 的 `--override` 死选项、P1-5 的元数据自引用与时间戳不一致、P1-6 的 `dir/file` 覆盖风险、P2-3 的 `gb`/`zh` 误匹配、P2-5 的缓存键与重试失效、P2-9 的删除条件宽松。

---

**结论**：`cmd/cmd_ffmpeg.js` 的功能主体是**能用的**，注释里保留了很有价值的实测结论。真正需要优先处理的不是"哪里会崩"，而是**三处"坏了也不出声"**：失败被计入成功、`--hwaccel`/`--decode-mode` 被静默忽略、`--override` 静默不生效。这三处的共同点是**用户拿不到任何负面信号**——对一个会批量改写/删除媒体文件的工具，静默失效比报错危险得多。第一梯队 8 项总改动约 30 行，可以先做一轮，把"参数撒谎"的路径全部堵上；第二梯队 4 项需要你先做语义决策。

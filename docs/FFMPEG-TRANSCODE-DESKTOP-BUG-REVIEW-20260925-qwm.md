# ffmpeg / transcode / desktop 全链路 Bug 审查（2026-09-25）

> QwenWork 产出（qwm）。范围：`cmd/cmd_ffmpeg.js`、`src/transcode/` 全模块、`apps/mediac-desktop` main/renderer/preload。
> 所有发现均经代码通读；标注【实测】的已用真机 ffmpeg 命令复现；标注【已核验】的由本次审查逐行确认。
> 已知遗留（PLANNING 并发重建、#4 进度乱序、#1 删除联动、#2 工具路径、#7 捆绑二进制、#8 resolvePresetPath、#6 staged、#12 状态真源、speed 域矛盾、无 complexFilter 预设 --speed 缺 atempo、probe/real 不同构）不在本文重复展开。

## 一、高风险（数据正确性 / 必现失败）

### B1. 终态后改配置不标 STALE，旧计划的删源确认继续生效【已核验，数据风险】
- `plan.ts:180-186`：`markStale()` 仅在 `READY/STALE` 态转换；执行结束（COMPLETED/FAILED/STOPPED）后 ConfigPanel 的 watch 触发的 `markStale()` 是 no-op。
- `App.vue:182`：`startExecution` 重推演条件 `hasStaged || status==="STALE" || !planSnapshot` 均不满足 → 直接复用旧计划。
- `ffmpeg-service.ts:625-628`：onSummary 按 `executionPlan.argv.deleteSourceConfirmed === true` 删源，argv 冻结在建计划时。
- 触发路径：开删源并确认 → 建计划 → 部分执行成功 → 关掉 deleteSource 开关 → 勾剩余任务再跑 → 新转码成功的源文件仍被移入回收目录，而 UI 显示开关已关。preset/输出目录等改动同理不会触发重推演。

### B2. `--video-copy` 遇需缩放/降帧源必失败【实测复现】
- `ffmpeg_presets.js:443-450`：copy 分支清了 `preset.filters`，但没清 `dimension`/`framerate`。
- `ffmpeg_plan.js:303-304`：`dstScaleNeeded` 只看 `dstDimension` vs 源边长，不感知 copy。
- `ffmpeg_build.js:452-473`：`buildFilterArgs` 条件含 `entry.dstArgs.scaled` 与 `tempPreset.framerate > 0`，与 `["-c:v","copy"]` 同发 → ffmpeg 报 "Filtering and streamcopy cannot be used together"。
- 触发：源任一边 > 预设 dimension（如 4K 源 + hevc_2k）、降帧预设（hevc_2kt）或 `--speed`。

### B3. webm 容器 + 文本字幕硬失败【实测复现】
- `ffmpeg_build.js:390-396`：`isMkv` 用 `extRaw.includes("mkv")` 判定，`.webm` 落入 MP4 分支 → `-c:s mov_text`。
- webm muxer 仅支持 VP8/VP9/AV1 + Vorbis/Opus + WebVTT，实测报 "Only VP8/VP9/AV1 video and Vorbis or Opus audio and WebVTT subtitles are supported"。
- 影响：vp9_2k/vp9_4k 预设处理任何含内嵌文本字幕（或外挂 .srt/.ass）的源全部失败。webm 实为 matroska 子集，应并入 mkv 分支或转 webvtt/-sn。

### B4. 右键"清空任务列表"绕过 busy 守卫【已核验】
- `TaskTable.vue:266-269`：`clearAllTasksFromMenu` 直接 `planStore.setPlan(null)`，无 `isBusy()` 守卫、不清 configStore inputs。
- `plan.ts:170-177`：`setPlan(null)` 把 status 重置 IDLE、清空 excludedPaths。
- RUNNING 中触发：引擎仍在跑，UI 变 IDLE，终止按钮消失（stopExecution 守卫只认 RUNNING/STOPPING），事件全部失配丢弃。与 `App.vue:288-292` 的 `clearAll`（有守卫）不等价。

### B5. `audioCodec:"copy"` 绕过容器兼容检查【实测复现】
- `ffmpeg_build.js:521-528`：copy 直接 `shouldCopy=true`，不像智能 copy 分支调 `isAudioCodecCompatibleWithContainer`。
- 实测 mkv/webm 源带 vorbis 音频跑 audio_extract（输出 m4a）→ "Could not find tag for codec vorbis" 硬失败。

### B6. 窗口 reload/崩溃后无任何状态恢复通道【已核验，main+renderer 双侧确认】
- `ipc-channels.ts:24-37` 无查询主进程执行状态的通道（`ffmpeg-service.getStatus()` 存在但未暴露 IPC）。
- 菜单含无守卫的 `reload`/`forceReload`（main/index.ts:181-182）。运行中 Ctrl+R → 渲染层 IDLE、任务表清空，`updateTaskProgress/Status` 按 taskId 找不到任务静默丢弃；期间无法停止；结束时 session.summary 把空 store 置成 COMPLETED。是 #12 状态真源问题的具体恶化面。

## 二、中风险（流程正确性 / 成功率回退）

### B7. 计划阶段删源发生在最终执行总确认之前【已核验】
- `cmd_ffmpeg.js:562-576` 的 `deleteCompletedSources`（dstExists 任务、独立确认）在 `:627` 的"处理 N 个文件"总确认之前执行。
- 用户对删源答 y、对总确认答 n → 零转码但源文件已被移走（进 .deleted 目录，可恢复但不显而易见）。破坏"最后一问取消 = 零改动"直觉。

### B8. 用户层预设 `extends` 内置预设名被整条丢弃【实测】
- `preset_loader.js:79-105,210-229`：每层 YAML 独立 `processPresets` 后才 merge，用户层 `~/.mediac/presets.yaml` 写 `extends: hevc_2k` → warn "Preset not found" 并丢弃，而文件头注释鼓励用户写用户层预设。

### B9. stopExecution 同步串行 taskkill 阻塞主进程【已核验代码，时耗推算】
- `ffmpeg-service.ts:382-400`：逐 pid `execFileSync("taskkill",…,{timeout:2000})`，串行最坏 8 并发 ≈16s 主进程完全冻结（UI/IPC 全阻塞）；且不给 execa 的 cancelSignal 优雅终止机会。

### B10. 进度事件节流跨任务共享 + 任务栏进度失真【已核验】
- `ffmpeg-service.ts:523,547-549`：单一 `lastProgressTime` 供所有并发任务共享，jobs>1 时部分任务进度被持续丢弃、行卡 0%、overallPercent 失真。
- `:550-552`：`updateTaskbarProgress(event.percent/100)` 把单任务百分比当全局进度，多任务时任务栏来回跳。

### B11. ffargs 码率带单位被静默丢弃 / an、anime 键不可用【实测】
- `ffmpeg_presets.js:305-307`：`--ffargs "vb=233k"` parseValue 返回字符串，`typeof value === "number"` 不满足 → 无提示丢弃（与 `--video-bitrate 233k` 行为不一致）。
- `ffmpeg_presets.js:347-352`：`an`/`anime` 在 ARG_ALIASES 中但 applyFfargs 无对应分支 → "Unknown ffargs key" 丢弃，动漫模式经 ffargs 无法开启。

### B12. 重试链路把 skipped 状态泄漏进执行中任务【机制确定，触发罕见】
- `ffmpeg_engine.js:150-159` + `ffmpeg_result.js:38-46`：`Object.assign(currentTask, preparedTask)` 把重试时 buildCliTask 判定的 `{status:"skipped"}`（SHORT_DURATION/BAD_FORMAT）合并进任务，engine 在 attempt 间不复检 skip；`runFFmpegCmd` 不检查时长/格式照常转码并 ok=true，`toRunResult` 第一优先级取 status → 成功产物被计为 skipped（保守方向，源不删，但计数错）。

### B13. AMD GPU vendor 归一化漏 "AMD Radeon..."【需复核】
- `gpu.js:391-397`：仅匹配 "advanced micro devices"/精确 "amd"/ati；systeminformation 返回 "AMD Radeon Graphics" → 判 other → amf 层永不入场，A 卡用户静默失去硬件编码。需实机确认 systeminformation 返回值。

### B14. 位深对齐 `-pix_fmt` 仅注入 swdec 层【确定代码事实，影响面窄】
- `hwaccel.js:980-987`：注释称 d3d/swdec/cpu 由 `-pix_fmt` 对齐，实际只对 `tierName==="swdec"` 注入。d3d 层 10bit 源 + h264 恒探测失败（多耗一次探测后降级，结果可接受）；cpu 层输出 High 10-bit h264（播放兼容性差）。

## 三、低风险 / 安全边界（记录备查）

- **L1** S-1 授权模型只覆盖 open/show；渲染层被攻破时仍可经 `STAGE_INPUTS`/`PLAN_CREATE` 直透 `deleteSourceFiles`（safeRemove 进回收目录）、`override:true`（commitOutputFile 覆盖任意已存在路径）、自定义工具路径（existsSync 即接受，主进程权限 spawn 任意 exe）。威胁模型内问题，普通用户路径无感。
- **L2** `--error-file <路径>` 用户路径被静默忽略，只识别特殊值 "json"（`ffmpeg_run.js:548-572`）；json 模式 `JSON.stringify(Error)` 为 `{}`，message 丢失。
- **L3** 取消场景 summary 不含 cancelled 计数，分项之和 < total（`cmd_ffmpeg.js:720-724`）。
- **L4** `ffmpeg_task.js:253-262` Dst2 分支疑似死代码且 skip 缺 dstExistsPath/dstExistsSize，会被 badDstTasks 过滤器误报。
- **L5** `buildCliTask` 之外，`srcVideoBitrate = ivideo?.bitrate || fileBitrate - 48*1000 || 0`（`ffmpeg_plan.js:357`）在 fileBitrate=0 时得 -48000 进模板变量；CLI 有码率预检兜底，desktop buildTask 路径无。
- **L6** activePids 陈旧条目：spawn 失败（pid undefined）时 onExit 不删，后续 stop 反复 taskkill 死 pid（被吞，无实害）。
- **L7** 并发 stageInputs 去重竞态 + authorizePaths 并发写同一 .tmp 再 rename（Windows 可能丢一次授权，被吞）；渲染层按 path 去重基本兜住。
- **L8** RUNNING 中可移除任务行 / 右键 removeSelected 无 busy 门禁：引擎仍写盘，用户失去可见性。
- **L9** 复制推演命令：`previewCmd` 由 main 按 `currentPlan.tasks[0]` 生成，替换却以 `planStore.tasks[0]` 为基准，移除过首行后替换失配，复制出的命令指向已移除任务（TaskTable.vue:203-217）。
- **L10** 授权根为盘符根（`c:\`）时 `startsWith(root + path.sep)` 拼成 `c:\\` 前缀匹配失效（path-whitelist.ts:61）。
- **L11** probeCacheKey 不含 quality/bitrate，长驻进程跨批次复用旧探测键（影响有限）。

## 四、检查过且确认无问题的高风险路径

- **失败/跳过/取消不误删源**：`deleteCompletedSources` 只取 `status==="done"`（或计划阶段显式 includeExisting 且 dstExistsSize>0），删除前再 stat 输出且 size>0；safeRemove 失败进 failed 列表。
- **临时文件生命周期**：执行前 remove + activeTempFiles 注册 + 信号钩子 + finally 兜底；崩溃残留仅剩强杀进程一种情形。
- **目标已存在 / -n 判定**：三重检查 + fs.move 目标存在时 reject（实测），不覆盖他人产物；override 有 backup+回滚。
- **同源重复输入**：扫描与 filterAndSliceEntries 双重按 path 去重。
- **桌面端已知修复全部验证在位**：task.done 失败标记、summary.failed 数字判定、onSummary 兜底、S-1 authorizedRoots、S-2 tempPath 校验、菜单动作状态守卫、时长加权进度、选择解耦、deleteSourceConfirmed 绑定（但被 B1 架空）、RUNNING 占位/abortController 前置、部分执行子集判态、空选补发 session.summary、CPU 重试参数（maxAttempts:2 + prepareAttempt decodeMode:"cpu" 在 ffmpeg-service.ts:585-608，审查初判漏传系误报，已排除）。
- **码率单位换算**：全程 bps→K 一致；YAML 码率字符串归一（1000 进制）正确。
- **输出命名**：模板变量、无双扩展名、DstExists 跳过与 override 备份回滚正确。

## 五、修复优先级建议

1. **B1 + B4**（删源误删 + 清空脱钩）：一行守卫级修复，数据风险，优先。
2. **B2 + B3 + B5**（copy 与滤镜/容器冲突）：转码必败/产物错误，涉及 build/plan 两处判定。
3. **B6**：暴露 getStatus IPC + onMounted 恢复，缓解 #12。
4. **B7**：把 dstExists 删源挪到总确认之后。
5. 其余按 B8→B14、L 系列排期。

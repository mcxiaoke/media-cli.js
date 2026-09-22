# FFmpeg CLI 参数体系 —— 定稿（极简追加模型）

> **版本**: 2026-09-22（定稿，采纳实施）
> **状态**: 已确认，进入实施
> **取代**: `docs/ffmpeg/ffmpeg-cli-params-design.md`（v1，实施验证通过后删除）
> **适用命令**: `cmd/cmd_ffmpeg.js`（`mediac ffmpeg` / `transcode` / `aconv` / `vconv` / `avconv`）
> **定位约束**: 本命令**只做视频压制**——音视频转码、压缩、调优、缩放、fps/speed 调整；**不做**裁切、seek、编辑、变换、叠加、字幕特效等复杂工作。

---

## 0. 决策摘要（为什么是"极简追加"）

v1 设计了 `--arg "@bucket ..."` 六段位置标记 + 编码器族差异化。评审与代码核对后判定：**该抽象对"压制"定位过重**，且实现只接了 `@input/@global` 两桶，其余静默失效——把"参数撒谎"从 `--ffargs` 搬到了更隐蔽的 `@` 语法。

**定稿改为**：

1. **整体删除 `--arg` 机制**（六桶 + `@global` + `@input` + 位置/族键解析），连死代码一起移除——"半接线静默失效"这一类 bug 从根上消失。
2. **`--video-args` / `--audio-args` / `--filters` 由"整体替换"改为"追加"**：追加到各自命令段末尾，用户参数排在预设/分层参数之后，靠 ffmpeg"后写覆盖"天然获得最高优先级；不再冲掉 `{scaleFilter}`（`--filters` 改追加到后滤镜段）。
3. **新增独立 `--metadata "k=v;k=v"`**：专用通道，按 `;` 切分、`=` 取键、值**原样保留空格**（不走过白空格再拆分的坑），追加在自动 `-metadata` 之后以覆盖自动 title。
4. **RESERVED 契约参数硬报错、绝不静默丢弃**：`--video-args` 里出现 `-c:v`（编码器由分层/预设决定）→ plan 阶段直接报错，引导用 `--video-codec` / `--ffargs vc=`。
5. **编码器专属参数告警**：追加串里出现"仅某编码器认"的 token（`-tune/-spatial_aq/-global_quality/-cq/-rc/-qp_i/-extbrc/...`）且处于 `auto` 分层时 **warn**：其它层可能不识别，导致真实编码报错或被重试逻辑静默拽回 CPU。用户仍要加则"自己加自己负责"（报错会同时进 console 与日志）。
6. **删除 `presets/default.yaml` 的 `streaming_1080p`**（上一位新增；其 `-tune zerolatency` 为 libx264 专属，会在 GPU 层炸）。

**不做**（明确排除，避免范围回潮）：`@global`、`@input`、`-ss/-t/-to`（seek/trim）、任意 `-map`、按编码器族分槽、preset 的 `videoArgsByFamily`。这些对"压制"要么越界、要么收益不抵复杂度。

---

## 1. 最终用户参数面

### 1.1 基础层（90% 用户，零学习成本）

- `--preset <name>`：选预设（编码器/质量/缩放/分层全托管）。
- `--ffargs "vb=..;vq=..;fps=..;dm=..;sp=..;ab=..;aq=..;ac=..;md=k=v"`：基础质量/码率/元数据。
  - ⚠️ **分隔符是 `;`（或 `:`/`#`），不是逗号**——`arg_parser` 的真实契约；逗号会被吞进前一个值导致整体失效。v1 通篇逗号示例作废。
- 单项覆盖：`--video-bitrate/-quality/-codec/-copy`、`--audio-bitrate/-quality/-copy`、`--dimension`、`--fps`、`--speed`。

### 1.2 高级层（追加，自负其责）

| 选项 | 追加落点 | 语义变更 | 典型用途 |
| --- | --- | --- | --- |
| `--video-args "..."` | 视频编码器块之后 | 替换→**追加** | `-tune`/`-g`/`-bf`/`-pix_fmt`/码控微调 |
| `--audio-args "..."` | 音频块之后 | 替换→**追加** | `-ar`/`-ac`/响度 |
| `--filters "..."` | `-vf` 滤镜链**末尾**（缩放后） | 替换→**追加**，保留 `{scaleFilter}` | 锐化/deband/降噪等后处理 |
| `--metadata "k=v;k=v"` | 输出前 `-metadata`（自动项之后） | **新增** | title/comment/artist 等 |
| `--filter-complex "..."` | `-filter_complex` | 不变（整体替换，高级逃生舱） | 复杂滤镜图（越界，自负） |

**约定**：追加串一律按空白拆分为 token 数组；值含空格的场景（如带空格的 `-metadata`）**必须走 `--metadata`**，不要塞进 `--video-args/--audio-args`（那里不保证带引号的空格取值）。追加串**不经过 `formatArgs` 模板替换**（避免与 `%k%/{k}/@k@/!k!` 占位符语法冲突）。

> **⚠️ 命令行写法（yargs 约束）**：`--video-args` / `--audio-args` / `--filters` 的值以 `-` 开头（如 `-tune film`），**必须用等号形式** `--video-args="-tune film"`，**不能**用空格形式 `--video-args "-tune film"`——后者会被 yargs 当成新选项吞掉、参数值变空。`--metadata "title=X"` 的值不以 `-` 开头，空格/等号皆可。

### 1.3 移除项

- `--arg`（含 `-a` 别名）与 `@input/@output/@video/@audio/@filter/@global` 全部下线。
- `ffmpeg_args_known.js` 的 `parseArgOptions/validateArgMarker/VALID_ARG_MARKERS/VALID_TIER_NAMES` 删除。
- `lib/ffmpeg_build.js` 中读取 `argOptions.global` / `argOptions.input` 的两段移除。

---

## 2. 合并与优先级规则

统一装配顺序（`createFFmpegArgs`）不变，逐段追加用户参数：

```
[ -hide_banner -n -v <lvl> -progress - -nostats ]        # 契约项，用户不可注入
[ preset.inputArgs ]  -i <in> [ 字幕 -i/-map ]
[ -vf:  pre → setpts → scale → fps → post(含 --filters 追加) ]
[ 视频编码器块(tier) ++ preset.videoArgs ++ user --video-args ]
[ 音频块(preset.audioArgs, copy/降级)   ++ user --audio-args ]
[ -metadata 自动(desc/copyright/title)  ++ user --metadata ]
[ preset.streamArgs ++ preset.outputArgs ]  <fileDstTemp>
```

优先级（低→高）：**预设默认 < `--ffargs` < 单项命令行 < `--video-args/--audio-args/--filters/--metadata`（追加，末位胜出）**。

- RESERVED：`-c:v` 出现在 `--video-args` → **报错**。编码器由分层/preset 决定，直塞会造"CPU 滤镜 + GPU 编码器"畸形组合（v1 §3.1 根因）。
- `-c:a` 出现在 `--audio-args`：不硬禁（音频不分层，末位 `-c:a` 天然覆盖，可用），但引导用 `--ffargs ac=`。
- 其它契约项（`-n/-y/-v/-hide_banner/-progress/-hwaccel*`）不会出现在 video/audio/filter 追加槽（位置不同），无需逐一拦截。

---

## 3. 实施变更点清单（file / function 级）

| # | 文件 | 位置 | 变更 |
| --- | --- | --- | --- |
| 1 | `cmd/cmd_ffmpeg.js` | builder | 删除 `.option("arg", {...})`；新增 `.option("metadata", {type:"string"})` |
| 2 | `cmd/cmd_ffmpeg.js` | `planFFmpegTasks` 校验段 | 加 RESERVED：`--video-args` 含 `-c:v` → `createError(INVALID_ARGUMENT)`；加编码器专属 warn（见 §4） |
| 3 | `lib/ffmpeg_presets.js` | 顶部 import | 去掉 `parseArgOptions` |
| 4 | `lib/ffmpeg_presets.js` | `createFromArgv` | `--video-args`→`userArgs.videoExtra`（不再覆盖 preset.videoArgs）；`--audio-args`→`userArgs.audioExtra`（不再覆盖 preset.audioArgs）；`--filters`→追加进 `preset.post_filters`；解析 `argv.metadata`→`userArgs.metadataPairs`；删除 `argv.arg` 与旧 metadata→argOptions 两段 |
| 5 | `lib/ffmpeg_presets.js` | `applyFfargs` | `metadata` 合并分隔符 `,`→`;` |
| 6 | `lib/ffmpeg_build.js` | `buildInputArgs` | 删除 `argOptions.global`、`argOptions.input` 两段 |
| 7 | `lib/ffmpeg_build.js` | `buildVideoArgsFromPlan` | 返回 `[...encArgs, ...baseExtra, ...splitArgs(videoExtra)]` |
| 8 | `lib/ffmpeg_build.js` | `buildAudioArgs` | 追加 `splitArgs(userArgs.audioExtra)` |
| 9 | `lib/ffmpeg_build.js` | `buildMetaArgs` | 自动项后追加 `userArgs.metadataPairs` |
| 10 | `lib/ffmpeg_args_known.js` | 文件 | 删 `parseArgOptions/validateArgMarker/VALID_*`；`KNOWN_FFMPEG_ARGS` 保留作未知词参考；新增导出 `ENCODER_SPECIFIC_ARGS` |
| 11 | `lib/i18n.js` | `ffmpeg.*` | 新增 `ffmpeg.metadata`、`ffmpeg.error.videoArgsCodec`、`ffmpeg.warn.encoderSpecific`；`ffmpeg.video.args/audio.args/filters` 描述改"追加"语义 |
| 12 | `presets/default.yaml` | `streaming_1080p` | 删除该预设块 |
| 13 | `test/*` | 新增 `test_ffmpeg_params_v2.js` | 覆盖 §5 |
| 14 | `cmd/cmd_ffmpeg.js` | builder | 启用 `.strictOptions()`（未知/拼错选项报错）+ 显式 `.positional("input")`（避免合法位置参数被误判未知）；详见 §8.3 |

辅助：新增纯函数 `splitArgs(str) = String(str).trim().split(/\s+/).filter(Boolean)`（build 内部），用户追加串不跑 `formatArgs`。

---

## 4. 编码器专属 warn 细节

- 词表 `ENCODER_SPECIFIC_ARGS`（仅用于启发式告警，非穷举）：`-tune -spatial_aq -temporal_aq -global_quality -cq -qp -qp_i -qp_p -constqp -cbr -rc -rc_lookahead -extbrc -look_ahead -b_ref_mode -surfaces -weighted_pred -quality -vbaq -preset`（`-preset` 三家都存在但取值域不同，仍纳入告警）。
- 触发：`--video-args` 命中任一 token **且** `decodeMode==="auto"` **且** 预设 `type==="video"`。
- 动作：`logWarn`，列出命中的 token，说明"其它编码器层可能不识别，导致真实编码报错或经重试降级到 CPU"。**不阻断**。
- 位置：plan 阶段一次（不逐文件刷屏）。

---

## 5. 测试计划（`node --test`）

`test/test_ffmpeg_params_v2.js`：

1. **metadata 解析+落位**：`createFromArgv({preset, metadata:"title=My Video;artist=A B"})` → `userArgs.metadataPairs` 正确；`createFFmpegArgs` 的 args 中出现 `-metadata title=My Video`（值含空格、未被拆）且位于自动 `title=` 之后。
2. **video-args 追加**：`buildVideoArgsFromPlan` 带 `userArgs.videoExtra="-tune film -g 60"` → 数组尾部含 `-tune film -g 60`，编码器块在前。
3. **audio-args 追加**：经 `createFFmpegArgs` 断言 `-c:a` 块后追加用户 token。
4. **filters 追加保 scale**：预设 `{scaleFilter}` + `--filters "unsharp=3"` → `buildScaleFiltersFromPlan` 结果同时含 `scale_cuda=`/`scale=` 与尾部 `,unsharp=3`，且不泄漏 `{scaleFilter}`。
5. **video-args 不再覆盖 preset.videoArgs**：`createFromArgv` 带 `--video-args` 时 `preset.videoArgs` 维持基类值，用户串在 `userArgs.videoExtra`。
6. **不回归**：既有 `test_ffmpeg_build_filters.js`、`test_ffmpeg_t4_forced_encoder.js` 全绿；`test_default_presets.js` 维持其既有状态（3 项预设计数失败为历史遗留，非本次引入，不改动）。

---

## 6. 兼容性

- `--ffargs` 白名单不变（仅修正文档分隔符）。
- `--video-args/--audio-args/--filters`：**行为变更（替换→追加）**。依赖"整体替换"语义的旧脚本需自查；对绝大多数只用于"加几个调优 flag"的用法，追加是超集且更安全。`--audio-args "-c:a copy"` 这类仍可用（末位覆盖）。
- `--arg`：直接移除（本就大部分失效，无实质依赖面）。
- `streaming_1080p` 移除：`--preset` choices 少一项；无预设继承它。
- preset `videoArgs`（硬件无关槽）保留原样（`buildVideoArgsFromPlan` 仍把它作为 base extra 追加，无 `-c:v` 时）。

---

## 7. 风险与对策

- **追加导致重复选项**：ffmpeg"后写覆盖"保证用户胜，符合直觉；仅当编码器/参数不兼容时报错——由 RESERVED + warn 兜住大部分，其余"自负其责"（错误进 console+日志）。
- **`--filters` 追加到 post，放不了 pre（如 yadif 反交错宜在缩放前）**：本期接受此限制（压制主流后处理在 post）；确需 pre 用 `--filter-complex` 或改预设。文档标注。
- **含空格取值**：只 `--metadata` 保证；`--video/audio-args` 明确不支持带空格值（引导用 `--metadata`）。
- **auto 下 CPU 静默降级**：warn 已提示；真实编码报错会被既有重试链捕获，用户能从日志看到层与命令。

---

## 8. yargs 参数写法规范（实测固化）

本项目用 yargs v17。以下规则均经实测（同一 yargs 复现），是"追加通道怎么用才不出错"的硬约束。

### 8.1 值以 `-` 开头的选项，必须用 `=` 形式

| 写法 | 解析到的值 | 结果 |
| --- | --- | --- |
| `--video-args "-tune film"`（空格，值以 `-` 开头） | `""` 空 | ❌ 值被吞 |
| `--video-args="-tune film"`（等号） | `"-tune film"` | ✅ |
| `--metadata "title=My Video"`（值不以 `-` 开头） | `"title=My Video"` | ✅ |
| `--video-args "foo"`（值不以 `-` 开头） | `"foo"` | ✅ |

**根因**：yargs 判断"一个 token 是值还是新选项"看它是否以 `-` 开头。空格分隔时若值以 `-` 开头，会被当成新选项解析，前面的选项拿到空值。`=` 右侧整段按字面绑定，跳过该判断。

**推论**：`--video-args` / `--audio-args` / `--filters` 的值都是 ffmpeg 参数（`-tune`/`-c:v`/`-ar`… 必以 `-` 开头）→ **一律用 `--opt="-xxx yyy"`**。`--metadata` 值是 `key=value`（不以 `-` 开头）→ 空格/等号皆可。偷懒统一规则：**所有带值选项一律写 `--opt=value`** 最安全。

### 8.2 单横线 vs 双横线

`-` 和 `--` **都算选项**，区别在名字解析：

- `--xxx`：长选项，`xxx` 整体是名字（`--video-args`）。
- `-x`：短选项（单字母别名）。
- `-xxx`（单横线+多字母）：被当作**短选项聚簇逐字母拆开**——实测 `-preset hevc` 炸成 `{p,r,e,s,t…}`，`hevc` 挂到最后一个字母。所以**别用单横线写长名**。
- `-abc`（多个已定义短选项）：合法聚簇，等价 `-a -b -c`。

### 8.3 未知 / 拼错选项：ffmpeg 命令已启用 `.strictOptions()`

- 之前（未开 strict）：`--tune`、拼错的 `--vide-args` 会被 yargs **静默收进 argv 再忽略**——既不报错也不转发给 ffmpeg，属"参数撒谎"。
- 现在：`cmd/cmd_ffmpeg.js` 的 builder 启用 `.strictOptions()`，未知/拼错选项**直接报错退出**：
  - `mediac ffmpeg in --tune film` → `Unknown argument: tune`（应放进 `--video-args="-tune film"`）。
  - `mediac ffmpeg in --vide-args x` → `Unknown arguments: vide-args, videArgs`（拼错被发现）。
- **选 `strictOptions` 而非 `strict`**：只约束"选项"，**放过多余位置参数**，避免误伤 `dcim <input...>` 这类多参数命令、以及将来可能的多目录传参。
- **代价**：`strictOptions` 会把"命令串位置参数"也当未知，故 ffmpeg builder 里已**显式声明 `.positional("input")`**（否则合法调用会误报 `Unknown argument: input`）。此约束**仅加在 ffmpeg 命令**，其它子命令维持原状（需要时按同样"声明 positional + builder 内 strictOptions"两步扩展）。
- **原则**：mediac 没有"把未知参数透传给 ffmpeg"的机制；一切 ffmpeg 参数只能通过 `--video-args` / `--audio-args` / `--filters` / `--metadata` 这几条**已声明的追加通道**进入。

---

_本文件为 `cmd/cmd_ffmpeg.js` CLI 参数体系的实施依据；与 `lib/ffmpeg_build.js`、`lib/ffmpeg_presets.js`、`lib/hwaccel.js` 的 S-4 分层架构保持一致。v1 文档在实施验证通过后删除。_

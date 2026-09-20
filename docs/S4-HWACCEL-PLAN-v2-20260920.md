# S-4 硬件加速环境绑定 —— 实施方案 v2

> 创建：2026-09-20（v2 依用户当日反馈修订）
> 前版：`docs/S-4-HWACCEL-PLAN-20260920.md`（v1，保留备查）
> 对应问题：`docs/TODO-FIXES-20260919.md` T-15 / S-4
> 本机环境：Windows 10 + RTX 4070（驱动 610.47）+ Intel UHD 750 + 自建 ffmpeg `N-125246-g9420146e6-2026-06-23-nonfree-shared`（`C:\Home\Apps\ffmpeg\bin`）
> 官方依据：`temp/hwaccelintro-ffmpeg.md`（FFmpeg HWAccelIntro 官方 wiki，用户提供）

---

## 一、先更正 v1 的两处错误结论

### 更正 1：vulkan **是**官方支持的（我 v1 说错了）

官方 API 表（`temp/hwaccelintro-ffmpeg.md:65`）明确：

```
| Vulkan | Y | Y | Y | Y | Y | Y | N | N | N | N |
           ↑ Linux AMD/Intel/NVIDIA    ↑ Windows AMD/Intel/NVIDIA
```

官方 Vulkan 章节（`:171-175`）：*"Vulkan video decoding is a new specification for vendor-generic hardware accelerated video decoding. Currently supported: Decoding H.264, HEVC, AV1."*

**所以"Vulkan 解码"是官方跨厂商能力，我 v1 说"官方构建普遍不含"是错的。**

我说错的那半截其实只对**编码器**成立 —— 官方表（`:93`）Vulkan 行是：

```
| Vulkan | Y | - | Y | N | N | Y | Y | Y |
                        ↑ Encoder Standalone = N（未实现）
```

不过这里有个新发现：**本机构建实际带有 `h264_vulkan`/`hevc_vulkan`/`av1_vulkan`，而且真能编码**（实测产出 216637 字节文件，rc=0）。说明官方表这一格已滞后于主干。结论修正为：**vulkan 编码能力取决于构建，不可移植；vulkan 解码是官方能力，可移植。**

**但在 Windows 上 vulkan 解码与 d3d11va 能力高度重叠**，放进默认链收益很低（你给的链里也没有它）。故定位不变：**仅显式 `--hwaccel vulkan` 时启用**，理由从"官方不支持"改为"Windows 上与 d3d 重叠、且编码侧不可移植"。

### 更正 2：`canUseCUDADecoder` **确实是**真实解码探测（我 v1 用词过重）

你说得对。它真的 fork 了 ffmpeg 去解码（`cmd/cmd_ffmpeg.js:1962-1984`），不是"假探测"。我 v1 称"假探测"不准确，撤回该措辞。

**真正的问题是两点**（下面第二节精确说明）：探测范围与真实命令范围不一致 + 失败判定只匹配两个错误串。

---

## 二、精确缺陷

### 2.1 官方文档给出的关键语义

`temp/hwaccelintro-ffmpeg.md:104` 原文：

> Internal hwaccel decoders are enabled via the `-hwaccel` option. The software decoder starts normally, but if it detects a stream which is decodable in hardware then it will attempt to delegate all significant processing to that hardware. **If the stream is not decodable in hardware (for example, it is an unsupported codec or profile) then it will still be decoded in software automatically.**
>
> External wrapper decoders are used by setting a specific decoder with `-codec:v` (e.g. `h264_cuvid`). These decoders require the codec to be known in advance, and **do not support any fallback to software**.

即：`-hwaccel cuda` 属 **internal hwaccel，设计上就会静默回落软解**；`-c:v h264_cuvid` 属 **external wrapper，不回落**。

**这解释了为什么"仅解码探测"恒为成功**：素材没有硬解能力时，ffmpeg 用软解把它解出来了，退出码 0、stderr 为空。

### 2.2 缺陷一：探测范围 ≠ 实际命令范围

| | 探测命令（现状） | 实际命令 |
| --- | --- | --- |
| 解码 | `-hwaccel cuda -hwaccel_output_format cuda` | 同 |
| 滤镜链 | **无** | `scale_cuda=...,format=cuda` |
| 编码器 | **无** | `-c:v h264_nvenc -cq 24` |

探测只覆盖解码，实际命令覆盖「解码 + 滤镜 + 编码」。当素材无硬解时，探测在软解路径上成功，但实际命令里 `scale_cuda` 只吃 CUDA 帧、拿不到软解帧 → 失败。

**实测不一致矩阵**（探测判定 vs 真实命令，本机真实执行）：

| 文件 | 现有探测判定 | 真实命令 | 是否一致 |
| --- | --- | --- | --- |
| h264_8.mp4 | true | OK | 一致 |
| h265_10.mkv | true | OK | 一致 |
| mpeg4.avi | true | OK | 一致 |
| h264_10.mp4 | false | FAIL | 一致 |
| h264_444.mp4 | false | FAIL | 一致 |
| h264_422.mp4 | false | FAIL | 一致 |
| **ffv1.mkv** | **true** | **FAIL** | **不一致** |

**最小复现**：

```bash
# 探测：rc=0，stderr 为空 → 现有逻辑判 canUse=true
ffmpeg -v error -hwaccel cuda -hwaccel_output_format cuda -i ffv1.mkv -frames:v 1 -f null -
# → rc=0

# 真实命令：rc=127
ffmpeg -v error -hwaccel cuda -hwaccel_output_format cuda -i ffv1.mkv \
  -vf "scale_cuda=w=1920:h=1920:force_original_aspect_ratio=decrease:interp_algo=lanczos,format=cuda" \
  -c:v h264_nvenc -cq 24 -frames:v 1 -f null -
# → rc=127  Impossible to convert between the formats supported by the filter ...
```

verbose 证据（ffv1 走了软解，但探测看不出来）：

```
Stream #0:0 -> #0:0 (ffv1 (native) -> wrapped_avframe (native))
```

### 2.3 缺陷二：失败判定只匹配两个错误串

```js
canUse = !(stderr.includes("CUDA_ERROR_INVALID_VALUE") ||
           stderr.includes("Failed setup for format cuda"))
```

任何**其它**错误串都算"可用"。上表里 h264_444/h264_422 碰巧命中 `Failed setup for format cuda` 才判对；ffv1 因为 stderr 为空直接漏过。

### 2.4 结论：修法只有一个方向

**把探测命令改成"与真实命令同构"**（同解码器 + 同滤镜链 + 同编码器），此后**只看退出码**即可，无需解析 stderr。

实测验证（把探测换成完整链后）：

| 文件 | 旧探测（仅解码） | 真实命令 | 修正探测（完整链） |
| --- | --- | --- | --- |
| h264_8.mp4 | OK | OK | OK |
| h265_10.mkv | OK | OK | OK |
| mpeg4.avi | OK | OK | OK |
| ffv1.mkv | **OK** | FAIL | **FAIL** ✅ |
| h264_10.mp4 | OK→判false | FAIL | FAIL ✅ |

**修正后 5/5 全部一致**（含 ffv1）。

---

## 三、实测证据矩阵（设计依据）

### 3.1 四层优先级链路（按你的新顺序）

| 层 | 链路 | h264_8 | h265_10 | h264_10 | mpeg4 | ffv1 |
| --- | --- | --- | --- | --- | --- | --- |
| **1-cuda** | `-hwaccel cuda -hwaccel_output_format cuda` + `scale_cuda` + `h264_nvenc`/`hevc_nvenc` | ✅ | ✅ | — | — | ❌ |
| **1-qsv** | `-hwaccel qsv -hwaccel_output_format qsv` + `scale_qsv` + `h264_qsv` | ✅ | — | — | — | — |
| **2-d3d** | `-hwaccel d3d11va` + CPU `scale=` + nvenc | ✅ | ✅ | ✅ | ❌ | ❌ |
| **2-d3d 零拷贝** | `-hwaccel d3d11va -hwaccel_output_format d3d11` + nvenc（无滤镜） | ✅ | ✅ | ✅ | — | — |
| **3-hwauto** | `-hwaccel auto` + CPU `scale=` + nvenc | ✅ | — | — | ✅ | — |
| **4-cpu** | 无 hwaccel + `scale=` + `libx264` | ✅ | — | ✅ | ✅ | — |

### 3.2 滤镜链约束（关键实现细节）

| 事实 | 实测 | 含义 |
| --- | --- | --- |
| `scale_d3d11` **不可用** | `Could not create the texture (80070057)` / `Unsupported pixel format: (null)`，rc=171/127 | **d3d 层必须用 CPU `scale=`**，不能照搬 `scale_cuda` 的写法 |
| `scale_d3d11` 参数名是 `width/height` | `-h filter=scale_d3d11` → AVOptions: width/height/format | 不是 `w/h`（写 `w=` 会 `Option not found`，rc=8） |
| qsv 必须配 `scale_qsv` | `-hwaccel qsv` + CPU `scale=` → rc=127；改 `-hwaccel_output_format qsv` + `scale_qsv` → rc=0 | qsv 层不能混 CPU 滤镜 |
| cuda 软解时必须 `hwupload_cuda` | `-hwaccel auto` + `scale_cuda` → rc=127；加 `hwupload_cuda` 前缀 → rc=0 | 现有 `cmd_ffmpeg.js:1739` 的补救方向正确 |
| d3d 可零拷贝给 nvenc | `-hwaccel d3d11va -hwaccel_output_format d3d11 -c:v hevc_nvenc` → rc=0 | 官方文档 `:257` "NVENC can accept d3d11 frames context directly" |

### 3.3 10bit 源的编码器约束（顺带发现）

```
h265_10.mkv + h264_nvenc  → rc=127  "Provided device doesn't support required NVENC features"
h265_10.mkv + hevc_nvenc  → rc=0
h265_10.mkv + scale_cuda + 强制 yuv420p → h264_nvenc rc=0
```

**h264 预设（h264_2k 等）遇到 10bit 源会失败**。这不是 S-4 独有问题，但"探测=真实命令"的设计天然会捕获它并触发降级 —— 又一个支持该设计的理由。

### 3.4 vulkan（更正后的准确描述）

| 能力 | 官方状态 | 本机实测 |
| --- | --- | --- |
| vulkan 解码 H.264/HEVC/AV1 | Windows/Linux/Android 全厂商 **Y** | ✅ h264_8 / h265_10 均 rc=0 |
| vulkan 滤镜 `scale_vulkan` | Filtering **Y** | ✅ h264_8 / h265_10 均 rc=0 |
| vulkan 编码器 | Encoder Standalone **N** | ⚠️ 本构建**有且可用**（产出 216637 字节） |
| vulkan 帧直喂 nvenc | — | ❌ rc=127（无互操作，需 `hwdownload` 中转） |
| vulkan 解码 + `hwdownload` + CPU scale + nvenc | — | ✅ rc=0 |

### 3.5 音频（按你的决策：自动换 native aac + warning）

```
libfdk_aac -profile:a aac_he -vbr 1 -b:a 48k  → rc=0        （当前硬编码用法）
native aac  -b:a 128k                          → rc=0        （LC/CBR 可用）
native aac  -profile:a aac_he                  → rc=127 "Profile not supported!"
native aac  -vbr 2                             → rc=0 但**静默忽略**
    warning: Codec AVOption vbr ... has not been used for any stream
    产物大小与不加 -vbr 完全一致（9983 bytes）→ 必须在脚本层替换，不能指望 ffmpeg 报错
```

### 3.6 现有 CPU 重试机制（你指出已有，已核实）

`cmd/cmd_ffmpeg.js:609-628`：

```js
let failedTasks = results.filter((r) => r && r.ffmpegFailed && !r.retryOnFailed)
if (failedTasks.length > 0) {
    const answer = await confirmDangerousAction(t("ffmpeg.confirm.retry", { count: ... }))
    if (answer) {
        for (const ft of failedTasks) {
            let newFT = core.omit(ft, "ffmpegArgs", "info")
            newFT.argv.decodeMode = "cpu"      // ← 切 CPU
            newFT.retryOnFailed = true
            ...
        }
    }
}
```

**已具备"单文件失败 → 切 CPU 重试"能力，但目前需要用户交互确认。** 你的决策是"单文件失败后继续"，所以本方案只需把这条链路与新分层对接（见 4.6），不必新建机制。

---

## 四、目标设计（已采纳你的四项决策）

### 4.1 优先级链（按你的新顺序）

你确认的顺序：**`[cuda, qsv, amf]` 三选一 → `d3d` → `hwauto` → `cpu`**

```
Tier 1  厂商专属硬解硬编（三选一，按检测到的显卡厂商命中）
        ├─ cuda : -hwaccel cuda -hwaccel_output_format cuda
        │         + scale_cuda + h264_nvenc / hevc_nvenc
        ├─ qsv  : -hwaccel qsv -hwaccel_output_format qsv
        │         + scale_qsv + h264_qsv / hevc_qsv
        └─ amf  : d3d11va 解码 + scale(CPU) + h264_amf / hevc_amf
                  （官方文档 :353：Windows 上 AMD 解码走 DXVA2/D3D11VA，
                    VCE 编码走 AMF；本机无 A 卡，此路径未实测，见 8.2）

Tier 2  d3d（Windows 通用兜底，你强调"肯定可用"）
        -hwaccel d3d11va（+ 可选 -hwaccel_output_format d3d11 零拷贝）
        + CPU scale=（scale_d3d11 实测不可用，见 3.2）
        + 任意硬件编码器（nvenc/qsv/amf 均可，官方文档 :257 确认 NVENC 直吃 d3d11 帧）

Tier 3  hwauto（现有脚本已在用，混合模式）
        -hwaccel auto + CPU scale= + 硬件编码器
        Windows 上 auto 实测落在 dxva2（D3D9Ex），编码器仍是 nvenc → 确为"混合解码编码"

Tier 4  cpu（最终兜底）
        无 hwaccel + scale= + libx264 / libx265
```

**关键说明**：

- **Tier 1 是"三选一"而非串行探测**。一般一台机器只有一块独显，按厂商命中即可，不必逐个试。探测到 NVIDIA 就只试 cuda，探测到 Intel 就只试 qsv。
- 但**探测仍要实际干跑**：厂商对了不等于该素材可硬解（10bit H.264、4:4:4、ffv1 都是反例）。
- **Tier 2 的 d3d 是真正的"万能兜底"**：实测 `d3d11va` 对 h264/h265/10bit 全部可用，且跨厂商（N/A/I 三家在 Windows 上都支持 D3D11）。这正是你强调它"肯定可用"的原因。
- **Tier 3 保留 hwauto 现状**：虽然它是混合模式，但作为"d3d 也失败时"的过渡层仍有价值（实测对 mpeg4 这类 d3d 层失败的素材，hwauto 反而 rc=0）。
- **vulkan 不在链上**，仅显式指定时启用（见 3.4 与更正 1）。

> ⚠️ 与你上一轮记忆中的 `cuda → qsv → amf → vaapi → cpu` 相比，本版有两处变化：① `amf` 从串行位改为与 cuda/qsv 并列；② 插入 `d3d` 与 `hwauto` 两层；③ 去掉 `vaapi`（Windows 不适用，实测失败）。以你本次明确指令为准。

### 4.2 三层抽象与"同厂商"约束

```
device  层：-hwaccel / -hwaccel_output_format / -init_hw_device
decoder 层：显式解码器名，或交给 -hwaccel 自选
filter  层：scale_cuda / scale_qsv / scale_vulkan / scale(CPU)
```

**硬约束（全部实测得出）**：

| 约束 | 证据 |
| --- | --- |
| filter 层必须与 device 层同厂商 | qsv + CPU `scale=` → rc=127；改 `scale_qsv` → rc=0 |
| d3d 层**只能**配 CPU `scale=` | `scale_d3d11` 实测 rc=171/127（纹理创建 80070057） |
| 软解 + `_cuda` 滤镜必须 `hwupload_cuda` | 无前缀 rc=127；加前缀 rc=0 |
| 跨 API 帧不互通 | vulkan 帧直喂 nvenc rc=127，需 `hwdownload` 中转 |
| 编码器对位深有要求 | h265_10 + h264_nvenc rc=127；+ hevc_nvenc rc=0 |

### 4.3 核心修法：探测命令与真实命令同构

这是整个方案的支点。**探测不再是"另写一条简化命令"，而是"把即将执行的命令原样跑 1 帧、输出到 null"。**

```js
// 伪代码：探测即干跑
async function probePlan(plan, inputPath) {
    const args = buildArgs(plan, inputPath, { dryRun: true })
    // dryRun 只改两处：-frames:v 1（或 -t 0.1）、输出改为 -f null -
    const { exitCode } = await execa(ffmpegPath, args, { reject: false })
    return exitCode === 0
}

// buildArgs 是真实执行时用的同一个函数 —— 同构的保证
```

**收益**：

1. 一致性 100% 保证（同一个 builder，不可能不一致）。
2. 不再需要解析 stderr 关键字（实测证明不可靠，见 2.3）。
3. 天然覆盖"编码器不支持该位深"这类隐患（见 3.3）。
4. 探测开销可接受：实测约 **340ms/次**（真实链干跑）。

**代价与缓解**：每个 (素材编码, 位深, 目标档位) 组合都要干跑一次。用缓存 + 组合去重控制（见 4.4）。

### 4.4 三级缓存

```
key = `${tier}|${srcCodec}|${bitDepth}|${pixFmt}|${dimProfile}`
```

- **不按文件路径缓存**（现状按 `inputPath`，1000 个文件 = 1000 次探测，且同编码重复）。
- 典型目录 3~5 种编码组合 → 探测总开销约 1~2 秒，可接受。
- 进程内 `Map` 即可，无需落盘。
- 设备级/编码器级另设一次性缓存（`-encoders` 仅 83ms，`-init_hw_device` 约 210ms）。

### 4.5 模式语义

| 模式 | CLI | 行为 |
| --- | --- | --- |
| **auto**（默认） | `--decode-mode auto` | 按 4.1 链逐层探测；某层失败→下一层；**全部失败→Tier 4 CPU**，日志标注实际层级与降级原因 |
| **gpu**（手动） | `--decode-mode gpu --hwaccel cuda` | **只用指定层**。失败即报错（非 0 退出码），错误含：请求层、素材信息、失败原因、建议 |
| **cpu** | `--decode-mode cpu` | 直接 Tier 4，不探测 |

**手动模式必须硬失败**（你需求②）。实测依据：显式解码器具备硬失败语义。

```bash
ffmpeg -c:v h264_cuvid -i h264_10.mp4 ...  → rc=127  Bit depth 10 with this chroma format is not supported
```

### 4.6 单文件失败后继续（复用现有 CPU 重试）

你的决策：**单文件失败后继续，复用现有重试机制**。

现状（`cmd_ffmpeg.js:609-628`）已具备该能力，只需两处对接：

1. **去掉交互确认**：现在失败后要 `confirmDangerousAction()` 问用户才重试。改为 auto 模式下**自动静默重试**（符合你"失败后继续"的要求）；仅 `--decode-mode gpu` 时才不重试（直接报错）。
2. **重试目标改为 Tier 4**：现在硬编码 `newFT.argv.decodeMode = "cpu"`，方向正确；改为走同一套分层解析器（`decodeMode = "cpu"` 即 Tier 4），并给重试任务加 `retryOnFailed` 标记防循环（现有 `!r.retryOnFailed` 过滤已支持）。

### 4.7 音频：native aac 降级 + warning（你的决策③）

```
探测：ffmpeg -encoders 含 libfdk_aac？
  ├─ 有 → 保持现状（保留 HE profile 与 VBR 能力）
  └─ 无 → 换 native aac，并打 warning：
          "libfdk_aac 不可用，已改用 native aac"
```

**必须在脚本层替换参数**（实测依据，见 3.5）：

| 原参数 | native aac 行为 | 替换为 |
| --- | --- | --- |
| `-c:a libfdk_aac -b:a {K}` | ✅ 可用 | `-c:a aac -b:a {K}` |
| `-profile:a aac_he` | ❌ rc=127 `Profile not supported!` | 去掉该参数，降为 LC，warning 提示音质下降 |
| `-vbr {N}` | ⚠️ **静默忽略**（仅 stderr warning，产物不变） | 按 VBR 档位映射为 `-b:a` 对应码率 |

> 若不做脚本层替换，`-vbr` 会被 ffmpeg 静默吞掉 —— 用户以为在用 VBR，实际是默认 CBR，且**无任何报错**。这是必须替换的理由。

### 4.8 预设占位符化

```js
// 改造前（硬编码）
videoArgs: "-c:v h264_nvenc -rc vbr -tune hq -cq {videoQuality} ...",
audioArgs: "-c:a libfdk_aac -b:a {audioBitrateK}",
filters:   "scale_cuda=w={dimension}:h={dimension}:...,format=cuda",

// 改造后
videoArgs: "{vcodecArgs} -cq {videoQuality} -bufsize {videoBitrateK} -maxrate {videoBitrateK}",
audioArgs: "{acodecArgs}",
filters:   "{scaleFilter}",
```

**注意**：`-rc vbr -tune hq -spatial-aq 1 -temporal-aq 1 -rc-lookahead 24` 是 **NVENC 专属**，QSV/AMF 不接受。所以占位符**必须整段替换编码器参数块**（`{vcodecArgs}`），不能只换编码器名。

`lib/core.js:403` 的 `formatArgs()` 已支持 `{key}` 占位符替换，可直接复用。

---
## 五、实施计划（测试先行）

> 按你的第 4 点决策：**先加 test**。所以阶段 0 就是测试骨架，后续每个阶段都以"新测试先红后绿"推进。
> 命令等价 diff 是"最好能有"的目标，**真正的验收底线是功能等价**（你已明确）。
> 每阶段结束跑 `npm run check && npm test`；改动前备份到 `temp/backups/`；在 `docs/CHANGES-YYYYMMDD.md` 顶部追加摘要。

### 阶段 0：测试骨架（先做，无源码改动）

**目标**：把"探测判定 == 真实命令结果"这条不变量固化成自动化测试。**此时测试应当是红的**（因为缺陷还在）。

新增 `test/test_hwaccel.js`：

```js
/**
 * 硬件加速探测回归测试
 *
 * 不变量：探测判定结果必须与真实命令执行结果一致。
 * 覆盖项：
 *   - ffv1 / mpeg4 等无硬解素材不得被判为可硬解（v1 实测漏判）
 *   - 10bit H.264 / 4:4:4 必须判为不可硬解
 *   - 层级降级顺序符合 cuda/qsv/amf → d3d → hwauto → cpu
 *   - 手动模式（gpu）失败必须硬失败
 *   - 音频在无 libfdk_aac 时降级为 native aac 且带 warning
 *
 * 环境依赖：需要 ffmpeg。缺失时整体 skip，不影响 CI 可移植性。
 */
```

**关键设计点**：

1. **ffmpeg 缺失时 skip 而非 fail**（项目要能跨机器跑）：
   ```js
   const ffmpegPath = await which("ffmpeg", { nothrow: true })
   const maybe = ffmpegPath ? describe : describe.skip
   ```
2. **测试素材用 lavfi 现场生成**（不往仓库塞二进制），实测耗时 < 1s：
   ```bash
   ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25 -t 1 -c:v libx264 -pix_fmt yuv420p h264_8.mp4
   ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25 -t 1 -c:v libx264 -pix_fmt yuv420p10le -profile:v high10 h264_10.mp4
   ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25 -t 1 -c:v ffv1 ffv1.mkv
   ```
3. **覆盖矩阵**（与第三节实测一致）：

| 用例 | 素材 | 期望 |
| --- | --- | --- |
| cuda 可硬解 | h264_8 | 判定 true，真实 OK |
| cuda 可硬解 10bit HEVC | h265_10 | 判定 true，真实 OK |
| **无硬解编码（v1 漏判）** | **ffv1** | **判定 false**（v1 判 true） |
| 10bit H.264 | h264_10 | 判定 false |
| 4:4:4 H.264 | h264_444 | 判定 false |
| 4:2:2 H.264 | h264_422 | 判定 false |
| 层级降级 | ffv1（auto） | 最终落到 cpu 层且成功产出 |
| 手动硬失败 | h264_10 + `--decode-mode gpu` | 非 0 退出码 |
| 音频降级 | 无 libfdk_aac 环境 | 用 native aac + warning |

4. **测试目录**：复用现有约定 `temp/test_hwaccel/`（参考 `test_p2_regressions.js` 的 `TMP_DIR` 写法），`before`/`after` 清理。

**产出**：测试文件 + 当前失败清单（作为后续阶段的靶子）。

### 阶段 1：探测同构化（修 2.2 / 2.3 缺陷）

1. 新增 `lib/hwaccel.js`：层级定义、设备/编码器探测、解码器名映射、滤镜链选择、`probePlan()`。
2. 重写 `cmd/cmd_ffmpeg.js` 的 `canUseCUDADecoder()` → 改为 `resolveHwPlan()`：
   - 探测命令 = 真实命令（同构，见 4.3）；
   - 判定 = `exitCode === 0`（不再解析 stderr）；
   - 缓存键改为 `(tier, srcCodec, bitDepth, pixFmt, dimProfile)`。
3. 跑阶段 0 的测试 → 应变绿。

**风险**：低。`useCUDA=false` 的既有降级路径已实测可跑通。

### 阶段 2：四层链 + 手动硬失败

1. 按 4.1 实现 `cuda/qsv/amf → d3d → hwauto → cpu` 的逐层探测与降级。
2. `--decode-mode gpu` 硬失败（4.5）；`--hwaccel` 加 `choices` 校验。
3. 对接现有 CPU 重试（4.6）：auto 模式自动重试、不弹交互确认。
4. 补 i18n 键（中英），含降级原因文案。

### 阶段 3：音频降级（4.7）

1. `libfdk_aac` 缺失 → native aac + warning；HE/VBR → CBR 参数替换。
2. 注意 `-vbr` 必须脚本层替换（ffmpeg 静默忽略，见 3.5）。

### 阶段 4：预设占位符化（改动最大，可后置）

1. `scale_cuda` ×3 → `{scaleFilter}`；`libfdk_aac` ×17 → `{acodecArgs}`；NVENC 参数块 → `{vcodecArgs}`。
2. **回归方式**（按你的决策放宽）：
   - **必须**：功能等价 —— 同 argv 在 N 卡环境下产出**可播放且参数合理**的文件；
   - **最好有**：改造前后 `ffmpegArgs` 逐参数 diff 为空；
   - 若 diff 不为空但功能等价（例如占位符展开顺序不同），可接受，需在 CHANGES 中记录差异点。

### 阶段 5（可选）：vulkan 显式支持

仅 `--hwaccel vulkan` 时启用。注意需 `-init_hw_device vulkan=vk:0`，且帧不与其他 API 互通（3.4）。

---

## 六、测试策略

### 6.1 分层

| 层 | 内容 | 是否需 ffmpeg |
| --- | --- | --- |
| 单元 | 层级解析、缓存键生成、参数组装（纯函数） | 否 |
| 集成 | 探测判定 vs 真实命令一致性（阶段 0 的核心） | 是（缺失 skip） |
| 端到端 | 少量真实转码，校验产物可解析、分辨率/编码符合预期 | 是（缺失 skip） |

### 6.2 现有基线

```
npm test  →  node --test "test/*.js"   当前 43 用例全绿（S-6 已修）
现有文件：test_decode_command / test_encoding / test_file / test_helper
         / test_p2_regressions / test_remove_command / test_zipu_path
```

新增 `test_hwaccel.js` 后总数增加，**全部须通过**。

### 6.3 不可移植项的显式标记

以下结论依赖本机硬件，测试中必须**条件化**而非硬断言，否则换机器就红：

| 项 | 处理 |
| --- | --- |
| NVIDIA 存在 | 检测 `-encoders` 是否含 `h264_nvenc`，无则 skip 该组用例 |
| Intel QSV 存在 | 同上，检测 `h264_qsv` |
| AMD AMF 存在 | 同上，检测 `h264_amf`（本机缺 `amfrt64.dll`） |
| 硬解能力（10bit/4:4:4 判定） | 属 ffmpeg 与驱动行为，跨机器可能不同 → 断言"判定==真实"，**不**硬断言具体值 |

> 最后一条是关键：测试断言的是**一致性不变量**，不是"h264_10 一定不可硬解"。这样换到不同显卡/驱动上仍然有效。

---
## 七、验收标准

| # | 验收项 | 判定方法 | 本机可验 |
| --- | --- | --- | --- |
| 1 | **探测与真实命令一致** | 阶段 0 测试全绿；ffv1 判 false（v1 判 true） | ✅ |
| 2 | 层级顺序正确 | auto 下日志显示实际层级，顺序符合 cuda/qsv/amf → d3d → hwauto → cpu | ✅ |
| 3 | 手动模式硬失败 | `--decode-mode gpu` 处理 h264_10 → 非 0 退出码 + 明确错误 | ✅ |
| 4 | 单文件失败后继续 | 目录混入坏文件，其余文件仍处理完，失败项走 CPU 重试 | ✅ |
| 5 | 无 GPU 环境可跑 | `CUDA_VISIBLE_DEVICES=-1` 模拟，落到 cpu 层并成功产出 | ✅ |
| 6 | 音频降级 | 无 libfdk_aac 构建下用 native aac + warning | ⚠️ 需换构建 |
| 7 | 默认路径无功能回归 | N 卡环境产物可播放、参数合理 | ✅ |
| 8 | 测试全绿 | `npm test` 现有 43 + 新增全通过 | ✅ |
| 9 | 探测开销可控 | 100 文件批次探测总耗时 < 3s | ✅ |

---

## 八、风险与未实测项

### 8.1 已识别风险

| 风险 | 缓解 |
| --- | --- |
| 探测开销随编码组合数线性增长 | 三级缓存 + 组合去重；实测单次 340ms |
| 阶段 4 占位符化回归面大 | 可后置；底线为功能等价（你已确认） |
| `scale_d3d11` 不可用，d3d 层须用 CPU scale | 已实测确认，方案按 CPU scale 设计（非照搬 cuda 写法） |
| 10bit 源 + h264 预设失败 | 探测同构化天然捕获，触发降级（3.3） |

### 8.2 未实测项（必须显式标注）

| 项 | 原因 | 影响 |
| --- | --- | --- |
| **AMD AMF 全链路** | 本机无 A 卡（`DLL amfrt64.dll failed to open`） | 4.1 中 amf 路径为**文档推断**（依据官方 `:353` "Windows 上 VCE 编码走 AMF"），需在 A 卡机器复验 |
| **AMD d3d11va 解码** | 同上 | 同上 |
| **Intel QSV 完整矩阵** | 本机有 UHD 750，已验证 h264_8 单点 | 10bit/HEVC 的 qsv 路径未全测 |
| **Linux 平台** | 本脚本面向 Windows（你已说明） | vaapi 已从链中移除，符合定位 |
| **vulkan 编码可移植性** | 本机构建有 `h264_vulkan`，官方表标 N | 不作为默认路径，仅显式启用 |

### 8.3 关于 vulkan 的最终定位（更正后）

- **官方支持**：vulkan **解码** H.264/HEVC/AV1 是官方能力，Windows/Linux/Android 全厂商可用（官方表 `:65`）。
- **不放入默认链的理由**（已从"官方不支持"更正为）：
  1. Windows 上与 `d3d11va` 能力高度重叠，边际收益低；
  2. vulkan 帧不与其他 API 互通（实测直喂 nvenc rc=127，需 `hwdownload` 中转，多一次拷贝）；
  3. 编码侧可移植性差（官方表标 N，本构建有属个例）。
- **定位**：跨厂商兜底 + 用户显式指定时启用，写进 `--hwaccel` 支持列表。

---

## 九、本方案对你四项决策的落实

| 你的决策 | 落实位置 |
| --- | --- |
| ① 优先级 `[cuda,qsv,amf] → d3d → hwauto → cpu`，三选一并列 | 4.1 全链设计；Tier 1 按厂商命中而非串行 |
| ② 单文件失败后继续，复用现有 CPU 重试 | 4.6；对接 `cmd_ffmpeg.js:609-628`，auto 模式去交互确认 |
| ③ 自动换 native aac + warning | 4.7；含 `-vbr` 静默忽略的脚本层替换 |
| ④ 先加 test；命令 diff 最好有，功能等价即可 | 阶段 0 测试先行；阶段 4 回归底线为功能等价 |

---

## 附录 A：本机能力快照（实测）

```
ffmpeg: N-125246-g9420146e6-2026-06-23-nonfree-shared  (C:\Home\Apps\ffmpeg\bin)
GPU:    NVIDIA GeForce RTX 4070 (驱动 610.47) + Intel UHD Graphics 750
hwaccels: cuda vaapi dxva2 qsv d3d11va opencl vulkan d3d12va amf

可用解码器(硬件):
  NVIDIA: h264_cuvid hevc_cuvid av1_cuvid mpeg4_cuvid vc1_cuvid vp8_cuvid vp9_cuvid
  Intel:  h264_qsv hevc_qsv av1_qsv mjpeg_qsv mpeg2_qsv vc1_qsv vp8_qsv vp9_qsv vvc_qsv
  AMD:    h264_amf hevc_amf av1_amf vp9_amf   ❌ DLL amfrt64.dll failed to open

可用编码器:
  ✅ h264_nvenc hevc_nvenc av1_nvenc
  ✅ h264_qsv hevc_qsv av1_qsv mjpeg_qsv
  ✅ h264_mf hevc_mf av1_mf aac_mf
  ✅ libx264 libx265
  ✅ h264_vulkan hevc_vulkan av1_vulkan（本构建特有）
  ✅ aac libfdk_aac
  ❌ h264_amf hevc_amf av1_amf（缺 DLL）

可用滤镜:
  scale_cuda  scale_qsv  scale_vaapi  scale_vulkan  scale_d3d11  scale_d3d12
  hwupload_cuda  hwdownload  hwupload  libplacebo
  ⚠️ scale_d3d11 实测不可用（纹理创建 80070057）

-init_hw_device: cuda ✅  qsv ✅  d3d11va ✅  vulkan ✅  vaapi ❌  amf ❌  opencl ❌
```

## 附录 B：关键实测原始输出

```bash
# 1. 探测恒成功（ffv1 无硬解，却 rc=0）—— 缺陷最小复现
$ ffmpeg -v error -hwaccel cuda -hwaccel_output_format cuda -i ffv1.mkv -frames:v 1 -f null -
rc=0   stderr 为空   → 现有逻辑判 canUse=true

# 2. 同素材真实命令失败
$ ffmpeg -v error -hwaccel cuda -hwaccel_output_format cuda -i ffv1.mkv \
    -vf "scale_cuda=w=1920:h=1920:force_original_aspect_ratio=decrease:interp_algo=lanczos,format=cuda" \
    -c:v h264_nvenc -cq 24 -frames:v 1 -f null -
rc=127  Impossible to convert between the formats supported by the filter ...

# 3. 官方语义：internal hwaccel 设计上就回落软解
#    temp/hwaccelintro-ffmpeg.md:104
#    "If the stream is not decodable in hardware ... it will still be decoded in software automatically."
#    而 external wrapper 不回落：
$ ffmpeg -c:v h264_cuvid -i h264_10.mp4 ...
rc=127  [h264_cuvid] Bit depth 10 with this chroma format is not supported

# 4. 各层可用性
$ ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i h264_8.mp4 -vf scale_cuda=... -c:v h264_nvenc ...
rc=0                                    # Tier1 cuda OK
$ ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i h264_8.mp4 -vf scale_qsv=w=1280:h=720 -c:v h264_qsv ...
rc=0                                    # Tier1 qsv OK
$ ffmpeg -hwaccel qsv -i h264_8.mp4 -vf scale=w=1280:h=720 -c:v h264_qsv ...
rc=127                                  # qsv 不能混 CPU 滤镜
$ ffmpeg -hwaccel d3d11va -i h264_8.mp4 -vf scale=w=1280:h=720 -c:v h264_nvenc ...
rc=0                                    # Tier2 d3d OK
$ ffmpeg -hwaccel auto -i mpeg4.avi -vf scale=w=1280:h=720 -c:v h264_nvenc ...
rc=0                                    # Tier3 hwauto OK（d3d 层对 mpeg4 失败时反而可用）
$ ffmpeg -i mpeg4.avi -vf scale=w=1280:h=720 -c:v libx264 -crf 22 ...
rc=0                                    # Tier4 cpu OK

# 5. d3d 零拷贝（官方文档 :257 "NVENC can accept d3d11 frames context directly"）
$ ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i h265_10.mkv -c:v hevc_nvenc ...
rc=0

# 6. scale_d3d11 不可用
$ ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i h264_8.mp4 -vf "scale_d3d11=width=1280:height=720:format=nv12" ...
rc=171  Could not create the texture (80070057)

# 7. hwaccel auto 在 Windows 落到 dxva2（混合模式证据）
$ ffmpeg -v verbose -hwaccel auto -i h264_8.mp4 -c:v h264_nvenc ...
[DXVA2] Using D3D9Ex device.
[dec:h264] Using auto hwaccel type dxva2 with new default device.
Stream #0:0 -> #0:0 (h264 (native) -> h264 (h264_nvenc))

# 8. 10bit 源 + h264 编码器失败
$ ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i h265_10.mkv -c:v h264_nvenc ...
rc=127  Provided device doesn't support required NVENC features
$ ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i h265_10.mkv -c:v hevc_nvenc ...
rc=0

# 9. vulkan（官方支持的解码 + 滤镜）
$ ffmpeg -init_hw_device vulkan=vk:0 -hwaccel vulkan -hwaccel_output_format vulkan \
    -i h264_8.mp4 -vf "scale_vulkan=w=1280:h=720,hwdownload,format=nv12" -frames:v 1 -f null -
rc=0
$ ffmpeg -init_hw_device vulkan=vk:0 -hwaccel vulkan -hwaccel_output_format vulkan -i h264_8.mp4 -c:v h264_nvenc ...
rc=127                                  # vulkan 帧不与其他 API 互通

# 10. 音频
$ ffmpeg -c:a aac -b:a 128k ...          rc=0     # native aac LC 可用
$ ffmpeg -c:a aac -profile:a aac_he ...  rc=127   # Profile not supported!
$ ffmpeg -c:a aac -vbr 2 ...
rc=0   warning: Codec AVOption vbr ... has not been used for any stream
       产物 9983 bytes，与不加 -vbr 完全一致（静默忽略）

# 11. 无 GPU 场景可稳定复现
$ CUDA_VISIBLE_DEVICES=-1 ffmpeg -hwaccel cuda -i h264_8.mp4 ...
rc=127  CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected
```

## 附录 C：探测耗时实测

```
真实链路干跑（1 帧 → null）:  361ms / 315ms / 343ms
设备探测（-init_hw_device）:   219ms / 207ms
编码器列表（-encoders）:        83ms
```

## 附录 D：与 v1 的差异摘要

| 项 | v1 | v2（本版） |
| --- | --- | --- |
| vulkan 定位 | "官方构建普遍不含，不建议" ❌ | **官方支持解码**；因与 d3d 重叠、帧不互通、编码不可移植而不入默认链 ✅ |
| `canUseCUDADecoder` 评价 | "假探测" ❌ | **确是真实探测**；问题是"探测范围≠命令范围"+"失败判定只匹配两串" ✅ |
| 优先级 | cuda→qsv→amf→vaapi→cpu（串行） | **`[cuda,qsv,amf]` 三选一 → d3d → hwauto → cpu** ✅ |
| 单文件失败 | 未明确 | **复用现有 CPU 重试**，auto 模式去交互确认 ✅ |
| 音频 | 降级 + 警告 | 同，补充 **`-vbr` 静默忽略必须脚本层替换** ✅ |
| 测试 | 作为验收手段 | **阶段 0 测试先行** ✅ |
| 命令 diff | 硬约束 | **功能等价为底线，diff 为加分项** ✅ |
| d3d 滤镜 | 未涉及 | **`scale_d3d11` 实测不可用 → d3d 层用 CPU `scale=`** ✅ |

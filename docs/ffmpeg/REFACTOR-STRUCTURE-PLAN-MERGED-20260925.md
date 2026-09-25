# mediac 目录结构重构方案（合并终稿·修订版）

- **版本**：v4.0-revised（v3.0 按独立评审修订）
- **日期**：2026-09-25 10:12（GMT+8）
- **状态**：实施完成（S0–S2 已落地，Windows 打包态已验证；版本发布待执行）
- **适用范围**：根目录 CLI、Electron Desktop
- **不适用范围**：历史设计文档、第三方 npm 包拆分

---

## 1. 结论

v2（SIMPLE）的核心决策成立：单一 npm 发布单元、`src/` 普通源码目录（无子 `package.json`、无 workspaces）、transcode facade 前置、机械迁移。其基线数字经逐条实测为真。

v4 在此基础上收窄：**本轮只做"CLI/Electron 与 transcode 之间的稳定导入接缝 + transcode 搬迁"，共享模块整理、helper 拆分、命名清理、adapter 纯化全部列为后续独立演进。**

**执行原则**：只做 `git mv` + import 路径机械替换；不拆文件、不改文件名、不动函数实现、不重命名符号；任何"顺手改进"推迟到重构结束后单独提交。

---

## 3. 实测事实与修正（承 v3，决策已更新）

### 3.1 测试脚本与 Node 版本（决策：升 >=22，一次同步四处）

实测（Node 24.21.0 / Windows）：`node --test test` 与 `node --test "test/"` 均报 `Cannot find module`，`node --test "test/**/*.js"` 发现并跑通 318/318。

**决策**：`engines.node` 提升至 `>=22`，**S0 一次提交内同步四处**：

1. `package.json#engines.node`；
2. `index.js` 硬编码的 `MIN_NODE_MAJOR`（现为 20，见 index.js#L21）；
3. README 支持说明；
4. AGENTS.md 环境要求。

依据：Node 20 已于 2026-04-30 结束官方维护（运行时生命周期），且 glob 位置参数需 Node 21+。不产生"包声明 22、入口仍接受 20"的中间状态。

### 3.2 `preset_loader.js` 的目录硬编码（决策：最小改法）

[lib/preset_loader.js#L47-L49](file:///c:/Home/Projects/media-cli.js/lib/preset_loader.js#L47-L49) 以 `path.join(MODULE_DIR, "..", "presets")` 定位根 `presets/`。文件移到 `src/transcode/` 后该相对深度失效，**预设直接失效**。

**决策（锁定）**：采用最小改法，相对深度改为 `path.join(MODULE_DIR, "..", "..", "presets")`，与 S2 同提交完成。`createPresetStore`/resource root 注入列为后续独立重构，不与目录搬迁捆绑。

**文档描述同步修正**（评审 3.12）：Electron 当前经 `initPresetsAsync(customPath)` 传入打包态 preset 路径，此时**只加载该单文件**；内置层 + 用户全局层 + cwd 层的完整分层覆盖仅 CLI 生效。本轮不改变此行为，文档如实描述，不声称桌面端已支持分层覆盖。

### 3.3 守卫规则范围（v4 收窄后重述）

- 规则"`cmd/`、`apps/`、`index.js` 只能经 facade 访问 transcode"**不扫 `test/`**：15 组白盒测试直接 import 内部模块，属合理白盒测试；
- 原"源码/测试/labs 不得再引用 `lib/`"规则**随 S2b 推迟一并取消**——`lib/` 本轮保留，且 CLI 其余命令继续合法引用它。

### 3.4 `labs/` 的两个 CJS 死文件

`labs/file_organize.js`（`require("../lib/file")`）与 `labs/download_urls.js`（CJS + 未声明依赖）在 `type: module` 包内本就无法运行。**决策（锁定）**：保留文件不删；守卫的存在性检查只覆盖 ESM `import`，不覆盖 `require`，这两个文件自然豁免。

### 3.5 工作区基线状态

基线提交 `a92d841` 后工作区曾为干净；v3 与本修订版文档本身为工作区未提交改动，开工前须先落盘（commit 文档或 stash），保证 S0 起每阶段 diff 可单独 revert。

仍须在开工前确认：`npm test` 318/318 全绿 + lint 全绿。

### 3.6 支持性证据（决定归属的依据，承 v3）

- `command_utils.js` 仅被 `cmd/*.js` 的 9 个模块引用，transcode 不依赖 → 原计划移 `cmd/support/`，**v4 随 S2b 一并推迟**，本轮留 `lib/`；
- `resolveAssetPath()` 全仓仅 1 个调用方（`capabilities.js`），实现为"向上找最近 `package.json`"；`src/` 不新增 manifest、`assets/` 保持根级，不受影响，**本轮零改动**；
- `unicode.js` 通过 `import.meta.url` 读取同目录 `hanzi_*.txt` → `unicode.js` 与字表同进退；**本轮均留在 `lib/`**，`electron.vite.config.ts` 的字表复制源（lib，见 L23）**不改**；待后续 S2b 若搬迁，再同步改复制源并断言资源存在；
- transcode 领域对外的非 ffmpeg 直接依赖实测 9 个：`core`、`helper`、`debug`、`i18n`、`errors`、`encoding`、`rename`、`file`、`mediainfo`——搬迁后这批同目录 import 统一临时改为 `../../lib/*.js`（评审 3.2 指出的 v3 漏项，v4 已纳入 S2 动作）。

### 3.7 `data/` 本地语料与干净 checkout（v4 新增，采纳评审 3.10 的最低成本版）

`data/` 整体被 `.gitignore` 忽略，但 `test_ffmpeg_scan.js`（L7/L36 的 `path.resolve("data/videos...")`）、`test_ffmpeg_parity.js` 等直接依赖其中素材，干净 checkout 会假失败。

**决策**：不建 fixture 体系、不在 CI 动态生成视频。S0 为依赖 `data/` 的测试补"目录不存在即 skip"守卫，其余保持现状；AGENTS.md 注明 `data/` 为本地开发语料。桌面端 e2e 依赖真实转码，维持"开发机手动跑"的既有口径。

---

## 4. 目标结构（本轮）

```text
mediac/
├── index.js                         # CLI bin 入口
├── cmd/                             # CLI 命令模块（不动）
│   └── cmd_*.js                     #   cmd_ffmpeg.js 改为经 facade 导入
├── lib/                             # 共享模块平铺（保留，标 legacy，冻结新增职责）
│   ├── core.js helper.js debug.js errors.js error-codes.js
│   ├── config.js i18n.js tryfp.js …（其余共享模块原位不动）
│   ├── unicode.js + hanzi_*.txt     #   本轮不动（同进退）
│   └── （18 个 ffmpeg 模块移出后 lib 剩 31 个文件）
├── src/
│   └── transcode/                   # ← 18 个原名模块 + index.js（facade）
├── apps/
│   └── mediac-desktop/              #   ffmpeg-service.ts 改为经 facade 导入
├── presets/                         # 唯一事实源，保持根级（不动）
├── assets/  data/  test/  scripts/  tools/  labs/  docs/
└── package.json                     # 唯一公开 npm 包（files 同时含 src 与 lib）
```

本轮实际移动的文件：**仅 18 个 transcode 模块 + 新增 1 个 facade**，其余全部原位。

### 4.1 transcode 领域（18 个，原名平移）

`ffmpeg_bin.js` `ffmpeg_build.js` `ffmpeg_engine.js` `ffmpeg_events.js` `ffmpeg_options.js` `ffmpeg_plan.js` `ffmpeg_plan_snapshot.js` `ffmpeg_planner.js` `ffmpeg_presets.js` `ffmpeg_result.js` `ffmpeg_run.js` `ffmpeg_scan.js` `ffmpeg_task.js` `hwaccel.js` `hwdetect.js` `gpu.js` `preset_loader.js` `preset_schema.js` → `src/transcode/`。

**不做的内容改动**（相对 v3 收窄）：

- ~~`parseBitrate` 下沉 `bitrate.js`~~：`ffmpeg_presets.js`/`ffmpeg_build.js` 经 `import * as helper from "../../lib/helper.js"` 继续使用，行为零变化；下沉连同特征测试迁移列后续（原 v3 §4.2 整段作废）；
- ~~`isAudioCodecCompatibleWithContainer` 下沉~~：唯一调用点 `ffmpeg_build.js`，同上处理；
- ~~测试目录重组（test/transcode/、test/helpers/）~~：13 个 `test_ffmpeg_*` 留在 `test/` 平铺，只改 import 路径；
- ~~`command_utils.js` → `cmd/support/`~~：随 S2b 推迟。

**除 facade、preset 相对深度（§3.2）、transcode 内共享 import 改 `../../lib/`、桌面端/测试 import 路径外，任何文件不发生内容 diff。**

---

## 5. transcode facade（过渡性 compatibility barrel）

### 5.1 定位与唯一入口

`src/transcode/index.js` 是 CLI 与 Electron 使用转码领域的唯一入口。**定位为过渡性 compatibility barrel**：本轮只解决深导入收敛，不宣称稳定领域 API；后续随 adapter 拆分与 helper 下沉再收敛为最小接口。

当前桌面端 [ffmpeg-service.ts#L7-L18](file:///c:/home/Projects/media-cli.js/apps/mediac-desktop/src/main/ffmpeg-service.ts#L7-L18) 一处深导入 12 个模块，加上 `cmd/cmd_ffmpeg.js` 的 10 条，是最大的两处深导入，即 facade 收敛目标。（深导入全仓基线 64 处，其中测试 23 处属白盒豁免，见 §8。）

导出清单以两个真实消费方（`cmd/cmd_ffmpeg.js`、`ffmpeg-service.ts`）的实际使用为准：

```js
// 引擎/执行
createFFmpegEngine, runFFmpeg, setFFmpegPath, LOG_TAG   // LOG_TAG：过渡兼容导出，列后续清理
// 参数拼装
createFFmpegArgs, flattenFFArgs                          // flattenFFArgs 若桌面端实际未用，S1 时顺手删除该 import，不留死依赖
// 二进制定位
resolveFFmpegBinary, resolveFFprobeBinary
// 硬件
detectHardwareCapabilities, TIERS
// 选项规范
normalizeCliOptions, normalizeWebOptions, toLegacyArgvOptions   // 命名不改（见 §5.2）
// 输入扫描
collectInputFiles, scanFFmpegInputs, scanWebInputFiles
// 任务/计划/结果
buildCliTask, prepareFFmpegPlan, deleteCompletedSources, createPublicPlanSnapshot, SKIP_REASON
// 预设
presets                              // ← ffmpeg_presets.js 的 default export：export { default as presets } from ...
```

~~`parseBitrate`、`isAudioCodecCompatibleWithContainer`~~：不进 facade（外部消费方未使用，属 transcode 内部实现，经 `lib/helper.js` 临时引用维持）。

`getMediaInfo` 属共享层（`lib/mediainfo.js`），调用方直接导入，不经 facade。

facade 不负责：yargs 解析、Electron IPC、终端确认、窗口生命周期、renderer 状态管理、`process.resourcesPath` 路径猜测。

### 5.2 命名清理（v4：整体后置）

`normalizeWebOptions → normalizeDesktopOptions`、`scanWebInputFiles → scanTranscodeInputs`、`buildCliTask → buildTask`、注释中的 `ffweb`/`WebUI` 措辞——**全部推迟到迁移完成后的独立小提交**，不进 S1/S2（评审 3.6：v3 在"机械迁移"的 S1 里混入重命名自相矛盾，且 CLI/Desktop 扫描入口并非同构，提前抽象成通用名会掩盖真实差异）。历史 `CHANGES-*` 文档保留原文。

---

## 6. 资源与运行时路径

### 6.1 presets（改动：仅 §3.2 的相对深度）

`presets/` 保持仓库根目录；CLI npm 包直接携带、Electron 经 `extraResources` 携带。Electron 当前"显式传入打包态路径、只加载单文件"的行为不变（§3.2）。

### 6.2 字表（本轮零改动）

`unicode.js` 与 `hanzi_*.txt` 均留 `lib/`，`electron.vite.config.ts` 复制源不改。后续若搬迁，须同提交：改复制源为 `src/text/` + 构建后断言文件存在（防静默缺表）+ 复制逻辑改为 glob（`hanzi_*.txt`），不再维护固定清单。

### 6.3 assets（本轮零改动）

根 `assets/` 继续作为根包资源；`resolveAssetPath()` 的"向上找最近 `package.json`"因 `src/` 不新增 manifest 不受影响。注：`assets/` 只随 npm CLI 发布，electron-builder 当前未携带它，文档描述以此为准。

### 6.4 data

根 `data/` 为本地测试语料，不入库、不作 npm 运行时资源；依赖它的测试补 skip 守卫（§3.7）。

---

## 7. 发布策略

### 7.1 CLI

根 `package.json` 是唯一发布单元。`files` 变化（**S1 即加 `src`，暂留 `lib`**；本轮终态两者并存）：

```json
"files": ["index.js", "scripts", "src", "lib", "cmd", "assets", "presets", "presets.example.yaml"]
```

每个阶段结束均须通过 tarball 安装态 smoke（§11.2），不存在"引用了 `src` 但 tarball 不含 `src`"的中间状态（评审 3.1 的 v3 阻断项已消除）。

### 7.2 版本号与兼容性（v4 简化）

个人 CLI，`lib/*` 从未作为公共 API 文档化，不承诺深导入兼容、不保留 deprecated wrapper。下次发布版本号高于 `2.0.0`，release note 说明 transcode 模块路径迁移（`lib/ffmpeg_*.js` → `src/transcode/`）即可。

### 7.3 Electron 同步修改（S1/S2 分摊）

- S1：`ffmpeg-service.ts` 深导入 12 条改为 facade 单条；
- S2：`tsconfig.node.json` include **追加** `../../src/**/*.js`（保留 `../../lib/**/*.js`，transcode 仍引用 lib 共享模块）；
- 字表复制、preset 打包路径：本轮不改。

### 7.4 FFmpeg/FFprobe 发行（本轮不实施，正式发布前二选一）

- **方案 A 外部依赖**：依赖用户 PATH/`FFMPEG_PATH`，UI 明确提示，补无 ffmpeg 时的可读错误。现状注记：`resolveFFmpegBinary` 已支持 `extraCandidates`（含桌面端 `process.resourcesPath` 候选）且执行前拒绝空路径，裸调 `"ffmpeg"` 仅剩底层 fallback 一条路径，正式发布前封堵；
- **方案 B 随应用分发**：`extraResources` 分发二进制，明确平台/架构矩阵、许可证、签名与版本配套。

---

## 8. 架构守卫（v4 精简版）

新增 `test/test_architecture_boundaries.js`：**小型正则扫描器**（约 60–80 行，零新依赖），提取静态 `import` / `export ... from` / 动态 `import()` 的说明符字符串，解析相对路径。**不做**：TS/Vue 语义解析、依赖图、循环检测、re-export 展开分析（评审 3.8 认同的方向：宁可规则少而语义无歧义，不造小型解析器）。apps 侧 `.ts`/`.vue` 用同一正则口径覆盖，误报宁可失败不静默。

**规则（硬失败，阻断 `npm test`）**：

1. `cmd/`、`index.js`、`apps/mediac-desktop/src/**`、`labs/`、`scripts/`、`tools/` 不得 import transcode 内部模块——即解析目标位于 `lib/ffmpeg_*`（S1 阶段）或 `src/transcode/`（S2 起）且**非** `src/transcode/index.js` 的 import 一律禁止；这些目录仍可正常导入 `lib/` 其余共享模块；`test/` 豁免（白盒测试允许深导入）；
2. 根项目 ESM 文件（`lib/`、`cmd/`、`src/`、`index.js`、`test/`、`labs/*.js`）的相对 `import` 必须解析到真实文件（不覆盖 CJS `require`，见 §3.4）；apps 侧由 typecheck/e2e 覆盖，不入本守卫。

**已删除的 v3 规则**（随范围收窄）：

- ~~"源码/测试/labs 不得再引用 `lib/`"~~：`lib/` 本轮保留；
- ~~core/helper 导出数量基线~~：数量守卫无法区分"删一增一"的职责漂移（评审 3.5）；改为在 `lib/core.js`、`lib/helper.js` 文件头注释标记 **legacy catch-all：只允许删除或修复，不承接新职责；新工具函数新建模块**，靠 review 约束；
- ~~循环依赖检测~~：收益不抵解析器复杂度；
- ~~关键词文本守卫~~：v3 已否决，维持。

---

## 9. 测试调整（v4 收窄）

1. 新增 `test/test_architecture_boundaries.js`（§8，S1 先启用规则 1 的 facade 部分，S2 起全量）；
2. 13 个 `test_ffmpeg_*` + `test_default_presets.js` + `test_preset_schema.js` + `test_gpu_detect.js` **留在 `test/` 平铺**，S2 仅改 import 路径（`../lib/ffmpeg_*.js` → `../src/transcode/ffmpeg_*.js`）；
3. ~~`test/transcode/`、`test/helpers/` 目录重组~~：不做；
4. ~~`parseBitrate` 用例迁移~~：不做（函数未下沉，`test_helper.js` 原位有效）；
5. cwd 依赖修复（实测两处真问题）：`test_ffmpeg_scan.js` L7/L36、`test_ffmpeg_parity.js` L11 的 `path.resolve("data/videos...")` 改为经仓库根解析 + **目录不存在即 skip**（§3.7）；
6. 测试脚本改 `node --test "test/**/*.js"` 并同步 `engines >=22`（§3.1）。

---

## 10. 阶段划分

每阶段一个提交，单一目的，独立可验证、可发布。每阶段结束跑 §11 门禁。

### S0：基线、发布准备与支持策略（一提交内完成）

- 落盘本方案文档（或 stash），确认工作区干净、`npm test` 318/318、lint 全绿；
- **Node >=22 四处同步**（§3.1：engines / `index.js` MIN_NODE_MAJOR / README / AGENTS.md）+ 测试脚本改 glob；
- 为依赖 `data/` 语料的测试补 skip 守卫（§9.5）；
- 新增 `test:package` 脚本：`npm pack` 到 `temp/release-check` + 临时目录安装 + CLI smoke；
- AGENTS.md 注明 `data/` 为本地语料、`lib/core.js`/`helper.js` 标 legacy。

### S1：建立 transcode facade（不动目录、不重命名）

- 创建 `src/transcode/index.js`，暂时 re-export 现有 `lib/ffmpeg_*.js`；
- `cmd/cmd_ffmpeg.js` 与 `ffmpeg-service.ts` 改为只从 facade 导入转码能力（桌面端 12 条深导入收敛为 1 条；顺手删除未使用的 import）；
- **`package.json#files` 同提交加入 `src`，保留 `lib`**（评审 3.1 修正）；
- 新增守卫测试，先启用规则 1（facade 唯一入口，扫描 `lib/ffmpeg_*` 深导入）与规则 2（import 可解析）；
- **不做**：符号重命名、helper 下沉、字表/preset 路径改动（§5.2、§4.1）。

**此阶段固定所有外部引用，S2 只改 facade 内部指向与被迁模块自身 import——这是整个迁移顺序的关键。**

### S2：transcode 搬迁（唯一有真实风险的提交）

- 18 个模块 `git mv` → `src/transcode/`，原名平移；
- facade 内部指向 `../../lib/` → `./`；
- **被迁模块对共享层的同目录 import 统一改 `../../lib/*.js`**（实测 9 个依赖：core/helper/debug/i18n/errors/encoding/rename/file/mediainfo；含 `ffmpeg_run.js` L14–17 的 4 条等，评审 3.2 指出的 v3 漏项）；
- `preset_loader.js` 相对深度修正（§3.2 最小改法）；
- `tsconfig.node.json` include 追加 `../../src/**/*.js`；
- 13+3 个测试 import 路径机械替换（§9.2）；
- 守卫规则 1 切换为拦截 `src/transcode/` 深导入。

### S3：文档收尾与发布

- 更新 AGENTS.md、README、`docs/FFMPEG-USAGE.md`、Electron README 的模块路径说明（transcode 部分指向 `src/transcode/`，其余注明仍在 `lib/`）；
- 历史设计文档与 CHANGES 保留原文；
- 重新构建 npm tarball 与 Electron Windows 产物，按 §11.4 手动 checklist 验收；
- 版本号 bump（>2.0.0），release note 说明路径迁移。

### 后续可选（本轮明确不做，按需另开）

| 事项 | 触发条件 |
|---|---|
| S2b：共享模块六分类搬迁、`command_utils.js` → `cmd/support/`、`lib/` 消失 | 某模块确需独立演进时单独搬那一个，或导航痛点真实出现 |
| `parseBitrate`/codec-compat 下沉 + 特征测试迁移 | transcode 域想摆脱对 `lib/helper.js` 的依赖时 |
| 命名清理（§5.2）| S2 落地稳定后一次小提交 |
| facade 收敛为最小领域 API、adapter 拆分 | parity 测试稳定后 |
| `createPresetStore`/resource root 注入 | 需要桌面端完整分层覆盖时 |

---

## 11. 验证门禁

### 11.1 每阶段基础门禁

```powershell
npm test          # 318 起，S1 起含架构守卫
npm run check
npm run lint
```

### 11.2 CLI 发布门禁（每阶段跑）

```powershell
npm pack --json --pack-destination temp/release-check
```

临时目录安装 tarball 后验证 `mediac --version` / `--help` / `ffmpeg --help` / `ffmpeg --show-presets`。

必须包含：`index.js`、`cmd/`、`src/`、`lib/`（共享模块与字表）、`presets/default.yaml`、`assets/`。不得包含：`apps/`、`docs/`、`test/`、`labs/`、`release/`、开发机绝对路径。

### 11.3 Electron 门禁（S1/S2 跑）

```powershell
npm --prefix apps/mediac-desktop run typecheck
npm --prefix apps/mediac-desktop run build
npm --prefix apps/mediac-desktop run test:e2e
```

### 11.4 Windows 打包态手动 checklist（S3，发布前）

个人项目不建自动化打包 smoke，发布前手动执行并记录：

1. 清理旧 `out/`、`release/`，重跑 `package:win`；
2. 检查最终 bundle 与字表（`out/main/hanzi_*.txt`）、`resources/presets/default.yaml` 存在；
3. 从仓库外 cwd、独立临时 userData 启动 `win-unpacked/MediaCli.exe`；
4. 清除 `FFMPEG_PATH`/PATH 最小化验证缺失提示；再显式设 `FFMPEG_PATH` 对仓库外文件完成一次真实转码。

### 11.5 编码参数回归保护

本方案只改变目录、facade 与依赖边界，**不得顺手修改** codec 选择、滤镜参数、码率换算、硬件 tier、参数拼装结果。确需修改 FFmpeg 参数时，按项目规则用真机 ffmpeg 与 `data/videos/` 素材逐项核验。

# mediac 目录结构重构方案

- 日期：2026-09-24 23:40 (GMT+8)
- 目标：把 ffmpeg 领域代码与公用核心分拆成清晰边界，删除 WebUI（ffweb），保留 ffmpeg CLI 与 Electron 桌面端，形成「核心公用 + 领域包 + 多端应用」的结构
- 依据：全仓静态依赖图扫描（91 个源文件，逐文件解析 import 说明符后归一化为真实路径）

---

## 一、现状与问题

### 1.1 事实清单（来自依赖图扫描）

| 项 | 数值 |
|----|------|
| `lib/` 平铺文件 | 50 项（45 个 `.js` + 5 个汉字表 `.txt`） |
| ffmpeg 域模块 | 19 个（`ffmpeg_*` 14 个 + `hwaccel` / `hwdetect` / `gpu` / `preset_loader` / `preset_schema`） |
| ffmpeg 域依赖的公用模块 | 12 个（`core` `helper` `debug` `file` `rename` `i18n` `errors` `config` `encoding` `command_utils` `media_parser` `tryfp`） |
| 被 ffmpeg 与其他命令共同使用的模块 | `mediainfo`（cmd_remove/cmd_rename）、`arg_parser`（cmd_rename）、`capabilities`（cmd_compress） |
| 前端封装 | 两套并存：`ffweb/`（WebUI，4 个测试）+ `apps/mediac-desktop/`（Electron） |
| 桌面端引用 lib | 12 个模块，全部为 ffmpeg 域（`../../../../lib/ffmpeg_*.js`） |

### 1.2 结构性问题

1. **领域与基础设施混居**：`lib/` 一个目录里同时放着日志（`debug.js`）、汉字表（`hanzi_*.txt`）、EXIF（`exif.js`）和转码引擎（`ffmpeg_engine.js`）。任何"改 ffmpeg"的改动都会在这个目录里滚动，review 时无法一眼判断影响面。
2. **边界只靠自觉**：没有任何机制阻止 `core/helper.js` 去 import `ffmpeg_presets.js`。一旦发生，`lib/` 就会退化成一个环，任何一端（CLI / 桌面端）都无法单独裁剪依赖。
3. **双前端重复**：`ffweb` 与 Electron 桌面端都要维护一份"扫描 → 计划 → 执行 → 事件适配"的胶水，且 WebUI 的并发、`jobs`、安全模型与桌面端已经出现分叉。桌面端是明确方向，WebUI 继续维护的边际收益为负。
4. **`core.js` / `helper.js` 是隐式垃圾桶**：`helper` 被 25 处引用、`core` 被 15 处引用，是事实上的"什么都往里放"。分拆后它们仍留在核心，但边界被目录显式圈住，后续可以按需继续下沉。
5. **测试目录无分层**：30 个测试文件平铺在 `test/`，ffmpeg 测试（16 个）、核心测试、命令测试混在一起，无法按层跑门禁。

---

## 二、目标与原则

1. **依赖方向单向且可验证**：`cmd/` 与 `apps/*` → `packages/ffmpeg` → `packages/core`。core 不得反向引用任何上层。方向约束由自动化测试强制，不靠 Code Review 记忆。
2. **分拆只动目录，不动运行时契约**：模块文件名、导出符号、函数签名一律不变（`git mv` 优先），保证 `git log --follow` 可追溯，迁移风险集中在 import 路径重写这一个维度。
3. **不引入 npm workspaces**：根包 `mediac` 是发布单元（bin + `files` 白名单），workspace 子包靠 `node_modules` symlink 解析，不会被打进 tarball，发布后必然 `ERR_MODULE_NOT_FOUND`。子目录 `package.json` 只声明边界与 exports，运行期走相对路径。
4. **资源与代码分离**：`presets/`（预设唯一事实源）、`data/`（样本与字表素材）、`assets/` 保持在仓库根目录，由代码加载，不随包迁移。
5. **每一步都可运行**：5 个步骤之间仓库始终处于「测试全绿 + lint 全绿 + 桌面端可构建」状态，任何一步可独立回滚。

---

## 三、目标结构

```
mediac/
├── index.js                        # CLI 入口（bin: mediac）
├── cmd/                            # CLI 子命令，只依赖 packages/*
│   ├── cmd_ffmpeg.js               #   ffmpeg 转码入口（保留）
│   └── cmd_*.js                    #   其余命令
├── packages/
│   ├── core/                       # 公用核心：不得出现 ffmpeg/ffprobe 概念
│   │   ├── package.json            #   边界声明（name/exports），不发布
│   │   ├── README.md               #   职责与依赖规则
│   │   └── src/
│   │       ├── index.js            #   聚合导出（可选入口，便于上层单点引用）
│   │       ├── support/            #   基础设施：日志、错误、配置、编码、国际化
│   │       ├── fs/                 #   文件遍历、路径、重命名、命令工具
│   │       ├── media/              #   媒体探测：mediainfo/exif/能力探测/压缩
│   │       └── data/               #   汉字表等静态数据
│   └── ffmpeg/                     # ffmpeg 领域：只依赖 ../core
│       ├── package.json
│       ├── README.md
│       └── src/                    #   ffmpeg_* / hwaccel / hwdetect / gpu / preset_*
├── apps/
│   └── mediac-desktop/             # Electron 桌面端（依赖 packages/ffmpeg）
├── presets/                        # 预设 YAML 唯一事实源（资源，保持根级）
├── test/
│   ├── core/                       # 核心层测试
│   ├── ffmpeg/                     # ffmpeg 领域测试
│   ├── cli/                        # 命令层测试
│   └── architecture/               # 依赖方向与边界守卫
├── docs/  scripts/  data/  labs/  tools/  assets/
└── package.json                    # 发布单元，files 增加 packages
```

已删除：`ffweb/`、`cmd/cmd_ffweb.js`、`test/test_ffweb_*`（4 个）。

---

## 四、模块归属表

### 4.1 `packages/core/src`

| 子目录 | 模块 | 归属理由 |
|--------|------|----------|
| `support/` | `debug.js` `errors.js` `error-codes.js` `config.js` `tryfp.js` `i18n.js` `encoding.js` `unicode.js` `date_parse.js` | 进程级基础设施：日志、错误码、配置、国际化、字符编码 |
| `support/` | `core.js` `helper.js` `arg_parser.js` | 通用工具箱与参数解析；`arg_parser` 同时被 `cmd_rename` 使用，必须留在 core |
| `fs/` | `file.js` `path-merge.js` `filename-rules.js` `rename.js` `command_utils.js` `tools.js` `query_parser.js` | 文件遍历、路径合并、命名规则、命令层通用工具 |
| `media/` | `mediainfo.js` `media_parser.js` `capabilities.js` `exif.js` `media-compress.js` `fixmetadata.js` `image_hash.js` | 媒体探测与处理；`mediainfo`/`capabilities` 被 ffmpeg 与非 ffmpeg 命令共用 |
| `data/` | `hanzi_common_3500.txt` `hanzi_common_7000.txt` `hanzi_common_japanese.txt` `hanzi_complex.txt` `hanzi_rarely.txt` | `unicode.js` 读取的静态字表（读取路径随迁移同步调整） |

### 4.2 `packages/ffmpeg/src`

`ffmpeg_bin.js`（二进制定位）、`ffmpeg_build.js`（参数拼装）、`ffmpeg_engine.js`（执行引擎）、`ffmpeg_events.js`（事件常量）、`ffmpeg_options.js`（选项规范化）、`ffmpeg_plan.js`（目标参数计算）、`ffmpeg_plan_snapshot.js`（对外快照）、`ffmpeg_planner.js`（计划编排）、`ffmpeg_presets.js`（预设）、`ffmpeg_result.js`（RunResult）、`ffmpeg_run.js`（单文件执行）、`ffmpeg_scan.js`（输入扫描）、`ffmpeg_task.js`（任务构建）、`hwaccel.js`（硬件分层矩阵）、`hwdetect.js`（能力探测）、`gpu.js`（GPU 支持矩阵）、`preset_loader.js`（预设加载）、`preset_schema.js`（预设校验）。

### 4.3 测试归属

| 目录 | 文件 |
|------|------|
| `test/ffmpeg/` | `test_ffmpeg_*`（12）、`test_default_presets.js`、`test_preset_schema.js`、`test_gpu_detect.js` |
| `test/core/` | `test_encoding.js` `test_file.js` `test_helper.js` `test_media_parser_fields.js` `test_p2_regressions.js` |
| `test/cli/` | `test_decode_command.js` `test_remove_command.js` `test_zipu_path.js` |
| `test/architecture/` | `test_boundaries.js`（新增） |
| 删除 | `test_ffweb_dialog.js` `test_ffweb_flow.js` `test_ffweb_security.js` `test_ffweb_task_runner.js` |

---

## 五、边界强制：架构守卫测试

新增 `test/architecture/test_boundaries.js`，扫描仓库内所有源文件的 import 说明符，归一化为真实路径后断言：

1. `packages/core/**` 不得 import `packages/ffmpeg/**`、`cmd/**`、`apps/**`、`ffweb/**`；
2. `packages/ffmpeg/**` 不得 import `cmd/**`、`apps/**`，只能 import `packages/core/**` 与外部依赖；
3. `packages/core/**` 源码中不得出现 `ffmpeg` / `ffprobe` 标识符（防止隐式领域耦合，白名单：`packages/core/src/media/capabilities.js` 探测本机是否已安装 ffmpeg 属合理例外，单独声明）；
4. `apps/mediac-desktop/**` 不得 import `cmd/**`（桌面端不应依赖 CLI 命令层）；
5. 仓库中不得再出现 `ffweb` 目录与 `cmd/cmd_ffweb.js`。

守卫测试与功能测试同属 `npm test`，违反即红灯，避免"重构完三个月又长回去"。

---

## 六、关键决策记录

### 6.1 为什么不用 npm workspaces

根包以 `files` 白名单发布（`index.js` `lib` `cmd` `presets` …）。若把 core/ffmpeg 变成 workspace 包，本地靠 `node_modules/@mediac/*` symlink 解析，而 npm 打包 tarball 时不会包含 `node_modules` 内的 symlink 目标 → 用户安装后 `Cannot find module '@mediac/core'`。要正确发布就得引入 bundling 或改为多包发布，成本与当前阶段收益不匹配。因此：**物理分目录 + 相对路径导入 + 子包 `package.json` 只作边界声明**，未来若真要独立发包，只需加 `workspaces` 并把相对导入批量换成包名（子包 `exports` 已就位）。

### 6.2 为什么 `presets/` 不搬进 `packages/ffmpeg`

- 预设是**数据而非代码**，用户可直接编辑（还有 `presets.example.yaml`）；
- 桌面端打包时有 9 个候选路径（含 `process.resourcesPath`），搬动会让打包与运行时候选同时变化；
- CLI 与桌面端共用同一份 YAML 是刻意的，放在根更能表达"唯一事实源"。

### 6.3 为什么文件名保持不变

`lib/core.js` 迁到 `packages/core/src/support/core.js` 后名字略显冗余，但改名会让 45 个文件的 import 与 30 个测试同时产生语义变更，收益（美观）远小于风险。保持文件名 = 迁移只剩"路径"一个变量，可用脚本批量重写并用全量测试验证。

---

## 七、分步迁移计划（每步一个提交）

| 步骤 | 内容 | 门禁 | 提交 |
|------|------|------|------|
| S1 | 删除 WebUI：`ffweb/`、`cmd/cmd_ffweb.js`、`test/test_ffweb_*`、`index.js` 注册、`package.json` 的 `files`、README 提及 | `npm test` / `check` / `lint` | `chore: remove ffweb web ui in favour of the electron desktop app` |
| S2 | 建立 `packages/core`：26 个模块 + 5 个字表按 support/fs/media/data 分组 `git mv`，全仓 import 重写 | 同上 + 桌面端 `typecheck` | `refactor(core): extract shared utilities into packages/core` |
| S3 | 建立 `packages/ffmpeg`：19 个领域模块迁移，更新 `cmd_ffmpeg`、Electron `ffmpeg-service.ts`、测试引用，`lib/` 清空移除 | 同上 + 桌面端 `typecheck` + `build` | `refactor(ffmpeg): extract ffmpeg domain into packages/ffmpeg` |
| S4 | 测试分层：`test/{core,ffmpeg,cli}` + 新增 `test/architecture/test_boundaries.js`，`npm test` 改递归 | `npm test`（含守卫）/ `check` / `lint` | `test(architecture): layer tests and enforce package boundaries` |
| S5 | 收尾：`package.json` 的 `files` 增加 `packages`、AGENTS.md / README / docs 路径引用更新、全量回归 | 全量门禁 | `docs: realign docs and packaging with the new package layout` |

回滚：每步为独立 commit，`git revert` 单步即可；迁移期间不修改任何导出符号，回滚不会引入语义冲突。

---

## 八、验证门禁（每步执行）

```bash
npm test                 # 根测试套件（S1 后 ~326，S4 后含守卫）
npm run check            # 全仓 node --check + Node 版本自检
npm run lint             # ESLint + Prettier
cd apps/mediac-desktop && npm run typecheck && npm run build
node index.js ffmpeg --help   # CLI 冒烟
```

---

## 九、后续演进（本次不做）

1. `packages/core/src/support/core.js` / `helper.js` 按职责继续下沉（如把路径工具并入 `fs/`）；
2. 桌面端与 CLI 共用的胶水层（扫描/计划/事件适配）沉淀到 `packages/ffmpeg/src/adapters/`；
3. 若桌面端需要独立发布，再评估 workspaces 化（子包 `exports` 已预留）。

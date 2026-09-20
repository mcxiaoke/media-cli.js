# ffmpeg 滤镜（Filters）使用指南

> 依据 ffmpeg 官方文档（ffmpeg-filters）编写，覆盖 ffmpeg 大部分内建滤镜的常用用法与参数解释。文中示例均可在安装了 ffmpeg 的机器上直接运行；涉及的滤镜名称与参数以 ffmpeg 官方文档为准。

## 目录

- [一、滤镜系统基础](#一滤镜系统基础)
    - [Filtergraph 语法](#filtergraph-语法)
    - [转义规则](#转义规则)
    - [时间线编辑（Timeline editing）](#时间线编辑)
    - [滤镜运行时命令](#滤镜运行时命令)
- [二、视频滤镜](#二视频滤镜)
    - [2.1 几何变换与尺寸](#21-几何变换与尺寸)
    - [2.2 裁剪、拼接与叠加](#22-裁剪拼接与叠加)
    - [2.3 时间处理](#23-时间处理)
    - [2.4 文字、字幕与图形](#24-文字字幕与图形)
    - [2.5 色彩调整与键控](#25-色彩调整与键控)
    - [2.6 模糊、锐化与降噪](#26-模糊锐化与降噪)
    - [2.7 去交错与反交错处理](#27-去交错与反交错处理)
    - [2.8 画质分析与诊断](#28-画质分析与诊断)
    - [2.9 其它常用视频滤镜](#29-其它常用视频滤镜)
- [三、音频滤镜](#三音频滤镜)
    - [3.1 音量、响度与混音](#31-音量响度与混音)
    - [3.2 音频时间处理](#32-音频时间处理)
    - [3.3 音频重采样与格式](#33-音频重采样与格式)
    - [3.4 音频滤波与效果](#34-音频滤波与效果)
    - [3.5 音频分析与静音检测](#35-音频分析与静音检测)
- [四、多媒体滤镜](#四多媒体滤镜)
- [五、视频源（Sources）与音频源](#五视频源与音频源)
- [六、常用综合示例](#六常用综合示例)

---

## 一、滤镜系统基础

### Filtergraph 语法

滤镜（filter）是 ffmpeg 中处理音视频数据的基本单元，滤镜之间通过"滤镜图"（filtergraph）连接。

- **简单滤镜图**：用 `-vf`（视频）/ `-af`（音频）选项指定，图形是单输入单输出的线性链。例如：

    ```
    ffmpeg -i input.mp4 -vf "scale=1280:720,format=yuv420p" output.mp4
    ```

    链中的滤镜用英文逗号 `,` 分隔，按从左到右的顺序依次处理。

- **复杂滤镜图**：用 `-filter_complex` 选项指定，支持多输入多输出、分支与合并。滤镜之间用英文分号
  `;` 分隔，流用 `[标签]` 命名。例如：

    ```
    ffmpeg -i input.mp4 -filter_complex "[0:v]split[a][b];[a]scale=640:360[av];[b]hue=h=30[bv];[av][bv]hstack[out]" -map "[out]" output.mp4
    ```

- **参数传递**：滤镜参数以 `key=value` 形式给出，多个参数用冒号 `:`
  分隔；也可以省略 key 按位置顺序传参，key=value 与位置参数可以混用。例如 `scale=1280:720` 等价于
  `scale=w=1280:h=720`。

- **命令行解析顺序**：
    1. 用 `\`（反斜杠）转义 `:`（冒号）、`\` 和 `[`、`]`；
    2. 用单引号 `'...'` 转义 `:`，在 `-filter_complex` 或 `-vf` 参数中引号内容不会被进一步解析；
    3. shell 层的转义（如整段参数加双引号）在传给 ffmpeg 前已由脚本处理。

- **参数值中的特殊字符**：`;` 与 `,`
  在 filtergraph 中有语法含义，若参数值本身需要包含它们（如 drawtext 的 text 中包含逗号），必须用
  `\` 转义或用引号包裹。

**option 求值时机**：多数几何类滤镜（scale、crop、pad 等）的参数是表达式，支持
`e=init`（初始化时求值一次，默认）与 `e=frame`（每帧求值）两种模式。

### 转义规则

- 滤镜图内 `,` 分隔滤镜、`;` 分隔滤镜链、`:` 分隔参数。要表示字面量这些字符时：
    - `text='hello world'` 中空格用单引号；
    - `drawtext=text='a\,b'` 用 `\,` 表示字面逗号；
    - `movie=filename='my:file.mp4'` 中冒号用单引号包裹或 `\:` 转义。
- 在 shell（如 bash/cmd）中传递复杂滤镜图时，通常还需再加一层引号：`-vf "drawtext=text='Hello World':fontsize=24"`。

### 时间线编辑（Timeline editing）

部分滤镜支持"时间线编辑"：在参数中以 `enable`
表达式控制生效时间，FFmpeg 会在表达式为真时启用滤镜、为假时旁路。可用变量：

- `t`：当前帧时间（秒）
- `n`：当前帧序号（从 0 开始）
- `pos`：当前帧在输入中的字节位置

示例：

```
# 前 10 秒做模糊，之后恢复正常
ffmpeg -i in.mp4 -vf "boxblur=luma_radius=10:enable='lt(t,10)'" out.mp4

# 从第 100 帧开始做旋转
ffmpeg -i in.mp4 -vf "rotate=45:enable='gte(n,100)'" out.mp4
```

### 滤镜运行时命令

许多滤镜支持 `sendcmd` / `zmq` 在运行时修改参数，或通过 `-filter_complex "...[0:v]..."` 与
`dumplicate` 等机制交互。通用调用方式：

```
ffmpeg -i in.mp4 -vf "drawtext=text='A':fontsize=30" out.mp4
```

运行中修改最常用的是：

```
ffmpeg -i in.mp4 -vf "eq=brightness=0.0" -f lavfi -i "color=c=black:s=1x1" -filter_complex "[0:v][1:v]overlay" -frames:v 1 out.png
```

具体支持的命令（commands）见各滤镜小节标注。通过 `sendcmd` 滤镜可以在滤镜图上执行命令，例如：

```
ffmpeg -i input.mkv -filter_complex "[0:v]sendcmd='10.0 drawtext reinit text=new',drawtext=text=old[v]" -map "[v]" out.mkv
```

---

## 二、视频滤镜

### 2.1 几何变换与尺寸

#### scale —— 缩放

最常用的滤镜，调整视频分辨率。官方参数（ffmpeg-filters 文档 scale 小节）如下：

| 参数                               | 说明                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| w / width                          | 输出宽度。可写表达式（如 `iw/2`）；`0` 与 `-n` 同义（等比缩放）；**单个 `-1` 保持宽高比**；**单个 `-2` 等比缩放并四舍五入到偶数**（-4 到 4 的倍数） |
| h / height                         | 输出高度，规则同 w；宽高最多只能有一个取 `-1`/`-2` 这类负值                                                                                         |
| force_original_aspect_ratio        | `disable`（默认）/ `decrease`（缩小以装进 w×h 盒子）/ `increase`（放大填满），与 force_divisible_by 组合实现"精准适配"                              |
| force_divisible_by                 | 配合 force_original_aspect_ratio，强制输出宽高为该值的倍数（如 2 保证偶数，H.264 需要）                                                             |
| flags                              | 缩放算法（见下表），默认 `bicubic`                                                                                                                  |
| eval                               | `init`（默认，只算一次）/ `frame`（逐帧重算，配合 t 表达式做动态缩放）                                                                              |
| interl                             | 对隔行扫描源的特殊处理：`0`/`1`（垂直方向按字段缩放）/`-1` 自动                                                                                     |
| in_color_matrix / out_color_matrix | 输入/输出色彩矩阵（`auto`/`bt601`/`bt709`/`smpte240m`/`bt2020`/`fcc` 等），防色彩偏移                                                               |
| in_range / out_range               | 输入/输出亮度范围（`auto`/`full`/`limited`/`jpeg`/`mpeg`/`tv`/`pc` 等）                                                                             |
| in_h_chr_pos / out_h_chr_pos       | 输入/输出色度采样水平位置（-1 自动，用于 4:2:0→4:4:4 等转换）                                                                                       |
| in_v_chr_pos / out_v_chr_pos       | 输入/输出色度采样垂直位置                                                                                                                           |
| intent                             | ICC 色彩意图：`perceptual`/`relative`/`saturation`/`absolute`（仅编译 liblcms2 时有效）                                                             |
| sar                                | 设置输出样本宽高比（如 `4:3`、`1`），一般交给 setdar/setsar 处理                                                                                    |
| setsar / setdar                    | 与 0.20 版前的同名选项：值 0 时分别继承输入的 sar / dar                                                                                             |

**flags 缩放算法取值**（官方 libswscale 定义，按质量/速度权衡选）：

| 算法          | 说明                                   | 适用场景               |
| ------------- | -------------------------------------- | ---------------------- |
| fast_bilinear | 快速双线性，质量最低                   | 实时预览               |
| bilinear      | 双线性插值                             | 常规缩小               |
| bicubic       | 双三次插值（**默认**），锐度与平滑均衡 | 通用默认               |
| lanczos       | Lanczos 核，锐利且带轻微振铃           | 高质量放大 / 缩小      |
| spline        | B 样条插值，比 bicubic 更平滑          | 高质量平滑             |
| area          | 面积平均（像素箱式），缩小最稳、抗锯齿 | **缩小用更佳**、缩略图 |
| gauss         | 高斯                                   | 平滑缩放               |
| sinc          | sinc 核，理论最优带限                  | 高质量（计算量大）     |
| neighbor      | 最近邻，像素风                         | 像素画 / 缩放整数倍    |

常用表达式变量：`in_w`/`iw`、`in_h`/`ih`、`out_w`/`ow`、`out_h`/`oh`、`a`（宽高比 iw/ih）、`sar`、`dar`、`n`（帧号）、`t`（秒）、`pos`、`hsub`、`vsub`、`iw`/`ih`
等。

**实测示例**（本机 FFmpeg 9.0.1）：

```
# 缩放到 1280 宽，高度按比例（-1 保持宽高比）
ffmpeg -i in.mp4 -vf "scale=1280:-1" out.mp4

# 双 -2：等比缩放且保证偶数（H.264 兼容性最好），实测输出 320x180
ffmpeg -i in.mp4 -vf "scale=320:-2" out.mp4

# 指定宽高但保持比例：decrease=装进盒子 / increase=填满盒子
ffmpeg -i in.mp4 -vf "scale=1280:720:force_original_aspect_ratio=decrease" out.mp4
ffmpeg -i in.mp4 -vf "scale=1280:720:force_original_aspect_ratio=increase" out.mp4

# force_divisible_by：装进盒子且宽高为 2 的倍数（H.264 编码必需偶数）
ffmpeg -i in.mp4 -vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2" out.mp4

# 高质量缩放（lanczos），实测输出 320x180
ffmpeg -i in.mp4 -vf "scale=w=320:h=-2:flags=lanczos" out.mp4

# 缩小一半并用 area 算法（缩小画质最稳，抗摩尔纹）
ffmpeg -i in.mp4 -vf "scale=iw/2:ih/2:flags=area" out.mp4

# 动态缩放：每秒在 50%~100% 间放大（eval=frame 逐帧求值）
ffmpeg -i in.mp4 -vf "scale='iw*(1+0.5*sin(t))':'ih*(1+0.5*sin(t))':eval=frame" out.mp4

# 色彩矩阵修正（BT.709 源 → BT.601，防止接老设备色偏）
ffmpeg -i in.mp4 -vf "scale=1280:720:in_color_matrix=bt709:out_color_matrix=bt601" out.mp4
```

#### crop —— 裁剪

从输入中裁剪出指定区域。

| 参数        | 说明                                                            |
| ----------- | --------------------------------------------------------------- |
| out_w / w   | 输出宽度（默认 `iw`，可表达式）                                 |
| out_h / h   | 输出高度（默认 `ih`）                                           |
| x / y       | 裁剪区域左上角坐标（默认居中），可用表达式，如 `(in_w-out_w)/2` |
| keep_aspect | 1 时保持输出宽高比                                              |
| exact       | 1 时精确按表达式计算，不取整（默认会对奇数尺寸调整）            |

表达式变量（官方 ffmpeg-filters
crop 小节）：`in_w`/`iw`、`in_h`/`ih`、`out_w`/`ow`、`out_h`/`oh`、`x`、`y`、`a`（=iw/ih）、`sar`、`dar`、`hsub`、`vsub`、`n`（帧号）、`t`（秒）、`pos`（文件位置）。

**crop 的完整官方参数**：

| 参数        | 说明                                                                |
| ----------- | ------------------------------------------------------------------- | --- | --- |
| out_w / w   | 输出宽度（默认 `iw`，可表达式，负数表示"总宽-                       | 值  | "） |
| out_h / h   | 输出高度（默认 `ih`）                                               |
| x / y       | 裁剪区域左上角坐标（默认居中），可用表达式                          |
| keep_aspect | 1 时保持输入宽高比，按比例调整输出尺寸（实测通过）                  |
| exact       | 1 时按表达式精确计算输出尺寸，不做对齐约束（默认会对偶数/对齐调整） |

```
# 裁剪中央 640x360
ffmpeg -i in.mp4 -vf "crop=640:360" out.mp4

# 裁剪掉上下左右各 100 像素
ffmpeg -i in.mp4 -vf "crop=iw-200:ih-200" out.mp4

# 从 (100,50) 起裁剪 320x240
ffmpeg -i in.mp4 -vf "crop=320:240:100:50" out.mp4

# 按宽高比自动缩放后裁剪（如从纵向素材裁出 16:9，等效"中心放大裁切"）
ffmpeg -i in.mp4 -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720" out.mp4

# 精确尺寸（不做对齐修正），配合 cropdetect 的黑边检测结果使用
ffmpeg -i in.mp4 -vf "crop=640:360:0:0:exact=1" out.mp4

# 每隔 1 秒左右扫动（表达式）
ffmpeg -i in.mp4 -vf "crop=iw/2:ih:(in_w-out_w)/2*sin(t)" out.mp4
```

> 配合 `cropdetect` 自动找黑边：先 `ffmpeg -i in.mp4 -vf cropdetect -f null -` 看输出中
> `crop=W:H:X:Y`
> 建议值，再手动填进 crop。yuv420p 下裁剪坐标和尺寸建议保持偶数，否则编码器会报 "width not divisible
> by 2"，可用 `crop=...:exact=0` 自动对齐或手动取偶。

#### pad —— 加边 / 加黑边

在输入四周填充，并把原图放到指定位置（常用于制作统一画幅）。

| 参数       | 说明                                                        |
| ---------- | ----------------------------------------------------------- |
| width / w  | 输出宽度（0 表示取输入宽度，默认 0）                        |
| height / h | 输出高度（同上）                                            |
| x / y      | 原图放置的左上角偏移（默认 0；为负时自动居中）              |
| color      | 填充颜色（默认 `black`），支持 `red`、`0xRRGGBB`、`rgba` 等 |
| eval       | `init`（默认）/ `frame`                                     |
| aspect     | 按宽高比填充                                                |

**pad 的完整官方参数**：

| 参数       | 说明                                                                            |
| ---------- | ------------------------------------------------------------------------------- |
| width / w  | 输出宽度（0 表示取输入宽度，默认 0），可表达式                                  |
| height / h | 输出高度（同上）                                                                |
| x / y      | 原图放置的左上角偏移（默认 0），可表达式                                        |
| color      | 填充颜色（默认 `black`），支持 `red`、`0xRRGGBB`、`0xRRGGBBAA`、`rgba(...)` 等  |
| eval       | `init`（默认，只算一次）/ `frame`（逐帧求值）                                   |
| aspect     | 按宽高比自动计算输出尺寸（`aspect=16/9`），此时 width/height 不用填（实测通过） |

表达式变量：`in_w`/`iw`、`in_h`/`ih`、`out_w`/`ow`、`out_h`/`oh`、`x`、`y`、`a`（=iw/ih）、`sar`、`dar`、`hsub`、`vsub`、`n`、`t`。

```
# 在 640x480 画布上，原图放左上角 (0,40)，填充紫色
ffmpeg -i in.mp4 -vf "pad=640:480:0:40:violet" out.mp4

# 扩大到 3/2 倍并居中
ffmpeg -i in.mp4 -vf "pad='3/2*iw:3/2*ih:(ow-iw)/2:(oh-ih)/2'" out.mp4

# 制作 16:9 黑边（处理竖屏视频横向填充）
ffmpeg -i in.mp4 -vf "pad='ih*16/9:ih:(ow-iw)/2:(oh-ih)/2'" out.mp4

# 用 aspect 自动算输出尺寸并居中（无需手算宽高，实测通过）
ffmpeg -i in.mp4 -vf "pad=aspect=16/9:x=(ow-iw)/2:y=(oh-ih)/2:color=black" out.mp4

# 带 alpha 的填充色（WebM/APNG 等支持透明容器）
ffmpeg -i in.mp4 -vf "pad=iw:ih*2:(ow-iw)/2:0:color=0x00000000@0" out.mkv
```

> 颜色 `0xRRGGBBAA` 的透明度在支持 alpha 的编码器（如 qtrle、vp9_alpha、png）下才生效； `eval=frame`
> 可用于"逐帧变化"的填充色表达式。

#### rotate —— 旋转

按角度旋转视频（任意角度，非 90 度倍数会产生黑角/超出画面的虚边）。

**完整官方参数**：

| 参数          | 说明                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| angle / a     | 旋转角度（**弧度**，可表达式），如 `PI/2`、`PI/4`、`2*PI*n/25`           |
| out_w / ow    | 输出宽度，`default`（默认）按旋转后的包围盒自动扩边；`iw` 表示固定输入宽 |
| out_h / oh    | 输出高度，同上                                                           |
| fillcolor / c | 背景填充色（默认 `black`）；`none` 时透明像素（需要 alpha 容器）         |
| bilinear      | 1（默认）双线性插值，0 最近邻（边缘更硬、速度快）                        |
| rotate        | 已过时等同 angle 的别名                                                  |

表达式可用变量：`n`（帧号）、`t`（时间秒）、`in_w`/`iw`、`in_h`/`ih`、`out_w`/`ow`、`out_h`/`oh`（基于默认包围盒）、以及数学函数
`sin/cos/tan/PI/abs/floor/ceil/mod` 等（ffmpeg 表达式求值器）。

```
# 顺时针旋转 90 度（90 度整数倍用 transpose 更快更清晰）
ffmpeg -i in.mp4 -vf "rotate=PI/2" out.mp4

# 旋转 45 度、白色背景（实测通过；包围盒自动扩到能容纳旋转后的画面）
ffmpeg -i in.mp4 -vf "rotate=PI/4:fillcolor=white" out.mp4

# 每秒旋转一周（8 秒素材转 8 圈）
ffmpeg -i in.mp4 -vf "rotate='2*PI*t'" out.mp4

# 固定输出尺寸旋转（画面超出部分被裁）
ffmpeg -i in.mp4 -vf "rotate=PI/6:ow=iw:oh=ih" out.mp4
```

> 90°/180°/270° 请优先用
> `transpose`/`hflip`/`vflip`（无插值损耗）；任意角旋转必然产生重采样。输出尺寸默认按旋转包围盒变化，后续缩放/裁剪时留意分辨率变化。

#### transpose —— 翻转/转置

把行与列互换（90 度旋转，比 rotate 无重采样损耗）。

**完整官方参数**：

| 参数        | 说明                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| dir         | 0（`cclock_flip`，默认）：逆时针 90° + 垂直翻转；1（`clock`）：顺时针 90°；2（`cclock`）：逆时针 90°；3（`clock_flip`）：顺时针 90° + 垂直翻转 |
| passthrough | 0/1：输入为逐行扫描时直接透传（跳过转置），默认 0                                                                                              |
| 旧别名      | `transpose=cclock_flip` 等名称写法兼容                                                                                                         |

**dir 四种模式的实用对照**（都是"把画面立起来/转过来"的常见组合）：

| dir | 名称        | 效果                  | 典型场景                |
| --- | ----------- | --------------------- | ----------------------- |
| 0   | cclock_flip | 逆时针 90° + 垂直镜像 | 老式自拍（90°CCW+镜像） |
| 1   | clock       | 顺时针 90°            | 手机竖屏→横屏           |
| 2   | cclock      | 逆时针 90°            | 横屏→竖屏               |
| 3   | clock_flip  | 顺时针 90° + 垂直镜像 | 后置摄像头自拍修正      |

```
# 竖屏手机视频转横屏（顺时针 90 度，实测通过）
ffmpeg -i portrait.mp4 -vf "transpose=1" out.mp4

# 逆时针旋转并镜像（自拍效果）
ffmpeg -i in.mp4 -vf "transpose=0" out.mp4

# 两段式：先转置再镜像，等效 180°+翻转（处理颠倒的相机画面）
ffmpeg -i in.mp4 -vf "transpose=1,transpose=1" out.mp4
```

#### hflip / vflip —— 水平 / 垂直翻转

无参数滤镜，分别沿垂直/水平轴镜像画面：

```
ffmpeg -i in.mp4 -vf "hflip" out.mp4    # 左右镜像（实测通过）
ffmpeg -i in.mp4 -vf "vflip" out.mp4    # 上下翻转（实测通过）

# 组合：旋转 180 度（hflip+vflip 等效 rotate=PI，但无插值损耗）
ffmpeg -i in.mp4 -vf "hflip,vflip" out.mp4
```

> 注意：带 EXIF 方向元数据的照片/手机视频，先 `-autorotate`（默认开启）或加 `-display_rotation`
> 处理旋转信息，否则转置结果可能与预期相反。

#### fps —— 改变帧率

改变输出帧率（丢帧或复制帧），注意它是"输出如何生成"，不会做插值。官方参数：

| 参数       | 说明                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| fps        | 输出帧率，如 `30`、`30000/1001`；也支持常见常量：`ntsc`(30000/1001)、`pal`(25)、`film`(24)、`ntsc_film`(24000/1001) |
| start_time | 输出起始 PTS（秒），默认第一个输入帧的 PTS                                                                          |
| round      | 帧时间取整方式：`zero`/`inf`/`down`/`up`/`near`，默认 `near`                                                        |
| eof_action | 流结束时动作：`round`/`pass`/`diff`/`reset`，默认 `round`                                                           |

> 取整方式影响输出帧时间的对齐：`near` 就近取整（默认，帧率切换最小抖动）；`down`
> 向下取整（时间轴单调不超前）；`up` 向上取整。正常情况保持默认即可。

```
# 统一为 30fps（适合短视频平台）
ffmpeg -i in.mp4 -vf "fps=30" out.mp4

# 25fps 素材 → 30fps（PAL→NTSC 类转换），实测输出 30fps
ffmpeg -i in.mp4 -vf "fps=30:start_time=0:round=near" out.mp4

# 均匀抽帧到 1fps（每隔 1 秒取一帧，做缩略图序列）
ffmpeg -i in.mp4 -vf "fps=1,scale=640:360" out%04d.png

# 抽帧到 12fps（实测：8 秒源 → 12fps，时长不变）
ffmpeg -i in.mp4 -vf "fps=12:start_time=0:round=down" out.mp4
```

#### framerate —— 改变帧率（带插值）

比 fps 更 "聪明"，通过插值生成中间帧或去重，可带运动补偿（需 `--enable-libfrei0r` 等）。

| 参数                      | 说明                                                     |
| ------------------------- | -------------------------------------------------------- |
| fps                       | 目标帧率，默认 `50`                                      |
| interp_start / interp_end | 帧间插值启用的时间范围（秒）                             |
| scene                     | 场景切换检测阈值                                         |
| flags                     | 组合 `scene_detect`（场景检测）、`scd`（场景切换检测）等 |

```
# 插值到 60fps（流畅化）
ffmpeg -i in.mp4 -vf "framerate=fps=60" out.mp4
```

#### setpts —— 修改时间戳（变速/重设起点）

控制 PTS（展示时间戳），是实现视频变速、重置时间的核心。官方支持的表达式（ffmpeg-filters 文档 setpts 小节）远比直觉多：

**视频（setpts）可用常量/函数**：`PTS`（当前帧 PTS）、`STARTPTS`/`STARTT`（本段起始 PTS/时间）、`N`（0 起帧号）、`FRAME_RATE`/`FR`（当前帧率）、`TB`（时间基）、`t`（时间，即 PTS\*TB）、`PREV_INPTS`（上一输入帧 PTS）、`PREV_OUTPTS`（上一输出帧 PTS）、`RTCTIME`/`RTCSTART`（墙钟）、`POS`（文件位置）、`DURATION`、`MIN`/`MAX`/`MOD`/`NAN`
等函数。

**音频（asetpts）额外可用**：`NB_CONSUMED_SAMPLES`（本帧已消耗样本）、`NB_SAMPLES`/`S`（帧样本数）、`SAMPLE_RATE`/`SR`（采样率）、`STARTPTS`、`T`（时间）等。

常用的变速写法：

| 目标             | 写法           | 说明                                         |
| ---------------- | -------------- | -------------------------------------------- |
| 时间归零         | `PTS-STARTPTS` | 拼接/叠加前把各段时间戳归零                  |
| 2 倍速           | `PTS/2`        | 时间轴压缩一半（每帧显示时间减半，播放更快） |
| 0.5 倍速（慢放） | `PTS*2`        | 时间轴拉伸一倍                               |
| 1.5 倍速         | `PTS/1.5`      | 与音频 `atempo=1.5` 配合                     |
| 固定间隔跳帧     | `N/(TB*30)`    | 每 1/30 秒输出一帧（配合 fps）               |

**视频变速 + 音频变速同步（音画一致的实测组合）**：

```
# 1.5 倍速：视频 setpts=PTS/1.5 + 音频 atempo=1.5（保持音调），实测输出时长 = 原/1.5
ffmpeg -i in.mp4 -vf "setpts=PTS/1.5" -af "atempo=1.5" out.mp4

# 2 倍速：视频 PTS/2 + 音频 atempo=2.0，实测 8 秒源输出 4 秒
ffmpeg -i in.mp4 -vf "setpts=PTS/2" -af "atempo=2.0" out.mp4

# 0.5 倍速慢放：视频 PTS*2 + 音频 atempo=0.5，实测 8 秒源输出 ~16 秒
ffmpeg -i in.mp4 -vf "setpts=2*PTS" -af "atempo=0.5" out.mp4

# 2.5 倍速（atempo 上限限制：>2 需串联）：视频 PTS/2.5 + atempo=sqrt(2.5)*sqrt(2.5)... 简化写法
ffmpeg -i in.mp4 -vf "setpts=PTS/2.5" -af "atempo=sqrt(2.5),atempo=sqrt(2.5)" out.mp4

# 时间归零（多段拼接、overlay 对齐常用）
ffmpeg -i in.mp4 -vf "setpts=PTS-STARTPTS" out.mp4
```

> 注意：
>
> - 只改视频时间戳会改变播放速度，但**不主动丢帧/插帧**——加速后输出帧数不变、时长缩短；若需要"变速的同时保持流畅帧率"，在 setpts 后接
>   `fps` 复采样（如 `setpts=PTS/2,fps=30`）。
> - **音频加速必须用 `atempo`**（变速不变调）而不是 `asetpts=PTS/2`（那会变调或产生无声间隙）。
> - atempo 支持范围 0.5~100，**超过 2 会跳过样本产生音质劣化**，官方推荐串联多个 `atempo=sqrt(n)`
>   实现 n 倍速（已实测 sqrt(3) 串联 = 3 倍速）。

### 2.2 裁剪、拼接与叠加

#### trim —— 裁剪时间范围

| 参数                    | 说明                                      |
| ----------------------- | ----------------------------------------- |
| start                   | 开始时间（秒，支持时间格式如 `00:01:00`） |
| end                     | 结束时间                                  |
| start_pts / end_pts     | 用 PTS 指定起止                           |
| duration                | 时长                                      |
| start_frame / end_frame | 按帧号裁剪                                |

```
# 取 10 秒到 20 秒
ffmpeg -i in.mp4 -vf "trim=start=10:end=20,setpts=PTS-STARTPTS" out.mp4

# 只取前 1 秒（取第一屏）
ffmpeg -i in.mp4 -vf "trim=duration=1,setpts=PTS-STARTPTS" out.mp4
```

> trim 之后时间戳不归零，通常接 `setpts=PTS-STARTPTS`。

#### tpad —— 时间轴补帧

在开头/结尾补黑帧或复制帧。

| 参数                           | 说明                                                 |
| ------------------------------ | ---------------------------------------------------- |
| start / stop                   | 开头/结尾补的帧数（stop 为 -1 表示无限续帧）         |
| start_mode / stop_mode         | `add`（纯色帧，默认）或 `clone`（复制第一/最后一帧） |
| start_duration / stop_duration | 用时长代替帧数                                       |
| color                          | 纯色帧颜色（默认 black）                             |

```
# 结尾定格 3 秒
ffmpeg -i in.mp4 -vf "tpad=stop_mode=clone:stop_duration=3" out.mp4

# 开头加 1 秒黑场
ffmpeg -i in.mp4 -vf "tpad=start_duration=1" out.mp4
```

#### overlay —— 叠加画面

把第二个输入叠加到第一个输入之上，支持任意位置与透明度，是最常用的合成滤镜。

| 参数       | 说明                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| x / y      | 叠加位置（默认居中），可用表达式                                                    |
| eof_action | 输入 2 结束时：`repeat`（默认，重复最后一帧）/ `endall`（结束所有）/ `pass`（透传） |
| shortest   | 1 时按最短输入结束                                                                  |
| format     | 输出格式：`yuv420`（默认）/ `yuv422`/`yuv444`/`rgb`/`gbrp`/`auto`                   |
| repeatlast | 0 时不重复输入 2 的最后一帧                                                         |
| alpha      | 叠加透明度（0-1，默认 1）                                                           |
| eval       | `init`/`frame`                                                                      |

表达式变量：`main_w`/`W`、`main_h`/`H`、`overlay_w`/`w`、`overlay_h`/`h`、`x`、`y` 等。

```
# 右下角水印（留 10px 边距）
ffmpeg -i main.mp4 -i logo.png -filter_complex "[0:v][1:v]overlay=W-w-10:H-h-10" out.mp4

# 左上角叠加并半透明
ffmpeg -i main.mp4 -i logo.png -filter_complex "[0:v][1:v]overlay=10:10:alpha=0.5" out.mp4

# 画面中央二次合成（等比缩放后叠加）
ffmpeg -i main.mp4 -i sub.mp4 -filter_complex "[1:v]scale=640:360[sub];[0:v][sub]overlay=(W-w)/2:(H-h)/2" out.mp4

# 滚动的横条（x 随时间变化）
ffmpeg -i main.mp4 -i bar.png -filter_complex "[0:v][1:v]overlay=x='mod(t*50,W)':y=0" out.mp4
```

#### hstack / vstack —— 横向 / 纵向拼接

把多路视频并排显示（要求相同像素格式，hstack 要求等高、vstack 要求等宽），比 overlay+pad 更快。

| 参数     | 说明               |
| -------- | ------------------ |
| inputs   | 输入数量（默认 2） |
| shortest | 1 时按最短输入结束 |

```
# 左右分屏对比
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2" out.mp4

# 上下分屏
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][1:v]vstack=inputs=2" out.mp4
```

#### xstack —— 自定义布局拼屏

可以把多路视频按自定义坐标排布。

| 参数     | 说明                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| inputs   | 输入数量（默认 2）                                                                     |
| layout   | 布局，如 `0_0\|w0_0\|0_h0\|w0_h0`（列\_行，可用 `w0`/`h0` 引用第 0 路宽/高，`+` 求和） |
| grid     | 网格布局，如 `2x2`，必须是 `行x列`                                                     |
| shortest | 1 时按最短输入结束                                                                     |
| fill     | 空白区域填充的颜色                                                                     |

```
# 2x2 四宫格
ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -i d.mp4 \
  -filter_complex "[0:v][1:v][2:v][3:v]xstack=inputs=4:grid=2x2" out.mp4

# 自定义布局：第一路占满左列，右列上方第二路，下方第三路
ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -filter_complex \
  "[0:v][1:v][2:v]xstack=inputs=3:layout=0_0\|w0_0\|w0_h0" out.mp4
```

#### tile —— 帧拼图

把连续若干帧拼成一张大图（视频预览墙、关键帧墙）。

| 参数      | 说明                             |
| --------- | -------------------------------- |
| layout    | 网格 `列x行`（默认 `6x5`）       |
| nb_frames | 最多拼多少帧（0 = 用满整个网格） |
| margin    | 外边框（0-1024，默认 0）         |
| padding   | 帧间距（0-1024，默认 0）         |
| color     | 空白区颜色（默认 black）         |
| overlap   | 相邻帧重叠数                     |

```
# 8x8 缩略图墙（-skip_frame nokey 只取关键帧）
ffmpeg -skip_frame nokey -i in.mp4 -vf "scale=128:72,tile=8x8" -an -fps_mode passthrough keyframes%03d.png

# 每 3x2 拼 5 帧，间距 7px，外边距 2px
ffmpeg -i in.mp4 -vf "tile=3x2:nb_frames=5:padding=7:margin=2" out.png
```

#### thumbnail —— 代表帧提取

在一组连续帧中选出最有代表性的一帧。

| 参数 | 说明                             |
| ---- | -------------------------------- |
| n    | 批大小（默认 100，越大内存越高） |
| log  | 日志级别（默认 info）            |

```
# 每 50 帧选 1 帧
ffmpeg -i in.mp4 -vf "thumbnail=50,scale=300:200" -frames:v 1 out.png

# 从视频中产生 1 张封面
ffmpeg -i in.mp4 -vf "thumbnail,scale=1280:-1" -frames:v 1 cover.png
```

#### split —— 分流复制

把一个输入分成多路，供后续各分支独立处理（复杂滤镜图必备）。

```
# 同时输出原画与缩略版两路
ffmpeg -i in.mp4 -filter_complex "[0:v]split[a][b];[a]scale=1280:720[hd];[b]scale=640:360[ld]" \
  -map "[hd]" -map "[ld]" -map 0:a out.mp4
```

#### select —— 按条件选帧

根据表达式条件选择帧（丢弃不满足的帧）。常用于逐帧处理、关键帧筛选。

| 参数        | 说明                       |
| ----------- | -------------------------- |
| expr / e    | 选择表达式，为真的帧被保留 |
| outputs / n | 输出数量                   |

表达式变量/函数：`n`（帧序号）、`t`（时间）、`pts`、`selected`、`prev_selected`、`key`（是否关键帧）、`pict_type`（I/P/B）、`interlaced`、`isnan`
等。

```
# 只保留关键帧（每隔多少秒取一帧）
ffmpeg -i in.mp4 -vf "select='eq(pict_type,I)'" -vsync vfr out_%04d.png

# 每秒取 1 帧：select='not(mod(n,25))'
ffmpeg -i in.mp4 -vf "select='not(mod(n\,25))'" -vsync vfr out_%04d.png

# 取前 100 帧与奇数帧
ffmpeg -i in.mp4 -vf "select='lt(n,100)+eq(mod(n,2),1)'" -vsync vfr out_%04d.png
```

> select 之后建议加 `-vsync vfr`（或 `-fps_mode vfr`）输出可变帧率文件，避免帧率抖动。

#### xfade —— 交叉淡化转场

把两个视频输入按指定转场效果交叉拼接（两路输入必须**恒定帧率**且分辨率、像素格式、帧率、时间基一致）。

| 参数       | 说明                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| transition | 转场效果：`fade`（默认，交叉淡化）/`dissolve`/`fadeblack`/`fadewhite`/`slideleft`/`wipeleft`/`circlecrop`/`zoomin`/`smoothleft`/`pixelize`/`fadefast`/`fadeslow`/`hlwind`/`coverleft`/`revealleft`/`squeezeh` 等 60+ 种 |
| duration   | 转场时长（秒，0-60，默认 1）                                                                                                                                                                                            |
| offset     | 转场开始时刻（相对第一个输入，秒，默认 0；通常取第一段时长减转场时长，如第一段 5s 则 offset=4）                                                                                                                         |
| expr       | 自定义转场表达式（`transition=custom` 时使用，可用 X/Y/W/H/P/A/B 等变量）                                                                                                                                               |

```
# 两段视频各 5 秒，中间 1 秒交叉淡化
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "xfade=transition=fade:duration=1:offset=4" out.mp4

# 溶解转场 2 秒
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "xfade=transition=dissolve:duration=2:offset=4" out.mp4
```

> 三段以上拼接：`[0:v][1:v]xfade=...:offset=4[v01];[v01][2:v]xfade=...:offset=8[v02]`，offset 依次累加。

### 2.3 时间处理

（变速：`setpts` 见 2.1；时间裁剪：`trim` 见 2.2；此处补充周期/循环相关）

#### fade —— 视频淡入淡出

| 参数                  | 说明                         |
| --------------------- | ---------------------------- |
| type                  | `in`（淡入）或 `out`（淡出） |
| start_frame           | 起始帧号（默认 0）           |
| nb_frames             | 过渡帧数                     |
| alpha                 | 1 时对透明通道也做淡变       |
| start_time / duration | 用时间（秒）代替帧号         |

```
# 开头 1 秒淡入
ffmpeg -i in.mp4 -vf "fade=t=in:st=0:d=1" out.mp4

# 结尾 1 秒淡出（需知道总时长，配合 trim 或直接写）
ffmpeg -i in.mp4 -vf "fade=t=out:st=10:d=1" out.mp4

# CSS 风格淡入淡出自定义（黑场）
ffmpeg -i in.mp4 -vf "fade=t=in:st=0:d=1,fade=t=out:st=9:d=1" out.mp4
```

#### loop —— 循环

| 参数  | 说明                                         |
| ----- | -------------------------------------------- |
| loop  | 循环次数（-1 无限循环）                      |
| size  | 缓存帧数（默认 0 = 无限）                    |
| start | 起始帧                                       |
| time  | 按时间开始（start=-1 时生效），如 `00:00:10` |

```
# 第一帧定格循环 10 次
ffmpeg -i in.mp4 -vf "loop=loop=10:size=1:start=0" out.mp4
```

#### minterpolate —— 运动插值补帧

基于运动估计的补帧（把 24 帧补到 60 帧），速度较慢。

| 参数         | 说明                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| fps          | 输出帧率（默认 60）                                                         |
| mi_mode      | `dup` / `blend` / `mci`（运动补偿插值，默认 `mci`）                         |
| mc_mode      | 运动补偿模式：`obmc`（默认）/ `aobmc`                                       |
| me_mode      | 运动估计：`bidir` / `bilat`                                                 |
| me           | 搜索算法：`esa`/`tss`/`tdls`/`ntss`/`fss`/`ds`/`hexbs`/`epzs`（默认）/`umh` |
| mb_size      | 宏块大小（默认 16）                                                         |
| search_param | 搜索参数（默认 32）                                                         |
| scd          | 场景切换检测：`none`/`fdiff`（默认）等                                      |

```
# 24fps 补到 60fps
ffmpeg -i in.mp4 -vf "minterpolate=fps=60:mi_mode=mci" out.mp4
```

#### mpdecimate —— 去重复帧（降帧率压缩）

如果画面与上一帧几乎相同则丢弃该帧（静态画面多的录屏/监控/PPT 视频，压缩率大幅提升）。注意它只丢重复帧，输出仍是可变帧率。

| 参数           | 说明                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| mode           | 0（默认）丢相似帧；1 只在连续重复足够长时才保留代表帧                                    |
| max            | mode 0：允许连续丢弃的最大帧数（负数=最小丢弃间隔；0=不限）                              |
| min            | mode 1：判定"足够长"的最小重复帧数（默认 1）                                             |
| keep           | mode 0：开始丢弃前忽略的连续相似帧数（默认 0）                                           |
| hi / lo / frac | 丢弃阈值：无 8x8 块差超 hi，且差超 lo 的块占比≤frac（默认 hi=64*12, lo=64*5, frac=0.33） |

```
# 录屏去重复帧（用最小间隔 10 保证播放入口，输出 vfr 后接 fps 定帧率）
ffmpeg -i screen.mp4 -vf "mpdecimate=max=-10,fps=30" out.mp4

# 查看会丢多少帧（输出到空，观察 dropped 数量）
ffmpeg -i screen.mp4 -vf mpdecimate -f null -
```

### 2.4 文字、字幕与图形

#### drawtext —— 叠加文字

最常用的字幕/水印滤镜，功能强大，支持换行、阴影、描边、逐帧变化。

| 参数                            | 说明                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------- |
| fontfile                        | 字体文件路径（如 `C\:/Windows/Fonts/msyh.ttc`，注意 Windows 路径要写 `C\:/`） |
| text                            | 文本内容（支持扩展如 `%{pts}`、`%{n}`；若含 `:` 需转义）                      |
| textfile                        | 从文件读取文本（适合换行文本）                                                |
| x / y                           | 位置（默认 0），支持表达式，如 `w-tw-10`、`h-th-10`                           |
| fontsize                        | 字号                                                                          |
| fontcolor                       | 字体颜色，支持 `white@0.5` 半透明                                             |
| borderw / bordercolor           | 描边宽度 / 颜色                                                               |
| shadowx / shadowy / shadowcolor | 阴影偏移 / 颜色                                                               |
| box / boxcolor / boxborderw     | 背景框开关 / 颜色 / 内边距                                                    |
| alpha                           | 整体透明度表达式（0-1）                                                       |
| font                            | 字体族名（需 libfreetype 支持，一般不指定）                                   |
| line_spacing                    | 行距                                                                          |
| text_align                      | 对齐：`left`/`center`/`right`（换行时有效）                                   |
| enable                          | 时间线表达式（见时间线编辑）                                                  |

常用扩展符：`%{pts}`（时间）、`%{pts:gmtime}`、`%{n}`（帧号）、`%{frame_num}`、`%{metadata:...}`、`%{eif:expr}`（表达式）。

```
# 右下角水印
ffmpeg -i in.mp4 -vf "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='LOGO':fontsize=32:fontcolor=white@0.7:x=w-tw-20:y=h-th-20" out.mp4

# 左上角显示播放时间
ffmpeg -i in.mp4 -vf "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}':fontsize=28:fontcolor=yellow:x=10:y=10" out.mp4

# 带背景框与描边的居中标题
ffmpeg -i in.mp4 -vf "drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='你好世界':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:box=1:boxcolor=black@0.4:x=(w-text_w)/2:y=(h-text_h)/2" out.mp4

# 前 5 秒显示"片头"
ffmpeg -i in.mp4 -vf "drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='片头':enable='lt(t,5)':x=10:y=10" out.mp4
```

> Windows 下字体路径中的 `:` 要写成
> `'C\\:/Windows/...'`：单引号包裹整个路径值，路径内的冒号用反斜杠转义（即
> `C\:`）。已在上方示例中按此写法给出。

（在 git-bash 里运行时如果反斜杠被 MSYS 吞掉，可改用双反斜杠 `C\\:`，或把滤镜图写进文件用
`-filter_complex_script` 传入。）

#### subtitles —— 烧录外挂字幕（推荐）

把 .srt/.ass 等字幕渲染到画面上（需编译时启用 libass，且需要 libavcodec/libavformat 解析字幕文件）。

| 参数              | 说明                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| filename / f      | 字幕文件路径，必填                                                                     |
| original_size     | 原始视频尺寸（字幕是按某尺寸设计的，改画幅后用于正确缩放字体）                         |
| fontsdir          | 字体目录                                                                               |
| alpha             | 处理 alpha 通道                                                                        |
| charenc           | 非 UTF-8 字幕的字符编码                                                                |
| stream_index / si | 指定容器内的字幕流索引                                                                 |
| force_style       | 覆盖 ASS 样式，如 `force_style='Fontname=SimHei,Fontsize=20,PrimaryColour=&HCCFF0000'` |
| shaping           | `auto`（默认）/ `simple` / `complex`（复杂文字脚本需要）                               |

```
# 烧录外挂字幕
ffmpeg -i in.mp4 -vf "subtitles=sub.srt" out.mp4

# 指定字体与颜色
ffmpeg -i in.mp4 -vf "subtitles=sub.srt:force_style='Fontname=SimHei,PrimaryColour=&HFFFFFF&'" out.mp4

# 从 mkv 内嵌流烧录（第 2 条字幕流）
ffmpeg -i in.mkv -vf "subtitles=in.mkv:si=1" out.mp4
```

#### ass —— 烧录 ASS 字幕（无需容器解析）

与 subtitles 相同，但只处理 ASS 文件，不需要 libavcodec/libavformat：

```
ffmpeg -i in.mp4 -vf "ass=subs.ass" out.mp4
```

#### drawbox / drawgrid —— 画框 / 画网格

```
# 在 (10,20) 画 200x60 半透明红框
ffmpeg -i in.mp4 -vf "drawbox=x=10:y=20:w=200:h=60:color=red@0.5:t=3" out.mp4

# 全图填充粉色
ffmpeg -i in.mp4 -vf "drawbox=x=0:y=0:w=iw:h=ih:color=pink@0.5:t=fill" out.mp4

# 画 100x100 网格，线宽 2
ffmpeg -i in.mp4 -vf "drawgrid=width=100:height=100:thickness=2:color=red@0.5" out.mp4
```

### 2.5 色彩调整与键控

#### eq —— 亮度对比度饱和度

| 参数                        | 说明                              |
| --------------------------- | --------------------------------- |
| contrast                    | 对比度（-1000 到 1000，默认 1.0） |
| brightness                  | 亮度（-1.0 到 1.0，默认 0）       |
| saturation                  | 饱和度（0.0 到 3.0，默认 1.0）    |
| gamma                       | 伽马（0.1 到 10.0，默认 1.0）     |
| gamma_r / gamma_g / gamma_b | RGB 分通道伽马                    |
| gamma_weight                | 伽马权重（0-1，默认 1）           |
| eval                        | `init` / `frame`                  |

```
# 提亮并增加对比度
ffmpeg -i in.mp4 -vf "eq=brightness=0.05:contrast=1.2:saturation=1.1" out.mp4
# 电影感：降低饱和度加暗角后的伽马微调
ffmpeg -i in.mp4 -vf "eq=saturation=0.85:gamma=1.05" out.mp4
```

#### hue —— 色相 / 饱和度调节

| 参数 | 说明                         |
| ---- | ---------------------------- |
| h    | 色相偏移（度，如 90）        |
| s    | 饱和度缩放（如 1.5）         |
| H    | 色相偏移（弧度，表达式可用） |

```
# 色相偏移 90 度（肤色变绿）
ffmpeg -i in.mp4 -vf "hue=h=-30" out.mp4

# 饱和度增强 1.5 倍
ffmpeg -i in.mp4 -vf "hue=s=1.5" out.mp4

# 每秒色相旋转（转场/氛围效果）
ffmpeg -i in.mp4 -vf "hue=H=2*PI*t" out.mp4
```

#### colorbalance —— 阴影/中间调/高光三区色彩平衡

| 参数         | 说明                       |
| ------------ | -------------------------- |
| rs / gs / bs | 阴影区红/绿/蓝调整         |
| rm / gm / bm | 中间调红/绿/蓝调整         |
| rh / gh / bh | 高光区红/绿/蓝调整         |
| pl           | 1 时保持亮度不变（默认 0） |

数值范围均为 `[-1.0, 1.0]`，正值偏向主色（红/绿/蓝），负值偏向补色（青/品红/黄），默认 0。

```
# 阴影加红（胶片暖调）
ffmpeg -i in.mp4 -vf "colorbalance=rs=0.3" out.mp4

# 高光偏青（冷色调）
ffmpeg -i in.mp4 -vf "colorbalance=bh=0.2:gh=0.1" out.mp4
```

#### colorchannelmixer —— 通道混合

对输出每个通道指定输入各通道的贡献比例。

| 参数              | 说明                                                |
| ----------------- | --------------------------------------------------- |
| rr / rg / rb / ra | 输出 R 通道取输入 R/G/B/A 的比例，默认 rr=1、其余 0 |
| gr / gg / gb / ga | 输出 G 通道（同前）                                 |
| br / bg / bb / ba | 输出 B 通道                                         |
| ar / ag / ab / aa | 输出 A 通道                                         |
| pc                | 保色模式：none/lum/max/avg/sum/nrm/pwr              |
| pa                | 保色强度（0-1，默认 0）                             |

范围 `[-2.0, 2.0]`。

```
# 转灰度
ffmpeg -i in.mp4 -vf "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3" out.mp4

# 仿怀旧（sepia）
ffmpeg -i in.mp4 -vf "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" out.mp4
```

#### colorlevels —— 黑/白电平调节

| 参数                          | 说明                                                    |
| ----------------------------- | ------------------------------------------------------- |
| rimin / gimin / bimin / aimin | 各通道输入最小值（0-1，默认 0，可填 `auto` 用合法范围） |
| rimax / gimax / bimax / aimax | 各通道输入最大值                                        |
| romin / gomin / bomin / aomin | 各通道输出最小值                                        |
| romax / gomax / bomax / aomax | 各通道输出最大值                                        |

```
# 提升暗部（输入最小值 0.1 映射到输出 0）
ffmpeg -i in.mp4 -vf "colorlevels=rimin=0.1:gimin=0.1:bimin=0.1" out.mp4

# 压暗高光
ffmpeg -i in.mp4 -vf "colorlevels=romax=0.85:gomax=0.85:bomax=0.85" out.mp4
```

#### curves —— 曲线调色（Photoshop 风格）

通过关键点列表定义调整曲线。

| 参数               | 说明                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| preset             | 预设：`none`/`color_negative`/`cross_process`/`darker`/`increase_contrast`/`lighter`/`linear`（默认）/`medium_contrast`/`negative`/`strong_contrast`/`vintage` |
| master             | 主通道曲线，如 `0/0 0.5/0.6 1/1`                                                                                                                               |
| red / green / blue | R/G/B 分通道曲线（格式同上）                                                                                                                                   |
| all                | 应用到所有通道（在 master 前处理）                                                                                                                             |
| psfile             | Photoshop .acv 曲线文件                                                                                                                                        |

```
# 增加对比度（S 曲线）
ffmpeg -i in.mp4 -vf "curves=master='0/0 0.25/0.15 0.75/0.85 1/1'" out.mp4

# 胶片感（vintage 预设）
ffmpeg -i in.mp4 -vf "curves=preset=vintage" out.mp4
```

#### lut / lutrgb / lutyuv —— 查找表

对每个分量用表达式查表转换。

| 参数          | 说明                       |
| ------------- | -------------------------- |
| c0 - c3       | 各分量表达式（按格式对应） |
| r / g / b / a | RGB 分量表达式（lutrgb）   |
| y / u / v     | YUV 分量表达式（lutyuv）   |

表达式常量/函数：`val`、`clipval`、`maxval`、`minval`、`negval`（=maxval-clipval+minval）、`clip(val)`、`gammaval(gamma)`、`w`、`h`。

```
# 反相（等效 negate）
ffmpeg -i in.mp4 -vf "lutyuv=y=negval:u=negval:v=negval" out.mp4

# 伽马校正
ffmpeg -i in.mp4 -vf "lutyuv=y=gammaval(0.5)" out.mp4
```

#### negate —— 反相

| 参数         | 说明                         |
| ------------ | ---------------------------- |
| components   | 要反相的通道：y/u/v/a/r/g/b  |
| negate_alpha | 1 时同时反相 alpha（默认 0） |

```
ffmpeg -i in.mp4 -vf "negate" out.mp4
ffmpeg -i in.mp4 -vf "negate=components=y" out.mp4   # 仅反相亮度
```

#### normalize —— 自动对比度/直方图拉伸

把每帧的输入动态范围线性映射到指定输出范围（消除灰蒙蒙）。

| 参数              | 说明                                                           |
| ----------------- | -------------------------------------------------------------- |
| blackpt / whitept | 输出的黑/白点颜色（默认 black / white）                        |
| smoothing         | 时间平滑帧数（减少闪烁，默认 0）                               |
| independence      | 通道独立归一化比例（0=联动保色相，1=完全独立去色偏，默认 1.0） |
| strength          | 强度（0-1，默认 1.0）                                          |

```
# 全幅对比度拉伸（可能闪烁）
ffmpeg -i in.mp4 -vf "normalize=blackpt=black:whitept=white:smoothing=0" out.mp4

# 加 50 帧平滑且保色相
ffmpeg -i in.mp4 -vf "normalize=smoothing=50:independence=0" out.mp4
```

#### colorkey / chromakey —— 色度键（抠像）

把指定颜色变为透明，用于绿幕/蓝幕合成。

| 参数       | 说明                                               |
| ---------- | -------------------------------------------------- |
| color      | 键控颜色（默认 black）                             |
| similarity | 相似度（0.01 只抠精确颜色，1.0 全匹配；默认 0.01） |
| blend      | 混合度（0.0 硬抠，越大过渡越平滑）                 |
| yuv        | 1 表示 color 以 YUV 十六进制输入（仅 chromakey）   |

chromakey 在 YUV 空间、colorkey 在 RGB 空间（8-bit）工作。

```
# 绿幕抠像后合成到背景
ffmpeg -i bg.png -i video.mp4 -filter_complex \
  "[1:v]chromakey=green:0.1:0.2[ckout];[0:v][ckout]overlay[out]" -map "[out]" output.mkv

# 更精确的绿幕颜色（十六进制近似 #70de77）
ffmpeg -i video.mp4 -vf "chromakey=0x70de77:0.1:0.2" out.mp4
```

#### alphaextract / alphamerge —— Alpha 通道提取/合并

```
# 提取 alpha 通道为灰度视频
ffmpeg -i in.mkv -vf "alphaextract" alpha.mp4

# 把 a.mkv 的 alpha 通道合并到 b.mkv
ffmpeg -i a.mkv -i b.mkv -filter_complex "[0:v][1:v]alphamerge" out.mkv
```

#### format —— 像素格式转换

| 参数     | 说明                                                  |
| -------- | ----------------------------------------------------- |
| pix_fmts | 输出像素格式，多个用 `\|` 分隔，如 `yuv420p\|yuv444p` |

```
# 统一为 yuv420p（兼容播放器）
ffmpeg -i in.mp4 -vf "scale=1280:720,format=yuv420p" out.mp4

# 输出 10bit
ffmpeg -i in.mp4 -vf "format=yuv420p10le" out.mp4
```

#### histogram —— 直方图显示

把色彩分布直方图叠加在画面上，用于调色分析。

| 参数                  | 说明                                  |
| --------------------- | ------------------------------------- |
| level_height          | 直方图高度（50-2048，默认 200）       |
| scale_height          | 色板高度（0-40，默认 12）             |
| display_mode          | `stack`（默认）/ `parade` / `overlay` |
| levels_mode           | `linear` / `logarithmic`              |
| components            | 显示的组件（默认 7）                  |
| fgopacity / bgopacity | 前景/背景透明度（默认 0.7 / 0.5）     |
| colors_mode           | 配色模式（默认 whiteonblack）         |

```
ffmpeg -i in.mp4 -vf "histogram=display_mode=parade" out.mp4
```

### 2.6 模糊、锐化与降噪

#### unsharp —— 锐化/柔化

| 参数                                         | 说明                                              |
| -------------------------------------------- | ------------------------------------------------- |
| luma_msize_x / luma_msize_y                  | 亮度半径（3-23，默认 5）                          |
| luma_amount                                  | 亮度锐化量（-2 到 5，0 关闭；正值锐化，负值柔化） |
| chroma_msize_x / chroma_msize_y              | 色度半径（默认 5）                                |
| chroma_amount                                | 色度锐化量（默认 0）                              |
| alpha_msize_x / alpha_msize_y / alpha_amount | alpha 通道（默认 0）                              |

```
# 常规锐化
ffmpeg -i in.mp4 -vf "unsharp=5:5:1.0:5:5:0.0" out.mp4

# 轻度柔肤（负值）
ffmpeg -i in.mp4 -vf "unsharp=5:5:-0.8" out.mp4
```

#### gblur —— 高斯模糊

| 参数   | 说明                            |
| ------ | ------------------------------- |
| sigma  | 模糊强度（0-1024，默认 0.5）    |
| sigmaV | 垂直方向强度（默认同 sigma）    |
| steps  | 步数（1-2，控制近似质量）       |
| planes | 处理的平面（bitmask，默认全部） |

```
# 背景虚化
ffmpeg -i in.mp4 -vf "gblur=sigma=20" out.mp4
```

#### boxblur —— 盒式模糊

| 参数                         | 说明               |
| ---------------------------- | ------------------ |
| luma_radius / luma_power     | 亮度模糊半径与次数 |
| chroma_radius / chroma_power | 色度               |
| alpha_radius / alpha_power   | alpha              |

半径支持表达式（如 `min(h\,w)/10`）。

```
# 打码效果（配合 crop/overlay 定位）
ffmpeg -i in.mp4 -vf "boxblur=luma_radius=20:luma_power=2" out.mp4

# 前 10 秒整体模糊（时间线编辑）
ffmpeg -i in.mp4 -vf "boxblur=luma_radius=10:enable='lt(t,10)'" out.mp4
```

#### smartblur —— 保边模糊

模糊时保留边缘（锐化/柔化两用）。

| 参数                | 说明                                              |
| ------------------- | ------------------------------------------------- |
| luma_radius / lr    | 亮度半径（0.1-5.0，默认 1.0）                     |
| luma_strength / ls  | 亮度强度（-1 到 1；正=模糊，负=锐化，默认 1.0）   |
| luma_threshold / lt | 亮度阈值（-30 到 30，0=全图，正=平坦区，负=边缘） |
| chroma\_\*          | 色度对应参数（默认取亮度值）                      |
| alpha\_\*           | alpha 对应参数                                    |

```
# 柔化皮肤但保留五官轮廓
ffmpeg -i in.mp4 -vf "smartblur=ls=0.8:lt=5" out.mp4
```

#### hqdn3d —— 高质量 3D 降噪

逐帧空域+时域降噪（压噪同时提高压缩率）。

| 参数           | 说明                                     |
| -------------- | ---------------------------------------- |
| luma_spatial   | 亮度空域强度（默认 4.0）                 |
| chroma_spatial | 色度空域强度（默认 3.0\*luma_spatial/4） |
| luma_tmp       | 亮度时域强度（默认 6.0\*luma_spatial/4） |
| chroma_tmp     | 色度时域强度                             |

```
# 轻度降噪
ffmpeg -i in.mp4 -vf "hqdn3d=4:3:6" out.mp4

# 更强降噪（夜晚/低光素材）
ffmpeg -i in.mp4 -vf "hqdn3d=8:6:12:9" out.mp4
```

#### nlmeans —— 非局部均值降噪

| 参数   | 说明                            |
| ------ | ------------------------------- |
| s      | 降噪强度（1.0-30.0，默认 1.0）  |
| p      | patch 尺寸（0-99 奇数，默认 7） |
| pc     | 色度 patch 尺寸（0 自动）       |
| r / rc | 搜索范围（0-99 奇数，默认 15）  |

```
# 较强降噪（慢）
ffmpeg -i in.mp4 -vf "nlmeans=s=5" out.mp4
```

### 2.7 去交错与反交错处理

摄像机隔行扫描素材在逐行屏幕上会有梳状条纹，需要去交错（deinterlace）。

#### yadif —— 最常用的去交错滤镜

| 参数   | 说明                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------- |
| mode   | `send_frame`/0（输出 1 帧/场对，默认）、`send_field`/1（每场输出 1 帧）、`send_frame_nospatial`/2、`send_field_nospatial`/3 |
| parity | `tff`/`bff`/`auto`（默认 auto，由帧标志决定）                                                                               |
| deint  | `all`（全去交错，默认）/ `interlaced`（仅标记的交错帧）                                                                     |

```
# 通用去交错
ffmpeg -i interlaced.ts -vf "yadif" out.mp4

# 指定场序并全帧处理
ffmpeg -i interlaced.ts -vf "yadif=mode=1:parity=tff:deint=all" out.mp4
```

#### bwdif —— 改进的 Bob 去交错

| 参数   | 说明                                     |
| ------ | ---------------------------------------- |
| mode   | `send_frame`/0、`send_field`/1（默认 0） |
| parity | `tff`/`bff`/`auto`（默认 auto）          |
| deint  | `all`/`interlaced`（默认 all）           |

```
ffmpeg -i interlaced.ts -vf "bwdif" out.mp4
```

> 与 yadif 相比，bwdif 保留了更高的垂直分辨率与更少的闪烁，画质通常更好。

#### w3fdif —— 高质去交错（BBC 算法）

| 参数   | 说明                                           |
| ------ | ---------------------------------------------- |
| filter | `simple` / `complex`（默认 complex，更高质量） |
| mode   | `frame` / `field`（默认 field）                |
| parity | `tff` / `bff` / `auto`（默认 auto）            |
| deint  | `all` / `interlaced`（默认 all）               |

```
# 高质量慢速去交错
ffmpeg -i interlaced.ts -vf "w3fdif=filter=complex:mode=frame" out.mp4
```

#### nnedi —— 神经网络边缘导向去交错

画质最高的去交错方案之一（需要权重文件 nnedi3_weights.bin）。

| 参数    | 说明                                             |
| ------- | ------------------------------------------------ |
| weights | 权重文件路径（必填）                             |
| deint   | `all` / `interlaced`                             |
| field   | `af`/`a`/`t`/`b`/`tf`/`bf`                       |
| planes  | 处理的平面                                       |
| nsize   | 邻域尺寸 s8x6/s16x6/s32x6/s48x6/s8x4/s16x4/s32x4 |
| nns     | 神经元数 n16/n32/n64/n128/n256                   |
| qual    | `fast`/`default`/`slow`                          |
| etype   | `a`（绝对误差）/ `s`（平方误差）权重             |
| pscrn   | 预筛选：none/original/new/new2/new3              |

#### fieldmatch —— 反胶转磁（inverse telecine）

把 3:2 pulldown 的隔行源还原为逐行（电影 24fps 还原），通常需要再接 decimate 去重帧。

| 参数    | 说明                                                         |
| ------- | ------------------------------------------------------------ |
| order   | `auto`/`bff`/`tff`（默认 auto）                              |
| mode    | `pc` / `pc_n`（默认）/ `pc_u` / `pc_n_ub` / `pcn` / `pcn_ub` |
| ppsrc   | 1 时启用第二输入作为干净源                                   |
| field   | `auto`/`bottom`/`top`                                        |
| mchroma | 是否包含色度比较（默认 1）                                   |

```
# 反胶转磁：30fps 源还原为 24fps
ffmpeg -i dv.avi -vf "fieldmatch,decimate" out.mp4

# 混合内容（含真交错部分）时在中间加 yadif
ffmpeg -i mixed.ts -vf "dejudder,fps=30000/1001,fieldmatch,yadif,decimate" out.mp4
```

#### idet —— 检测场序/是否交错

不改变画面，只输出检测结果（metadata 与日志），用于确定是否去交错、场序是 TFF 还是 BFF。

| 参数                    | 说明                                    |
| ----------------------- | --------------------------------------- |
| intl_thres / prog_thres | 交错/逐行判定阈值                       |
| rep_thres               | 重复场检测阈值                          |
| half_life               | 统计半衰期（帧数，0=全部计入）          |
| analyze_interlaced_flag | 用 N 帧验证流的 interlaced 标志是否准确 |

```
# 检查前 360 帧的场序
ffmpeg -i input.ts -filter:v "idet,metadata=mode=print" -frames:v 360 -an -f null -
```

### 2.8 画质分析与诊断

#### signalstats —— 视频信号统计

输出每帧 Y/U/V 的 min/low/avg/high/max、饱和度、色相、位深、帧间差等指标，写入帧 metadata（前缀
`lavfi.signalstats.*`），可用于检测过曝、黑场、非法广播电平。

| 参数      | 说明                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| stat      | 附加分析：`tout`（时间异常像素）/ `vrep`（垂直重复行）/ `brng`（超出合法广播范围） |
| out       | 与 stat 对应，输出高亮标记画面                                                     |
| color / c | 高亮颜色（默认 yellow）                                                            |

主要 metadata 键：`YMIN/YLOW/YAVG/YHIGH/YMAX`、`UMIN…`、`VMIN…`、`SATMAX`、`HUEMED/HUEAVG`、`YDIF/UDIF/VDIF`、`YBITDEPTH`
等。

```
# 查看亮暗统计
ffmpeg -i in.mp4 -vf "signalstats" -f null -

# 把超范围像素标记为红色输出
ffmpeg -i in.mp4 -vf "signalstats=out=brng:color=red" out.mp4

# 叠加实时数值文本（配合 drawtext 与 metadata）
ffmpeg -i in.mp4 -vf "signalstats,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Y %{metadata:lavfi.signalstats.YAVG}':x=10:y=10" out.mp4
```

#### showinfo —— 帧信息打印

逐帧打印帧号、PTS、时间、像素格式、宽高、场序、关键帧标记、校验和、均值与标准差等，不改变画面。

```
ffmpeg -i in.mp4 -vf "showinfo" -f null -
```

#### cropdetect —— 自动检测黑边裁剪参数

检测视频内容区域（黑边），输出建议的 crop 参数（日志中显示 `crop=...`）。

| 参数                | 说明                                                   |
| ------------------- | ------------------------------------------------------ |
| mode                | `black`（默认，按黑边）/ `mvedges`（按运动矢量与边缘） |
| limit               | 黑电平阈值（0-255，默认 24；8bit 之外用 0-1 比例）     |
| round               | 宽高需整除的值（默认 16；2=仅要求偶数，适合 4:2:2）    |
| skip                | 跳过开头 N 帧（默认 2）                                |
| reset_count / reset | 每 N 帧重置检测（0=永不重置）                          |
| mv_threshold        | 运动阈值（默认 8）                                     |
| low / high          | Canny 边缘检测低/高阈值（0-1，默认 5/255 与 15/255）   |

```
# 检测黑边
ffmpeg -i in.mp4 -vf "cropdetect" -f null - 2>&1 | grep crop=

# 取检测结果应用
ffmpeg -i in.mp4 -vf "crop=720:480:0:30" out.mp4
```

#### scdet —— 场景切换检测

通过帧间差（MAFD）检测镜头切换，输出 metadata `lavfi.scd.mafd` / `lavfi.scd.score` /
`lavfi.scd.time`。

| 参数          | 说明                                     |
| ------------- | ---------------------------------------- |
| threshold / t | 切换阈值（0-100，推荐 8-14，默认 10）    |
| sc_pass / s   | 1 时只把切换帧传给下游（截取关键帧快照） |

```
# 打印场景切换时间
ffmpeg -i in.mp4 -vf "scdet,metadata=print:file=-" -f null -

# 提取每个场景的切换帧（结合 select）
ffmpeg -i in.mp4 -vf "scdet=threshold=10:sc_pass=1,select='gt(scene,0)'" -vsync vfr snapshot_%04d.png
```

#### freezedetect —— 冻结画面检测

检测视频画面卡住（无变化）的区间，输出 `lavfi.freezedetect.freeze_start` / `freeze_duration` /
`freeze_end`。

| 参数         | 说明                              |
| ------------ | --------------------------------- |
| noise / n    | 噪声容差（dB 或比值，默认 -60dB） |
| duration / d | 判定冻结的最小时长（默认 2 秒）   |

```
ffmpeg -i in.mp4 -vf "freezedetect=n=-50dB:d=2,metadata=print:file=-" -f null -
```

#### deflicker —— 闪烁去除

去除光照闪烁（如荧光灯、太阳穿过云层引起的亮度波动）。

| 参数     | 说明                              |
| -------- | --------------------------------- |
| size / s | 滑动平均窗口帧数（2-129，默认 5） |
| mode / m | am/gm/hm/qm/cm/pm/median，默认 am |
| bypass   | 1 时不修改画面只输出 metadata     |

```
ffmpeg -i flicker.mp4 -vf "deflicker=size=9:mode=pm" out.mp4
```

#### psnr / ssim —— 画质对比（客观评分）

用两路输入逐帧比对客观画质（转码/滤镜是否引入损失）。第一路为主视频原样通过，第二路为参考视频；两路必须**同分辨率、同像素格式、同帧数**。PSNR 越高越好（>40dB 人眼几乎无差别），SSIM 越接近 1 越好。

| 参数           | 说明                                                 |
| -------------- | ---------------------------------------------------- |
| stats_file / f | 把逐帧得分写入文件（`-` 输出到标准输出）             |
| stats_version  | 日志格式版本（默认 1，≥2 时输出各分量明细，仅 psnr） |
| output_max     | 是否在日志中输出最大值（默认 0，仅 psnr，需版本≥2）  |

```
# 对比原片与转码片的 PSNR / SSIM（两路时间戳先对齐）
ffmpeg -i orig.mp4 -i trans.mp4 -lavfi \
  "[0:v]settb=AVTB,setpts=PTS-STARTPTS[m];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[m][r]psnr=stats_file=psnr.log" -f null -
```

> 时间戳不一致务必加 `settb=AVTB,setpts=PTS-STARTPTS` 对齐，否则逐帧错位会导致结果无意义。

### 2.9 其它常用视频滤镜

#### blend —— 双输入混合

两个输入按表达式逐像素混合（需同尺寸同格式）。

| 参数                              | 说明                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| all_mode                          | 混合模式：addition/add（默认）/addition128/and/divide/grainmerge/or/softlight/subtract/xor/... |
| all_expr                          | 自定义混合表达式                                                                               |
| c0mode / c1mode / c2mode / c3mode | 各通道独立模式                                                                                 |

```
# 两张图平均混合
ffmpeg -i a.png -i b.png -filter_complex "[0:v][1:v]blend=all_mode='average'" out.png
```

#### tblend —— 与前一帧混合（残影效果）

```
ffmpeg -i in.mp4 -vf "tblend=all_mode=screen" out.mp4
```

#### vignette —— 暗角

| 参数    | 说明                                |
| ------- | ----------------------------------- |
| angle   | 暗角强度（弧度表达式，默认 `PI/5`） |
| x0 / y0 | 中心偏移                            |
| mode    | `forward`（默认）/ `backward`       |
| eval    | `init`/`frame`                      |

```
# 轻微暗角（电影感）
ffmpeg -i in.mp4 -vf "vignette=PI/4" out.mp4
```

#### zoompan —— 推拉摇移（Ken Burns）

对单帧图片做缩放平移产生运动效果（也常用于视频）。

| 参数  | 说明                                            |
| ----- | ----------------------------------------------- |
| zoom  | 缩放表达式（如 `min(zoom+0.0015,1.5)`、`1.5`）  |
| x / y | 平移表达式（如 `iw/2-(iw/zoom/2)`）             |
| d     | 每张输入图输出帧数（默认 1，做视频常设 125 等） |
| s     | 输出尺寸（默认 hd720）                          |
| fps   | 输出帧率（默认 25）                             |

```
# 图片缓慢推近
ffmpeg -loop 1 -i photo.jpg -vf "zoompan=z='min(zoom+0.0015,1.5)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=25" -t 5 out.mp4

# 横向摇移
ffmpeg -loop 1 -i photo.jpg -vf "zoompan=z=1.2:d=125:x='(iw-iw/zoom)*on/125':y='ih/2-(ih/zoom/2)':s=1280x720:fps=25" -t 5 out.mp4
```

#### deshake —— 视频防抖

尝试修正手持拍摄/车辆颠簸造成的水平与垂直方向微小位移。

| 参数          | 说明                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| x / y / w / h | 限定运动向量搜索区域（-1=整帧，默认整帧，配合 drawbox 查看区域）            |
| rx / ry       | x/y 方向最大位移像素（0-64，默认 16）                                       |
| edge          | 边缘填充：`blank,0`/`original,1`/`clamp,2`（拉伸）/`mirror,3`（镜像，默认） |
| blocksize     | 运动搜索块大小（4-128，默认 8）                                             |
| contrast      | 块对比度阈值（1-255，默认 125，低对比块忽略）                               |
| search        | `exhaustive,0`（默认，穷举）/ `less,1`（快速）                              |
| filename      | 输出运动搜索详细日志到指定文件                                              |

```
# 手持视频防抖（默认参数）
ffmpeg -i shaky.mp4 -vf "deshake" out.mp4

# 只做水平防抖（比如拍摄时只有水平抖动）
ffmpeg -i shaky.mp4 -vf "deshake=rx=32:ry=5:edge=clamp" out.mp4
```

> deshake 基于运动估计，画面内容若有大范围主体运动或转场，会误判，建议先裁剪掉帧边缘再处理。

#### delogo —— 去台标 / 水印

用周围像素插值覆盖指定矩形区域（对静止台标/水印有效，动画或有纹理背景效果可能不佳）。

| 参数          | 说明                             |
| ------------- | -------------------------------- |
| x / y / w / h | 台标矩形左上角坐标与宽高（必填） |
| show          | 1 时画绿色矩形帮助定位（默认 0） |

> 注意：插值需要矩形外侧的像素，因此矩形**不能贴边**（x/y 至少留 1 像素余量），且不能超出画面边界。

```
# 先加 show=1 输出一帧定位台标位置
ffmpeg -i in.mp4 -vf "delogo=show=1" -frames:v 1 -update 1 probe.png

# 确认矩形后去掉台标（如距左/上各 10px，宽高 100x77）
ffmpeg -i in.mp4 -vf "delogo=x=10:y=10:w=100:h=77" out.mp4
```

# 先加 show=1 输出一帧定位台标位置

ffmpeg -i in.mp4 -vf "delogo=show=1" -frames:v 1 -update 1 probe.png

# 确认矩形后去掉台标（如左上角 100x77）

ffmpeg -i in.mp4 -vf "delogo=x=0:y=0:w=100:h=77" out.mp4

```

#### noise —— 添加噪点

给视频添加噪声（可加颗粒感 / 模拟胶片 / 破坏压缩痕迹）。

| 参数                       | 说明                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ |
| all_seed / cN_seed         | 噪声种子（默认 123457，cN 按分量）                                                   |
| all_strength / cN_strength | 噪声强度（0-100，常用 10-50）                                                        |
| all_flags / cN_flags       | 标志：`a` 时域平滑 / `p` 伪随机图案 / `t` 逐帧变化（时域）/ `u` 均匀分布（默认高斯） |

```

# 胶片颗粒感（时域 + 均匀，强度 20）

ffmpeg -i in.mp4 -vf "noise=alls=20:allf=t+u" out.mp4

```

#### deblock —— 去块效应

去除视频压缩产生的块状伪影（适合转码自低码率素材或老视频）。

| 参数         | 说明                                                       |
| ------------ | ---------------------------------------------------------- |
| filter       | `weak`（默认）/ `strong`（更强，可能软化细节）/ `disabled` |
| block        | 块大小（4/8/16，默认 8）                                   |
| alpha / beta | 强度阈值（默认 0.098），越大去除越多                       |

```

# 去除 8x8 块效应（转码老视频）

ffmpeg -i blocky.mp4 -vf "deblock=filter=weak:block=8:alpha=0.1:beta=0.1" out.mp4

```

#### geq —— 像素级表达式变换

对每个像素的 RGBA/YUVA 分量用表达式重新计算，可实现各种数学滤镜（亮度/对比度/伪 3D/滤镜矩阵等），自由度最高但也最慢。

| 参数                     | 说明                                |
| ------------------------ | ----------------------------------- |
| lum_expr                 | 亮度（或灰度情况下的 Y）表达式      |
| cb_expr / cr_expr        | Cb/Cr 分量表达式                    |
| alpha_expr               | 透明度表达式                        |
| r_expr / g_expr / b_expr | RGB 分量表达式（像素格式为 RGB 时） |

表达式内可用变量：`X`/`Y`（坐标）、`W`/`H`（宽高）、`N`（帧号）、`T`（时间）、`p(x,y)`（取像素函数）等。

```

# 亮度翻倍（提亮）

ffmpeg -i in.mp4 -vf "geq=lum='p(X,Y)\*2'" out.mp4

# 1.2 倍亮度 + 0.8 对比度

ffmpeg -i in.mp4 -vf "geq=lum='(p(X,Y)-128)\*0.8+128+25'" out.mp4

```

> 简单需求优先用 eq/curves/lut 等专用滤镜，geq 只在需要自定义数学变换时使用。

#### fps_mode / vsync 相关注意

`-vf fps=30` 修改帧率；而 `-fps_mode vfr`（旧
`-vsync vfr`）是输出模式选项（可变帧率），配合 select/thumbnail 等抽取帧场景使用，二者不同。

---

## 三、音频滤镜

### 3.1 音量、响度与混音

#### volume —— 音量调节

| 参数       | 说明                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| volume     | 音量表达式：数值（如 0.5、2.0）、dB（如 `10dB`）、表达式（如 `1.5`、`lt(t,5)*0.5`） |
| precision  | 精度：`fixed`/`float`/`double`（默认 float）                                        |
| eval       | `once`（默认，只算一次）/ `frame`（逐帧求值）/ `sample`                             |
| replaygain | 是否使用 ReplayGain 元数据：`track`/`album`/`no`（默认 no）                          |
| replaygain_preamp | ReplayGain 预增益 dB（默认 0，仅 replaygain 生效时）                         |
| replaygain_noclip | 1 时按 ReplayGain 增益后防削波（自动压低）                                  |

表达式可用常量：`n`（帧号）、`nb_channels`（声道数）、`nb_consumed_samples`、`nb_samples`、`pos`（帧位置）、`pts`、`sample_rate`、`startpts`、`startt`、`t`（时间）、`tb`、`volume`（当前音量）。

```

# 音量减半

ffmpeg -i in.mp3 -af "volume=0.5" out.mp3

# 提升 6dB（+6dB ≈ 电压翻倍）

ffmpeg -i in.mp3 -af "volume=6dB" out.mp3

# 前 5 秒静音、之后正常（eval=frame 必须，逐帧求值）

ffmpeg -i in.mp3 -af "volume='if(lt(t,5),0,1)':eval=frame" out.mp3

# 渐入渐出音量（0~2 秒从 0 线性到 1，8~10 秒回到 0）

ffmpeg -i in.mp3 -af "volume='if(lt(t,2),t/2,if(gt(t,8),(10-t)/2,1))':eval=frame" out.mp3

# 响度回放增益：利用文件内嵌 RG 元数据

ffmpeg -i in.mp3 -af "volume=replaygain=track:replaygain_preamp=2" out.mp3

# 静音检测后自动削波保护（noclip）

ffmpeg -i in.mp3 -af "volume=8dB:replaygain_noclip=1" out.mp3

```

> 提升超过 0dB 会削波（clipping），需要时配合 `alimiter` 或 `loudnorm` 保证不失真。

#### volumedetect —— 音量检测（只分析）

输出平均/最大/最小音量与 RMS 电平到日志，常用作"这个视频多大声"的检测。

```

ffmpeg -i in.mp4 -af "volumedetect" -f null -

```

输出示例：`mean_volume: -18.6 dB`、`max_volume: -2.1 dB`，可作为调节依据。

#### loudnorm —— EBU R128 响度归一化

广播/平台标准响度处理（YouTube -14 LUFS、流媒体 -16 LUFS 常见）。

| 参数                                                      | 说明                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| I / i                                                     | 集成响度目标（-70 到 -5，默认 -24 LUFS）                                     |
| LRA / lra                                                 | 响度范围目标（1-50，默认 7 LU）                                              |
| TP / tp                                                   | 真实峰值上限（-9 到 0，默认 -2 dBTP）                                        |
| measured_I / measured_LRA / measured_TP / measured_thresh | 单遍模式下输入的实测值（用 `ffmpeg -af loudnorm=print_format=summary` 先测） |
| offset                                                    | 补偿增益（默认 0）                                                           |
| linear                                                    | `true`（默认线性）/ `false`（动态），线性需要提供 measured\_\*               |
| dual_mono                                                 | 1 时把单声道按"双单声道"测量                                                 |
| print_format                                              | `summary`/`json`/`none`                                                      |
| stats_file                                                | 统计输出文件（`-` 为标准输出）                                               |

```

# 两遍法：先测

ffmpeg -i in.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=summary" -f null -

# 再以实测值线性归一化

ffmpeg -i in.wav -af
"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-23.5:measured_LRA=9.2:measured_TP=-5.1:measured_thresh=-33.0:linear=true"
out.wav

# 单遍动态模式（直播/快速处理）

ffmpeg -i in.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11:linear=false" out.wav

```

#### alimiter —— 限制器

| 参数                                   | 说明                             |
| -------------------------------------- | -------------------------------- |
| level_in                               | 输入增益（默认 1）               |
| level_out                              | 输出增益（默认 1）               |
| limit                                  | 限制电平（0.0625-1，默认 1）     |
| attack / release                       | 启动/释放时间（默认 5ms / 50ms） |
| asc / asc_level                        | 自动释放调整                     |
| level / level_enabled / level_duration | 电平显示                         |

```

# 限制在 -6dB 左右（limit=0.5）

ffmpeg -i in.wav -af "alimiter=limit=0.5" out.wav

```

#### amix —— 多路混音

把多个音频输入混为一路（常见"背景音乐+人声"合成）。**输入来自不同文件时**必须与 `-filter_complex` 配合
（每个输入流独立命名），单输入多流也可以用 `-af`。

| 参数               | 说明                                   |
| ------------------ | -------------------------------------- |
| inputs             | 输入数量（默认 2）                     |
| duration           | `longest`（默认）/`shortest`/`first`   |
| dropout_transition | 某一路结束后的过渡时长（默认 2 秒）    |
| weights            | 各输入权重（空格分隔，缺省沿用最后值） |
| normalize          | 1（默认）自动归一化防削波              |

```

# 人声 + 背景乐（音乐音量降为 1/4 权重，实测：输出与最长输入等长）

ffmpeg -i vocal.wav -i music.mp3 -filter_complex \
 "amix=inputs=2:duration=longest:dropout_transition=0:weights='1 0.25':normalize=1" out.wav

# 三路混音，按时长最短的结束

ffmpeg -i a.wav -i b.wav -i c.wav -filter_complex "amix=inputs=3:duration=shortest" out.wav

# 关闭归一化（各输入原音量相加，容易削波，适合后续再 limiter）

ffmpeg -i vocal.wav -i music.mp3 -filter_complex \
 "amix=inputs=2:normalize=0,alimiter=limit=0.95" out.wav

# 立体声/单声道混音后统一声道布局（amix 输出默认与第一路一致）

ffmpeg -i mono.wav -i stereo.wav -filter_complex \
 "[0:a]aresample=48000:stereo[a0];[1:a]aresample=48000:stereo[a1];[a0][a1]amix=inputs=2" out.wav

```

> 权重是纯数字（如 `1 0.25`）表示乘法增益；`weights` 数量不足时最后一个值对剩余输入生效。
> 混合后总响度会升高，开 `normalize=1`（默认）可自动防削波，或关掉后用 `alimiter` 做响度限制。

# 人声 + 背景乐（音乐音量降为 1/4 权重）

ffmpeg -i vocal.wav -i music.mp3 -filter_complex \
 "amix=inputs=2:duration=longest:dropout_transition=0:weights='1 0.25':normalize=1" out.wav

# 三路混音，按时长最短的结束

ffmpeg -i a.wav -i b.wav -i c.wav -filter_complex "amix=inputs=3:duration=shortest" out.wav

```

#### sidechaincompress —— 侧链压缩（自动闪避）

用第二路输入（侧链信号）控制第一路（主信号）的压缩：侧链越响，主信号压得越狠。常用于"人声进来时背景音乐自动变小"（ducking）。

| 参数      | 说明                                               |
| --------- | -------------------------------------------------- |
| level_in  | 主信号输入增益（默认 1，范围 0.015625-64）         |
| mode      | `downward`（默认）/ `upward`                       |
| threshold | 侧链触发阈值（默认 0.125，范围 0.00097563-1）      |
| ratio     | 压缩比 1-20（默认 2：侧链高 4dB 则主信号只低 2dB） |
| attack    | 启动时间 ms（默认 20）                             |
| release   | 释放时间 ms（默认 250）                            |
| makeup    | 压缩后补偿增益 1-64（默认 1）                      |
| knee      | 膝点柔度 1-8（默认 2.82843）                       |
| link      | 侧链声道联动：`average`（默认）/ `maximum`         |
| detection | 检测方式：`peak` / `rms`（默认，更平滑）           |
| level_sc  | 侧链输入增益（默认 1）                             |
| mix       | 压缩信号混入比例 0-1（默认 1）                     |

```

# 背景音乐随人声自动闪避（音乐 -8dB，attack 快、release 慢）

ffmpeg -i voice.wav -i music.mp3 -filter_complex \
 "[1:a]asplit=2[sc][mix];[0:a][sc]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300:makeup=1[compr];[compr][mix]amix=inputs=2"
out.wav

```

#### amerge —— 多路并轨（合成立体声/多声道）

把 N 路声道布局独立的音频合并为一路多声道（要求采样率与格式相同）。

| 参数        | 说明                                                    |
| ----------- | ------------------------------------------------------- |
| inputs      | 输入数量（默认 2）                                      |
| layout_mode | `legacy`（默认）/ `reset`（不重排，仅计总数）/ `normal` |

```

# 两个单声道合成立体声

ffmpeg -i left.wav -i right.wav -filter_complex "[0:a][1:a]amerge" out.wav

# 6 路音频合并（来自 mkv 的多音轨）

ffmpeg -i in.mkv -filter_complex "[0:1][0:2][0:3][0:4][0:5][0:6]amerge=inputs=6" -c:a pcm_s16le
out.mkv

```

> 注意：`amerge` 不做"混合"，只做"并排"；声道数相加。需要叠加混合用 `amix`，需要重映射/下混用
> `pan`。

#### pan —— 声道重映射与混音

通用声道矩阵工具：下混、上混、交换声道、静音某声道。

| 参数       | 说明                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 第一个参数 | 输出声道布局（如 stereo 或 5.1）                                                                           |
| 后续参数   | 每个输出声道的定义：`out_name=[gain*]in_name[([+-][gain*]in_name)...]`；`<` 表示自动归一化增益（总和为 1） |

```

# 立体声下混为单声道（左 0.9 + 右 0.1）

ffmpeg -i stereo.wav -af "pan=mono|c0=0.9*c0+0.1*c1" out.wav

# 5.1 保留 L/R 做立体声

ffmpeg -i 5_1.wav -af "pan=stereo|c0=FL|c1=FR" out.wav

# 交换左右声道

ffmpeg -i stereo.wav -af "pan=stereo|c0=c1|c1=c0" out.wav

# 环绕下混为立体声（LFE 并入左右）

ffmpeg -i 5_1.wav -af "pan=stereo|FL<FL+0.5*FC+0.6*BL+0.6*SL|FR<FR+0.5*FC+0.6*BR+0.6*SR" out.wav

```

> ffmpeg 自带的 `-ac 2` 下混更简单，除非有特殊需求才用 pan。

### 3.2 音频时间处理

#### atempo —— 变速不变调

音频变速的标准滤镜（WSOLA 算法，变速时保持音调）。实测：8 秒音频 `atempo=2.0`
输出 4 秒、`atempo=0.5` 输出 16 秒，与时间戳严格对应。

| 参数  | 说明                                                                     |
| ----- | ------------------------------------------------------------------------ |
| tempo | 速度（0.5-100，默认 1.0）；**超过 2 会跳过样本，音质下降**，官方建议串联 |

```
# 放慢 20%
ffmpeg -i in.mp3 -af "atempo=0.8" out.mp3

# 加速到 300%（两级串联 sqrt(3)*sqrt(3)≈3，保持音质，实测通过）
ffmpeg -i in.mp3 -af "atempo=sqrt(3),atempo=sqrt(3)" out.mp3

# 2.5 倍速（sqrt(2.5) 两级串联）
ffmpeg -i in.mp3 -af "atempo=sqrt(2.5),atempo=sqrt(2.5)" out.mp3

# 视频音频同步 1.5 倍速（视频 setpts 配 atempo，音画长度一致）
ffmpeg -i in.mp4 -vf "setpts=PTS/1.5" -af "atempo=1.5" out.mp4
```

> **变速 + 变调（"花栗鼠"效果）**：单独用 `asetrate` 配合重采样，例如
> `-af asetrate=48000*0.9,aresample=48000`（音调降低 10% 速度不变）；变调但速度不变：`asetrate=48000*1.1,aresample=48000,atempo=1.1`（先提速再拉回，音调升高）。一句话：变调用
> `asetrate`，变速用 `atempo`，两者组合可实现独立控制。

#### adelay —— 延迟

| 参数   | 说明                                             |
| ------ | ------------------------------------------------ | -------------------------------------------------------------- |
| delays | 各声道延迟（`                                    | `分隔，默认单位**毫秒**；数字后加`S`= 精确样本数，加`s` = 秒） |
| all    | 1 时把最后一个延迟值应用到所有剩余声道（默认 0） |

```

# 左声道延迟 500ms（回音立体声效果）

ffmpeg -i in.wav -af "adelay=500|0" out.wav

# 精确延迟 1024 个样本（第二声道），第三声道 700 样本

ffmpeg -i in.wav -af "adelay=0|1024S|700S" out.wav

# 所有声道统一延迟 64 样本

ffmpeg -i in.wav -af "adelay=delays=64S:all=1" out.wav

```

> 延迟不足的声道位置以静音填充；需要"回声（保留原声）"用 `aecho`，需要"循环重复（淡出回声）"用
> `aecho` 加大 delays，单纯延迟请用 `adelay`。

# 左声道延迟 500ms（回音立体声效果）

ffmpeg -i in.wav -af "adelay=500|0" out.wav

```

#### apad —— 补静音

在音频后面补静音（与视频 tpad 对应）。

| 参数                | 说明                          |
| ------------------- | ----------------------------- |
| pad_len / whole_len | 补多少样本 / 总长度（样本数） |
| pad_dur / whole_dur | 补 0.5 秒 / 总时长 10 秒      |

```

# 补 2 秒静音

ffmpeg -i in.m4a -af "apad=pad_dur=2" out.m4a

# 总时长凑满 10 秒

ffmpeg -i in.m4a -af "apad=whole_dur=10" out.m4a

```

#### atrim —— 音频裁剪

| 参数                      | 说明                    |
| ------------------------- | ----------------------- |
| start / end               | 起止时间（秒/时间格式） |
| start_pts / end_pts       | 起止 PTS                |
| duration                  | 时长                    |
| start_sample / end_sample | 按样本裁剪              |

```

# 取 0:30 到 1:00

ffmpeg -i in.mp3 -af "atrim=start=30:end=60,asetpts=PTS-STARTPTS" out.mp3

```

> 与视频 trim 相同，裁剪后接 `asetpts=PTS-STARTPTS` 归零时间戳。

#### afade —— 音频淡入淡出

| 参数       | 说明                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| type       | `in` / `out`                                                                                                                 |
| start_time | 起始时间（默认 0）                                                                                                           |
| duration   | 过渡时长（默认 0）                                                                                                           |
| curve      | `tri`（默认三角）/`qsin`/`hsin`/`esin`/`log`/`ipar`/`qua`/`cub`/`squ`/`cbr`/`par`/`exp`/`iqsin`/`ihsin`/`dese`/`desi`/`losi` |

```

# 首尾各 2 秒淡入淡出

ffmpeg -i in.mp3 -af "afade=t=in:st=0:d=2,afade=t=out:st=58:d=2" out.mp3

```

#### acrossfade —— 交叉淡化（音频转场）

两路音频首尾交叉混叠过渡。

| 参数         | 说明                                                     |
| ------------ | -------------------------------------------------------- |
| inputs / n   | 参与交叉淡化的输入数（默认 2，多输入时依次串联交叉淡化） |
| nb_samples   | 过渡持续样本数（默认 44100，即默认约 1 秒@44.1kHz）      |
| duration / d | 过渡时长；设置后优先于 nb_samples                        |
| overlap / o  | 1（默认）时第一路结尾与第二路开头重叠                    |
| curve1 / c1  | 第一路过渡曲线（类型同 afade，如 `tri`/`exp`/`qsin` 等） |
| curve2 / c2  | 第二路过渡曲线                                           |

```

# 两路音频 10 秒指数曲线交叉淡化

ffmpeg -i a.flac -i b.flac -filter_complex "acrossfade=d=10:c1=exp:c2=exp" out.flac

# 无重叠（前一段播完再淡入后一段）

ffmpeg -i a.flac -i b.flac -filter_complex "acrossfade=d=10:o=0:c1=exp:c2=exp" out.flac

# 三段依次交叉淡化

ffmpeg -i a.flac -i b.flac -i c.flac -filter_complex "acrossfade=n=3" out.flac

```

> 曲线类型取值与 afade 一致，运行时可用 `ffmpeg -h filter=acrossfade` 确认本机支持的取值。

#### asetrate —— 改变采样率解释（变速变调）

```

# 音调升高（无需重采样时 44100→48000 解释）

ffmpeg -i in.wav -af "asetrate=48000,aresample=44100" out.wav

```

### 3.3 音频重采样与格式

#### aresample —— 重采样

基于 libswresample 的重采样滤镜，语法为
`aresample=[sample_rate:]resampler_options`（冒号分隔 key=value）。除采样率外，它的完整参数来自
**ffmpeg-resampler 手册（Resampler Options）**，常用如下：

| 参数           | 说明                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| sample_rate    | 目标采样率（0=不变，也可作为位置参数写在冒号前）                                   |
| sample_fmt     | 采样格式（如 `fltp`、`s16`、`s32`）                                                |
| channel_layout | 声道布局（如 `stereo`、`mono`、`5.1`）                                             |
| async          | 时间戳补偿：`async=1` 拉伸/压缩样本匹配时间戳；`async=1000` 每秒最多补偿 1000 样本 |
| first_pts      | 首帧 PTS（单位 1/AV_TIME_BASE 秒），用于对多路输入对齐起点                         |
| min_hard_comp  | 硬补偿触发阈值（默认 0.1）：时间差小于此值用软补偿                                 |
| soft_comp      | 软补偿强度（默认 0.0，即使用最小二乘拉伸）                                         |
| max_soft_comp  | 最大软补偿量（默认 0，0 表示可无限）                                               |
| max_comp       | 一次硬补偿的最大样本数（默认 0=无限制）                                            |
| filter_size    | 重采样滤波器长度（默认 16），越大质量越高越慢                                      |
| phase_shift    | 线性相位特性（默认 10，取值 -21~30），-1 关闭线性相位                              |
| linear_interp  | 1 启用线性插值（默认 0）                                                           |
| cutoff         | 低通截止比例（默认 0.97）                                                          |
| dither_method  | 抖动算法（如 `rectangular`、`triangular`、`error`，默认 none）                     |

```

# 统一为 48kHz 立体声 float（常用规范）

ffmpeg -i in.mp3 -af "aresample=48000:fltp:stereo" out.wav

# 仅改采样率（位置参数写法）

ffmpeg -i in.wav -af "aresample=44100" out.wav

# 匹配时间戳：音画不同步时让音频拉伸吻合（每秒最多补偿 1000 样本）

ffmpeg -i in.mp4 -af "aresample=async=1000" out.mp4

# 改采样率 + 提高重采样质量

ffmpeg -i in.wav -af "aresample=96000:filter_size=32:phase_shift=15" out.wav

```

> 通常不需要显式指定：输出编码器决定了采样率/格式时，ffmpeg 会自动插入 aresample；单纯改采样率/声道用命令行选项
> `-ar`、`-ac` 更直观。`-async 1`（旧式输入选项）与滤镜的 `aresample=async=1`
> 功能等价，建议用滤镜版。

#### aformat —— 强制音频格式

```

# 统一格式有利于后续拼接/混流

ffmpeg -i in.m4a -af "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo" out.wav

```

| 参数            | 说明                    |
| --------------- | ----------------------- |
| sample_fmts     | 采样格式列表（\| 分隔） |
| sample_rates    | 采样率列表              |
| channel_layouts | 声道布局列表            |

#### anull —— 透传

不做处理，直通。主要用于滤镜图占位/测试。

### 3.4 音频滤波与效果

#### aecho —— 回声

| 参数     | 说明                                |
| -------- | ----------------------------------- | ------- |
| in_gain  | 输入增益（默认 0.6）                |
| out_gain | 输出增益（默认 0.3）                |
| delays   | 各回声延迟（ms，\| 分隔，默认 `1000 | 180`）  |
| decays   | 各回声衰减（默认 `0.3               | 0.25`） |

```

# 简单山洞回声

ffmpeg -i in.wav -af "aecho=0.8:0.9:500:0.5" out.wav

# 双回声

ffmpeg -i in.wav -af "aecho=0.6:0.3:400|800:0.4|0.3" out.wav

```

#### lowpass / highpass —— 低通 / 高通

| 参数               | 说明                                           |
| ------------------ | ---------------------------------------------- |
| frequency / f      | 截止频率（默认 500Hz / 0 自适应）              |
| poles / p          | 极点数量（1/2，默认 2，每极每倍频程 6dB 滚降） |
| width_type / width | 带宽指定方式（h/q/o/s/k）与带宽                |
| mix / m            | 干湿比（0-1，默认 1）                          |
| channels / c       | 只处理指定声道（如 LFE）                       |
| normalize / n      | 归一化双二阶系数                               |
| transform          | dii/tdi/tdii/latt/svf/zdf 等 IIR 变换类型      |
| precision          | 精度 auto/s16/s32/f32/f64                      |

```

# 低通 3kHz（去齿音/降噪前常用）

ffmpeg -i in.wav -af "lowpass=f=3000" out.wav

# 高通 80Hz（去除低频轰鸣）

ffmpeg -i in.wav -af "highpass=f=80" out.wav

# 只处理 LFE 声道

ffmpeg -i in.wav -af "lowpass=c=LFE" out.wav

```

#### bandpass / bandreject —— 带通 / 带阻

```

# 带通 1kHz 附近（电话音效）

ffmpeg -i in.wav -af "bandpass=f=1000:width_type=q:width=1" out.wav

# 陷波 50Hz 电源干扰

ffmpeg -i in.wav -af "bandreject=f=50:width_type=o:width=1" out.wav

```

#### equalizer —— 参数均衡器

| 参数           | 说明                  |
| -------------- | --------------------- |
| frequency / f  | 中心频率（Hz）        |
| width_type / t | h/q/o/s/k             |
| width / w      | 带宽                  |
| gain / g       | 增益（dB，-30 到 30） |
| mix / m        | 干湿比                |
| channels / c   | 作用声道              |
| normalize      | 归一化                |

```

# 低频 3dB 提升（80Hz）

ffmpeg -i in.wav -af "equalizer=f=80:t=q:w=1:g=3" out.wav

# 中频 2kHz 削减 4dB

ffmpeg -i in.wav -af "equalizer=f=2000:t=q:w=1.5:g=-4" out.wav

# 三段均衡修正人声（低频轻微提升 + 中频凹陷 + 高频提亮，级联多个 equalizer）

ffmpeg -i vocal.wav -af \
 "equalizer=f=120:t=q:w=1:g=2,equalizer=f=500:t=q:w=1.5:g=-3,equalizer=f=8000:t=q:w=1:g=3" out.wav

# 只作用于左声道

ffmpeg -i stereo.wav -af "equalizer=f=1000:t=q:w=1:g=6:c=FL" out.wav

```

#### bass / treble —— 低/高频增益（搁架式均衡）

高低音搁架滤波器（类似音箱的 Tone 旋钮），分别增益或削减低频/高频。

| 参数           | 说明                                           |
| -------------- | ---------------------------------------------- |
| gain / g       | 增益 dB，-20 到 +20（默认 0），正值注意削波    |
| frequency / f  | 中心频率 Hz（bass 默认 100，treble 默认 3000） |
| width_type / t | 带宽表示：h(Hz)/q(o)/s(slope)/k(kHz)，默认 q   |
| width / w      | 带宽（q 模式默认 0.5，s 模式默认 1）           |
| poles / p      | 极点数量（默认 2）                             |
| mix / m        | 干湿比 0-1（默认 1）                           |
| channels / c   | 作用的声道                                     |
| normalize      | 启用后把 DC 处幅度归一化到 0dB                 |

```

# 低音 +6dB（100Hz 附近）

ffmpeg -i in.wav -af "bass=g=6" out.wav

# 高音削减 4dB（高频刺耳）

ffmpeg -i in.wav -af "treble=g=-4" out.wav

```

#### afftdn —— FFT 降噪（AI 式宽带降噪）

基于 FFT 的频域降噪，适合口播/录音底噪。可自动估计噪底，也可先采样一段纯噪声作为样本。

| 参数                 | 说明                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| noise_reduction / nr | 降噪量 dB（0.01-97，默认 12）                                                |
| noise_floor / nf     | 噪声底线 dB（-80 到 -20，默认 -50）                                          |
| noise_type / nt      | 噪声类型：`white,w`（默认）/`vinyl,v`（黑胶）/`shellac,s`/`custom,c`         |
| band_noise / bn      | custom 模式下的 15 段频带噪声轮廓                                            |
| residual_floor / rf  | 残余噪声底线 dB（默认 -38）                                                  |
| track_noise / tn     | 1 时自动跟踪调整噪声底线（推荐开启）                                         |
| output_mode / om     | `input,i`（原样输出）/`output,o`（默认，输出降噪后）/`noise,n`（只输出噪声） |
| adaptivity / ad      | 增益调整适应速度 0-1（默认 0.5）                                             |
| noise_link / nl      | 多声道噪声联动：`none`/`min`/`max`/`average`（默认 min）                     |
| sample_noise / sn    | `start,begin` 开始采样 / `stop,end` 结束采样并生成噪声轮廓                   |

```

# 口播录音降噪（自动跟踪噪底）

ffmpeg -i mic.wav -af "afftdn=nr=15:tn=1" out.wav

# 先采集 2 秒纯噪声样本（开头静音段），再以此为轮廓降噪

ffmpeg -i noisy.wav -af "afftdn=sn=start,atrim=0:2,afftdn=sn=stop,afftdn=nr=20:om=output" -t 10
out.wav

```

> 降噪量过大会有"水声"（音乐性噪声），建议 nr 12-20 之间，宁小勿大。

#### chorus / flanger / vibrato / tremolo —— 效果器

| 滤镜    | 说明                                         | 常用参数                                                 |
| ------- | -------------------------------------------- | -------------------------------------------------------- |
| chorus  | 合唱：多个可变延迟叠加（人声变厚）           | in_gain(0.4)/out_gain(0.4)/delays/decays/speeds/depths   |
| flanger | 镶边：短延迟周期性扫动（喷气式"whoosh"效果） | in_gain(0.5)/out_gain(0.5)/delay(0-30ms)/depth/decode... |
| vibrato | 颤音：周期性调制频率（正弦调制采样率）       | f(5Hz)/d(0.5)                                            |
| tremolo | 震音：周期性调制音量（增益调制）             | f(5Hz)/d(0.8)                                            |

```

# 合唱：一个延迟 55ms、深度 0.25

ffmpeg -i vocal.wav -af "chorus=0.7:0.9:55:0.4:0.25:2" out.wav

# 颤音 2Hz 深度 0.3

ffmpeg -i guitar.wav -af "vibrato=f=2:d=0.3" out.wav

```

> chorus 参数是位置参数：`in_gain:out_gain:delays:decays:speeds:depths`，用 `|` 分隔多个延迟值。

#### asetpts —— 音频时间戳

音频版 setpts（普通变速另有 atempo，此处用于时间归零）：

```

ffmpeg -i in.mp3 -af "atrim=start=5,asetpts=PTS-STARTPTS" out.mp3

```

### 3.5 音频分析与静音检测

#### astats —— 音频统计

输出峰值、RMS、波峰因数、DC 偏移、各声道测量等。

| 参数（常用） | 说明                       |
| ------------ | -------------------------- |
| length       | 统计窗口（秒，默认 0.05）  |
| metadata     | 1 时输出 metadata          |
| reset        | 重置统计的帧数（0=不重置） |

```

ffmpeg -i in.wav -af "astats=metadata=1" -f null -

```

#### silencedetect —— 静音检测

输出静音区间起止时间（秒）到日志与 metadata（`lavfi.silence_start` / `lavfi.silence_end` /
`lavfi.silence_duration`）。

| 参数         | 说明                                          |
| ------------ | --------------------------------------------- |
| noise / n    | 噪声容差（`-60dB` 或比值 0.001，默认）        |
| duration / d | 判定为静音的最小时长（默认 2 秒）             |
| mono / m     | 1 时按声道分别检测（metadata 键带 `.X` 后缀） |

```

# 检测 5 秒以上静音，容差 -50dB

ffmpeg -i in.mp3 -af "silencedetect=n=-50dB:d=5" -f null -

# 静音位置常用于自动字幕/分段

ffmpeg -i in.mp3 -af "silencedetect=n=-35dB:d=0.5" -f null - 2>&1 | grep silence\_

```

#### silenceremove —— 静音去除

自动修剪开头/中间/结尾的静音段（播客、口播常用）。

| 参数            | 说明                                                      |
| --------------- | --------------------------------------------------------- |
| start_periods   | 开头去静音的"非静音段"计数（1=去开头静音，-N 连续去）     |
| start_duration  | 判定"声音开始"的非静音时长（防误删突发噪声）              |
| start_threshold | 音量阈值（0 或 -90dB 等）                                 |
| start_silence   | 保留的开头静音最长时间                                    |
| start_mode      | `any`/`all`（多声道检测模式）                             |
| stop_periods    | 结尾静音计数（正=去结尾；负=-N=去中间所有静音/每隔 N 段） |
| stop_duration   | 判定静音段的时长                                          |
| stop_threshold  | 结尾音量阈值                                              |
| stop_silence    | 保留的结尾静音长度                                        |
| detection       | `avg`/`rms`（默认）/`peak`/`median`/`ptp`/`dev`           |
| window          | 检测窗口（秒，默认 0.02）                                 |
| timestamp       | `write`（默认重写时间戳）/ `copy`                         |

```

# 去掉开头录音延迟（最常见用法）

ffmpeg -i rec.m4a -af "silenceremove=start_periods=1:start_duration=2:start_threshold=0.02" out.m4a

# 去除所有 >1 秒的静音

ffmpeg -i rec.m4a -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-45dB" out.m4a

# 去掉开口与结尾静音并保留 0.5 秒缓冲

ffmpeg -i rec.m4a -af
"silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB:start_silence=0.5:stop_silence=0.5"
out.m4a

```

#### acompressor —— 压缩器

| 参数             | 说明                                            |
| ---------------- | ----------------------------------------------- |
| level_in         | 输入电平（默认 1）                              |
| mode             | `downward`（默认）/ `upward`                    |
| threshold        | 阈值（默认 0.125）                              |
| ratio            | 压缩比（默认 2）                                |
| attack / release | 启动/释放时间（0.01-2000ms，默认 20ms / 250ms） |
| makeup           | 输出增益补偿（dB）                              |
| knee             | 拐点（1-30，默认 2.828）                        |
| link             | 联动手（默认 automatic）                        |
| detection        | `peak`/`rms`                                    |

```

# 人声压限器：-20dB 阈值 4:1

ffmpeg -i vocal.wav -af "acompressor=threshold=0.1:ratio=4:attack=5:release=100:makeup=4" out.wav

```

---

## 四、多媒体滤镜

处理多路流的通用滤镜（多数同时支持视频与音频）。

#### concat —— 拼接

把多个输入（视频/音频/字幕同时）按顺序拼接，要求各路参数（分辨率、帧率、采样率、声道等）一致。

| 参数   | 说明                               |
| ------ | ---------------------------------- |
| n      | 输入段数                           |
| v      | 1 = 处理视频                       |
| a      | 1 = 处理音频                       |
| s      | 1 = 处理字幕（不常见）             |
| unsafe | 1 = 允许不按关键帧时间戳对齐的拼接 |

```

# 三片段拼接（视频+音频）

ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -filter_complex \
 "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]" \
 -map "[outv]" -map "[outa]" out.mp4

```

#### concat 的分段用法（不同参数时先统一）：

```

ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
 "[0:v]scale=1280:720,fps=30,format=yuv420p[v0];[0:a]aresample=48000:aformat=channel_layouts=stereo[a0];\

[1:v]scale=1280:720,fps=30,format=yuv420p[v1];[1:a]aresample=48000:aformat=channel_layouts=stereo[a1];\

[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" out.mp4

```

> 更简单的方案：相同参数的文件直接用
> `-f concat -safe 0 -i list.txt -c copy out.mp4`（流拷贝拼接，不重编码）。

#### concat 滤镜索引规则

`[0:v]` 语法：`输入序号:流类型`，v=视频、a=音频、s=字幕，`0:v:0` 表示第 1 个输入的第 1 条视频流。

#### metadata / ametadata —— 帧元数据操作

| 参数     | 说明                                                                 |
| -------- | -------------------------------------------------------------------- |
| mode     | `select`/`add`/`modify`/`delete`/`print`                             |
| key      | 元数据键                                                             |
| value    | 值（add/modify 必填；select 比较用）                                 |
| function | `same_str`/`starts_with`/`less`/`equal`/`greater`/`expr`/`ends_with` |
| expr     | function=expr 时的表达式（VALUE1=帧值，VALUE2=用户值）               |
| file     | print 模式输出文件（`-`=stdout）                                     |

```

# 打印 signalstats 某指标在 0-1 区间的帧

ffmpeg -i in.mp4 -vf
"signalstats,metadata=print:key=lavfi.signalstats.YDIF:value=0:function=expr:expr='between(VALUE1,0,1)'"
-f null -

# 删除所有帧元数据

ffmpeg -i in.mp4 -vf "metadata=mode=delete" out.mp4

```

#### setdar / setsar —— 设置显示宽高比 / 采样宽高比

```

# 声明画面为 16:9（不改变像素）

ffmpeg -i in.mp4 -vf "setdar=16/9" out.mp4

```

#### settb —— 设置时间基

| 参数 | 说明                              |
| ---- | --------------------------------- |
| expr | 时间基，如 `1/25`、`AVTB`、`intb` |

```

ffmpeg -i in.mp4 -vf "settb=AVTB" out.mp4

```

#### split / asplit —— 分流

`split` 见视频部分；音频用 `asplit`，用法一致（`asplit=2[a][b]`）。

#### sendcmd —— 向下游滤镜发送命令

```

# 10 秒时把 drawtext 文字改为 "new"

ffmpeg -i in.mp4 -filter_complex \
 "[0:v]sendcmd='10.0 drawtext reinit text=new',drawtext=text=old[v]" -map "[v]" out.mp4

```

#### perms / aperms —— 权限测试

测试用，几乎不会在实际处理中遇到，可忽略。

---

## 五、视频源与音频源

在 `-f lavfi -i`
下可直接使用内建源，用于生成测试画面/声音，或作为滤镜图的输入（`-filter_complex "testsrc"` 等）。

### 视频源

#### testsrc —— 测试图案（彩色渐变+时间码）

| 参数         | 说明                 |
| ------------ | -------------------- |
| size / s     | 尺寸（默认 320x240） |
| rate / r     | 帧率（默认 25）      |
| duration / d | 时长（默认无限）     |
| decimals / n | 时间码小数位         |
| sar          | 采样宽高比           |

```

# 5.3 秒、176x144、10fps 测试视频

ffmpeg -f lavfi -i "testsrc=duration=5.3:size=qcif:rate=10" out.mp4

```

#### color —— 纯色

| 参数         | 说明                                           |
| ------------ | ---------------------------------------------- |
| color / c    | 颜色（如 `red`、`0xRRGGBB`、`red@0.2` 透明度） |
| size / s     | 尺寸（默认 320x240）                           |
| rate / r     | 帧率（默认 25）                                |
| duration / d | 时长                                           |

```

# 生成 1 秒红色 1080p 片段

ffmpeg -f lavfi -i "color=c=red:s=1920x1080:r=30:d=1" out.mp4

# 半透明红底 640x360

ffmpeg -f lavfi -i "color=c=red@0.2:s=qcif:r=10" -t 5 out.mp4

```

#### 其它测试源

| 源                      | 说明                                     |
| ----------------------- | ---------------------------------------- |
| smptebars / smptehdbars | SMPTE 彩条                               |
| testsrc2                | 与 testsrc 类似，支持更多像素格式        |
| rgbtestsrc              | RGB 测试条（检测 RGB/BGR 反转）          |
| nullsrc                 | 空白帧（配合 geq 生成噪声等）            |
| allrgb / allyuv         | 全部颜色的 4096x4096 图                  |
| haldclutsrc             | Hald CLUT 单位矩阵（配合 haldclut 滤镜） |
| colorchart              | 色卡                                     |

```

# 10 秒 SMPTE 彩条（测试显示器）

ffmpeg -f lavfi -i "smptebars=s=1920x1080:r=30" -t 10 bars.mp4

# 用 geq 生成随机噪声

ffmpeg -f lavfi -i "nullsrc=s=256x256,geq=random(1)\*255:128:128" -t 3 noise.mp4

```

#### movie —— 从文件读取作为滤镜图输入

在复杂滤镜图中读取额外文件（叠加、混流），可以指定起播位置、循环等。

| 参数              | 说明                                                    |
| ----------------- | ------------------------------------------------------- |
| filename          | 文件名/设备/协议地址                                    |
| format_name / f   | 容器格式（自动探测）                                    |
| seek_point / sp   | 起播位置（秒）                                          |
| streams / s       | 要读取的流（`v:0+#0x81` 等，`dv`/`da` 为默认视频/音频） |
| stream_index / si | 流序号（-1 自动）                                       |
| loop              | 循环次数（0=无限）                                      |
| dec_threads       | 解码线程数                                              |
| format_opts       | 格式选项（如协议白名单）                                |

```

# 把另一个视频缩放后叠加（经典示例）

ffmpeg -i main.mp4 -filter_complex \
 "[0:v]setpts=PTS-STARTPTS[main];movie=sub.mp4:seek_point=3.2,scale=180:-1,setpts=PTS-STARTPTS[over];\

[main][over]overlay=16:16[out]" -map "[out]" out.mp4

# 无限循环叠加

ffmpeg -i main.mp4 -filter_complex "movie=loop.mp4:loop=0,scale=200:-1[ov];[0:v][ov]overlay=10:10"
out.mp4

```

#### amovie —— 音频版 movie

与 movie 相同，默认选音频流：

```

ffmpeg -i main.mp4 -filter_complex "[0:v][1:a]..."

```

### 音频源

#### anullsrc —— 空白音频

| 参数                | 说明                    |
| ------------------- | ----------------------- |
| channel_layout / cl | 声道布局（默认 stereo） |
| sample_rate / r     | 采样率（默认 44100）    |
| nb_samples / n      | 每帧样本数              |
| duration / d        | 时长                    |

```

# 生成 10 秒静音（与视频拼接/补轨用）

ffmpeg -f lavfi -i "anullsrc=r=48000:cl=mono" -t 10 silence.wav

# 静音当音轨合成到视频

ffmpeg -i video.mp4 -f lavfi -i "anullsrc=r=44100:cl=stereo" -shortest -c:v copy -c:a aac out.mp4

```

#### anoisesrc —— 噪声

| 参数            | 说明                                                    |
| --------------- | ------------------------------------------------------- |
| sample_rate / r | 采样率（默认 48000）                                    |
| amplitude / a   | 振幅（0-1，默认 1.0）                                   |
| duration / d    | 时长（默认无限）                                        |
| color / c       | 颜色：white/pink/brown/blue/violet/velvet（默认 white） |
| seed / s        | 随机种子                                                |
| nb_samples / n  | 每帧样本数（默认 1024）                                 |

```

# 60 秒粉噪（-23dB 左右方便测量）

ffmpeg -f lavfi -i "anoisesrc=d=60:c=pink:r=44100:a=0.1" pink.mp3

# 白噪声（测试扬声器）

ffmpeg -f lavfi -i "anoisesrc=d=5:c=white:r=44100:a=0.05" white.wav

```

#### sine —— 正弦波

| 参数            | 说明                                      |
| --------------- | ----------------------------------------- |
| frequency / f   | 频率（默认 440Hz）                        |
| beep_factor / b | 叠加提示音（每秒一次，频率为载波的 b 倍） |
| sample_rate / r | 采样率（默认 44100）                      |
| duration / d    | 时长                                      |

```

# 1kHz 测试音 3 秒

ffmpeg -f lavfi -i "sine=frequency=1000:duration=3" test_tone.wav

# 440Hz + 每秒 880Hz 提示声

ffmpeg -f lavfi -i "sine=f=440:b=2:d=10" beep.wav

```

---

## 六、常用综合示例

### 1. 视频统一规范（多平台通用）

```

ffmpeg -i in.mp4 -vf
"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=30"
-af "aresample=48000,volume=0.9" -c:v libx264 -crf 20 -preset slow -c:a aac -b:a 192k out.mp4

```

### 2. 水印（静态/动态）

```

# 静态右下角 LOGO

ffmpeg -i in.mp4 -i logo.png -filter_complex \
 "[1:v]scale=120:-1[lg];[0:v][lg]overlay=W-w-20:H-h-20:format=auto" -c:a copy out.mp4

# 文字水印逐帧显示时间

ffmpeg -i in.mp4 -vf
"drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}':fontsize=32:fontcolor=white@0.6:x=w-tw-20:y=h-th-20"
out.mp4

```

### 3. 绿幕合成

```

ffmpeg -i bg.mp4 -i fg.mov -filter_complex \
 "[1:v]chromakey=0x00b140:0.12:0.25[fgv];[0:v][fgv]overlay=(W-w)/2:(H-h)/2[out]" \
 -map "[out]" -map 1:a? out.mp4

```

### 4. 音画同步的变速剪辑

```

# 视频 2 倍速（同时变速音频，保持音调）

ffmpeg -i in.mp4 -vf "setpts=PTS/2" -af "atempo=2" -c:v libx264 -crf 20 out.mp4

```

### 5. 分屏对比（原画 vs 处理）

```

ffmpeg -i in.mp4 -filter_complex \
 "[0:v]split[a][b];[a]scale=960:540[la];[b]curves=preset=increase_contrast,scale=960:540[ra];\
 [la][ra]hstack=inputs=2[v]" -map "[v]" -map 0:a out.mp4

```

### 6. 自动去静音 + 响度归一化的口播

```

ffmpeg -i rec.m4a -af
"silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB,loudnorm=I=-16:TP=-1.5:LRA=11"
out.m4a

```

### 7. 视频截图系列（每秒一帧）

```

ffmpeg -i in.mp4 -vf "fps=1,scale=640:-1" -q:v 2 frame\_%03d.jpg

```

### 8. 检测视频问题（黑场/冻结/静音）

```

ffmpeg -i in.mp4 -vf "blackdetect=d=0.5:pict_th=0.95,freezedetect=n=-50dB:d=2,metadata=print:file=-"
-af "silencedetect=n=-50dB:d=1" -f null -

```

### 9. GIF 制作（调色板）

```

ffmpeg -i in.mp4 -vf
"fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif

```

### 10. 查看滤镜可用性与参数

```

ffmpeg -filters # 列出全部滤镜 ffmpeg -h filter=scale # 查看某滤镜帮助与参数 ffmpeg -h
filter=drawtext

```

---

## 附录 A：常用查找速查

| 需求                   | 滤镜                                                    |
| ---------------------- | ------------------------------------------------------- |
| 缩放                   | scale                                                   |
| 裁剪                   | crop / cropdetect                                       |
| 加边                   | pad                                                     |
| 旋转/翻转              | rotate / transpose / hflip / vflip                      |
| 变速（视频）           | setpts                                                  |
| 变速（音频，不变调）   | atempo                                                  |
| 时间裁剪               | trim / atrim                                            |
| 淡入淡出               | fade / afade                                            |
| 拼接                   | concat                                                  |
| 叠加                   | overlay                                                 |
| 分屏                   | hstack / vstack / xstack                                |
| 文字/字幕              | drawtext / subtitles / ass                              |
| 水印                   | drawtext / overlay                                      |
| 调亮度/对比度/饱和度   | eq                                                      |
| 调色相                 | hue                                                     |
| 调色（曲线/通道/分区） | curves / colorchannelmixer / colorbalance / colorlevels |
| 反相                   | negate                                                  |
| 自动对比度             | normalize / histeq                                      |
| 黑白（灰度）           | colorchannelmixer / hue=s=0                             |
| 抠像                   | chromakey / colorkey                                    |
| 锐化/柔化              | unsharp / smartblur                                     |
| 模糊                   | gblur / boxblur                                         |
| 降噪                   | hqdn3d / nlmeans / atadenoise                           |
| 去交错                 | yadif / bwdif / w3fdif / nnedi                          |
| 反胶转磁               | fieldmatch + decimate                                   |
| 补帧                   | minterpolate / framerate                                |
| 音量                   | volume                                                  |
| 响度归一化             | loudnorm                                                |
| 音量检测               | volumedetect                                            |
| 混音                   | amix                                                    |
| 声道并轨               | amerge                                                  |
| 声道重映射             | pan                                                     |
| 限幅                   | alimiter / acompressor                                  |
| 回声                   | aecho                                                   |
| 低通/高通/均衡         | lowpass / highpass / equalizer                          |
| 静音检测/去除          | silencedetect / silenceremove                           |
| 画质分析               | signalstats / showinfo / astats / volumedetect          |
| 场景切换检测           | scdet                                                   |
| 冻结检测               | freezedetect                                            |
| 测试视频源             | testsrc / smptebars / color                             |
| 测试音频源             | sine / anoisesrc / anullsrc                             |

> 提示：每台机器 ffmpeg 编译配置不同，个别滤镜（如 nnedi 需要权重文件、subtitles 需要 libass）可能不可用；用
> `ffmpeg -filters` 确认本机支持情况。

```

```

```

/*
 * 文件: config.js
 * 项目: mediac
 * 创建: 2026-02-14 17:32:43
 * 修改: 2026-02-14 17:32:43
 * 作者: mcxiaoke (github@mcxiaoke.com)
 * 许可证: Apache License 2.0
 *
 * 全局配置文件
 * 定义程序运行时的各种配置参数和默认值
 */

import { cpus } from "os"

/**
 * 全局配置对象
 * 包含图像处理、编码转换等功能的配置参数
 */
export default {
    /**
     * 并发度策略
     *
     * 此前各命令现场写 `cpus().length` / `/ 2` / `- 2` / `* 2` / `* 8`，
     * 策略四处漂移：同一个「文件操作」在不同命令里并发度能差 4 倍，
     * 调整时也无从下手。这里按**任务类型**集中定义，调用点只取用不再自行计算。
     *
     * 定义成函数而非常量：`cpus()` 取值推迟到调用时，避免 import 期副作用。
     */
    JOBS: {
        /** CPU 密集（图片解码/编码、哈希计算）：留一半核给系统 */
        cpuIntensive: () => Math.max(1, Math.floor(cpus().length / 2)),
        /** IO 密集（文件移动/复制/删除/重命名）：可高于核数，但不必到核数的数倍 */
        ioBound: () => Math.max(4, cpus().length * 2),
        /** 外部工具探测（ffprobe / exiftool / CUDA 探测）：每个任务都要起进程，留出余量 */
        externalTool: () => Math.max(1, cpus().length - 2),
        /** 元数据读取与目录遍历 */
        metadata: () => Math.max(4, cpus().length * 4),
    },

    // sharp库是否支持HEIC到JPG的转换
    SHARP_SUPPORT_HEIC: undefined,

    // 外部工具路径
    NCONVERT_BIN_PATH: undefined, // nconvert工具路径（用于HEIC等格式转换）
    VIPS_BIN_PATH: undefined, // vips工具路径（高性能图像处理）
    /**
     * 编码转换相关配置
     * 用于处理文件名和文本的编码转换
     */
    ENCODING: {
        // 默认源编码列表
        DEFAULT_FROM_ENCODINGS: [
            "ISO-8859-1",
            "ISO-8859-2",
            "UTF8",
            "UTF-16",
            "UTF-32",
            "GBK",
            "BIG5",
            "SHIFT_JIS",
            "EUC-JP",
            "EUC-KR",
            "CP949",
        ],
        // 默认目标编码列表
        DEFAULT_TO_ENCODINGS: [
            "ISO-8859-1",
            "ISO-8859-2",
            "UTF8",
            "UTF-16",
            "UTF-32",
            "GBK",
            "BIG5",
            "SHIFT_JIS",
            "EUC-JP",
            "EUC-KR",
            "CP949",
        ],
        // 默认置信度阈值
        DEFAULT_THRESHOLD: 50,
        // 缓存大小限制
        CACHE_SIZE_LIMIT: 1000,
        // 并发处理数量
        CONCURRENCY: 4,
    },
}

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

/**
 * 全局配置对象
 * 包含图像处理、编码转换等功能的配置参数
 */
export default {
    // sharp库是否支持HEIC到JPG的转换
    SHARP_SUPPORT_HEIC: undefined,

    // 外部工具路径
    NCONVERT_BIN_PATH: undefined,  // nconvert工具路径（用于HEIC等格式转换）
    VIPS_BIN_PATH: undefined,       // vips工具路径（高性能图像处理）
    /**
     * 编码转换相关配置
     * 用于处理文件名和文本的编码转换
     */
    ENCODING: {
        // 默认源编码列表
        DEFAULT_FROM_ENCODINGS: ["ISO-8859-1", "ISO-8859-2", "UTF8", "UTF-16", "UTF-32", "GBK", "BIG5", "SHIFT_JIS", "EUC-JP", "EUC-KR", "CP949"],
        // 默认目标编码列表
        DEFAULT_TO_ENCODINGS: ["ISO-8859-1", "ISO-8859-2", "UTF8", "UTF-16", "UTF-32", "GBK", "BIG5", "SHIFT_JIS", "EUC-JP", "EUC-KR", "CP949"],
        // 默认置信度阈值
        DEFAULT_THRESHOLD: 50,
        // 缓存大小限制
        CACHE_SIZE_LIMIT: 1000,
        // 并发处理数量
        CONCURRENCY: 4,
    },
}

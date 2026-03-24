/*
 * Project: mediac
 * Created: 2026-02-14 17:32:43
 * Modified: 2026-02-14 17:32:43
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
export default {
    // sharp是否支持heic2jpg
    SHARP_SUPPORT_HEIC: undefined,
    NCONVERT_BIN_PATH: undefined,
    VIPS_BIN_PATH: undefined,
    // 编码相关配置
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

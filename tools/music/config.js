// 支持扫描的音频扩展名
export const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "aac", "ogg", "m4a", "ape", "alac", "wma"]

// 相似度阈值 (0 到 1)，0.8 表示相似度达到 80% 才会被记录
export const SIMILARITY_THRESHOLD = 0.8

// 极其关键：清理文件名的正则，去除各种干扰标签，提高匹配准确率
// 例如去除: [320k], (Remastered), 【无损】, 连字符, 下划线等
export const CLEAN_REGEX = /\[.*?\]|\(.*?\)|【.*?】|（.*?）|-|_+|\s+/g

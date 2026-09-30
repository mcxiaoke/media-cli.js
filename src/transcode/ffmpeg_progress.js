/**
 * FFmpeg 进度与速率解析模块
 *
 * 专注于 stdout 流式输出中的 out_time、speed 正则解析与进度条/回调派发。
 */

/**
 * 将 ffmpeg 时间格式 HH:MM:SS.ms 转换为秒数
 * @param {string} timeStr - 时间字符串
 * @returns {number} 秒数
 */
export function parseTimeToSeconds(timeStr) {
    // timeStr 格式可能是:
    // 1. "00:00:04.633333" (out_time, 有6位小数)
    // 2. "00:04:36.30" (time, 有2位小数)
    // 3. "00:04:36" (无小数)
    if (!timeStr) return 0
    const parts = timeStr.split(":")
    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts
        // 只取小数点前两位，忽略微秒
        const secondsNum = parseFloat(seconds)
        // out_time=N/A 或时间字段含非数字时 parseFloat 返回 NaN，
        // 不能让它传播到进度条 update(NaN)
        if (!Number.isFinite(secondsNum)) return 0
        const hoursNum = parseFloat(hours)
        const minutesNum = parseFloat(minutes)
        if (!Number.isFinite(hoursNum) || !Number.isFinite(minutesNum)) return 0
        return hoursNum * 3600 + minutesNum * 60 + secondsNum
    }
    return 0
}

/**
 * 创建进度解析器实例，负责从子进程 stdout 流中实时解析 speed 与 out_time 并更新进度条/回调
 *
 * @param {object} options
 * @param {object} [options.entry]
 * @param {number} [options.srcDuration]
 * @param {object} [options.progressBar] cliProgress SingleBar 实例
 * @param {Function} [options.onProgress] 进度回调函数
 * @returns {{ handleStdout: (data: Buffer|string) => void, currentTime: number, currentSpeed: string, currentSpeedValue: number }}
 */
export function createProgressTracker({
    entry = null,
    srcDuration = 0,
    progressBar = null,
    onProgress = null,
} = {}) {
    let currentTime = 0
    // 展示用速度串（ffmpeg -progress 输出形如 "1.5x"），进度条模板 {speed} 直接消费
    let currentSpeed = "0x"
    // 数值化速度（1.5），供 onProgress 消费者做速度/剩余时间计算。
    // ⚠️ onProgress 必须拿到 number 而不是字符串 "1.5x"，否则消费端的数值运算恒为空。
    let currentSpeedValue = 0

    return {
        get currentTime() {
            return currentTime
        },
        get currentSpeed() {
            return currentSpeed
        },
        get currentSpeedValue() {
            return currentSpeedValue
        },
        handleStdout(data) {
            const lines = data.toString().split("\n")
            for (const line of lines) {
                const trimmedLine = line.trim()
                // 解析 speed= 字段（-progress 输出的是 speed= 1.5x 或 speed=N/A）
                const speedMatch = trimmedLine.match(/^speed=\s*(.*)$/)
                if (speedMatch) {
                    const s = speedMatch[1].trim()
                    if (s && s !== "N/A") {
                        currentSpeed = s
                        const parsed = Number.parseFloat(s)
                        if (Number.isFinite(parsed) && parsed > 0) {
                            currentSpeedValue = parsed
                        }
                    }
                }
                // 解析 out_time= 字段（-progress 输出的是 out_time）
                const timeMatch = trimmedLine.match(/^out_time=(.*)$/)
                if (timeMatch) {
                    const timeStr = timeMatch[1].trim()
                    currentTime = parseTimeToSeconds(timeStr)

                    // 计算进度百分比
                    if (srcDuration > 0) {
                        const progress = Math.min(
                            100,
                            Math.round((currentTime / srcDuration) * 100),
                        )
                        if (progressBar) {
                            progressBar.update(progress, { speed: currentSpeed })
                        }
                        if (onProgress) {
                            onProgress({
                                percent: progress,
                                speed: currentSpeedValue,
                                speedText: currentSpeed,
                                currentTime,
                                srcDuration,
                                entry,
                            })
                        }
                    }
                }
            }
        },
    }
}

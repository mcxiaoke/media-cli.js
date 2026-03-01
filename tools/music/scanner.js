import fg from "fast-glob"
import path from "path"
import { AUDIO_EXTENSIONS } from "./config.js"

export async function scanAudioFiles(directories) {
    // 抹平 Windows (\) 和 POSIX (/) 的路径差异，防止 fast-glob 报错
    const normalizedDirs = directories.map((dir) => dir.split(path.sep).join("/"))

    const extPattern =
        AUDIO_EXTENSIONS.length > 1 ? `{${AUDIO_EXTENSIONS.join(",")}}` : AUDIO_EXTENSIONS[0]

    const patterns = normalizedDirs.map((dir) => {
        const cleanDir = dir.replace(/\/$/, "")
        return `${cleanDir}/**/*.${extPattern}`
    })

    const files = await fg(patterns, {
        absolute: true,
        caseSensitiveMatch: false,
        onlyFiles: true,
    })

    // 转回原生系统分隔符
    return files.map((file) => path.normalize(file))
}

import fs from "fs-extra"
import path from "path"
import { calculateDstArgs, createDstBaseName, selectPreferredSubtitle } from "./ffmpeg_plan.js"
import { getMediaInfo as defaultGetMediaInfo } from "./mediainfo.js"
import * as helper from "./helper.js"

/**
 * 构建一个 WebUI/共享任务层使用的媒体任务条目。
 *
 * 这是第一阶段的最小可测试 seam：只移动任务构建，不改变 CLI 的
 * prepareFFmpegCmd 业务。后续 Engine 会在此基础上统一 CLI 与 GUI。
 *
 * @param {object} input
 * @param {object} options
 * @returns {Promise<object|null>}
 */
export async function buildTask(
    input,
    {
        index,
        total,
        activePreset,
        argv,
        output = "",
        fsApi = fs,
        getMediaInfo = defaultGetMediaInfo,
        calculate = calculateDstArgs,
        createBaseName = createDstBaseName,
        chooseSubtitle = selectPreferredSubtitle,
        textHash = helper.textHash,
    },
) {
    const info = await getMediaInfo(input.path)
    const isAudio = activePreset.type === "audio"
    const ivideo = info?.video
    const iaudio = info?.audio
    const duration = info?.duration || ivideo?.duration || iaudio?.duration || 0

    if (isAudio && !iaudio) return null
    if (!isAudio && !ivideo) return null

    const entry = {
        index,
        total,
        path: input.path,
        name: input.name,
        size: input.size,
        info,
        preset: activePreset,
        argv,
        duration,
    }

    entry.dstArgs = calculate(entry)

    const srcDir = path.dirname(input.path)
    const srcBase = path.parse(input.name).name
    const dstDir = output ? path.resolve(output) : srcDir
    const [fileDstBase] = createBaseName(entry)
    const dstExt = activePreset.format || path.extname(input.name) || ".mp4"
    const fileDst = path.join(dstDir, `${fileDstBase}${dstExt}`)
    const fileDstTemp = path.join(
        dstDir,
        `${fileDstBase}_tmp@${textHash(input.path)}@tmp_${dstExt}`,
    )

    const subExts = [".ass", ".ssa", ".srt"]
    const subtitles = []
    for (const ext of subExts) {
        const subPath = path.join(srcDir, `${srcBase}${ext}`)
        if (await fsApi.pathExists(subPath)) subtitles.push(subPath)
    }

    return {
        ...entry,
        fileDstDir: dstDir,
        fileDst,
        fileDstTemp,
        subtitles,
        selectedSubtitle: chooseSubtitle(subtitles),
        status: "pending",
    }
}

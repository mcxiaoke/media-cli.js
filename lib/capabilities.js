/*
 * File: capabilities.js
 * Project: mediac
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 运行环境能力探测（图像处理相关）
 *
 * 背景：sharp 的 HEIC 支持、nconvert、vips 是否存在，此前由
 * `cmd/cmd_compress.js` 的 `updateConfig()` 写进 `config` 单例，
 * 再由 `cmd/cmd_shared.js` 的 `compressImage()` **隐式读取**。
 *
 * 这带来两个问题：
 *   1. 「探测过没有」取决于调用顺序 —— 换成别的入口调用 `compressImage`，
 *      `config.VIPS_BIN_PATH` / `config.SHARP_SUPPORT_HEIC` 就是 undefined，
 *      HEIC 分支会静默走一条不可用的路径（resizeFunc 选到 nconvert，
 *      而 nconvert 路径同样是 undefined）。
 *   2. 探测中途抛错时 catch 后继续执行，`config` 会停在「只写了一半」的中间态。
 *
 * 现在把探测独立成模块：结果 memo 化（幂等、只探测一次），
 * 谁先用谁触发，不再依赖某个命令先跑过。
 */

import fs from "fs-extra"
import os from "os"
import path from "path"
import sharp from "sharp"
import which from "which"
import config from "./config.js"
import * as log from "./debug.js"
import { resolveAssetPath } from "./helper.js"

const LOG_TAG = "Capabilities"

let probePromise = null

/**
 * 探测并填充图像处理能力，结果写入 config 单例供既有调用点读取
 *
 * 幂等：并发调用共享同一个 Promise，只会真正探测一次。
 *
 * @returns {Promise<{sharpSupportHeic:boolean,nconvertPath:string|null,vipsPath:string|null}>}
 */
export function ensureImageCapabilities() {
    probePromise ??= probeImageCapabilities()
    return probePromise
}

async function probeImageCapabilities() {
    const caps = {
        sharpSupportHeic: false,
        nconvertPath: null,
        vipsPath: null,
    }

    try {
        const testPic = await resolveAssetPath("assets/test.heic")
        const testTmp = path.join(os.tmpdir(), `mediac_probe_${Date.now()}.jpg`)
        try {
            await sharp(testPic).jpeg({ quality: 70 }).toFile(testTmp)
            caps.sharpSupportHeic = true
        } catch {
            caps.sharpSupportHeic = false
        }
        // 无论成功与否都清理临时文件
        await fs.remove(testTmp).catch(() => null)
    } catch (error) {
        // 缺 assets/test.heic 时不应让整个命令失败，仅记为「不支持」
        log.logWarn(LOG_TAG, `sharp HEIC probe skipped: ${error?.message || error}`)
    }

    caps.nconvertPath = (await which("nconvert", { nothrow: true })) || null
    caps.vipsPath = (await which("vips", { nothrow: true })) || null

    // 一次性赋值，避免「探测失败留下半配置」的中间态
    config.SHARP_SUPPORT_HEIC = caps.sharpSupportHeic
    config.NCONVERT_BIN_PATH = caps.nconvertPath
    config.VIPS_BIN_PATH = caps.vipsPath

    log.logInfo(
        LOG_TAG,
        `sharp:heic=${caps.sharpSupportHeic}`,
        `nconvert=${caps.nconvertPath ? "yes" : "no"}`,
        `vips=${caps.vipsPath ? "yes" : "no"}`,
    )
    return caps
}

/**
 * 读取已探测的能力快照（不触发探测）
 *
 * 供同步上下文使用，例如 `compressImage` 里选择 resize 实现。
 *
 * @returns {{sharpSupportHeic:boolean,nconvertPath:string|null,vipsPath:string|null}}
 */
export function getImageCapabilities() {
    return {
        sharpSupportHeic: config.SHARP_SUPPORT_HEIC === true,
        nconvertPath: config.NCONVERT_BIN_PATH || null,
        vipsPath: config.VIPS_BIN_PATH || null,
    }
}

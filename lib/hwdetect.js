/*
 * File: hwdetect.js
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 硬件能力检测（S-4 方案「双层决策」的第一层）
 *
 * 职责：从 ffmpeg 构建本身探测**设备级**能力，回答「这台机器有哪些可用的硬件加速器」。
 *   与第二层「文件级探测」（lib/hwaccel.js 的 probeLayer）配合：
 *     硬件检测 → 候选层列表（便宜，一次即可，结果可长期缓存）
 *     文件探测 → 从候选中挑出真正能吃下这个文件的层（贵，按 编码/位深/尺寸 缓存）
 *
 * 判定依据（全部为实测结论，见 docs/S-4-SCALE-PARAMS-20260920.md）：
 *   - 没有 NVIDIA 显卡 → -encoders 不含 h264_nvenc/hevc_nvenc → 不用 cuda 层
 *   - 没有 Intel 核显   → -encoders 不含 h264_qsv        → 不用 qsv 层
 *   - 没有 AMD 显卡     → -encoders 不含 h264_amf 或缺 amfrt64.dll → 不用 amf 层
 *   - d3d11va 是 Windows 通用兜底，只要有 -hwaccels d3d11va 即可用
 *   - cpu 层永远可用
 *
 * ⚠️ 注意：本机实测 gyan 构建的 -encoders **含** h264_amf，但实际运行报
 *    "DLL amfrt64.dll failed to open"（无 A 卡）。因此 amf 的判定不能只看
 *    -encoders，必须结合真实设备初始化探测（见 detectAmfUsable）。
 */

import { execa } from "execa"
import which from "which"
import * as log from "./debug.js"

/** 进程内缓存：设备级探测结果与 ffmpeg 构建绑定，一次进程内不必重复 */
let cachedCapabilities = null

/** 各层对应的「可用性指纹」编码器 */
const TIER_ENCODER_PROBE = {
    cuda: ["h264_nvenc", "hevc_nvenc"],
    qsv: ["h264_qsv", "hevc_qsv"],
    amf: ["h264_amf", "hevc_amf"],
    d3d: ["h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv"], // d3d 只负责解码，编码需另配
}

/**
 * 解析 ffmpeg -encoders 输出，返回可用编码器集合
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseEncoders(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        // 形如 " V....D h264_nvenc   NVIDIA NVENC H.264 encoder"
        const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/)
        if (m) set.add(m[1])
    }
    return set
}

/**
 * 解析 ffmpeg -hwaccels 输出
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseHwaccels(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        const t = line.trim()
        if (!t || /^hardware acceleration methods:?$/i.test(t)) continue
        set.add(t)
    }
    return set
}

/**
 * 解析 ffmpeg -filters 输出，返回可用滤镜集合
 *
 * 输出形如（注意标志位宽度不固定，1~3 字符）：
 *   " .. scale_cuda        V->V       GPU accelerated video resizer"
 *   " T.. yadif            V->V       Deinterlace the input image."
 * 因此不能按固定宽度切，改为「找到含 -> 的列，取它前一列」。
 *
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseFilters(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        if (!line.includes("->")) continue
        const cols = line.trim().split(/\s+/)
        const arrowIdx = cols.findIndex((c) => c.includes("->"))
        if (arrowIdx >= 1) {
            const name = cols[arrowIdx - 1]
            // 过滤掉表头/说明行
            if (/^[A-Za-z0-9_]+$/.test(name)) set.add(name)
        }
    }
    return set
}

/**
 * 真实设备初始化探测：某些编码器虽然列在 -encoders 里，但设备不可用
 * （典型：无 A 卡时 h264_amf 报 "DLL amfrt64.dll failed to open"）
 *
 * 用最小命令跑 1 帧到 null，只看退出码。
 *
 * @returns {Promise<boolean>}
 */
async function probeDeviceUsable(bin, { hwaccel, encoder, timeoutMs = 8000 }) {
    try {
        const args = ["-hide_banner", "-v", "error", "-y"]
        if (hwaccel) args.push("-hwaccel", hwaccel)
        args.push(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=1",
            "-t",
            "1",
            "-c:v",
            encoder,
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        )
        const res = await execa(bin, args, { reject: false, timeout: timeoutMs, cleanup: true })
        return res.exitCode === 0
    } catch {
        return false
    }
}

/**
 * 检测本机硬件加速能力
 *
 * @param {object} [opts]
 * @param {string} [opts.ffmpegPath] ffmpeg 可执行文件路径
 * @param {boolean} [opts.force] 忽略缓存强制重新检测
 * @param {boolean} [opts.deviceProbe] 是否做真实设备初始化探测（较慢，默认 true）
 * @returns {Promise<object>} 能力描述
 */
export async function detectHardwareCapabilities({
    ffmpegPath,
    force = false,
    deviceProbe = true,
} = {}) {
    if (cachedCapabilities && !force) {
        return cachedCapabilities
    }

    const bin = ffmpegPath || (await which("ffmpeg", { nothrow: true }))
    if (!bin) {
        throw new Error("hwdetect: ffmpeg not found")
    }

    // 1. 静态能力：一次性拉取 encoders / hwaccels / filters
    const [encRes, hwRes, fltRes] = await Promise.all([
        execa(bin, ["-hide_banner", "-v", "error", "-encoders"], { reject: false }),
        execa(bin, ["-hide_banner", "-v", "error", "-hwaccels"], { reject: false }),
        execa(bin, ["-hide_banner", "-v", "error", "-filters"], { reject: false }),
    ])
    const encoders = parseEncoders(encRes.stdout)
    const hwaccels = parseHwaccels(hwRes.stdout)
    const filters = parseFilters(fltRes.stdout)

    // 2. 逐层判定「静态是否具备」
    const staticOk = {
        cuda: TIER_ENCODER_PROBE.cuda.every((e) => encoders.has(e)),
        qsv: TIER_ENCODER_PROBE.qsv.every((e) => encoders.has(e)),
        amf: TIER_ENCODER_PROBE.amf.every((e) => encoders.has(e)),
        d3d: hwaccels.has("d3d11va"),
        cpu: true,
    }

    // 3. 真实设备探测：静态具备的层，再确认设备真的能用
    const usable = { ...staticOk }
    const probeDetail = {}
    if (deviceProbe) {
        const probes = []
        if (staticOk.cuda) {
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "cuda", encoder: "h264_nvenc" }).then((ok) => {
                    usable.cuda = ok
                    probeDetail.cuda = ok ? "device ok" : "device init failed"
                }),
            )
        }
        if (staticOk.qsv) {
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "qsv", encoder: "h264_qsv" }).then((ok) => {
                    usable.qsv = ok
                    probeDetail.qsv = ok ? "device ok" : "device init failed"
                }),
            )
        }
        if (staticOk.amf) {
            // AMF 无独立解码 hwaccel，直接测编码器
            probes.push(
                probeDeviceUsable(bin, { hwaccel: null, encoder: "h264_amf" }).then((ok) => {
                    usable.amf = ok
                    probeDetail.amf = ok ? "device ok" : "DLL/device unavailable (e.g. amfrt64.dll)"
                }),
            )
        }
        if (staticOk.d3d) {
            // d3d 只做解码，配 libx264 编码验证解码链路
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "d3d11va", encoder: "libx264" }).then((ok) => {
                    usable.d3d = ok
                    probeDetail.d3d = ok ? "device ok" : "device init failed"
                }),
            )
        }
        await Promise.all(probes)
    }

    // 4. 推导厂商
    const vendor = usable.cuda ? "nvidia" : usable.qsv ? "intel" : usable.amf ? "amd" : "any"

    // 5. 滤镜可用性（老版本 ffmpeg 缺 scale_d3d11 / scale_vulkan 等）
    const filterSupport = {
        scale_cuda: filters.has("scale_cuda"),
        scale_qsv: filters.has("scale_qsv"),
        vpp_amf: filters.has("vpp_amf"),
        scale_d3d11: filters.has("scale_d3d11"),
        scale_vulkan: filters.has("scale_vulkan"),
    }

    cachedCapabilities = {
        ffmpegPath: bin,
        vendor,
        usable,
        staticOk,
        probeDetail,
        hwaccels: [...hwaccels],
        filterSupport,
        encoderCount: encoders.size,
    }
    log.debug("hwdetect capabilities:", JSON.stringify(cachedCapabilities))
    return cachedCapabilities
}

/** 清空缓存（测试用） */
export function clearHwCapabilitiesCache() {
    cachedCapabilities = null
}

/**
 * 根据硬件能力得出候选层列表（按优先级）
 *
 * 这是「双层决策」的第一层输出：**不做文件相关判断**，只回答
 * 「这台机器理论上可以尝试哪些层」。
 *
 * @param {object} caps detectHardwareCapabilities 的结果
 * @param {object} [opts]
 * @param {string} [opts.decodeMode] auto | gpu | cpu
 * @param {string} [opts.hwaccel] 显式指定的层名（decodeMode=gpu 时用）
 * @returns {string[]} 层名数组，按优先级
 */
export function candidateTiers(caps, { decodeMode = "auto", hwaccel } = {}) {
    if (decodeMode === "cpu") return ["cpu"]

    if (decodeMode === "gpu") {
        const name = normalizeHwaccelName(hwaccel)
        if (!name) {
            throw new Error("decodeMode=gpu requires --hwaccel (cuda|qsv|amf|d3d11va|d3d12va)")
        }
        if (!caps.usable[name]) {
            throw new Error(
                `hwaccel '${name}' is not available on this machine ` +
                    `(vendor=${caps.vendor}, usable=${JSON.stringify(caps.usable)})`,
            )
        }
        return [name]
    }

    // auto：厂商专属层（若可用）→ d3d → cpu
    const list = []
    for (const t of ["cuda", "qsv", "amf"]) {
        if (caps.usable[t]) list.push(t)
    }
    if (caps.usable.d3d) list.push("d3d")
    list.push("cpu")
    return list
}

/** --hwaccel 取值 → 层名 */
function normalizeHwaccelName(hwaccel) {
    if (!hwaccel) return null
    const h = String(hwaccel).toLowerCase()
    if (h === "d3d11va" || h === "d3d12va" || h === "dxva2" || h === "auto") return "d3d"
    if (h === "cuda" || h === "qsv" || h === "amf" || h === "cpu" || h === "d3d") return h
    return null
}

export default {
    detectHardwareCapabilities,
    clearHwCapabilitiesCache,
    candidateTiers,
    parseEncoders,
    parseHwaccels,
    parseFilters,
}

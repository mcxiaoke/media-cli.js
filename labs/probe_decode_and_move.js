/*
 * Project: mediac
 * File: labs/probe_decode_and_move.js
 * Created: 2026-09-20
 * Author: mcxiaoke
 * License: Apache License 2.0
 *
 * 解码探测：把「ffmpeg 无法解码/解封装」的视频文件从测试目录移走，
 * 避免损坏/加密的 chromium 测试片污染正常编码测试。
 *
 * 用法：
 *   node labs/probe_decode_and_move.js [srcDir] [dstDir] [并发数]
 * 默认：
 *   srcDir = F:\Temp\testvideos
 *   dstDir = F:\Temp\testvid_bad
 *   并发   = 4   超时   = 5000ms
 *
 * 判定（两轮探测，快优先）：
 *   1) ffmpeg -hwaccel auto -f null -   （硬件解码，快）
 *      - 退出 0                    → 可解码
 *      - 超时                      → 视为可解码（大文件只是慢，跳过第二轮）
 *      - 其它非 0                  → 进第二轮
 *   2) ffmpeg -f null -              （纯 CPU 复测，排除硬件不支持但文件正常的）
 *      - 退出 0 / 超时              → 可解码
 *      - 非 0                      → 坏文件 → 移动到 dstDir（平铺，重名加序号）
 *
 * 超时处理：execa timeout 发 SIGTERM 后 1s 补 SIGKILL，catch 里再补一次 SIGKILL
 * 兜底，确保卡死的 ffmpeg（如 -hwaccel auto 挂驱动）能被真正杀掉。
 *
 * 注意：仅判定「解码/解封装」失败。个别文件解码正常但在 mp4 容器
 * mux 时失败（如 cook 音频进 mp4），本脚本不会移走。
 */
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import { execa } from "execa"
import pMap from "p-map"
import { isVideoFile } from "../lib/helper.js"
import * as mf from "../lib/file.js"

const SRC_DIR = path.resolve(process.argv[2] || "F:\\Temp\\testvideos")
const DST_DIR = path.resolve(process.argv[3] || "F:\\Temp\\testvid_bad")
const CONCURRENCY = Number(process.argv[4]) || 4
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 5000

// 直接 console，不走 lib/debug.js：loglevel 默认 WARN 会吞掉 info
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)

/**
 * 跑一次 ffmpeg 探测
 * 超时/异常时确保子进程被强杀（SIGTERM 对卡死的 ffmpeg 无效，必须 SIGKILL）
 * @returns {{ok:boolean, detail:string, timedOut:boolean}}
 */
async function runProbe(file, extraArgs) {
    const args = ["-hide_banner", "-v", "error", ...extraArgs, "-i", file, "-f", "null", "-"]
    let subprocess
    try {
        subprocess = execa("ffmpeg", args, {
            reject: false,
            timeout: PROBE_TIMEOUT_MS,
            // timeout 触发时先 SIGTERM，1s 后仍未退出则补 SIGKILL
            forceKillAfterDelay: 1000,
            cleanup: true,
            maxBuffer: 10 * 1024 * 1024,
        })
        const res = await subprocess
        if (res.timedOut) {
            return { ok: false, detail: "(timeout, killed)", timedOut: true }
        }
        if (res.exitCode === 0) return { ok: true, detail: "", timedOut: false }
        const firstErr =
            (res.stderr || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ||
            `exit=${res.exitCode}`
        return { ok: false, detail: firstErr, timedOut: false }
    } catch (err) {
        // 兜底强杀，防止僵尸进程残留
        try {
            subprocess?.kill("SIGKILL")
        } catch {}
        const isTimeout = /timed out|ETIMEDOUT|timeout/i.test(String(err?.message || ""))
        return {
            ok: false,
            detail: isTimeout ? "(timeout, killed)" : String(err?.message || err).slice(0, 200),
            timedOut: isTimeout,
        }
    }
}

/**
 * 两轮探测：
 *   hw-auto 失败（非超时）→ 纯 CPU 复测；
 *   hw-auto 超时 → 视为可解码（大文件只是慢，不再浪费一轮 CPU）
 */
async function probeFile(file) {
    const fast = await runProbe(file, ["-hwaccel", "auto"])
    if (fast.ok) return { ok: true, via: "hw", detail: "" }
    if (fast.timedOut) return { ok: true, via: "hw-timeout", detail: "(timeout, treated as ok)" }
    const cpu = await runProbe(file, [])
    if (cpu.ok) {
        return { ok: true, via: "cpu", detail: `hw-auto failed(${fast.detail})` }
    }
    if (cpu.timedOut) {
        return { ok: true, via: "cpu-timeout", detail: `hw-auto failed(${fast.detail}); cpu timeout` }
    }
    return { ok: false, via: "cpu", detail: cpu.detail || fast.detail }
}

async function moveToBad(file) {
    const name = path.basename(file)
    let dest = path.join(DST_DIR, name)
    let i = 1
    while (await fs.pathExists(dest)) {
        dest = path.join(DST_DIR, `${path.parse(name).name}_${i}${path.extname(name)}`)
        i++
    }
    await fs.move(file, dest, { overwrite: false })
    return dest
}

async function main() {
    if (!(await fs.pathExists(SRC_DIR))) {
        log(`ERROR: src dir not found: ${SRC_DIR}`)
        process.exit(1)
    }
    await fs.ensureDir(DST_DIR)

    const entries = await mf.walk(SRC_DIR, {
        withFiles: true,
        needStats: true,
        entryFilter: (e) => e.isFile && isVideoFile(e.name),
    })
    const files = entries.map((e) => e.path)
    const total = files.length
    log(`src=${SRC_DIR}`)
    log(`dst=${DST_DIR}`)
    log(`files=${total} concurrency=${CONCURRENCY} timeout=${PROBE_TIMEOUT_MS}ms (hw-auto -> cpu -> bad)`)

    let done = 0
    const results = await pMap(
        files,
        async (file) => {
            // 显示正在探测的文件：卡住时能直接看到是哪个
            log(`[${done + 1}/${total}] ${path.basename(file)}`)
            const r = await probeFile(file)
            done++
            return { file, ...r }
        },
        { concurrency: CONCURRENCY },
    )

    const good = results.filter((r) => r.ok)
    const bad = results.filter((r) => !r.ok)
    log(`good=${good.length} bad=${bad.length}`)

    const report = []
    let moved = 0
    for (const r of bad) {
        const dest = await moveToBad(r.file)
        moved++
        report.push(`MOVE ${path.relative(SRC_DIR, r.file)} -> ${path.relative(DST_DIR, dest)} :: ${r.detail}`)
        log(`MOVE ${r.file} :: ${r.detail}`)
    }
    log(`moved=${moved}`)

    // 报告落盘到项目 temp/（脚本相对路径，与运行 cwd 无关）
    const scriptDir = path.dirname(fileURLToPath(import.meta.url))
    const reportFile = path.join(
        scriptDir,
        "..",
        "temp",
        `decode_probe_report_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`,
    )
    await fs.ensureDir(path.dirname(reportFile))
    await fs.writeFile(
        reportFile,
        [`src=${SRC_DIR}`, `dst=${DST_DIR}`, `total=${total} good=${good.length} bad=${bad.length} moved=${moved}`, "", ...report].join("\n"),
        "utf-8",
    )
    log(`report: ${reportFile}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})

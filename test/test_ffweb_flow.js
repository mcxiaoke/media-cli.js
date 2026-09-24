/**
 * FFmpeg WebUI 真实流程端到端自动化测试
 */
import assert from "assert"
import fs from "fs-extra"
import path from "path"
import test from "node:test"
import { WebServer } from "../ffweb/server.js"

const TEST_OUT_DIR = path.resolve("temp/test_ffweb_out")
const SAMPLE_VIDEO = path.resolve("data/videos/TEST2__mpeg4_avi_480.avi")

test("FFmpeg WebUI (ffweb) End-to-End Real Flow", async (t) => {
    await fs.remove(TEST_OUT_DIR)
    await fs.ensureDir(TEST_OUT_DIR)

    const server = new WebServer({
        port: 3955,
        host: "127.0.0.1",
        autoExit: false,
    })

    const info = await server.start()
    const baseUrl = `http://${info.host}:${info.port}`

    t.after(async () => {
        await server.close()
        await fs.remove(TEST_OUT_DIR)
    })

    await t.test("1. GET /api/env should return hardware and presets with metadata", async () => {
        const res = await fetch(`${baseUrl}/api/env`)
        assert.strictEqual(res.status, 200)
        const data = await res.json()
        assert.strictEqual(data.ok, true)
        assert.ok(Array.isArray(data.presets))
        assert.ok(data.presets.length > 0)
        const hevcPreset = data.presets.find((p) => p.name === "hevc_2k")
        assert.ok(hevcPreset)
        assert.strictEqual(hevcPreset.videoCodecFamily, "hevc")
        assert.ok(hevcPreset.videoQuality !== undefined)
        assert.ok(hevcPreset.audioCodec !== undefined)
    })

    await t.test("2. POST /api/plan should analyze video and support custom options", async () => {
        const res = await fetch(`${baseUrl}/api/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                inputs: [SAMPLE_VIDEO],
                output: TEST_OUT_DIR,
                preset: "h264_2k",
                options: {
                    audioCodec: "aac",
                    audioBitrate: "128k",
                    videoBitrate: "1500k",
                    fps: 30,
                    speed: 1.25,
                },
            }),
        })
        assert.strictEqual(res.status, 200)
        const data = await res.json()
        assert.strictEqual(data.ok, true)
        assert.strictEqual(data.plan.totalTasks, 1)
        assert.ok(data.plan.previewCmd.includes("ffmpeg"))
        assert.strictEqual(data.plan.tasks[0].name, path.basename(SAMPLE_VIDEO))
    })

    await t.test(
        "3. POST /api/task/start should execute real transcode and emit progress",
        async () => {
            // 连接 SSE 监听进度与日志
            const eventsReceived = []
            const logsReceived = []
            let doneResolve
            const donePromise = new Promise((resolve) => {
                doneResolve = resolve
            })

            const sseRes = await fetch(`${baseUrl}/api/events`)
            const reader = sseRes.body.getReader()
            const decoder = new TextDecoder()

            const readLoop = async () => {
                let buffer = ""
                while (true) {
                    const { value, done } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split("\n\n")
                    buffer = lines.pop() || ""
                    for (const chunk of lines) {
                        if (chunk.includes("event: PROGRESS")) {
                            eventsReceived.push("PROGRESS")
                        } else if (chunk.includes("event: FILE_DONE")) {
                            eventsReceived.push("FILE_DONE")
                        } else if (chunk.includes("event: ALL_DONE")) {
                            eventsReceived.push("ALL_DONE")
                            doneResolve()
                        } else if (chunk.includes("event: LOG")) {
                            logsReceived.push(chunk)
                        }
                    }
                }
            }
            readLoop()

            // 触发开始转码
            const startRes = await fetch(`${baseUrl}/api/task/start`, { method: "POST" })
            assert.strictEqual(startRes.status, 200)
            const startData = await startRes.json()
            assert.strictEqual(startData.ok, true)

            // 等待转码完成（最多 60 秒）
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Transcode timeout")), 60000),
            )
            await Promise.race([donePromise, timeout])

            reader.cancel()

            // 验证收到了进度与完成事件
            assert.ok(eventsReceived.includes("FILE_DONE"), "Should receive FILE_DONE event")
            assert.ok(eventsReceived.includes("ALL_DONE"), "Should receive ALL_DONE event")

            // 验证收到了包含 [PREPARE] 和 [CMD] 的 LOG 事件
            const allLogText = logsReceived.join("\n")
            assert.ok(
                allLogText.includes("[PREPARE]") || allLogText.includes('"tag":"Prepare"'),
                "Should receive PREPARE log",
            )
            assert.ok(
                allLogText.includes("[CMD]") || allLogText.includes('"tag":"Command"'),
                "Should receive CMD log",
            )

            // 验证产物文件已生成且大小非空
            const outFiles = await fs.readdir(TEST_OUT_DIR)
            const transcodeOutputs = outFiles.filter((f) => !f.includes("_tmp@"))
            assert.ok(transcodeOutputs.length > 0, "Output file must be generated")

            const outStat = await fs.stat(path.join(TEST_OUT_DIR, transcodeOutputs[0]))
            assert.ok(outStat.size > 1000, `Output size should be > 1KB, got ${outStat.size}`)
        },
    )

    await t.test("4. POST /api/task/stop should abort running transcode", async () => {
        // 先生成新计划（覆盖模式）
        await fetch(`${baseUrl}/api/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                inputs: [SAMPLE_VIDEO],
                output: TEST_OUT_DIR,
                preset: "hevc_4k",
                options: { override: true },
            }),
        })

        // 开始
        await fetch(`${baseUrl}/api/task/start`, { method: "POST" })

        // 稍等 150ms 启动子进程后发送停止
        await new Promise((r) => setTimeout(r, 150))
        const stopRes = await fetch(`${baseUrl}/api/task/stop`, { method: "POST" })
        const stopData = await stopRes.json()
        assert.strictEqual(stopData.ok, true)

        // 再次查看状态
        await new Promise((r) => setTimeout(r, 500))
        const snapRes = await fetch(`${baseUrl}/api/snapshot`)
        const snapData = await snapRes.json()
        assert.ok(
            ["STOPPED", "COMPLETED", "IDLE"].includes(snapData.snapshot.status),
            `Status should be stopped, got ${snapData.snapshot.status}`,
        )

        // 验证无任何残留的临时文件 _tmp@
        const remainingFiles = await fs.readdir(TEST_OUT_DIR)
        const tempFiles = remainingFiles.filter((f) => f.includes("_tmp@"))
        assert.strictEqual(tempFiles.length, 0, "No temporary files should be left")
    })
})

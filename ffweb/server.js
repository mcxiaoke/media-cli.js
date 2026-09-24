/**
 * FFmpeg WebUI 本地服务
 *
 * 极简、零新增第三方网络依赖的 HTTP + SSE (Server-Sent Events) 本地服务。
 * 负责静态资源托管、REST API 响应、实时流式推送与空闲自动退出管理。
 */
import crypto from "crypto"
import fs from "fs-extra"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { openNativeDialog } from "./dialog.js"
import { taskRunner } from "./task_runner.js"
import * as log from "../lib/debug.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSETS_DIR = path.join(__dirname, "assets")

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

export class WebServer {
    constructor({ port = 3900, host = "127.0.0.1", autoExit = true } = {}) {
        this.desiredPort = port
        this.host = host
        this.autoExit = autoExit
        this.port = null
        this.server = null
        this.token = crypto.randomBytes(16).toString("hex")
        this.sseClients = new Set()
        this.idleTimer = null
        this.idleTimeoutMs = 20000 // 20 秒无客户端且无任务则优雅退出
    }

    /**
     * 启动服务器并探测空闲端口
     */
    async start() {
        let currentPort = this.desiredPort
        const maxAttempts = 20

        for (let i = 0; i < maxAttempts; i++) {
            try {
                await this._listen(currentPort)
                this.port = currentPort
                break
            } catch (err) {
                if (err.code === "EADDRINUSE") {
                    currentPort++
                } else {
                    throw err
                }
            }
        }

        if (!this.port) {
            throw new Error(
                `Failed to bind to any port between ${this.desiredPort} and ${currentPort}`,
            )
        }

        // 监听 TaskRunner 事件并通过 SSE 实时广播
        taskRunner.addListener((event, data) => {
            this.broadcastSSE(event, data)
        })

        // 启动时开启一次空闲检测（等待浏览器打开）
        this.resetIdleTimer(45000)

        return {
            port: this.port,
            host: this.host,
            token: this.token,
            url: `http://${this.host}:${this.port}/?token=${this.token}`,
        }
    }

    _listen(port) {
        return new Promise((resolve, reject) => {
            const srv = http.createServer((req, res) => this.handleRequest(req, res))
            srv.once("error", reject)
            srv.listen(port, this.host, () => {
                srv.removeListener("error", reject)
                this.server = srv
                resolve()
            })
        })
    }

    /**
     * 关闭服务器
     */
    async close() {
        if (this.idleTimer) clearTimeout(this.idleTimer)
        await log.flushFileLog()
        if (this.server) {
            return new Promise((resolve) => this.server.close(resolve))
        }
    }

    resetIdleTimer(customMs = null) {
        if (!this.autoExit) return
        if (this.idleTimer) clearTimeout(this.idleTimer)

        // 若当前有任务正在执行，不启动空闲退出
        if (taskRunner.status === "RUNNING") return

        const ms = customMs || this.idleTimeoutMs
        this.idleTimer = setTimeout(() => {
            if (this.sseClients.size === 0 && taskRunner.status !== "RUNNING") {
                this.close().then(() => {
                    process.exit(0)
                })
            }
        }, ms)
    }

    /**
     * 向所有已连接的 Web 客户端广播 SSE 消息
     */
    broadcastSSE(event, data) {
        if (this.sseClients.size === 0) return
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        for (const client of this.sseClients) {
            try {
                client.write(payload)
            } catch {
                this.sseClients.delete(client)
            }
        }
    }

    async handleRequest(req, res) {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`)
        const pathname = parsedUrl.pathname

        // 跨域与基础头
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Token")

        if (req.method === "OPTIONS") {
            res.writeHead(204)
            return res.end()
        }

        // 路由分发
        if (pathname === "/api/events") {
            return this.handleSSE(req, res)
        }

        if (pathname.startsWith("/api/")) {
            return this.handleAPI(pathname, req, res)
        }

        // 静态文件服务
        return this.handleStatic(pathname, res)
    }

    /**
     * 处理 SSE 实时推送
     */
    handleSSE(req, res) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        })

        res.write(`event: CONNECTED\ndata: ${JSON.stringify({ ok: true })}\n\n`)
        this.sseClients.add(res)

        // 发送当前快照
        const snapshot = taskRunner.getSnapshot()
        res.write(`event: SNAPSHOT\ndata: ${JSON.stringify(snapshot)}\n\n`)

        // 清除退出定时器
        if (this.idleTimer) clearTimeout(this.idleTimer)

        // 心跳包
        const pingInterval = setInterval(() => {
            try {
                res.write(": ping\n\n")
            } catch {
                clearInterval(pingInterval)
            }
        }, 10000)

        req.on("close", () => {
            clearInterval(pingInterval)
            this.sseClients.delete(res)
            if (this.sseClients.size === 0) {
                this.resetIdleTimer()
            }
        })
    }

    /**
     * 处理 REST API
     */
    async handleAPI(pathname, req, res) {
        const sendJSON = (statusCode, obj) => {
            res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" })
            res.end(JSON.stringify(obj))
        }

        const readBody = async () => {
            let data = ""
            for await (const chunk of req) data += chunk
            try {
                return JSON.parse(data || "{}")
            } catch {
                return {}
            }
        }

        try {
            if (pathname === "/api/env" && req.method === "GET") {
                const env = await taskRunner.getEnv()
                return sendJSON(200, { ok: true, ...env })
            }

            if (pathname === "/api/snapshot" && req.method === "GET") {
                return sendJSON(200, { ok: true, snapshot: taskRunner.getSnapshot() })
            }

            if (pathname === "/api/dialog/select" && req.method === "POST") {
                const body = await readBody()
                const paths = await openNativeDialog({
                    mode: body.mode || "file",
                    multi: body.multi !== false,
                    title: body.title || "选择媒体文件或目录",
                })
                return sendJSON(200, { ok: true, paths })
            }

            if (pathname === "/api/plan" && req.method === "POST") {
                const body = await readBody()
                const result = await taskRunner.createPlan(body)
                return sendJSON(200, result)
            }

            if (pathname === "/api/task/start" && req.method === "POST") {
                // 异步开始执行，不阻塞 HTTP 响应
                taskRunner.startExecution().catch((err) => {
                    taskRunner.appendLog("error", "Run", `Execution error: ${err.message}`)
                })
                return sendJSON(200, { ok: true, message: "Execution started" })
            }

            if (pathname === "/api/task/stop" && req.method === "POST") {
                const result = taskRunner.stopExecution()
                return sendJSON(200, result)
            }

            return sendJSON(404, { ok: false, error: "Not Found" })
        } catch (err) {
            return sendJSON(500, { ok: false, error: err.message || String(err) })
        }
    }

    /**
     * 处理前端静态文件托管
     */
    async handleStatic(pathname, res) {
        let reqPath = pathname === "/" ? "/index.html" : pathname
        let filePath = path.join(ASSETS_DIR, reqPath)

        // 防止目录遍历
        if (!filePath.startsWith(ASSETS_DIR)) {
            res.writeHead(403)
            return res.end("Forbidden")
        }

        if (!(await fs.pathExists(filePath))) {
            // 降级返回 index.html
            filePath = path.join(ASSETS_DIR, "index.html")
            if (!(await fs.pathExists(filePath))) {
                res.writeHead(404)
                return res.end("Not Found")
            }
        }

        const ext = path.extname(filePath).toLowerCase()
        const mime = MIME_TYPES[ext] || "application/octet-stream"

        try {
            const content = await fs.readFile(filePath)
            res.writeHead(200, { "Content-Type": mime })
            res.end(content)
        } catch {
            res.writeHead(500)
            res.end("Internal Server Error")
        }
    }
}

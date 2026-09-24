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

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_INPUTS = 5000
const MAX_PATH_LENGTH = 4096

function isLoopbackHost(host) {
    return LOOPBACK_HOSTS.has(String(host).trim().toLowerCase())
}

function httpError(statusCode, message) {
    const error = new Error(message)
    error.statusCode = statusCode
    return error
}

export class WebServer {
    constructor({ port = 3900, host = "127.0.0.1", autoExit = true } = {}) {
        this.desiredPort = port
        this.host = String(host).trim().toLowerCase()
        this.autoExit = autoExit
        this.port = null
        this.server = null
        this.publicOrigin = null
        this.token = crypto.randomBytes(16).toString("hex")
        this.sseClients = new Set()
        this.idleTimer = null
        this.idleTimeoutMs = 20000 // 20 秒无客户端且无任务则优雅退出
    }

    /**
     * 启动服务器并探测空闲端口
     */
    async start() {
        if (!isLoopbackHost(this.host)) {
            throw new Error("ffweb remote binding is disabled; use 127.0.0.1, localhost, or ::1")
        }

        let currentPort = this.desiredPort
        const maxAttempts = 20

        for (let i = 0; i < maxAttempts; i++) {
            try {
                await this._listen(currentPort)
                this.port = this.server.address()?.port || currentPort
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

        const urlHost = this.host.includes(":") ? `[${this.host}]` : this.host
        this.publicOrigin = `http://${urlHost}:${this.port}`

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

    _isOriginAllowed(req) {
        const origin = req.headers.origin
        // Node/CLI 客户端通常没有 Origin；浏览器请求必须严格同源。
        return !origin || origin === this.publicOrigin
    }

    _applyCorsHeaders(req, res) {
        res.setHeader("Vary", "Origin")
        if (!this._isOriginAllowed(req)) {
            return false
        }
        if (req.headers.origin) {
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin)
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Token")
        }
        return true
    }

    _requestToken(req, parsedUrl) {
        const headerToken = req.headers["x-token"]
        const normalizedHeaderToken = Array.isArray(headerToken) ? headerToken[0] : headerToken
        return parsedUrl.searchParams.get("token") || normalizedHeaderToken || ""
    }

    _isAuthorized(req, parsedUrl) {
        const supplied = Buffer.from(this._requestToken(req, parsedUrl))
        const expected = Buffer.from(this.token)
        return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
    }

    _validatePlanBody(body) {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw httpError(400, "Request body must be a JSON object")
        }
        if (!Array.isArray(body.inputs) || body.inputs.length === 0) {
            throw httpError(400, "inputs must be a non-empty array")
        }
        if (body.inputs.length > MAX_INPUTS) {
            throw httpError(413, `Too many inputs (maximum ${MAX_INPUTS})`)
        }
        for (const input of body.inputs) {
            if (typeof input !== "string" || input.length === 0 || input.length > MAX_PATH_LENGTH) {
                throw httpError(400, "Each input must be a non-empty path string")
            }
        }
        if (body.output !== undefined && body.output !== null) {
            if (typeof body.output !== "string" || body.output.length > MAX_PATH_LENGTH) {
                throw httpError(400, "output must be a valid path string")
            }
        }
        if (body.preset !== undefined && typeof body.preset !== "string") {
            throw httpError(400, "preset must be a string")
        }
        if (
            body.options !== undefined &&
            (!body.options || typeof body.options !== "object" || Array.isArray(body.options))
        ) {
            throw httpError(400, "options must be a JSON object")
        }
        return body
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

        if (!this._applyCorsHeaders(req, res)) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
            return res.end("Forbidden")
        }

        if (req.method === "OPTIONS") {
            res.writeHead(204)
            return res.end()
        }

        // API/SSE 是高权限接口，必须验证随机 token；token 可放 query（EventSource）
        // 或 X-Token header（fetch）。
        if (pathname.startsWith("/api/") && !this._isAuthorized(req, parsedUrl)) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" })
            return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }))
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
            const chunks = []
            let size = 0
            for await (const chunk of req) {
                size += chunk.length
                if (size > MAX_BODY_BYTES) {
                    throw httpError(413, "Request body is too large")
                }
                chunks.push(Buffer.from(chunk))
            }
            const data = Buffer.concat(chunks).toString("utf8")
            if (!data.trim()) return {}
            try {
                return JSON.parse(data)
            } catch {
                throw httpError(400, "Request body must be valid JSON")
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
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    throw httpError(400, "Request body must be a JSON object")
                }
                const mode = body.mode || "file"
                if (mode !== "file" && mode !== "directory") {
                    throw httpError(400, "mode must be file or directory")
                }
                const title =
                    typeof body.title === "string" ? body.title.slice(0, 200) : "选择媒体文件或目录"
                const paths = await openNativeDialog({
                    mode,
                    multi: body.multi !== false,
                    title,
                })
                return sendJSON(200, { ok: true, paths })
            }

            if (pathname === "/api/plan" && req.method === "POST") {
                const body = this._validatePlanBody(await readBody())
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
            return sendJSON(err.statusCode || 500, { ok: false, error: err.message || String(err) })
        }
    }

    /**
     * 处理前端静态文件托管
     */
    async handleStatic(pathname, res) {
        let reqPath = pathname === "/" ? "/index.html" : pathname
        let filePath = path.resolve(ASSETS_DIR, `.${reqPath}`)

        // 防止目录穿越；不能只用 startsWith，避免 assets2 之类的路径前缀误判。
        const relative = path.relative(ASSETS_DIR, filePath)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
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

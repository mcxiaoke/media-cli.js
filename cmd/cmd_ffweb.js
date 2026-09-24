/*
 * Project: mediac
 * File: cmd_ffweb.js
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import { execa } from "execa"
import fs from "fs-extra"
import which from "which"
import * as log from "../lib/debug.js"
import { WebServer } from "../ffweb/server.js"

export { aliases, builder, command, describe, handler }

const command = "ffweb [input]"
const aliases = ["web", "gui"]
const describe = "Launch FFmpeg Web Studio GUI (启动音视频转码 Web 图形界面)"

const builder = function addOptions(ya) {
    return ya
        .positional("input", {
            describe: "Initial folder or media file to load (初始加载的文件夹或文件)",
            type: "string",
        })
        .option("port", {
            alias: "p",
            type: "number",
            default: 3900,
            describe: "HTTP/SSE server port (Web 服务端口，默认 3900)",
        })
        .option("host", {
            type: "string",
            default: "127.0.0.1",
            describe: "Server bind host (仅允许 127.0.0.1、localhost 或 ::1；默认 127.0.0.1)",
        })
        .option("open", {
            type: "boolean",
            default: true,
            describe: "Automatically open Edge App or default browser (自动打开界面)",
        })
        .option("browser", {
            type: "boolean",
            default: false,
            describe:
                "Force open in regular browser instead of Edge App mode (强制使用普通浏览器打开)",
        })
}

async function findEdgeBinary() {
    if (process.platform !== "win32") {
        return null
    }
    const candidates = [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        process.env.LOCALAPPDATA &&
            `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean)

    for (const p of candidates) {
        if (await fs.pathExists(p)) {
            return p
        }
    }

    try {
        const found = await which("msedge")
        if (found) return found
    } catch {
        // ignore
    }

    return null
}

async function openUrl(url, forceBrowser = false) {
    if (!forceBrowser && process.platform === "win32") {
        const edgeBin = await findEdgeBinary()
        if (edgeBin) {
            log.show(chalk.green("ffweb:"), `Launching Microsoft Edge App mode...`)
            // 以独立应用模式拉起 Edge（无地址栏、无标签页）
            execa(edgeBin, [`--app=${url}`, "--window-size=1360,860"], {
                detached: true,
                stdio: "ignore",
            }).unref()
            return
        }
    }

    // 降级为系统默认浏览器打开
    log.show(chalk.green("ffweb:"), `Opening in default browser...`)
    if (process.platform === "win32") {
        execa("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref()
    } else if (process.platform === "darwin") {
        execa("open", [url], { detached: true, stdio: "ignore" }).unref()
    } else {
        execa("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
    }
}

const handler = async function (argv) {
    log.show(chalk.cyan("=================================================="))
    log.show(chalk.cyan("  mediac ffweb - FFmpeg Web Studio GUI"))
    log.show(chalk.cyan("=================================================="))

    const server = new WebServer({
        port: argv.port,
        host: argv.host,
        autoExit: true,
    })

    const { url, port } = await server.start()

    log.show(chalk.green("Server running at:"), chalk.yellow.bold(url))
    log.show(chalk.gray(`Port: ${port} | Host: ${argv.host} | Auto-Exit: Enabled on window close`))
    log.show(chalk.gray("Press Ctrl+C to terminate."))

    if (argv.open) {
        try {
            await openUrl(url, argv.browser)
        } catch (err) {
            log.showYellow(`Could not open browser automatically: ${err.message}`)
            log.show(`Please open the following link manually in your browser:\n  ${url}`)
        }
    }

    // 保持主事件循环存活
    return new Promise(() => {})
}

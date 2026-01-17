/*
 * Project: mediac
 * Created: 2021-08-02 15:40:17 +0800
 * Modified: 2024-04-09 22:15:20 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

const path = require("path")
const stream = require("stream")
const { promisify } = require("util")
const fs = require("fs-extra")
const throat = require("throat")
const got = require("got")
const { URL } = require("url")
const os = require("os")
const sanitizeFilename = require("sanitize-filename")
const pipeline = promisify(stream.pipeline)
const { bootstrap } = require("global-agent")

bootstrap()

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36"

global.GLOBAL_AGENT.HTTP_PROXY =
    process.env["http_proxy"] || process.env["https_proxy"] || process.env["all_proxy"]

console.log("Proxy:", global.GLOBAL_AGENT.HTTP_PROXY)

async function downloadUrl(url, options) {
    options = options || {}
    const filepath = new URL(url).pathname
    const filename = sanitizeFilename(path.basename(filepath))
    const dirDst = path.resolve(
        options.output || path.join("Downloads", sanitizeFilename(path.dirname(filepath))),
    )
    // console.log(`Downloading ${url}`);
    const fileDst = path.join(dirDst, filename)
    try {
        const stats = await fs.stat(fileDst)
        if (stats.isFile() && stats.size < 1024) {
            console.log(`Del Invalid: ${fileDst} (${stats.size / 1000}k)`)
            await fs.rm(fileDst)
        }
    } catch (error) {
        console.log(error)
        //ignore
    }
    if (await fs.pathExists(fileDst)) {
        // console.log(`Skip Exists: ${fileDst}`);
        return
    }
    try {
        if (!(await fs.pathExists(dirDst))) {
            await fs.mkdirp(dirDst)
        }
        await pipeline(
            got.stream(url, { headers: { "user-agent": USER_AGENT } }),
            fs.createWriteStream(fileDst),
        )
        console.log(`Downloaded to ${fileDst}`)
        return fileDst
    } catch (error) {
        console.error("Download Error", String(error))
    }
}

async function DownloadUrls() {
    console.log(process.argv.slice(2))
    const data = await fs.readFile(process.argv.slice(2)[0], {
        encoding: "utf8",
    })
    const urls = data.split(os.EOL)
    const results = Promise.all(urls.map(throat(8, (url) => downloadUrl(url))))
    console.log(`Result: ${(await results).length} files downloaded!`)
}

DownloadUrls()

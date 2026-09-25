/*
 * Verify the packed npm artifact in an isolated installation.
 */
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const RELEASE_ROOT = path.join(ROOT, "temp", "release-check")

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || ROOT,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        env: process.env,
    })
    if (result.status !== 0) {
        if (result.stdout) process.stderr.write(result.stdout)
        if (result.stderr) process.stderr.write(result.stderr)
        throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`)
    }
    return result.stdout.trim()
}

function runNpm(args, options = {}) {
    if (process.env.npm_execpath) {
        return run(process.execPath, [process.env.npm_execpath, ...args], options)
    }
    return run(process.platform === "win32" ? "npm.cmd" : "npm", args, options)
}

function hasPathPrefix(file, prefix) {
    return file === prefix || file.startsWith(`${prefix}/`)
}

fs.rmSync(RELEASE_ROOT, { recursive: true, force: true })
fs.mkdirSync(RELEASE_ROOT, { recursive: true })

const packOutput = runNpm(["pack", "--json", "--pack-destination", RELEASE_ROOT])
const packMetadata = JSON.parse(packOutput)
const packed = Array.isArray(packMetadata) ? packMetadata[0] : packMetadata
if (!packed?.filename || !Array.isArray(packed.files)) {
    throw new Error("npm pack did not return file metadata")
}

const files = packed.files.map((entry) => entry.path.replaceAll("\\", "/"))
const requiredFiles = ["index.js", "src/transcode/index.js", "lib/debug.js", "presets/default.yaml"]
const requiredDirectories = ["scripts", "src", "lib", "cmd", "assets", "presets"]
const forbiddenDirectories = ["apps", "docs", "test", "labs", "release"]

for (const required of requiredFiles) {
    if (!files.includes(required)) throw new Error(`Packed artifact is missing ${required}`)
}
for (const required of requiredDirectories) {
    if (!files.some((file) => hasPathPrefix(file, required))) {
        throw new Error(`Packed artifact has no files under ${required}/`)
    }
}
for (const forbidden of forbiddenDirectories) {
    if (files.some((file) => hasPathPrefix(file, forbidden))) {
        throw new Error(`Packed artifact unexpectedly contains ${forbidden}/`)
    }
}
for (const file of files) {
    if (path.isAbsolute(file) || /^[a-z]:[\\/]/i.test(file)) {
        throw new Error(`Packed artifact contains an absolute path: ${file}`)
    }
}
const textExtensions = new Set([".cjs", ".js", ".json", ".md", ".mjs", ".txt", ".yaml", ".yml"])
for (const file of files) {
    if (!textExtensions.has(path.extname(file))) continue
    const content = fs.readFileSync(path.join(ROOT, file), "utf8")
    if (/[a-z]:[\\/](?:home|users|projects)[\\/]/i.test(content)) {
        throw new Error(`Packed file contains a development-machine path: ${file}`)
    }
}

const installRoot = fs.mkdtempSync(path.join(RELEASE_ROOT, "install-"))
fs.writeFileSync(
    path.join(installRoot, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
    "utf8",
)
const tarball = path.join(RELEASE_ROOT, packed.filename)
runNpm(["install", tarball, "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: installRoot })

const cli = path.join(installRoot, "node_modules", "mediac", "index.js")
for (const args of [
    ["--version"],
    ["--help"],
    ["ffmpeg", "--help"],
    ["ffmpeg", ".", "--show-presets"],
]) {
    run(process.execPath, [cli, ...args], { cwd: installRoot })
}

console.log(`Package smoke passed: ${files.length} files, installed at ${installRoot}`)

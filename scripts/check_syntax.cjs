const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

function walk(dir) {
    const res = []
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        const st = fs.statSync(p)
        if (st.isDirectory()) res.push(...walk(p))
        else if (st.isFile() && p.endsWith(".js")) res.push(p)
    }
    return res
}

// 检查 cmd 和 lib 目录下的 .js 文件
const dirs = [path.join(__dirname, "..", "cmd"), path.join(__dirname, "..", "lib")]
const files = []
for (const d of dirs) {
    if (!fs.existsSync(d)) {
        console.error("directory not found:", d)
        continue
    }
    files.push(...walk(d))
}
if (!files.length) {
    console.log("No .js files found under cmd/ or lib/.")
    process.exit(0)
}

let hasErr = false
for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" })
    if (r.status !== 0) {
        hasErr = true
        console.error("\n-- Syntax error in:", f)
        if (r.stdout) console.error(r.stdout)
        if (r.stderr) console.error(r.stderr)
    } else {
        console.log(`OK: ${f}`)
    }
}
if (hasErr) process.exit(1)
console.log("\nAll *.js passed node --check")

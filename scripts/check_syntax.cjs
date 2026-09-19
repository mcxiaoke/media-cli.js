/*
 * File: check_syntax.cjs
 * Description: 全仓库语法检查 + Node 版本兼容性自检
 *
 * 为什么扩展范围（原脚本只扫 cmd/ 与 lib/）：
 *   index.js、tools/、scripts/、test/ 的语法错误不会被发现，
 *   而这些目录同样会被引擎加载或被执行，属门禁盲区。
 *
 * 为什么做版本自检：
 *   曾因代码使用了 `using` 声明式资源管理（需 Node >= 24）而在 Node 22 上
 *   整包不可用，而 engines 声明又是基于错误假设写的。此处不仅比对运行时版本
 *   与 package.json 的 engines，还扫描代码中是否出现超出该下限的新语法。
 */
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")

// 不参与检查的目录：node_modules(依赖)、temp(备份与中间产物)、
// coverage(覆盖率)、.git、assets(二进制素材)、dist(构建产物)
const SKIP_DIRS = new Set(["node_modules", "temp", "coverage", ".git", "assets", "dist"])

const JS_EXT = [".js", ".cjs", ".mjs"]

function walk(dir) {
    const res = []
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        let st
        try {
            st = fs.statSync(p)
        } catch {
            continue
        }
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue
            res.push(...walk(p))
        } else if (st.isFile() && JS_EXT.includes(path.extname(name))) {
            res.push(p)
        }
    }
    return res
}

// ---------------------------------------------------------------- 语法检查

const files = walk(ROOT).sort()
if (!files.length) {
    console.log("No .js files found.")
    process.exit(0)
}

let hasErr = false
const failed = []
for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" })
    if (r.status !== 0) {
        hasErr = true
        failed.push(f)
        console.error("\n-- Syntax error in:", path.relative(ROOT, f))
        if (r.stdout) console.error(r.stdout)
        if (r.stderr) console.error(r.stderr)
    }
}

// -------------------------------------------------- 运行时版本与 engines 比对

function checkEngines() {
    const pkgPath = path.join(ROOT, "package.json")
    if (!fs.existsSync(pkgPath)) return
    const engines = JSON.parse(fs.readFileSync(pkgPath, "utf8")).engines
    if (!engines?.node) return
    const m = /(\d+)/.exec(engines.node)
    if (!m) return
    const required = Number.parseInt(m[1], 10)
    const current = Number.parseInt(process.versions.node.split(".")[0], 10)
    if (current < required) {
        hasErr = true
        console.error(
            `\n-- Node version mismatch: engines requires >=${required}, running ${process.versions.node}`,
        )
    } else {
        console.log(`Node ${process.versions.node} satisfies engines "node": "${engines.node}"`)
    }
}

// ------------------------------------- 扫描超出 engines 下限的新语法（第一道防线）

// 只做轻量文本匹配，用于拦截"在旧版本上解析即失败"的语法，
// 避免再次出现 using / await using 这类整包不可用的问题。
const SYNTAX_GATES = [
    {
        pattern: /^\s*await\s+using\s+\w+\s*=/m,
        name: "await using（声明式资源管理，需要 Node >= 24）",
    },
    {
        pattern: /^\s*using\s+\w+\s*=/m,
        name: "using（声明式资源管理，需要 Node >= 24）",
    },
]

function checkModernSyntax() {
    const hits = []
    for (const f of files) {
        let src
        try {
            src = fs.readFileSync(f, "utf8")
        } catch {
            continue
        }
        for (const gate of SYNTAX_GATES) {
            if (gate.pattern.test(src)) {
                hits.push(`${path.relative(ROOT, f)}: ${gate.name}`)
            }
        }
    }
    if (hits.length) {
        hasErr = true
        console.error("\n-- 检测到超出 engines 下限的语法：")
        for (const h of hits) console.error(`   ${h}`)
    }
}

checkEngines()
checkModernSyntax()

// --------------------------------------------------------------------- 汇总

if (hasErr) {
    console.error(`\n${failed.length} file(s) failed syntax check.`)
    process.exit(1)
}
console.log(`\nAll ${files.length} *.js passed node --check`)

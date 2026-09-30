import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TRANSCODE_DIR = path.join(ROOT, "src", "transcode")
const TRANSCODE_FACADE = path.join(TRANSCODE_DIR, "index.js")
const LIB_DIR = path.join(ROOT, "lib")
const CMD_DIR = path.join(ROOT, "cmd")
const SRC_DIR = path.join(ROOT, "src")
const APP_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".vue"])
const ESM_EXTENSIONS = new Set([".js", ".mjs"])

function walk(dir, extensions) {
    if (!fs.existsSync(dir)) return []
    const result = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name)
        if (entry.isDirectory()) result.push(...walk(target, extensions))
        else if (extensions.has(path.extname(entry.name))) result.push(target)
    }
    return result
}

function extractImports(source) {
    const patterns = [
        /\bimport\s+(?:type\s+)?(?:[\w$*{},\s]+\s+from\s+)?["']([^"']+)["']/g,
        /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']/g,
    ]
    const found = new Map()
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1]
            const line = source.slice(0, match.index).split("\n").length
            found.set(`${line}:${specifier}`, { line, specifier })
        }
    }
    return [...found.values()].sort((a, b) => a.line - b.line)
}

function resolveRelativeImport(sourceFile, specifier) {
    const base = path.resolve(path.dirname(sourceFile), specifier)
    const candidates = [base, `${base}.js`, path.join(base, "index.js")]
    return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function isWithin(file, directory) {
    const relative = path.relative(directory, file)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function collectRelativeImports(file) {
    const source = fs.readFileSync(file, "utf8")
    return extractImports(source)
        .filter((entry) => entry.specifier.startsWith("."))
        .map((entry) => ({ ...entry, target: resolveRelativeImport(file, entry.specifier) }))
        .filter((entry) => entry.target)
}

function findForbiddenImports(files, directories) {
    const violations = []
    for (const file of files) {
        for (const { line, specifier, target } of collectRelativeImports(file)) {
            if (directories.some((directory) => isWithin(target, directory))) {
                violations.push(`${relative(file)}:${line} -> ${specifier}`)
            }
        }
    }
    return violations
}

function collectRootSources() {
    return [
        path.join(ROOT, "index.js"),
        ...walk(LIB_DIR, ESM_EXTENSIONS),
        ...walk(CMD_DIR, ESM_EXTENSIONS),
        ...walk(SRC_DIR, ESM_EXTENSIONS),
        ...walk(path.join(ROOT, "test"), ESM_EXTENSIONS),
        ...walk(path.join(ROOT, "labs"), ESM_EXTENSIONS),
    ].filter((file) => fs.existsSync(file))
}

function collectProtectedSources() {
    return [
        path.join(ROOT, "index.js"),
        ...walk(CMD_DIR, APP_EXTENSIONS),
        ...walk(path.join(ROOT, "labs"), APP_EXTENSIONS),
        ...walk(path.join(ROOT, "scripts"), APP_EXTENSIONS),
        ...walk(path.join(ROOT, "tools"), APP_EXTENSIONS),
    ].filter((file) => fs.existsSync(file))
}

function relative(file) {
    return path.relative(ROOT, file).replaceAll("\\", "/")
}

const FACADE_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*transcode\/index\.js["']/g

/** 解析 import/export 花括号里的名字列表 */
function parseImportedNames(list, useAlias) {
    const names = []
    for (const part of list.split(",")) {
        const segments = part.trim().split(/\s+as\s+/)
        const name = (useAlias ? segments.at(-1) : segments[0]).trim()
        if (name) names.push(name)
    }
    return names
}

test("CLI, labs, scripts, and tools only import transcode through its facade", () => {
    const violations = []
    for (const file of collectProtectedSources()) {
        const source = fs.readFileSync(file, "utf8")
        for (const { line, specifier } of extractImports(source)) {
            if (!specifier.startsWith(".")) continue
            const target = resolveRelativeImport(file, specifier)
            if (
                target &&
                isWithin(target, TRANSCODE_DIR) &&
                path.resolve(target) !== TRANSCODE_FACADE
            ) {
                violations.push(`${relative(file)}:${line} -> ${specifier}`)
            }
        }
    }
    assert.deepEqual(violations, [], `Transcode deep imports found:\n${violations.join("\n")}`)
})

test("relative imports in root ESM sources resolve to real files", () => {
    const violations = []
    for (const file of collectRootSources()) {
        const source = fs.readFileSync(file, "utf8")
        for (const { line, specifier } of extractImports(source)) {
            if (!specifier.startsWith(".")) continue
            if (!resolveRelativeImport(file, specifier)) {
                violations.push(`${relative(file)}:${line} -> ${specifier}`)
            }
        }
    }
    assert.deepEqual(violations, [], `Unresolved relative imports found:\n${violations.join("\n")}`)
})

test("transcode facade exports nothing without a CLI consumer", () => {
    const exported = new Set()
    const facadeSource = fs.readFileSync(TRANSCODE_FACADE, "utf8")
    for (const m of facadeSource.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
        for (const name of parseImportedNames(m[1], true)) exported.add(name)
    }

    const used = new Set()
    for (const file of collectProtectedSources()) {
        const source = fs.readFileSync(file, "utf8")
        for (const m of source.matchAll(FACADE_IMPORT_RE)) {
            for (const name of parseImportedNames(m[1], false)) used.add(name)
        }
    }

    // 桌面端迁出后本仓库没有第二个消费方：无消费者的 facade 导出即外部调用方遗留
    const orphans = [...exported].filter((name) => !used.has(name)).sort()
    assert.deepEqual(orphans, [], `Facade exports without a CLI consumer:\n${orphans.join("\n")}`)
})

test("legacy lib never imports cmd or src", () => {
    const violations = findForbiddenImports(walk(LIB_DIR, ESM_EXTENSIONS), [CMD_DIR, SRC_DIR])
    assert.deepEqual(violations, [], `lib/ upward imports found:\n${violations.join("\n")}`)
})

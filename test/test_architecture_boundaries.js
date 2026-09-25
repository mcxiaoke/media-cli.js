import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TRANSCODE_DIR = path.join(ROOT, "src", "transcode")
const TRANSCODE_FACADE = path.join(TRANSCODE_DIR, "index.js")

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

function collectRootSources() {
    const extensions = new Set([".js", ".mjs"])
    return [
        path.join(ROOT, "index.js"),
        ...walk(path.join(ROOT, "lib"), extensions),
        ...walk(path.join(ROOT, "cmd"), extensions),
        ...walk(path.join(ROOT, "src"), extensions),
        ...walk(path.join(ROOT, "test"), extensions),
        ...walk(path.join(ROOT, "labs"), extensions),
    ].filter((file) => fs.existsSync(file))
}

function collectProtectedSources() {
    const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".vue"])
    return [
        path.join(ROOT, "index.js"),
        ...walk(path.join(ROOT, "cmd"), extensions),
        ...walk(path.join(ROOT, "apps", "mediac-desktop", "src"), extensions),
        ...walk(path.join(ROOT, "labs"), extensions),
        ...walk(path.join(ROOT, "scripts"), extensions),
        ...walk(path.join(ROOT, "tools"), extensions),
    ].filter((file) => fs.existsSync(file))
}

function relative(file) {
    return path.relative(ROOT, file).replaceAll("\\", "/")
}

test("CLI, desktop, labs, scripts, and tools only import transcode through its facade", () => {
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

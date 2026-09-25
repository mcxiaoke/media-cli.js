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
const APPS_DIR = path.join(ROOT, "apps")
const DESKTOP_SRC = path.join(APPS_DIR, "mediac-desktop", "src")
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
        ...walk(DESKTOP_SRC, APP_EXTENSIONS),
        ...walk(path.join(ROOT, "labs"), APP_EXTENSIONS),
        ...walk(path.join(ROOT, "scripts"), APP_EXTENSIONS),
        ...walk(path.join(ROOT, "tools"), APP_EXTENSIONS),
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

test("legacy lib never imports cmd, src or apps", () => {
    const violations = findForbiddenImports(walk(LIB_DIR, ESM_EXTENSIONS), [
        CMD_DIR,
        SRC_DIR,
        APPS_DIR,
    ])
    assert.deepEqual(violations, [], `lib/ upward imports found:\n${violations.join("\n")}`)
})

test("electron main does not import CLI command modules", () => {
    const violations = findForbiddenImports(walk(path.join(DESKTOP_SRC, "main"), APP_EXTENSIONS), [
        CMD_DIR,
    ])
    assert.deepEqual(
        violations,
        [],
        `Electron main to cmd/ imports found:\n${violations.join("\n")}`,
    )
})

test("electron renderer and preload do not import root src, lib or cmd", () => {
    const files = [
        ...walk(path.join(DESKTOP_SRC, "renderer"), APP_EXTENSIONS),
        ...walk(path.join(DESKTOP_SRC, "preload"), APP_EXTENSIONS),
    ]
    const violations = findForbiddenImports(files, [SRC_DIR, LIB_DIR, CMD_DIR])
    assert.deepEqual(
        violations,
        [],
        `Electron renderer/preload to root modules found:\n${violations.join("\n")}`,
    )
})

test("electron main probes media info through the transcode facade", () => {
    const forbidden = path.resolve(path.join(LIB_DIR, "mediainfo.js"))
    const violations = []
    for (const file of walk(path.join(DESKTOP_SRC, "main"), APP_EXTENSIONS)) {
        for (const { line, specifier, target } of collectRelativeImports(file)) {
            if (path.resolve(target) === forbidden) {
                violations.push(`${relative(file)}:${line} -> ${specifier}`)
            }
        }
    }
    assert.deepEqual(
        violations,
        [],
        `Electron main direct lib/mediainfo imports found:\n${violations.join("\n")}`,
    )
})

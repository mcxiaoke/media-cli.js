/*
 * File: preset_loader.js
 * Created: 2026-03-27
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * YAML preset loader for FFmpeg presets
 * Supports:
 * - Loading presets from YAML files
 * - Preset inheritance (extends)
 * - Layered preset loading (built-in default.yaml → user ~/.mediac → cwd)
 * - Explicit override via `_override: true` (same-name presets are skipped by default)
 *
 * P0-1 修复（2026-09-21，详见 docs/ffmpeg-system-refactor-plan-20260921.md §2.1）：
 *   此前 `cwd/presets.yaml` 与内置预设同名时**无条件覆盖**，仓库自带 presets.yaml
 *   里 11+ 个旧式硬编码预设会静默架空内置 S-4 预设。
 *   现在同名预设必须显式声明 `_override: true` 才允许覆盖，否则 warn 并跳过，
 *   且内置预设收敛到随包发布的 presets/default.yaml（本层总是存在且最低优先级）。
 */

import fs from "fs-extra"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import * as log from "../../lib/debug.js"
import { PRESET_FIELDS, hasPresetTypeMismatch } from "./preset_schema.js"

const LOG_TAG = "PresetLoader"

let yamlParser = null

async function loadYamlParser() {
    if (yamlParser) return yamlParser
    try {
        const yaml = await import("js-yaml")
        yamlParser = yaml
        return yamlParser
    } catch (e) {
        log.logError(LOG_TAG, "js-yaml not installed, YAML presets will not be available")
        log.logError(LOG_TAG, "Install with: npm install js-yaml")
        return null
    }
}

// 包内内置预设目录/文件：通过 import.meta.url 定位，不依赖 process.cwd()，
// 因此从任意目录运行 mediac 都能命中（随 npm 包发布在 presets/ 目录）。
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PRESET_DIR = path.join(MODULE_DIR, "..", "..", "presets")
export const DEFAULT_PRESET_PATH = path.join(DEFAULT_PRESET_DIR, "default.yaml")

// 用户层搜索路径（覆盖/新增层，优先级从低到高）
const USER_SEARCH_PATHS = [
    path.join(os.homedir(), ".mediac", "presets.yaml"),
    path.join(os.homedir(), ".mediac", "presets.yml"),
    path.join(process.cwd(), "presets.yaml"),
    path.join(process.cwd(), "presets.yml"),
]

/**
 * 解析单文件预设路径。
 * customPath 存在时优先；否则在用户搜索路径中找第一个存在者；
 * 都不存在时回退到包内 default.yaml（随包必在，兜底）。
 */
function resolvePresetPath(customPath) {
    if (customPath) {
        const resolved = path.resolve(customPath)
        if (fs.pathExistsSync(resolved)) {
            return resolved
        }
    }
    for (const p of USER_SEARCH_PATHS) {
        if (fs.pathExistsSync(p)) {
            return p
        }
    }
    return fs.pathExistsSync(DEFAULT_PRESET_PATH) ? DEFAULT_PRESET_PATH : null
}

function resolveExtends(presets, presetName, resolved = new Set()) {
    if (resolved.has(presetName)) {
        throw new Error(`Circular extends detected: ${presetName}`)
    }
    resolved.add(presetName)

    const preset = presets[presetName]
    if (!preset) {
        throw new Error(`Preset not found: ${presetName}`)
    }

    if (!preset.extends) {
        return { ...preset }
    }

    const baseName = preset.extends
    const basePreset = resolveExtends(presets, baseName, resolved)

    const merged = { ...basePreset }
    for (const key of Object.keys(preset)) {
        if (key !== "extends") {
            merged[key] = preset[key]
        }
    }

    return merged
}

/**
 * 预设允许出现的字段白名单。
 *
 * 此前 `yaml.load()` 之后只判断了 `typeof === "object"`：字段拼错（如
 * `videoBitrat`、`dimesion`）会被静默忽略，用户以为改了码率其实一个字节都没变，
 * 且没有任何提示。这里显式告警未知字段。
 *
 * 字段白名单由 lib/preset_schema.js 统一维护（S-4 新字段 videoCodecFamily、
 * 三段式滤镜 pre_filters/post_filters 等均在其中），避免 loader 白名单
 * 与 FFmpegPreset 构造器字段脱节。
 */
function validatePresetFields(name, preset) {
    if (!preset || typeof preset !== "object") {
        log.logWarn(LOG_TAG, `Preset '${name}' is not an object, skipped`)
        return false
    }
    const unknown = Object.keys(preset).filter((k) => !PRESET_FIELDS.has(k))
    if (unknown.length > 0) {
        log.logWarn(
            LOG_TAG,
            `Preset '${name}' has unknown field(s): ${unknown.join(", ")} (ignored)`,
        )
    }
    const typeMismatch = Object.keys(preset).filter((k) => hasPresetTypeMismatch(k, preset[k]))
    if (typeMismatch.length > 0) {
        log.logWarn(
            LOG_TAG,
            `Preset '${name}' has field(s) with wrong type: ${typeMismatch.join(", ")} (ignored)`,
        )
    }
    return true
}

function processPresets(rawPresets) {
    const processed = {}
    const presetNames = Object.keys(rawPresets)

    for (const name of presetNames) {
        try {
            const resolved = resolveExtends(rawPresets, name)
            if (!validatePresetFields(name, resolved)) {
                continue
            }
            processed[name] = resolved
        } catch (e) {
            log.logWarn(LOG_TAG, `Failed to resolve preset '${name}': ${e.message}`)
        }
    }

    return processed
}

/**
 * 加载单个 YAML 预设文件。
 * customPath 缺失/无效时回退 resolvePresetPath（用户层 → 包内 default.yaml）。
 *
 * @returns {Promise<{path: string, presets: Object}|null>}
 */
export async function loadPresetsFromYaml(customPath = null) {
    const yaml = await loadYamlParser()
    if (!yaml) {
        return null
    }

    const presetPath = resolvePresetPath(customPath)
    if (!presetPath) {
        log.logDebug(LOG_TAG, "No YAML preset file found")
        return null
    }

    try {
        log.logInfo(LOG_TAG, `Loading presets from: ${presetPath}`)
        const content = await fs.readFile(presetPath, "utf8")
        const rawPresets = yaml.load(content)

        if (!rawPresets || typeof rawPresets !== "object") {
            log.logWarn(LOG_TAG, "Invalid YAML preset file: expected object")
            return null
        }

        const processed = processPresets(rawPresets)
        const count = Object.keys(processed).filter((k) => !k.startsWith("_")).length
        log.logSuccess(LOG_TAG, `Loaded ${count} presets from YAML`)

        return {
            path: presetPath,
            presets: processed,
        }
    } catch (e) {
        log.logError(LOG_TAG, `Failed to load YAML presets: ${e.message}`)
        return null
    }
}

/**
 * 分层加载全部存在的预设层（低 → 高优先级）：
 *   1. 包内 presets/default.yaml（内置层，总是存在）
 *   2. ~/.mediac/presets.yaml|yml（用户全局层）
 *   3. cwd/presets.yaml|yml（项目局部层）
 * 指定 customPath 时只加载该单文件（测试/调试用，不走分层）。
 *
 * @returns {Promise<Array<{path: string, presets: Object}>>}
 */
export async function loadPresetLayers(customPath = null) {
    const yaml = await loadYamlParser()
    if (!yaml) {
        return []
    }
    const layers = []
    const paths = customPath
        ? [path.resolve(customPath)]
        : [DEFAULT_PRESET_PATH, ...USER_SEARCH_PATHS]
    for (const p of paths) {
        if (!fs.pathExistsSync(p)) {
            continue
        }
        const layer = await loadPresetsFromYaml(p)
        if (layer) {
            layers.push(layer)
        }
    }
    return layers
}

/**
 * 合并一层 YAML 预设到已有预设表。
 *
 * P0-1 修复的合并规则（§2.1）：
 *   - 新增预设：直接加入；
 *   - 同名预设：必须带 `_override: true` 才允许覆盖，否则 warn 并跳过
 *     （避免用户层的旧式/同名预设静默架空内置 S-4 预设）。
 *
 * @param {Map<string, Object>} builtinPresets 已合并的低优先级预设表
 * @param {{path: string, presets: Object}} yamlPresets 当前层加载结果
 * @returns {Map<string, Object>} 合并后的新预设表（不改动入参）
 */
export function mergePresets(builtinPresets, yamlPresets) {
    if (!yamlPresets || !yamlPresets.presets) {
        return builtinPresets
    }

    const merged = new Map(builtinPresets)
    let overrideCount = 0
    let skippedCount = 0
    let newCount = 0

    for (const [name, preset] of Object.entries(yamlPresets.presets)) {
        if (name.startsWith("_")) {
            continue
        }
        if (merged.has(name)) {
            if (preset._override === true) {
                overrideCount++
                merged.set(name, preset)
            } else {
                skippedCount++
                log.logWarn(
                    LOG_TAG,
                    `Preset '${name}' already exists and has no '_override: true', skipped (from ${yamlPresets.path})`,
                )
            }
        } else {
            newCount++
            merged.set(name, preset)
        }
    }

    if (overrideCount > 0) {
        log.logInfo(LOG_TAG, `Overridden ${overrideCount} preset(s)`)
    }
    if (skippedCount > 0) {
        log.logInfo(LOG_TAG, `Skipped ${skippedCount} same-name preset(s) without _override: true`)
    }
    if (newCount > 0) {
        log.logInfo(LOG_TAG, `Added ${newCount} new preset(s)`)
    }

    return merged
}

export function getPresetSearchPaths() {
    return [DEFAULT_PRESET_PATH, ...USER_SEARCH_PATHS]
}

export { resolvePresetPath, processPresets }

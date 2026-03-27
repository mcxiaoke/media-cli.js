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
 * - User config override (~/.mediac/presets.yaml)
 */

import fs from "fs-extra"
import os from "os"
import path from "path"
import * as log from "./debug.js"

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

const PRESET_SEARCH_PATHS = [
    path.join(os.homedir(), ".mediac", "presets.yaml"),
    path.join(os.homedir(), ".mediac", "presets.yml"),
    path.join(process.cwd(), "presets.yaml"),
    path.join(process.cwd(), "presets.yml"),
]

function resolvePresetPath(customPath) {
    if (customPath) {
        const resolved = path.resolve(customPath)
        if (fs.pathExistsSync(resolved)) {
            return resolved
        }
    }
    for (const p of PRESET_SEARCH_PATHS) {
        if (fs.pathExistsSync(p)) {
            return p
        }
    }
    return null
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

function processPresets(rawPresets) {
    const processed = {}
    const presetNames = Object.keys(rawPresets)

    for (const name of presetNames) {
        try {
            const resolved = resolveExtends(rawPresets, name)
            processed[name] = resolved
        } catch (e) {
            log.logWarn(LOG_TAG, `Failed to resolve preset '${name}': ${e.message}`)
        }
    }

    return processed
}

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

export function mergePresets(builtinPresets, yamlPresets) {
    if (!yamlPresets || !yamlPresets.presets) {
        return builtinPresets
    }

    const merged = new Map(builtinPresets)
    let overrideCount = 0
    let newCount = 0

    for (const [name, preset] of Object.entries(yamlPresets.presets)) {
        if (name.startsWith("_")) {
            continue
        }
        if (merged.has(name)) {
            overrideCount++
        } else {
            newCount++
        }
        merged.set(name, preset)
    }

    if (overrideCount > 0) {
        log.logInfo(LOG_TAG, `Overridden ${overrideCount} built-in presets`)
    }
    if (newCount > 0) {
        log.logInfo(LOG_TAG, `Added ${newCount} new presets`)
    }

    return merged
}

export function getPresetSearchPaths() {
    return [...PRESET_SEARCH_PATHS]
}

export { resolvePresetPath, processPresets }

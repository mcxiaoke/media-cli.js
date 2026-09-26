const OUTPUT_MODES = new Set(["tree", "dir", "file"])
const EXECUTION_MODES = new Set(["plan", "execute"])
const DECODE_MODES = new Set(["auto", "gpu", "cpu"])

const OPTION_KEYS = [
    "ffargs",
    "filelist",
    "extensions",
    "include",
    "exclude",
    "regex",
    "start",
    "count",
    "prefix",
    "suffix",
    "dimension",
    "framerate",
    "fps",
    "speed",
    "videoBitrate",
    "videoQuality",
    "videoCopy",
    "videoCodec",
    "audioBitrate",
    "audioQuality",
    "audioCopy",
    "audioCodec",
    "metadata",
    // 注：filters / filterComplex / videoArgs / audioArgs 已随 S-4 重构从选项面移除
    //（滤镜与额外编码参数只经预设 YAML 的 filters/pre_filters/post_filters 表达），
    // 保留在此只会让宿主传入后被静默忽略，故一并删除。
    "errorFile",
    "hwaccel",
    "decodeMode",
    "strict",
    "jobs",
    "override",
    "deleteSourceFiles",
    "deleteSourceConfirmed",
    "autoConfirm",
    "debug",
    "anime",
]

function invalidArgument(message) {
    const error = new Error(message)
    error.code = "INVALID_ARGUMENT"
    return error
}

function asObject(value, label) {
    if (value === undefined || value === null) return {}
    if (typeof value !== "object" || Array.isArray(value)) {
        throw invalidArgument(`${label} must be an object`)
    }
    return value
}

function normalizeInputs(inputs, directories = []) {
    const result = []
    const source = []
    if (inputs !== undefined) {
        if (Array.isArray(inputs)) source.push(...inputs)
        else if (typeof inputs === "string") source.push(inputs)
        else throw invalidArgument("inputs must be a string or string array")
    }
    if (Array.isArray(directories)) source.push(...directories)
    for (const input of source) {
        if (typeof input !== "string" || input.trim() === "") {
            throw invalidArgument("input paths must be non-empty strings")
        }
        const value = input.trim()
        if (!result.includes(value)) result.push(value)
    }
    return result
}

function pickOptions(raw) {
    const result = {}
    for (const key of OPTION_KEYS) {
        if (raw[key] !== undefined) result[key] = raw[key]
    }
    return result
}

function validateAndNormalize(raw, { mode, inputs, output, preset }) {
    const source = asObject(raw, "options")
    const outputMode = source.outputMode || "dir"
    if (!OUTPUT_MODES.has(outputMode)) {
        throw invalidArgument(`outputMode must be one of: ${[...OUTPUT_MODES].join(", ")}`)
    }

    const executionMode = mode || (source.doit ? "execute" : "plan")
    if (!EXECUTION_MODES.has(executionMode)) {
        throw invalidArgument("mode must be plan or execute")
    }

    const decodeMode = source.decodeMode || "auto"
    if (!DECODE_MODES.has(decodeMode)) {
        throw invalidArgument("decodeMode must be one of: auto, gpu, cpu")
    }

    const jobs = source.jobs
    if (jobs !== undefined && (!Number.isFinite(Number(jobs)) || Number(jobs) <= 0)) {
        throw invalidArgument("jobs must be greater than 0")
    }

    const speed = source.speed
    if (
        speed !== undefined &&
        Number(speed) !== 0 &&
        (Number(speed) < 0.5 || Number(speed) > 2.0)
    ) {
        throw invalidArgument("speed must be 0 or between 0.5 and 2.0")
    }

    const dimension = source.dimension
    if (dimension !== undefined && Number(dimension) < 0) {
        throw invalidArgument("dimension must be greater than or equal to 0")
    }

    const start = source.start
    const count = source.count
    if (start !== undefined && (!Number.isInteger(Number(start)) || Number(start) < 0)) {
        throw invalidArgument("start must be a non-negative integer")
    }
    if (count !== undefined && (!Number.isInteger(Number(count)) || Number(count) < 0)) {
        throw invalidArgument("count must be a non-negative integer")
    }

    const normalizedPath = output === undefined || output === null ? "" : output
    if (typeof normalizedPath !== "string") {
        throw invalidArgument("output must be a string")
    }
    if (preset !== undefined && preset !== null && typeof preset !== "string") {
        throw invalidArgument("preset must be a string")
    }

    const options = pickOptions(source)
    if (options.framerate === undefined && options.fps !== undefined) {
        options.framerate = options.fps
    }
    delete options.fps
    if (options.audioCodec === "copy") options.audioCopy = true

    return {
        schemaVersion: 1,
        mode: executionMode,
        inputs: normalizeInputs(inputs),
        output: normalizedPath,
        outputMode,
        preset: preset || "",
        decodeMode,
        jobs: jobs === undefined ? undefined : Number(jobs),
        strict: source.strict === true,
        override: source.override === true,
        deleteSourceFiles: source.deleteSourceFiles === true,
        deleteSourceConfirmed: source.deleteSourceConfirmed === true,
        autoConfirm: source.autoConfirm === true,
        ...options,
    }
}

/**
 * Normalize CLI/yargs input into the shared FFmpeg option shape.
 * ffargs parsing/application remains an adapter concern and is injected by the caller.
 */
export function normalizeCliOptions(argv = {}, deps = {}) {
    const source = { ...argv }
    if (source.ffargs && deps.parseFfargs && deps.applyFfargs) {
        Object.assign(source, deps.applyFfargs(source, deps.parseFfargs(source.ffargs)))
    }
    return validateAndNormalize(source, {
        mode: source.doit ? "execute" : "plan",
        inputs: normalizeInputs(source.input, source.directories),
        output: source.output,
        preset: source.preset,
    })
}

/**
 * Normalize desktop (Electron) input into the shared FFmpeg option shape.
 */
export function normalizeDesktopOptions(body = {}) {
    const source = asObject(body, "body")
    const options = asObject(source.options, "options")
    return validateAndNormalize(
        { ...options, ...pickTopLevelDesktopOptions(source) },
        {
            mode: source.mode || "plan",
            inputs: source.inputs || source.input,
            output: source.output,
            preset: source.preset,
        },
    )
}

function pickTopLevelDesktopOptions(source) {
    const result = {}
    for (const key of [...OPTION_KEYS, "outputMode", "jobs", "strict", "override", "decodeMode"]) {
        if (source[key] !== undefined) result[key] = source[key]
    }
    return result
}

/**
 * Remove envelope fields before passing normalized options to legacy argv consumers.
 */
export function toLegacyArgvOptions(options = {}) {
    const {
        schemaVersion: _schemaVersion,
        mode: _mode,
        inputs: _inputs,
        output: _output,
        preset: _preset,
        ...legacy
    } = options
    return legacy
}

/*
 * Project: mediac
 * Created: 2026-02-14 15:20:48
 * Modified: 2026-02-14 15:20:48
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * jpg-metadata-fixer.mjs
 * 优化版：标签分类+字母序排序 + 简化调试日志
 * 适配：iPhone + 小米手机拍摄的 JPG 元数据
 */

// 调试开关：生产环境设为 false，调试时设为 true
const DEBUG_MODE = false

/**
 * 完整的 JPG (JPEG) 兼容元数据标签列表
 * 分类：基础信息 > EXIF扩展 > GPS信息 > 色彩配置 > IPTC > XMP > 衍生别名
 * 每个分类内部按字母序排序
 */
const JPG_LEGAL_TAGS = new Set([
    // ---------------- 1. 基础文件信息 (Exif.Image) - 字母序 ----------------
    "APP14Flags0",
    "APP14Flags1",
    "BitsPerSample",
    "ColorComponents",
    "ColorTransform",
    "Compression",
    "Copyright",
    "DCTEncodeVersion",
    "EncodingProcess",
    "Artist",
    "ImageDescription",
    "ImageHeight",
    "ImageLength",
    "ImageWidth",
    "JPEGInterchangeFormat",
    "JPEGInterchangeFormatLength",
    "Make",
    "Model",
    "Orientation",
    "DateTime",
    "PhotometricInterpretation",
    "PrimaryChromaticities",
    "ResolutionUnit",
    "RowsPerStrip",
    "SamplesPerPixel",
    "Software",
    "StripByteCounts",
    "StripOffsets",
    "TransferFunction",
    "WhitePoint",
    "XResolution",
    "YCbCrPositioning",
    "YCbCrSubSampling",
    "YResolution",

    // ---------------- 2. EXIF 扩展信息 (Exif.Photo) - 字母序 ----------------
    "Aperture",
    "ApertureValue",
    "BrightnessValue",
    "CameraOwnerName",
    "CFAPattern",
    "ComponentsConfiguration",
    "CompressedBitsPerPixel",
    "Contrast",
    "CreateDate",
    "CustomRendered",
    "DateTimeCreated",
    "DateTimeDigitized",
    "DateTimeOriginal",
    "DigitalCreationDate",
    "DigitalCreationDateTime",
    "DigitalCreationTime",
    "DigitalZoomRatio",
    "DeviceSettingDescription",
    "ExifImageHeight",
    "ExifImageWidth",
    "ExifVersion",
    "ExposureBiasValue",
    "ExposureCompensation",
    "ExposureIndex",
    "ExposureMode",
    "ExposureProgram",
    "ExposureTime",
    "FNumber",
    "FileSource",
    "Flash",
    "FlashEnergy",
    "FlashpixVersion",
    "FlashVersion",
    "FocalLength",
    "FocalLength35efl",
    "FocalLengthIn35mmFilm",
    "FocalLengthIn35mmFormat",
    "FocalPlaneResolutionUnit",
    "FocalPlaneXResolution",
    "FocalPlaneYResolution",
    "GainControl",
    "HDREditMode",
    "ImageUniqueID",
    "ISO",
    "LensID",
    "LensMake",
    "LensModel",
    "LensSerialNumber",
    "LensSpecification",
    "LightSource",
    "Make",
    "MaxApertureValue",
    "MeteringMode",
    "ModifyDate",
    "Orientation",
    "OffsetTime",
    "OffsetTimeDigitized",
    "OffsetTimeOriginal",
    "RelatedImageFileFormat",
    "RelatedImageHeight",
    "RelatedImageFileType",
    "RelatedImageWidth",
    "Saturation",
    "SceneCaptureType",
    "SceneType",
    "SensingMethod",
    "Sharpness",
    "ShutterSpeed",
    "ShutterSpeedValue",
    "SpatialFrequencyResponse",
    "SubSecCreateDate",
    "SubSecDateTimeOriginal",
    "SubSecModifyDate",
    "SubSecTime",
    "SubSecTimeDigitized",
    "SubSecTimeOriginal",
    "SubjectArea",
    "SubjectDistance",
    "SubjectDistanceRange",
    "SubjectLocation",
    "TimeCreated",
    "UserComment",
    "WhiteBalance",

    // ---------------- 3. GPS 信息 (Exif.GPS) - 字母序 ----------------
    "GPSAltitude",
    "GPSAltitudeRef",
    "GPSAreaInformation",
    "GPSDateStamp",
    "GPSDateTime",
    "GPSDestBearing",
    "GPSDestBearingRef",
    "GPSDestDistance",
    "GPSDestDistanceRef",
    "GPSDestLatitude",
    "GPSDestLatitudeRef",
    "GPSDestLongitude",
    "GPSDestLongitudeRef",
    "GPSDifferential",
    "GPSDOP",
    "GPSHPositioningError",
    "GPSImgDirection",
    "GPSImgDirectionRef",
    "GPSLatitude",
    "GPSLatitudeRef",
    "GPSLongitude",
    "GPSLongitudeRef",
    "GPSMapDatum",
    "GPSMeasureMode",
    "GPSPosition",
    "GPSSatellites",
    "GPSSpeed",
    "GPSSpeedRef",
    "GPSStatus",
    "GPSTimeStamp",
    "GPSTrack",
    "GPSTrackRef",
    "GPSProcessingMethod",
    "GPSVersionID",

    // ---------------- 4. 色彩配置文件标签 - 字母序 ----------------
    "BlueMatrixColumn",
    "BlueTRC",
    "ChromaticAdaptation",
    "CMMFlags",
    "ColorSpaceData",
    "ConnectionSpaceIlluminant",
    "DeviceAttributes",
    "DeviceManufacturer",
    "DeviceModel",
    "DeviceModelDesc",
    "DeviceMfgDesc",
    "GreenMatrixColumn",
    "GreenTRC",
    "Luminance",
    "MediaBlackPoint",
    "MediaWhitePoint",
    "MeasurementBacking",
    "MeasurementFlare",
    "MeasurementGeometry",
    "MeasurementIlluminant",
    "MeasurementObserver",
    "PrimaryPlatform",
    "ProfileClass",
    "ProfileConnectionSpace",
    "ProfileCMMType",
    "ProfileCopyright",
    "ProfileCreator",
    "ProfileDateTime",
    "ProfileDescription",
    "ProfileFileSignature",
    "ProfileID",
    "ProfileVersion",
    "RedMatrixColumn",
    "RedTRC",
    "RenderingIntent",
    "Technology",
    "ViewingCondDesc",
    "ViewingCondIlluminant",
    "ViewingCondIlluminantType",
    "ViewingCondSurround",

    // ---------------- 5. IPTC 基础标签 - 字母序 ----------------
    "ApplicationRecordVersion",
    "CodedCharacterSet",
    "CurrentIPTCDigest",
    "DisplayedUnitsX",
    "DisplayedUnitsY",
    "IPTCDigest",

    // ---------------- 6. XMP 核心标签 - 字母序 ----------------
    "XMP-dc:Contributor",
    "XMP-dc:Creator",
    "XMP-dc:Date",
    "XMP-dc:Description",
    "XMP-dc:Format",
    "XMP-dc:Identifier",
    "XMP-dc:Language",
    "XMP-dc:Publisher",
    "XMP-dc:Rights",
    "XMP-dc:Subject",
    "XMP-dc:Title",
    "XMP-dc:Type",
    "XMP-exif:DateTimeOriginal",
    "XMP-photoshop:DateCreated",

    // ---------------- 7. 衍生别名标签 - 字母序 ----------------
    "CircleOfConfusion",
    "FOV",
    "HyperfocalDistance",
    "ImageSize",
    "LightValue",
    "Megapixels",
    "ScaleFactor35efl",
])

/**
 * 调试信息存储（仅保留核心对比数据）
 */
const debugInfo = {
    originalKeys: [], // 原始所有 Key
    preservedKeys: [], // 最终保留的 Key
    filteredKeys: [], // 被过滤的 Key
}

/**
 * 深度递归过滤无效字段
 */
function deepFilterInvalidFields(value, parentKey = "") {
    // 过滤二进制字段
    if (value && typeof value === "object" && value._ctor === "BinaryField") {
        const key = parentKey || "unknown"
        if (!debugInfo.filteredKeys.includes(key)) {
            debugInfo.filteredKeys.push(key)
        }
        return undefined
    }

    // 过滤数组
    if (Array.isArray(value)) {
        const filtered = []
        for (let i = 0; i < value.length; i++) {
            const itemKey = `${parentKey}[${i}]`
            const filteredItem = deepFilterInvalidFields(value[i], itemKey)
            if (filteredItem !== undefined) {
                filtered.push(filteredItem)
            }
        }
        return filtered.length > 0 ? filtered : undefined
    }

    // 过滤对象
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const filteredObj = {}
        for (const [k, v] of Object.entries(value)) {
            const fullKey = parentKey ? `${parentKey}.${k}` : k

            // 记录被过滤的 Key
            if (!JPG_LEGAL_TAGS.has(k) || /^(HEIC|RAW|Video|Audio)/i.test(k)) {
                if (!debugInfo.filteredKeys.includes(fullKey)) {
                    debugInfo.filteredKeys.push(fullKey)
                }
                continue
            }

            const filteredVal = deepFilterInvalidFields(v, fullKey)
            if (filteredVal !== undefined) {
                filteredObj[k] = filteredVal
            }
        }
        return Object.keys(filteredObj).length > 0 ? filteredObj : undefined
    }

    return value
}

/**
 * 修复时间字段格式
 */
function fixTimeFields(metadata) {
    const fixed = { ...metadata }
    const timeFields = [
        "DateTimeOriginal",
        "CreateDate",
        "ModifyDate",
        "GPSDateTime",
        "GPSTimeStamp",
        "GPSDateStamp",
        "DateTimeDigitized",
        "SubSecCreateDate",
        "SubSecDateTimeOriginal",
        "SubSecModifyDate",
        "DateTimeCreated",
        "DigitalCreationDateTime",
    ]

    timeFields.forEach((field) => {
        if (fixed[field]) {
            const value = fixed[field]
            // 处理时间对象
            if (typeof value === "object" && !Array.isArray(value) && value.rawValue) {
                fixed[field] = value.rawValue
            }
            // 处理 GPSTimeStamp 字符串
            else if (typeof value === "string" && field === "GPSTimeStamp" && value.includes(":")) {
                const parts = value.split(":")
                const hour = Number(parts[0])
                const minute = Number(parts[1])
                const second = Number(parts[2].split(".")[0])
                fixed[field] = [hour, minute, second]
            }
        }
    })

    return fixed
}

/**
 * 过滤合法标签并记录调试信息
 */
function filterJpgLegalTags(metadata) {
    const legalMetadata = {}

    for (const [tag, value] of Object.entries(metadata)) {
        // 跳过空值
        if (value === undefined || value === null || value === "") {
            if (!debugInfo.filteredKeys.includes(tag)) {
                debugInfo.filteredKeys.push(tag)
            }
            continue
        }

        // 匹配合法标签
        if (JPG_LEGAL_TAGS.has(tag)) {
            legalMetadata[tag] = value
            debugInfo.preservedKeys.push(tag)
            continue
        }

        // 兼容 XMP 标签简写
        const xmpShortTag = tag.replace(/^XMP([A-Za-z]+):/, "XMP-$1:")
        if (JPG_LEGAL_TAGS.has(xmpShortTag)) {
            legalMetadata[xmpShortTag] = value
            debugInfo.preservedKeys.push(`${tag} → ${xmpShortTag}`)
            continue
        }

        // 兼容 ImageLength/ImageHeight 别名
        let aliasHandled = false
        if (tag === "ImageLength" && !legalMetadata.ImageHeight) {
            legalMetadata.ImageHeight = value
            debugInfo.preservedKeys.push(`${tag} → ImageHeight`)
            aliasHandled = true
        }
        if (tag === "ImageHeight" && !legalMetadata.ImageLength) {
            legalMetadata.ImageLength = value
            debugInfo.preservedKeys.push(`${tag} → ImageLength`)
            aliasHandled = true
        }

        // 记录非合法标签
        if (!aliasHandled && !debugInfo.filteredKeys.includes(tag)) {
            debugInfo.filteredKeys.push(tag)
        }
    }

    return legalMetadata
}

/**
 * 简化版调试日志打印（仅展示 Key 对比）
 */
function printSimpleDebugLog() {
    if (!DEBUG_MODE) return

    console.log("\n=====================================")
    console.log("📝 JPG 元数据 Key 过滤对比")
    //console.log("=====================================")

    // 1. 原始 Key 列表（排序）
    console.log(`1. 原始 Key 总数: ${debugInfo.originalKeys.length}`)
    //console.log(`   ${debugInfo.originalKeys.sort().join(", ")}`)

    // 2. 最终保留 Key 列表（排序）
    console.log(`2. 保留 Key 总数: ${debugInfo.preservedKeys.length}`)
    //console.log(`   ${debugInfo.preservedKeys.sort().join(", ")}`)

    // 3. 被过滤 Key 列表（排序）
    console.log(`3. 过滤 Key 总数: ${debugInfo.filteredKeys.length}`)
    console.log(`   ${debugInfo.filteredKeys.sort().join(", ")}`)

    console.log("=====================================\n")
}

/**
 * 重置调试信息
 */
function resetDebugInfo() {
    debugInfo.originalKeys = []
    debugInfo.preservedKeys = []
    debugInfo.filteredKeys = []
}

/**
 * 核心方法：修复元数据
 */
export function fixMetadata(rawMetadata, debug = false) {
    resetDebugInfo()

    if (!rawMetadata || typeof rawMetadata !== "object") {
        console.warn("fixMetadata: 输入的原始元数据不是有效对象")
        return {}
    }

    // 记录原始 Key 列表
    debugInfo.originalKeys = Object.keys(rawMetadata)

    // 步骤1：过滤无效字段
    const withoutInvalid = deepFilterInvalidFields(rawMetadata) || {}

    // 步骤2：修复时间字段
    const fixedTime = fixTimeFields(withoutInvalid)

    // 步骤3：过滤合法标签
    const legalMetadata = filterJpgLegalTags(fixedTime)

    // 打印简化日志
    if (DEBUG_MODE || debug) {
        printSimpleDebugLog()
    }

    return legalMetadata
}

/**
 * 获取调试信息（用于自定义处理）
 */
export function getDebugInfo() {
    return { ...debugInfo }
}

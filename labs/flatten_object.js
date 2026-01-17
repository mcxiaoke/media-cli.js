/*
 * Project: mediac
 * Created: 2024-04-20 20:54:43
 * Modified: 2024-04-20 20:54:43
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

function flattenObject(obj, parentKey = "") {
    return Object.keys(obj).reduce((acc, key) => {
        const newKey = parentKey ? `${parentKey}.${key}` : key
        if (typeof obj[key] === "object" && !Array.isArray(obj[key]) && obj[key] !== null) {
            Object.assign(acc, flattenObject(obj[key], newKey))
        } else {
            acc[newKey] = obj[key]
        }
        return acc
    }, {})
}

const input = {
    programs: [],
    streams: [
        {
            codec_name: "h264",
            codec_long_name: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
            profile: "High",
            codec_type: "video",
            codec_tag_string: "avc1",
            width: 1280,
            height: 720,
            display_aspect_ratio: "16:9",
            pix_fmt: "yuv420p",
            r_frame_rate: "30/1",
            time_base: "1/30",
            duration: "45.966667",
            bit_rate: "818714",
        },
    ],
    format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        format_long_name: "QuickTime / MOV",
        duration: "46.045170",
        size: "5469178",
        bit_rate: "950228",
    },
}

const flattenedObject = flattenObject(input)
console.log(flattenedObject)

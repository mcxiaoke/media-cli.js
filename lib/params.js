/*
 * Project: mediac
 * Created: 2024-04-27 14:25:22
 * Modified: 2024-04-27 14:25:22
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// 参数字符串示例
// "a=[1.5,2,3,abd,hello];b=[fdsf,rer,wr,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ac=aac;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;ddf;dfdfdfaa=;test mode='3434324':yes=false"
// 参数解析规则
// 键值对之间用分号或冒号或井号中的一种分割 ; : #
// 中括号包裹为数组，数组元素用逗号或叹号或斜杠或竖杠分割 , ! / |
// 键值对的值，如果为数字就解析为数字类型，如果为true/false就解析为布尔值
// 键值对的值，如果单引号双引号包裹，就去掉引号，解析为字符串
//

// function parseString(inputString) {
//     const parsedObject = {}

//     const keyValuePairs = inputString.split(/[;#:]/)

//     for (let pair of keyValuePairs) {
//         const [key, value] = pair.split('=')

//         if (!key) {
//             console.log(`Invalid key-value pair: ${pair}`)
//             continue
//         }

//         // Parse value
//         let parsedValue = null
//         if (value !== undefined) {
//             let cleanValue = value.trim()
//             // Remove surrounding quotes if present
//             if (cleanValue.startsWith('"') || cleanValue.startsWith("'")) {
//                 cleanValue = cleanValue.slice(1, -1)
//             }
//             if (cleanValue.includes('[') && cleanValue.includes(']')) {
//                 const arrayValues = cleanValue.substring(cleanValue.indexOf('[') + 1, cleanValue.lastIndexOf(']')).split(/[,|\/!]/)
//                 parsedValue = arrayValues.map(val => parseValue(val.trim()))
//             } else {
//                 parsedValue = parseValue(cleanValue)
//             }
//         }

//         parsedObject[key] = parsedValue
//     }

//     return parsedObject
// }

// function parseValue(value) {
//     // Check if value is a floating point number
//     if (!isNaN(parseFloat(value)) && isFinite(value)) {
//         return parseFloat(value)
//     }
//     // Check if value is 'true' or 'false'
//     else if (value.toLowerCase() === 'true') {
//         return true
//     } else if (value.toLowerCase() === 'false') {
//         return false
//     }
//     // Otherwise, return the original value
//     else {
//         return value
//     }
// }

// // sample input
// // "a=[1.5,2,3,abd,hello];b=[fdsf,rer,wr,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ac=aac;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;ddf;dfdfdfaa=;test mode='3434324':yes=false;width=>1200;height=<600;nothing"

// console.log(parseString(process.argv[2]))


function parseString(inputString) {
    const parsedObject = {}

    const keyValuePairs = inputString.split(/;|:|#/)

    for (let pair of keyValuePairs) {
        const [key, value] = pair.split('=')

        if (!key) {
            console.log(`Invalid key-value pair: ${pair}`)
            continue
        }

        // Parse value
        let parsedValue = null
        if (value !== undefined) {
            let cleanValue = value.trim()
            // Check if value is wrapped in quotes
            const isQuoted = cleanValue.startsWith('"') && cleanValue.endsWith('"') ||
                cleanValue.startsWith("'") && cleanValue.endsWith("'")
            if (isQuoted) {
                parsedValue = cleanValue.slice(1, -1)
            } else if (cleanValue.includes('[') && cleanValue.includes(']')) {
                const arrayValues = cleanValue.substring(cleanValue.indexOf('[') + 1, cleanValue.lastIndexOf(']')).split(/,|!|\/|\|/)
                parsedValue = arrayValues.map(val => parseValue(val.trim()))
            } else {
                // Check if value is a number, boolean, or comparison expression
                parsedValue = parseValue(cleanValue)
            }
        }

        parsedObject[key.trim()] = parsedValue
    }

    return parsedObject
}

const RE_NUMBER_OP = /^[><]-?\d+(\.\d+)?$/

function parseValue(value) {
    // Check if value is a floating point number
    if (!isNaN(parseFloat(value)) && !isNaN(value) && !value.includes('"') && !value.includes("'")) {
        return parseFloat(value)
    }
    // Check if value is 'true' or 'false'
    else if (value.toLowerCase() === 'true') {
        return true
    } else if (value.toLowerCase() === 'false') {
        return false
    }
    // Check if value is a comparison expression
    else if (RE_NUMBER_OP.test(value)) {
        console.log(value)
        return { operator: value[0], number: parseFloat(value.substr(1)) }
    }
    else {
        return value
    }
}

// sample input
const sampleInput1 = "a=[1.5,2,3,abd,hello];b=[fdsf,rer,wr,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ac=aac;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;ddf;dfdfdfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;nt=>none;nothing;notw>w2;noth"

console.log(parseString(sampleInput1))

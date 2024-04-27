/*
 * Project: mediac
 * Created: 2024-04-27 14:25:22
 * Modified: 2024-04-27 14:25:22
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// 参数字符串示例
// "a=[1.5,2,hello];b=[red,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;dddfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;someobj={oa=vaaa,oc=32132.23,od=>23}"
// 参数解析规则
// 键值对之间用分号或冒号或井号中的一种分割 ; : #
// 中括号包裹为数组，数组元素用逗号或叹号或斜杠或竖杠分割 , ! / |
// 键值对的值，如果为数字就解析为数字类型，如果为true/false就解析为布尔值
// 键值对的值，如果单引号双引号包裹，就去掉引号，解析为字符串
// 键值对的值，如果大于号小于号开头，解析为 {op:">",num:1234} 这种

function parseString(inputString) {
    const parsedObject = {}

    const keyValuePairs = inputString.split(/;|:|#/)

    for (let pair of keyValuePairs) {
        // const [key, value] = pair.split('=', 2)
        // Parse value
        let parsedValue = null
        const indexOfEqual = pair.indexOf('=')
        if (indexOfEqual === -1) {
            // 没有等号认为是非法的键值对，报错
            throw new Error(`Invalid key-value pair: ${pair}`)
        }
        const key = pair.substring(0, indexOfEqual)
        const value = pair.substring(indexOfEqual + 1)
        if (!key) {
            // console.log(`Invalid key-value pair: ${pair}`)
            // continue
            throw new Error(`Invalid key-value pair: ${pair}`)
        }
        if (value) {
            let cleanValue = value.trim()
            // Check if value is wrapped in quotes
            const isQuoted = cleanValue.startsWith('"') && cleanValue.endsWith('"') ||
                cleanValue.startsWith("'") && cleanValue.endsWith("'")
            if (isQuoted) {
                parsedValue = cleanValue.slice(1, -1)
            } else if (cleanValue.includes('[') && cleanValue.includes(']')) {
                const arrayValues = cleanValue.slice(1, -1).split(/,|!|\/|\|/)
                parsedValue = arrayValues.map(val => parseValue(val.trim()))
            } else if (cleanValue.startsWith('{') && cleanValue.endsWith('}')) {
                // Parse as object
                const objectStr = cleanValue.slice(1, -1)
                parsedValue = parseObject(objectStr)
            }
            else {
                // Check if value is a number, boolean, or comparison expression
                parsedValue = parseValue(cleanValue)
            }
        }

        parsedObject[key.trim()] = parsedValue
    }

    return parsedObject
}

const RE_NUMBER = /^-?\d+(\.\d+)?$/
const RE_NUMBER_OP = /^[><]-?\d+(\.\d+)?$/

function parseValue(value) {
    console.log('parseValue', value)
    if (!value) { return value }
    // Check if value is a floating point number
    if (RE_NUMBER.test(value)) {
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
        return { op: value[0], num: parseFloat(value.substr(1)) }
    }
    else {
        return value
    }
}

function parseObject(objectStr) {
    const obj = {}
    // Split the object string by comma and then iterate over each key-value pair
    const keyValuePairs = objectStr.split(',')
    for (let pair of keyValuePairs) {
        // Split each pair by '=' to get key and value
        const [key, value] = pair.split('=')
        // Trim whitespace from key and value, and then parse the value
        obj[key.trim()] = parseValue(value?.trim())
    }
    return obj
}

// sample input
const sampleInput1 = "a=[1.5,2,hello];b=[red,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;dddfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;someobj={oa=vaaa,oc=32132.23,od=>23}"

console.log(parseString(sampleInput1))

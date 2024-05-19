/*
 * File: core.js
 * Created: 2024-03-23 13:04:52 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

export async function parallel(arr, fn, threads = 4) {
    const result = []
    while (arr.length) {
        const res = await Promise.all(arr.splice(0, threads).map(x => fn(x)))
        result.push(res)
    }
    return result.flat()
}

export const asyncFilterAll = async (arr, predicate) => Promise.all(arr.map(predicate))
    .then((results) => arr.filter((_v, index) => results[index]))

// concurrently
export const asyncFilter = async (arr, predicate) =>
    arr.reduce(async (memo, e) =>
        await predicate(e) ? [...await memo, e] : memo
        , [])


// sequentially
export const asyncFilterSeq = async (arr, predicate) =>
    arr.reduce(async (memo, e) =>
        [...await memo, ...await predicate(e) ? [e] : []]
        , [])

// map async all
export const asyncMapAll = async (arr, func) => await Promise.all(arr.map(func))

// map async serially
export const asyncMap = async (array, func) => {
    return array.reduce(async (accumulatorPromise, item) => {
        const accumulator = await accumulatorPromise
        const result = await func(item)
        accumulator.push(result)
        return accumulator
    }, Promise.resolve([]))
}

// map async in groups
export const asyncMapGroup = async (arr, func, batchSize) => {
    const result = []

    for (let i = 0; i < arr.length; i += batchSize) {
        const batch = arr.slice(i, i + batchSize)
        const gr = await asyncMap(batch, func)
        result.push(...gr)
    }
    return result
}

export async function asyncMapParallel(arr, asyncFunc, concurrency) {
    const results = []
    const promises = []

    // 定义一个辅助函数，用于执行异步操作并将结果添加到结果数组中
    async function executeAsyncFunc(item) {
        const result = await asyncFunc(item)
        results.push(result)
    }

    // 循环遍历数组，将并发执行的异步操作添加到 promises 数组中
    for (let i = 0; i < arr.length; i++) {
        const currentItem = arr[i]
        const promise = executeAsyncFunc(currentItem)
        promises.push(promise)

        // 当 promises 数组中的 Promise 达到并发数时，使用 Promise.all 等待它们全部完成
        if (promises.length === concurrency || i === arr.length - 1) {
            await Promise.all(promises)
            promises.length = 0 // 清空 promises 数组，以便下一轮并发执行
        }
    }

    return results
}

// sync
export const some = (arr, predicate) => arr.filter(predicate).length > 0
export const every = (arr, predicate) => arr.filter(predicate).length === arr.length

// async
export const asyncSome =
    async (arr, predicate) => (await asyncFilter(arr, predicate)).length > 0
export const asyncEvery =
    async (arr, predicate) => (await asyncFilter(arr, predicate)).length === arr.length



// String.prototype.localeCompare基本可以完美实现按照拼音排序
export function compareLocalBy(k) {
    return (a, b) => a[k].localeCompare(b[k], ['ja', 'zh'])
}

export function compareIntl(a, b) {
    return new Intl.Collator('zh-Hans-CN', { sensitivity: 'accent' }).compare(a, b)
}

// https://juejin.cn/post/7314196310648193087
export function compareIntlBy(k) {
    return (a, b) => compareIntl(a[k], b[k])
}

const reASCII = /p{ASCII}/
const reHanaKana = /p{HIRAGANA}|p{KATAKANA}/
export const compareSmart = (a, b) => {
    return a.localeCompare(b, ['ja', 'zh'])
}


export function compareSmartBy(k) {
    return (a, b) => compareSmart(a[k], b[k])
}

// 路径排序，路径深度=>路径长度=>自然语言
export const comparePathSmart = (a, b) => {
    const ap = a.split(/[\\\/]/)?.length ?? 1
    const bp = b.split(/[\\\/]/)?.length ?? 1
    if (ap !== bp) {
        return bp - ap
    }
    if (a.length !== b.length) {
        return b.length - a.length
    }
    const regexp = /\p{ASCII}/
    if (regexp.test(a) && regexp.test(b)) {
        // ASCII 字符直接比较
        return a.toLowerCase() < b.toLowerCase() ? -1 : 1
    } else {
        // 中文的用 localeCompare
        return a.localeCompare(b, ['ja', 'zh'])
    }
}


export function comparePathSmartBy(k) {
    return (a, b) => comparePathSmart(a[k], b[k])
}

export function isUNCPath(strPath) {
    const re = /^[\\\/]{2,}[^\\\/]+[\\\/]+[^\\\/]+/
    return re.test(strPath)
}

function findUniqueElement(arr) {
    // 使用 Set 将数组中的元素去重
    const set = new Set(arr)

    // 如果去重后的集合大小为 1，则返回该唯一元素，否则返回 undefined
    return set.size === 1 ? set.values().next().value : undefined
}

// 计算数组中每个元素出现的次数并排序
// const arr = [1, 2, 3, 4, 1, 2, 2, 3, 3, 3]
// const result = countOccurrences(arr)
// console.log(result) // 输出：[[3, 4], [2, 3], [1, 2], [4, 1]]
export function countOccurrences(arr) {
    const counts = {}
    // 统计每个元素出现的次数
    arr.forEach(item => {
        counts[item] = (counts[item] || 0) + 1
    })

    // 将统计结果转化为数组形式，并按出现次数多少排序
    const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1])

    // 构造新数组，元素为 (item, count)
    const result = sortedCounts.map(([item, count]) => [item, count])

    return result
}

export function countAndSort(arr, ignoreList = []) {
    // 使用 Map 对数组中各元素的个数进行统计
    const counts = new Map()
    arr.forEach(item => {
        // 如果当前元素在忽略列表中，则跳过
        if (!ignoreList.includes(item)) {
            counts.set(item, (counts.get(item) || 0) + 1)
        }
    })

    // 数组元素全部相同，同时也在忽略列表里的特殊情况
    // if (counts.size === 0) {
    //     return [arr[0], [[arr[0], arr.length]]]
    // }

    // 将 Map 转换为数组，并按照元素出现的次数进行排序
    const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])

    // 获取出现最多的元素
    const mostCommon = sortedCounts?.[0]?.[0]

    return [mostCommon, sortedCounts]
}

export function groupByCount(array, count) {
    return array.reduce((result, item, index) => {
        if (index % count === 0) {
            result.push(array.slice(index, index + count))
        }
        return result
    }, [])
}

// 占位符替换，简单的模板字符串功能
// 能识别 %name% {name} @name@ !name! 这几种 
// replacePlaceholders
export const formatArgs = (str, replacements) => {
    // 检查 str 是否是字符串
    if (typeof str !== 'string') {
        // throw new TypeError('Expected parameter "str" to be a string.')
        return str
    }
    // 检查 replacements 是否是对象
    if (typeof replacements !== 'object' || replacements === null) {
        throw new TypeError('Expected parameter "replacements" to be an object.')
    }
    // 支持多种分隔符号
    return str.replace(/%([^%]+)%|{([^{}]+)}/g, (match, p1, p2, p3, p4) => {
        const placeholder = p1 || p2 || p3 || p4
        return replacements.hasOwnProperty(placeholder) ? replacements[placeholder] : match
    })
}

export const formatObjectArgs = (obj, replacements) => {
    return Object.keys(obj).reduce((acc, key) => {
        acc[key] = formatArgs(obj[key], replacements)
        return acc
    }, {})
}

export function isExtendableObject(obj) {
    return typeof obj === 'object' && Boolean(obj) && !Array.isArray(obj)
}

// 将Map的key作为value对象的一个字段插入，返回一个新Map
// SRC {item1: {name: 'john smith'}, item2: {name: 'hello world'}}
// DST {item1: {key:'item1', name: 'john smith'}, item2: {key, 'item2', name: 'hello world'}}
export function createMapWithKeyField(map, fieldName = 'key') {
    const transformedMap = new Map()
    for (const [key, value] of map.entries()) {
        if (isExtendableObject(value)) {
            transformedMap.set(key, { ...value, [fieldName]: key })
        } else {
            transformedMap.set(key, value)
        }
    }
    return transformedMap
}

// 将Map的key作为value对象的一个字段插入，直接修改
export function modifyMapWithKeyField(map, fieldName = 'key') {
    for (const [key, value] of map.entries()) {
        if (isExtendableObject(value)) {
            map.set(key, { ...value, [fieldName]: key })
        }
    }
}

// 将Object的key作为value对象的一个字段插入，返回新对象
export function createObjectWithKeyField(obj, fieldName = 'key') {
    const transformedObj = {}
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key]
            if (isExtendableObject(value)) {
                transformedObj[key] = { ...value, [fieldName]: key }
            } else {
                transformedObj[key] = value
            }
        }
    }
    return transformedObj
}

// 将Object的key作为value对象的一个字段插入，直接修改
export function modifyObjectWithKeyField(obj, fieldName = 'key') {
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key]
            if (isExtendableObject(value)) {
                obj[key] = { ...value, [fieldName]: key }
            }
        }
    }
}

// 简单的深度复制对象方法，不能复制函数和一些特殊对象
export const deepClone = (obj) => JSON.parse(JSON.stringify(obj))

export function randomString(length = 16) {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'
    let randomString = ''
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length)
        randomString += characters[randomIndex]
    }
    return randomString
}

// 过滤掉对象的某些字段，返回一个新的对象
export function filterFields(obj, filterFunc) {
    const filteredObj = {}

    // 遍历对象的所有属性
    for (const [key, value] of Object.entries(obj)) {
        // 如果提供了过滤函数，并且该键值对不符合过滤函数的条件，则跳过该键值对
        if (filterFunc && !filterFunc(key, value)) {
            continue
        }
        // 将符合条件的键值对添加到新对象中
        filteredObj[key] = value
    }
    return filteredObj
}

// 复制源对象的字段到目标对象，忽略指定的字段
export function copyFields(source, target, ignoreKeys = []) {
    // 遍历源对象的属性
    for (const key in source) {
        // 确保属性存在且不在忽略列表中，并且不是数组或对象
        if (
            source.hasOwnProperty(key) &&
            !ignoreKeys.includes(key) &&
            !Array.isArray(source[key]) &&
            typeof source[key] !== 'object' &&
            source[key] !== null &&
            source[key] !== undefined
        ) {
            // 复制基本类型字段到目标对象
            target[key] = source[key]
        }
    }
}

// 直接修改原对象， 删除某些键值
export function removeFieldsIn(obj, removeKeys = []) {
    for (const key in obj) {
        if (obj.hasOwnProperty(key)
            && removeKeys.includes(key)) {
            delete obj[key]
        }
    }
}

// 直接修改原对象，删除符合条件的键值
export function removeFieldsBy(obj, filterFunc) {
    for (const [key, value] of Object.entries(obj)) {
        // 如果提供了过滤函数，并且该键值对不符合过滤函数的条件，则跳过该键值对
        if (filterFunc && filterFunc(key, value)) {
            delete obj[key]
        }
    }
}

// 去掉一个object所有值不是基本类型的字段
// 保留值类型为字符串、数字、布尔值的字段
export function pickSimpleValues(obj) {
    return filterFields(obj, (key, value) => {
        return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && (value !== null && value !== undefined && value !== 0)
    })
}

// 保留值不为空的字段
export function pickTrueValues(obj) {
    return filterFields(obj, (key, value) => {
        return value !== null && value !== undefined && value !== 0
    })
}

export function updateObject(target, source) {
    for (const key in source) {
        if (target.hasOwnProperty(key)) {
            target[key] = source[key]
        }
    }
    return target
}

export function uniqueByFields(array, ...fields) {
    const uniqueArray = []
    const seen = {}

    array.forEach(item => {
        // 将指定字段的值组合成一个唯一的键值
        const key = fields.map(field => item[field]).join('|')
        if (!seen[key]) {
            seen[key] = true
            uniqueArray.push(item)
        }
    })

    return uniqueArray
}

// using reduce
function uniqueByFields2(array, ...fields) {
    return array.reduce((uniqueArray, currentItem) => {
        const key = fields.map(field => currentItem[field]).join('|')
        const exists = uniqueArray.some(item => {
            const comparisonKey = fields.map(field => item[field]).join('|')
            return comparisonKey === key
        })
        if (!exists) {
            uniqueArray.push(currentItem)
        }
        return uniqueArray
    }, [])
}

// number 保留几位小数
// roundToDecimalPlaces
export function roundNum(num, decimalPlaces = 2) {
    if (typeof num === 'string') {
        num = parseFloat(num)
    }
    const factor = Math.pow(10, decimalPlaces)
    return Math.round(num * factor) / factor
}

// 平滑系数变化
export function smoothChange(current, target = 1, factor = 0.3) {
    if (current === target) return current

    let diff = target - current
    // sqrt 开平方 cbrt 开立方
    let adjustment = Math.sqrt(Math.abs(diff)) * factor

    if (diff < 0) {
        adjustment = -adjustment
    }
    return current + adjustment
}

// https://www.npmjs.com/package/underscore
export const pick = (obj, ...keys) => Object.fromEntries(
    keys
        .filter(key => key in obj)
        .map(key => [key, obj[key]])
)

export const ipick = (obj, ...keys) => Object.fromEntries(
    keys.map(key => [key, obj[key]])
)

export const omit = (obj, ...keys) => Object.fromEntries(
    Object.entries(obj)
        .filter(([key]) => !keys.includes(key))
)

export function removeQuotes(value) {
    return value.replace(/^"|"$/g, '').replace(/\\"/g, '"')
}

// Functional try-catch wrapper
// Wrap function to avoid try-catch block, return [error, result];
export const tryRun = (fn, ...args) => {
    try {
        return [null, fn(...args)]
    } catch (e) {
        return [e]
    }
}

// Functional try-catch wrapper for promises.
// Wrap function to avoid try-catch block, resolves [error, result];
export const tryRunAsync = async (fn, ...args) => {
    try {
        return [null, await fn(...args)]
    } catch (e) {
        return [e]
    }
}

// 取数组元素，间隔n个元素娶一个
function takeEveryNth(arr, n) {
    // 检查输入是否合法
    if (!Array.isArray(arr)) {
        throw new Error('第一个参数必须是一个数组！')
    }
    if (typeof n !== 'number' || n <= 0) {
        throw new Error('第二个参数必须是一个正整数！')
    }

    const result = []
    for (let i = 0; i < arr.length; i += n) {
        result.push(arr[i])
    }
    return result
}

// 取数组元素，n个随机不重复元素
export function takeRandomElements(arr, n) {
    // 检查输入是否合法
    if (!Array.isArray(arr)) {
        throw new Error('第一个参数必须是一个数组！')
    }
    if (typeof n !== 'number' || n <= 0 || n > arr.length) {
        throw new Error('第二个参数必须是一个正整数且不能大于数组长度！')
    }

    // 洗牌算法
    const shuffled = arr.slice() // 复制数组
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] // 交换元素位置
    }

    // 取前n个元素
    return shuffled.slice(0, n)
}

//使用Fisher-Yates算法的变体，它只洗牌一部分数组而不是整个数组
function getRandomElements(arr, n) {
    // 检查输入是否合法
    if (!Array.isArray(arr)) {
        throw new Error('第一个参数必须是一个数组！')
    }
    if (typeof n !== 'number' || n <= 0 || n > arr.length) {
        throw new Error('第二个参数必须是一个正整数且不能大于数组长度！')
    }

    const result = []
    const indices = new Set()

    // 随机选择不重复的索引
    while (indices.size < n) {
        const index = Math.floor(Math.random() * arr.length)
        if (!indices.has(index)) {
            indices.add(index)
            result.push(arr[index])
        }
    }

    return result
}
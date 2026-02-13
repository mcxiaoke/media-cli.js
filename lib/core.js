/*
 * File: core.js
 * Created: 2024-03-23 13:04:52 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 并行处理数组中的元素，控制并发数量
 * 将数组分块，每块最多threads个元素并发处理
 *
 * @param {Array} arr - 要处理的数组
 * @param {Function} fn - 处理每个元素的异步函数
 * @param {number} threads - 并发线程数，默认为4
 * @returns {Promise<Array>} 所有处理结果的扁平化数组
 *
 * @example
 * const results = await parallel([1, 2, 3, 4, 5], async (x) => x * 2, 2)
 * // 返回 [2, 4, 6, 8, 10]
 */
export async function parallel(arr, fn, threads = 4) {
    const result = []

    // 循环处理数组，每次处理threads个元素
    while (arr.length) {
        // 从数组开头取出最多threads个元素进行并发处理
        const chunk = arr.splice(0, threads)
        const res = await Promise.all(chunk.map((x) => fn(x)))
        result.push(res)
    }

    // 将所有批次的结果扁平化为单个数组
    return result.flat()
}

/**
 * 异步过滤数组 - 并发执行断言函数过滤元素
 * 使用Promise.all并发检查所有元素
 *
 * @param {Array} arr - 要过滤的数组
 * @param {Function} predicate - 断言函数，返回Promise<boolean>
 * @returns {Promise<Array>} 过滤后的数组
 */
export const asyncFilterAll = async (arr, predicate) =>
    Promise.all(arr.map(predicate)).then((results) => arr.filter((_v, index) => results[index]))

/**
 * 异步过滤数组 - 并发执行断言函数过滤元素（使用reduce）
 * 所有断言并发执行，但结果按顺序收集
 *
 * @param {Array} arr - 要过滤的数组
 * @param {Function} predicate - 断言函数，返回Promise<boolean>
 * @returns {Promise<Array>} 过滤后的数组
 */
// concurrently
export const asyncFilter = async (arr, predicate) =>
    arr.reduce(async (memo, e) => ((await predicate(e)) ? [...(await memo), e] : memo), [])

/**
 * 异步过滤数组 - 顺序执行断言函数过滤元素
 * 断言函数按数组顺序依次执行
 *
 * @param {Array} arr - 要过滤的数组
 * @param {Function} predicate - 断言函数，返回Promise<boolean>
 * @returns {Promise<Array>} 过滤后的数组
 */
// sequentially
export const asyncFilterSeq = async (arr, predicate) =>
    arr.reduce(async (memo, e) => [...(await memo), ...((await predicate(e)) ? [e] : [])], [])

/**
 * 异步映射数组 - 并发执行函数处理所有元素
 * 使用Promise.all同时处理所有元素
 *
 * @param {Array} arr - 要映射的数组
 * @param {Function} func - 处理函数，返回Promise
 * @returns {Promise<Array>} 处理结果数组
 */
// map async all
export const asyncMapAll = async (arr, func) => await Promise.all(arr.map(func))

/**
 * 异步映射数组 - 顺序执行函数处理元素
 * 按数组顺序依次处理每个元素
 *
 * @param {Array} array - 要映射的数组
 * @param {Function} func - 处理函数，返回Promise
 * @returns {Promise<Array>} 处理结果数组，保持原顺序
 */
// map async serially
export const asyncMap = async (array, func) => {
    return array.reduce(async (accumulatorPromise, item) => {
        const accumulator = await accumulatorPromise
        const result = await func(item)
        accumulator.push(result)
        return accumulator
    }, Promise.resolve([]))
}

/**
 * 异步分组映射 - 按批次顺序处理数组元素
 * 将数组分批处理，每批内并发执行
 *
 * @param {Array} arr - 要映射的数组
 * @param {Function} func - 处理函数，返回Promise
 * @param {number} batchSize - 每批处理数量
 * @returns {Promise<Array>} 所有批次的处理结果合并后的数组
 */
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

/**
 * 并行映射函数 - 并发执行异步函数处理数组元素
 * 相比parallel函数，这个实现更精细地控制并发，不会修改原数组
 *
 * @param {Array} arr - 要处理的数组
 * @param {Function} asyncFunc - 处理每个元素的异步函数
 * @param {number} concurrency - 并发数量限制
 * @returns {Promise<Array>} 处理结果数组，保持原数组顺序
 *
 * @example
 * const results = await asyncMapParallel([1, 2, 3, 4], async (x) => {
 *   await new Promise(resolve => setTimeout(resolve, 1000))
 *   return x * 2
 * }, 2)
 */
export async function asyncMapParallel(arr, asyncFunc, concurrency) {
    const results = []
    const promises = []

    // 定义辅助函数：执行异步操作并将结果添加到结果数组
    async function executeAsyncFunc(item) {
        const result = await asyncFunc(item)
        results.push(result)
    }

    // 遍历数组，分批进行并发处理
    for (let i = 0; i < arr.length; i++) {
        const currentItem = arr[i]
        const promise = executeAsyncFunc(currentItem)
        promises.push(promise)

        // 当达到并发限制或处理到最后一个元素时，等待当前批次完成
        if (promises.length === concurrency || i === arr.length - 1) {
            await Promise.all(promises)
            promises.length = 0 // 清空promises数组，准备下一轮并发
        }
    }

    return results
}

/**
 * 同步数组过滤 - 检查数组中是否有任意元素满足条件
 *
 * @param {Array} arr - 要检查的数组
 * @param {Function} predicate - 断言函数
 * @returns {boolean} 如果有元素满足条件返回true
 */
// sync
export const some = (arr, predicate) => arr.filter(predicate).length > 0

/**
 * 同步数组过滤 - 检查数组中是否所有元素都满足条件
 *
 * @param {Array} arr - 要检查的数组
 * @param {Function} predicate - 断言函数
 * @returns {boolean} 如果所有元素都满足条件返回true
 */
export const every = (arr, predicate) => arr.filter(predicate).length === arr.length

/**
 * 异步数组过滤 - 检查数组中是否有任意元素满足条件
 * 使用并发方式检查
 *
 * @param {Array} arr - 要检查的数组
 * @param {Function} predicate - 断言函数，返回Promise<boolean>
 * @returns {Promise<boolean>} 如果有元素满足条件返回true
 */
// async
export const asyncSome = async (arr, predicate) => (await asyncFilter(arr, predicate)).length > 0

/**
 * 异步数组过滤 - 检查数组中是否所有元素都满足条件
 * 使用并发方式检查
 *
 * @param {Array} arr - 要检查的数组
 * @param {Function} predicate - 断言函数，返回Promise<boolean>
 * @returns {Promise<boolean>} 如果所有元素都满足条件返回true
 */
export const asyncEvery = async (arr, predicate) =>
    (await asyncFilter(arr, predicate)).length === arr.length

/**
 * 按指定字段进行本地化比较的排序函数
 * 使用localeCompare按照日语或中文的本地化规则排序
 *
 * @param {string} k - 用于比较的对象属性名
 * @returns {Function} 比较函数，用于Array.sort()
 */
export function compareLocalBy(k) {
    return (a, b) => a[k].localeCompare(b[k], ["ja", "zh"])
}

/**
 * 国际化字符串比较函数
 * 使用Intl.Collator进行中文排序
 *
 * @param {string} a - 第一个字符串
 * @param {string} b - 第二个字符串
 * @returns {number} 比较结果：负数表示a在前，正数表示b在前，0表示相等
 */
export function compareIntl(a, b) {
    return new Intl.Collator("zh-Hans-CN", { sensitivity: "accent" }).compare(a, b)
}

/**
 * 按指定字段进行国际化比较的排序函数
 *
 * @param {string} k - 用于比较的对象属性名
 * @returns {Function} 比较函数，用于Array.sort()
 */
export function compareIntlBy(k) {
    return (a, b) => compareIntl(a[k], b[k])
}

/**
 * 智能字符串比较函数
 * 按照日语和中文的本地化规则排序
 *
 * @param {string} a - 第一个字符串
 * @param {string} b - 第二个字符串
 * @returns {number} 比较结果
 */
export const compareSmart = (a, b) => {
    return a.localeCompare(b, ["ja", "zh"])
}

/**
 * 按指定字段进行智能比较的排序函数
 *
 * @param {string} k - 用于比较的对象属性名
 * @returns {Function} 比较函数，用于Array.sort()
 */
export function compareSmartBy(k) {
    return (a, b) => compareSmart(a[k], b[k])
}

/**
 * 智能路径排序函数 - 按照路径深度、路径长度和自然语言顺序排序
 * 排序优先级：路径深度（深路径在前）=> 路径长度（长路径在前）=> 自然语言排序
 *
 * @param {string} a - 第一个路径
 * @param {string} b - 第二个路径
 * @returns {number} 排序结果：负数表示a在前，正数表示b在前，0表示相等
 */
export const comparePathSmart = (a, b) => {
    // 计算路径深度（分隔符数量）
    const ap = a.split(/[\\\/]/)?.length ?? 1 // 使用空值合并运算符提供默认值
    const bp = b.split(/[\\\/]/)?.length ?? 1

    // 首先按路径深度排序，深度大的路径排在前面（降序）
    if (ap !== bp) {
        return bp - ap // 深度大的值更大，所以用bp-ap实现降序
    }

    // 深度相同时，按路径长度排序，长度长的排在前面（降序）
    if (a.length !== b.length) {
        return b.length - a.length
    }

    // 长度也相同时，按字符类型智能排序
    const regexp = /\p{ASCII}/u // 添加u标志支持Unicode属性转义
    if (regexp.test(a) && regexp.test(b)) {
        // 如果两个路径都是ASCII字符，使用简单的字母顺序比较（不区分大小写）
        return a.toLowerCase() < b.toLowerCase() ? -1 : 1
    } else {
        // 如果包含非ASCII字符（如中文、日文），使用localeCompare进行本地化排序
        // ["ja", "zh"] 表示优先支持日文和中文的排序规则
        return a.localeCompare(b, ["ja", "zh"])
    }
}

/**
 * 按指定字段进行智能路径比较的排序函数
 *
 * @param {string} k - 用于比较的对象属性名
 * @returns {Function} 比较函数，用于Array.sort()
 */
export function comparePathSmartBy(k) {
    return (a, b) => comparePathSmart(a[k], b[k])
}

/**
 * 检查路径是否为UNC路径（通用命名约定路径）
 * UNC路径格式: \\server\share\path 或 //server/share/path
 *
 * @param {string} strPath - 要检查的路径字符串
 * @returns {boolean} 如果是UNC路径返回true，否则返回false
 */
export function isUNCPath(strPath) {
    const re = /^[\\\/]{2,}[^\\\/]+[\\\/]+[^\\\/]+/
    return re.test(strPath)
}

/**
 * 查找数组中的唯一元素
 * 如果数组去重后只剩一个元素，则返回该元素
 *
 * @param {Array} arr - 要检查的数组
 * @returns {*} 唯一元素，如果有多个不同元素则返回undefined
 */
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
/**
 * 统计数组中每个元素出现的次数并按出现频率降序排序
 * 返回包含[元素, 出现次数]的二维数组
 *
 * @param {Array} arr - 要统计的数组
 * @returns {Array<Array>} 排序后的统计结果，每个元素为[值, 出现次数]
 *
 * @example
 * countOccurrences([1, 2, 3, 2, 1, 1, 4])
 * // 返回 [[1, 3], [2, 2], [3, 1], [4, 1]]
 */
export function countOccurrences(arr) {
    const counts = {}

    // 遍历数组，统计每个元素出现的次数
    arr.forEach((item) => {
        counts[item] = (counts[item] || 0) + 1 // 如果元素不存在则初始化为0，然后+1
    })

    // 将统计对象转换为数组，并按出现次数降序排序
    const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1])

    // 构造结果数组，每个元素为[原始值, 出现次数]
    const result = sortedCounts.map(([item, count]) => [item, count])

    return result
}

/**
 * 统计数组中元素出现次数并排序，支持忽略特定元素
 * 返回最常见元素和完整的排序统计结果
 *
 * @param {Array} arr - 要统计的数组
 * @param {Array} ignoreList - 要忽略的元素列表
 * @returns {Array} [最常见元素, 排序后的统计数组]
 *
 * @example
 * countAndSort([1, 2, 2, 3, 3, 3, 4], [4])
 * // 返回 [3, [[3, 3], [2, 2], [1, 1]]]
 */
export function countAndSort(arr, ignoreList = []) {
    // 使用 Map 统计数组中各元素的出现次数
    const counts = new Map()
    arr.forEach((item) => {
        // 如果当前元素在忽略列表中，则跳过不统计
        if (!ignoreList.includes(item)) {
            counts.set(item, (counts.get(item) || 0) + 1)
        }
    })

    // 将 Map 转换为数组，并按照元素出现次数降序排序
    const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])

    // 获取出现次数最多的元素（排序后数组的第一个元素的键）
    const mostCommon = sortedCounts?.[0]?.[0]

    return [mostCommon, sortedCounts]
}

/**
 * 将数组按指定数量分组
 * 例如: groupByCount([1,2,3,4,5,6], 2) 返回 [[1,2],[3,4],[5,6]]
 *
 * @param {Array} array - 要分组的数组
 * @param {number} count - 每组的元素数量
 * @returns {Array<Array>} 分组后的二维数组
 */
export function groupByCount(array, count) {
    return array.reduce((result, item, index) => {
        if (index % count === 0) {
            result.push(array.slice(index, index + count))
        }
        return result
    }, [])
}

/**
 * 占位符替换函数（旧版本）- 简单的模板字符串功能
 * 支持识别 %name%、{name}、@name@、!name! 这几种占位符格式
 *
 * @param {string} str - 包含占位符的模板字符串
 * @param {Object} replacements - 占位符替换映射对象
 * @returns {string|any} 替换后的字符串，如果输入不是字符串则返回原值
 * @throws {TypeError} 当replacements参数不是对象时抛出
 *
 * @example
 * formatArgsOld("Hello %name%!", {name: "World"}) // 返回 "Hello World!"
 * formatArgsOld("File {filename}.txt", {filename: "test"}) // 返回 "File test.txt"
 */
export const formatArgsOld = (str, replacements) => {
    // 检查 str 是否是字符串
    if (typeof str !== "string") {
        // throw new TypeError('Expected parameter "str" to be a string.')
        return str
    }
    // 检查 replacements 是否是对象
    if (typeof replacements !== "object" || replacements === null) {
        throw new TypeError('Expected parameter "replacements" to be an object.')
    }
    // 支持多种分隔符号的正则表达式：%占位符%、{占位符}、@占位符@、!占位符!
    return str.replace(/%([^%]+)%|{([^{}]+)}/g, (match, p1, p2, p3, p4) => {
        const placeholder = p1 || p2 || p3 || p4 // 提取占位符名称
        return replacements.hasOwnProperty(placeholder) ? replacements[placeholder] : match // 如果找到替换值则替换，否则保持原样
    })
}

/**
 * 占位符替换函数 - 支持多种格式的模板字符串替换
 * 支持的占位符格式：%name%、{name}、@name@、!name!
 * 模板参数支持字母、数字、下划线和连字符
 *
 * @param {string} str - 包含占位符的模板字符串
 * @param {Object} replacements - 占位符替换映射对象
 * @returns {string|any} 替换后的字符串，如果输入不是字符串则返回原值
 * @throws {TypeError} 当replacements参数不是对象时抛出
 *
 * @example
 * formatArgs("File %name%.txt", {name: "test"}) // 返回 "File test.txt"
 * formatArgs("Path: {dir}/@file@", {dir: "home", file: "doc"}) // 返回 "Path: home/doc"
 */
export const formatArgs = (str, replacements) => {
    if (typeof str !== "string") return str

    if (typeof replacements !== "object" || replacements === null) {
        throw new TypeError('Expected parameter "replacements" to be an object.')
    }

    // 正则表达式匹配四种占位符格式：%key%、{key}、@key@、!key!
    // [\w-]+ 匹配字母、数字、下划线和连字符
    const pattern = /%([\w-]+)%|{([\w-]+)}|@([\w-]+)@|!([\w-]+)!/g

    return str.replace(pattern, (match, p1, p2, p3, p4) => {
        const key = p1 || p2 || p3 || p4 // 提取占位符键名
        // 使用 Object.prototype.hasOwnProperty.call 安全检查属性是否存在
        return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match
    })
}

/**
 * 格式化对象中所有字符串属性中的占位符
 * 遍历对象的每个属性，使用formatArgs进行格式化
 *
 * @param {Object} obj - 要格式化的对象
 * @param {Object} replacements - 占位符替换映射对象
 * @returns {Object} 格式化后的新对象
 */
export const formatObjectArgs = (obj, replacements) => {
    return Object.keys(obj).reduce((acc, key) => {
        acc[key] = formatArgs(obj[key], replacements)
        return acc
    }, {})
}

/**
 * 检查对象是否可扩展（非null、非数组的纯对象）
 *
 * @param {*} obj - 要检查的对象
 * @returns {boolean} 如果是可扩展对象返回true
 */
export function isExtendableObject(obj) {
    return typeof obj === "object" && Boolean(obj) && !Array.isArray(obj)
}

/**
 * 创建新Map并将key作为字段插入到value对象中
 * 不修改原Map，返回包含新对象的Map
 *
 * @param {Map} map - 源Map
 * @param {string} fieldName - 要添加的字段名，默认为"key"
 * @returns {Map} 新Map，value对象中包含key字段
 */
export function createMapWithKeyField(map, fieldName = "key") {
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

/**
 * 直接修改Map，将key作为字段插入到value对象中
 * 原地修改Map中的可扩展对象
 *
 * @param {Map} map - 要修改的Map
 * @param {string} fieldName - 要添加的字段名，默认为"key"
 */
export function modifyMapWithKeyField(map, fieldName = "key") {
    for (const [key, value] of map.entries()) {
        if (isExtendableObject(value)) {
            map.set(key, { ...value, [fieldName]: key })
        }
    }
}

/**
 * 创建新对象并将key作为字段插入到value对象中
 * 不修改原对象，返回包含新属性的对象
 *
 * @param {Object} obj - 源对象
 * @param {string} fieldName - 要添加的字段名，默认为"key"
 * @returns {Object} 新对象，value对象中包含key字段
 */
export function createObjectWithKeyField(obj, fieldName = "key") {
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

/**
 * 直接修改对象，将key作为字段插入到value对象中
 * 原地修改对象中的可扩展属性值
 *
 * @param {Object} obj - 要修改的对象
 * @param {string} fieldName - 要添加的字段名，默认为"key"
 */
export function modifyObjectWithKeyField(obj, fieldName = "key") {
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key]
            if (isExtendableObject(value)) {
                obj[key] = { ...value, [fieldName]: key }
            }
        }
    }
}

/**
 * 简单的深度复制对象
 * 使用JSON序列化/反序列化实现，不能复制函数和特殊对象
 *
 * @param {*} obj - 要复制的对象
 * @returns {*} 深度复制后的对象
 */
export const deepClone = (obj) => JSON.parse(JSON.stringify(obj))

/**
 * 生成指定长度的随机字符串
 * 使用字母、数字和下划线组成
 *
 * @param {number} length - 字符串长度，默认为16
 * @returns {string} 随机字符串
 */
export function randomString(length = 16) {
    const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
    let randomString = ""
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length)
        randomString += characters[randomIndex]
    }
    return randomString
}

// 过滤掉对象的某些字段，返回一个新的对象
/**
 * 根据过滤函数筛选对象的字段，返回新对象
 * 可以选择性地过滤掉不符合条件的键值对
 *
 * @param {Object} obj - 要筛选的源对象
 * @param {Function} filterFunc - 过滤函数，接收(key, value)参数，返回true保留该字段
 * @returns {Object} 筛选后的新对象
 *
 * @example
 * filterFields({a: 1, b: 2, c: 3}, (key, value) => value > 1)
 * // 返回 {b: 2, c: 3}
 *
 * filterFields({name: "test", age: 25, email: "test@example.com"}, (key) => key !== "email")
 * // 返回 {name: "test", age: 25}
 */
export function filterFields(obj, filterFunc) {
    const filteredObj = {}

    // 遍历对象的所有键值对
    for (const [key, value] of Object.entries(obj)) {
        // 如果提供了过滤函数，则使用该函数判断是否保留当前字段
        // 只有当filterFunc返回true时才保留该字段
        if (filterFunc && !filterFunc(key, value)) {
            continue // 跳过不符合条件的字段
        }

        // 将符合条件的键值对添加到新对象中
        filteredObj[key] = value
    }

    return filteredObj
}

/**
 * 复制源对象的基本类型字段到目标对象
 * 只复制字符串、数字、布尔值等基本类型，忽略数组、对象和指定字段
 *
 * @param {Object} source - 源对象
 * @param {Object} target - 目标对象
 * @param {Array<string>} ignoreKeys - 要忽略的字段列表
 */
export function copyFields(source, target, ignoreKeys = []) {
    // 遍历源对象的属性
    for (const key in source) {
        // 确保属性存在且不在忽略列表中，并且不是数组或对象
        if (
            source.hasOwnProperty(key) &&
            !ignoreKeys.includes(key) &&
            !Array.isArray(source[key]) &&
            typeof source[key] !== "object" &&
            source[key] !== null &&
            source[key] !== undefined
        ) {
            // 复制基本类型字段到目标对象
            target[key] = source[key]
        }
    }
}

/**
 * 直接修改原对象，删除指定的键值对
 *
 * @param {Object} obj - 要修改的对象
 * @param {Array<string>} removeKeys - 要删除的键列表
 */
export function removeFieldsIn(obj, removeKeys = []) {
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && removeKeys.includes(key)) {
            delete obj[key]
        }
    }
}

/**
 * 直接修改原对象，删除符合条件的键值对
 *
 * @param {Object} obj - 要修改的对象
 * @param {Function} filterFunc - 过滤函数，接收(key, value)，返回true则删除
 */
export function removeFieldsBy(obj, filterFunc) {
    for (const [key, value] of Object.entries(obj)) {
        // 如果提供了过滤函数，并且该键值对不符合过滤函数的条件，则跳过该键值对
        if (filterFunc && filterFunc(key, value)) {
            delete obj[key]
        }
    }
}

/**
 * 从对象中提取基本类型的值
 * 保留值类型为字符串、数字、布尔值且非空的字段
 *
 * @param {Object} obj - 源对象
 * @returns {Object} 只包含基本类型值的新对象
 */
export function pickSimpleValues(obj) {
    return filterFields(obj, (key, value) => {
        return (
            (typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean") &&
            value !== null &&
            value !== undefined &&
            value !== 0
        )
    })
}

/**
 * 从对象中提取非空值
 * 保留值不为null、undefined、0的字段
 *
 * @param {Object} obj - 源对象
 * @returns {Object} 只包含非空值的新对象
 */
export function pickTrueValues(obj) {
    return filterFields(obj, (key, value) => {
        return value !== null && value !== undefined && value !== 0
    })
}

/**
 * 使用源对象的值更新目标对象
 * 只更新目标对象中已存在的属性
 *
 * @param {Object} target - 目标对象
 * @param {Object} source - 源对象
 * @returns {Object} 更新后的目标对象
 */
export function updateObject(target, source) {
    for (const key in source) {
        if (target.hasOwnProperty(key)) {
            target[key] = source[key]
        }
    }
    return target
}

/**
 * 根据指定字段对数组去重
 * 多个字段的值组合作为唯一标识
 *
 * @param {Array} array - 要去重的数组
 * @param {...string} fields - 用于去重的字段名
 * @returns {Array} 去重后的数组
 */
export function uniqueByFields(array, ...fields) {
    const uniqueArray = []
    const seen = {}

    array.forEach((item) => {
        // 将指定字段的值组合成一个唯一的键值
        const key = fields.map((field) => item[field]).join("|")
        if (!seen[key]) {
            seen[key] = true
            uniqueArray.push(item)
        }
    })

    return uniqueArray
}

/**
 * 使用reduce实现根据指定字段对数组去重
 * 另一种实现方式，性能稍差
 *
 * @param {Array} array - 要去重的数组
 * @param {...string} fields - 用于去重的字段名
 * @returns {Array} 去重后的数组
 */
function uniqueByFields2(array, ...fields) {
    return array.reduce((uniqueArray, currentItem) => {
        const key = fields.map((field) => currentItem[field]).join("|")
        const exists = uniqueArray.some((item) => {
            const comparisonKey = fields.map((field) => item[field]).join("|")
            return comparisonKey === key
        })
        if (!exists) {
            uniqueArray.push(currentItem)
        }
        return uniqueArray
    }, [])
}

/**
 * 数字保留指定小数位
 *
 * @param {number|string} num - 要四舍五入的数字
 * @param {number} decimalPlaces - 保留的小数位数，默认为2
 * @returns {number} 四舍五入后的数字
 */
export function roundNum(num, decimalPlaces = 2) {
    if (typeof num === "string") {
        num = parseFloat(num)
    }
    const factor = Math.pow(10, decimalPlaces)
    return Math.round(num * factor) / factor
}

/**
 * 平滑系数变化
 * 使用平方根函数实现渐进式变化，避免突变
 *
 * @param {number} current - 当前值
 * @param {number} target - 目标值，默认为1
 * @param {number} factor - 调整因子，默认为0.3
 * @returns {number} 平滑调整后的值
 */
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

/**
 * 从对象中选取指定的属性
 * 类似lodash的pick函数
 *
 * @param {Object} obj - 源对象
 * @param {...string} keys - 要选取的属性名
 * @returns {Object} 包含指定属性的新对象
 */
export const pick = (obj, ...keys) =>
    Object.fromEntries(keys.filter((key) => key in obj).map((key) => [key, obj[key]]))

/**
 * 从对象中选取指定的属性（忽略不存在的属性）
 *
 * @param {Object} obj - 源对象
 * @param {...string} keys - 要选取的属性名
 * @returns {Object} 包含指定属性的新对象
 */
export const ipick = (obj, ...keys) => Object.fromEntries(keys.map((key) => [key, obj[key]]))

/**
 * 从对象中排除指定的属性
 * 类似lodash的omit函数
 *
 * @param {Object} obj - 源对象
 * @param {...string} keys - 要排除的属性名
 * @returns {Object} 不包含指定属性的新对象
 */
export const omit = (obj, ...keys) =>
    Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)))

/**
 * 移除字符串两端的引号
 *
 * @param {string} value - 要处理的字符串
 * @returns {string} 移除引号后的字符串
 */
export function removeQuotes(value) {
    return value.replace(/^"|"$/g, "").replace(/\\"/g, '"')
}

/**
 * 函数式try-catch包装器（同步版本）
 * 避免使用try-catch块，返回[error, result]元组
 *
 * @param {Function} fn - 要执行的函数
 * @param {...*} args - 传递给函数的参数
 * @returns {Array} [error|null, result|null]
 */
export const tryRun = (fn, ...args) => {
    try {
        return [null, fn(...args)]
    } catch (e) {
        return [e]
    }
}

/**
 * 函数式try-catch包装器（异步版本）
 * 避免使用try-catch块，返回[error, result]元组
 *
 * @param {Function} fn - 要执行的异步函数
 * @param {...*} args - 传递给函数的参数
 * @returns {Promise<Array>} [error|null, result|null]
 */
export const tryRunAsync = async (fn, ...args) => {
    try {
        return [null, await fn(...args)]
    } catch (e) {
        return [e]
    }
}

/**
 * 每隔n个元素取一个元素
 * 例如: takeEveryNth([1,2,3,4,5,6], 2) 返回 [1, 3, 5]
 *
 * @param {Array} arr - 源数组
 * @param {number} n - 间隔数量
 * @returns {Array} 选取的元素数组
 * @throws {Error} 当参数无效时抛出错误
 */
export function takeEveryNth(arr, n) {
    // 检查输入是否合法
    if (!Array.isArray(arr)) {
        throw new Error("第一个参数必须是一个数组！")
    }
    if (typeof n !== "number" || n <= 0) {
        throw new Error("第二个参数必须是一个正整数！")
    }

    const result = []
    for (let i = 0; i < arr.length; i += n) {
        result.push(arr[i])
    }
    return result
}

// 取数组元素，n个随机不重复元素
/**
 * 从数组中随机抽取n个不重复的元素
 * 使用Fisher-Yates洗牌算法确保随机性和性能
 *
 * @param {Array} arr - 源数组
 * @param {number} n - 要抽取的元素数量
 * @returns {Array} 包含n个随机元素的新数组
 * @throws {Error} 当输入参数无效时抛出错误
 *
 * @example
 * takeRandom([1, 2, 3, 4, 5], 3) // 可能返回 [3, 1, 5]
 */
export function takeRandom(arr, n) {
    // 输入验证
    if (!Array.isArray(arr)) {
        throw new Error("第一个参数必须是一个数组！")
    }
    if (typeof n !== "number" || n <= 0 || n > arr.length) {
        throw new Error("第二个参数必须是一个正整数且不能大于数组长度！")
    }

    // 使用Fisher-Yates洗牌算法
    const shuffled = arr.slice() // 创建数组副本，不修改原数组

    // 从后向前遍历，对每个位置进行随机交换
    for (let i = shuffled.length - 1; i > 0; i--) {
        // 生成0到i之间的随机索引
        const j = Math.floor(Math.random() * (i + 1))
        // 交换当前位置i和随机位置j的元素
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    // 返回洗牌后数组的前n个元素
    return shuffled.slice(0, n)
}

/**
 * 随机选择数组中的n个不重复元素
 * 使用Set记录已选择的索引确保不重复
 *
 * @param {Array} arr - 源数组
 * @param {number} n - 要选择的元素数量
 * @returns {Array} 随机选取的元素数组
 * @throws {Error} 当参数无效时抛出错误
 */
export function getRandomElements(arr, n) {
    // 检查输入是否合法
    if (!Array.isArray(arr)) {
        throw new Error("第一个参数必须是一个数组！")
    }
    if (typeof n !== "number" || n <= 0 || n > arr.length) {
        throw new Error("第二个参数必须是一个正整数且不能大于数组长度！")
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

/**
 * 从数组中随机选取n个元素（Fisher-Yates变种）
 * 只洗牌数组的最后n个元素，优化性能
 *
 * @param {Array} arr - 源数组
 * @param {number} n - 要选取的元素数量
 * @returns {Array} 随机选取的n个元素
 */
export function pickRandom(arr, n) {
    if (n >= arr.length) {
        return arr.slice() // 返回整个数组的副本
    }

    const result = arr.slice() // 不修改原数组
    for (let i = result.length - 1; i > result.length - 1 - n; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }

    return result.slice(-n)
}

/*
 * File: core.js
 * Created: 2024-03-23 13:04:52 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 安全的自有属性判断
 *
 * 直接调用 `hasOwn(obj, key)` 有两处风险：
 *   1. 对象可能自建 `hasOwnProperty` 字段（或由 `Object.create(null)` 创建、根本没有该方法）；
 *   2. 以 `{}` 作字典时，`__proto__` / `toString` 等原型链上的键会造成误判。
 * 统一走 `Object.prototype.hasOwnProperty.call` 可规避这两类问题。
 *
 * @param {Object} obj - 待检查对象
 * @param {string|symbol} key - 属性名
 * @returns {boolean} 是否为对象自有属性
 */
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * 并行处理数组中的元素，控制并发数量
 * 将数组分块处理，每块最多threads个元素并发执行
 * 相比Promise.all一次性处理所有元素，此方法可以控制并发数量，避免资源耗尽
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
    // 使用副本，避免 splice 修改调用方的原数组（副作用）
    const queue = [...arr]

    // 循环处理数组，每次处理threads个元素
    while (queue.length) {
        // 从队列开头取出最多threads个元素进行并发处理
        const chunk = queue.splice(0, threads)
        const res = await Promise.all(chunk.map((x) => fn(x)))
        result.push(res)
    }

    // 将所有批次的结果扁平化为单个数组
    return result.flat()
}

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
 * 主要用于文件列表展示，让相关文件聚集在一起
 *
 * @param {string} a - 第一个路径
 * @param {string} b - 第二个路径
 * @returns {number} 排序结果：负数表示a在前，正数表示b在前，0表示相等
 */
export const comparePathSmart = (a, b) => {
    // 计算路径深度（分隔符数量）
    const ap = a.split(/[\\/]/)?.length ?? 1 // 使用空值合并运算符提供默认值
    const bp = b.split(/[\\/]/)?.length ?? 1

    // 首先按路径深度排序，深度大的路径排在前面（降序）
    if (ap !== bp) {
        return bp - ap // 深度大的值更大，所以用bp-ap实现降序
    }

    // 深度相同时，按路径长度排序，长度长的排在前面（降序）
    if (a.length !== b.length) {
        return b.length - a.length
    }

    // 长度也相同时，按字符类型智能排序
    //
    // 必须是「全部字符都是 ASCII」才算 ASCII 路径。
    // 旧写法 `/\p{ASCII}/u.test(a)` 只要**任一**字符为 ASCII 就返回 true，
    // 于是 "D:/照片/IMG_001.jpg" 这类中西混排路径会被判为纯 ASCII，
    // 走 `toLowerCase()` 比较而非 localeCompare，中文排序结果错误。
    const regexp = /^[\p{ASCII}]+$/u
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
    const re = /^[\\/]{2,}[^\\/]+[\\/]+[^\\/]+/
    return re.test(strPath)
}

/**
 * 查找数组中的唯一元素
 * 如果数组去重后只剩一个元素，则返回该元素
 *
 * @param {Array} arr - 要检查的数组
 * @returns {*} 唯一元素，如果有多个不同元素则返回undefined
 */
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
    // 用无原型对象作字典：普通 `{}` 下，若数组元素是字符串 "__proto__" / "toString"，
    // `counts[key] || 0` 会读到原型链上的对象/函数，`+ 1` 得到 NaN，该元素统计失真
    const counts = Object.create(null)

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
function isExtendableObject(obj) {
    return typeof obj === "object" && Boolean(obj) && !Array.isArray(obj)
}

/**
 * 直接修改对象，将key作为字段插入到value对象中
 * 原地修改对象中的可扩展属性值
 *
 * @param {Object} obj - 要修改的对象
 * @param {string} fieldName - 要添加的字段名，默认为"key"
 */
export function modifyObjectWithKeyField(obj, fieldName = "key") {
    for (const key of Object.keys(obj)) {
        if (!hasOwn(obj, key)) {
            continue
        }
        const value = obj[key]
        if (isExtendableObject(value)) {
            // 同上：Object.defineProperty 才能真正写入名为 __proto__ 的自有属性
            Object.defineProperty(obj, key, {
                value: { ...value, [fieldName]: key },
                enumerable: true,
                writable: true,
                configurable: true,
            })
        }
    }
}

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
            hasOwn(source, key) &&
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
 * 根据指定字段对数组去重
 * 多个字段的值组合作为唯一标识
 *
 * @param {Array} array - 要去重的数组
 * @param {...string} fields - 用于去重的字段名
 * @returns {Array} 去重后的数组
 */
export function uniqueByFields(array, ...fields) {
    const uniqueArray = []
    // 用无原型对象作已见集合：普通 `{}` 下，若组合键为 "__proto__" / "toString"，
    // `seen[key]` 会命中原型链上的对象/函数（truthy），该条会被误判为重复而丢弃
    const seen = Object.create(null)

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

/**
 * 统计list1元素在list2中的存在数量（仅返回计数，一维列表）
 * @param {Array} list1 待检测列表
 * @param {Array} list2 目标列表
 * @returns {number} 匹配数量
 */
export function countListMatches(list1, list2) {
    // 边界处理：非数组/空列表直接返回0
    if (
        !Array.isArray(list1) ||
        !Array.isArray(list2) ||
        list1.length === 0 ||
        list2.length === 0
    ) {
        return 0
    }
    // Set优化查询性能，统计匹配数
    const targetSet = new Set(list2)
    return list1.filter((item) => targetSet.has(item)).length
}

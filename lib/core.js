/*
 * File: core.js
 * Created: 2024-03-23 11:34:38
 * Modified: 2024-03-23 11:52:01
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
export async function parallel(arr, fn, threads = 4) {
    const result = [];
    while (arr.length) {
        const res = await Promise.all(arr.splice(0, threads).map(x => fn(x)));
        result.push(res);
    }
    return result.flat();
}

export const asyncFilterAll = async (arr, predicate) => Promise.all(arr.map(predicate))
    .then((results) => arr.filter((_v, index) => results[index]));

// concurrently
export const asyncFilter = async (arr, predicate) =>
    arr.reduce(async (memo, e) =>
        await predicate(e) ? [...await memo, e] : memo
        , []);


// sequentially
export const asyncFilterSeq = async (arr, predicate) =>
    arr.reduce(async (memo, e) =>
        [...await memo, ...await predicate(e) ? [e] : []]
        , []);

// map async all
export const asyncMap = async (arr, func) => await Promise.all(arr.map(func));

// map async in groups
export const asyncMapGroup = async (arr, func, batchSize) => {
    const result = [];

    for (let i = 0; i < arr.length; i += batchSize) {
        const batch = arr.slice(i, i + batchSize);
        const gr = await asyncMap(batch, func);
        result.push(...gr);
    }
    return result;
};

// sync
export const some = (arr, predicate) => arr.filter(predicate).length > 0;
export const every = (arr, predicate) => arr.filter(predicate).length === arr.length;

// async
export const asyncSome =
    async (arr, predicate) => (await asyncFilter(arr, predicate)).length > 0;
export const asyncEvery =
    async (arr, predicate) => (await asyncFilter(arr, predicate)).length === arr.length;



// String.prototype.localeCompare基本可以完美实现按照拼音排序
export function compareLocalBy(k) {
    return (a, b) => a[k].localeCompare(b[k], "zh");
}

export function compareIntl(a, b) {
    return new Intl.Collator('zh-Hans-CN', { sensitivity: 'accent' }).compare(a, b);
}

// https://juejin.cn/post/7314196310648193087
export function compareIntlBy(k) {
    return (a, b) => compareIntl(a[k], b[k]);
}
export const compareSmart = (a, b) => {
    const regexp = /p{ASCII}/
    if (regexp.test(a) && regexp.test(b)) {
        // ASCII 字符直接比较
        return a.toLowerCase() < b.toLowerCase() ? -1 : 1
    } else {
        // 中文的用 localeCompare
        return a.localeCompare(b, 'zh')
    }
}

export function compareSmartBy(k) {
    return (a, b) => compareSmart(a[k], b[k]);
}

export function isUNCPath(strPath) {
    const re = /^[\\\/]{2,}[^\\\/]+[\\\/]+[^\\\/]+/
    return re.test(strPath);
}

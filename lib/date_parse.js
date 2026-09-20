/*
 * File: date_parse.js
 * Project: mediac
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 从媒体文件名解析拍摄日期时间
 *
 * 此前 `cmd/cmd_move.js` 与 `cmd/cmd_pick.js` 各自实现了一份，且有两处不一致：
 *   1. 正则：move 要求日期与时间之间**必须有**分隔符（`[_-]`），
 *      pick 则可选（`[_-]?`）→ `IMG_20210919.081146.jpg` 只在 pick 里能识别；
 *   2. 时区：move 固定 `Asia/Shanghai`，pick 用**本机时区**（dayjs 默认）。
 *      本机在 GMT+8 时结果恰好一致，一旦时区变化，同批文件会被分到不同月份。
 *
 * 统一为一处：时区固定，分隔符可选，并加上前导非数字守卫与字段范围校验。
 */

import dayjs from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat.js"
import timezone from "dayjs/plugin/timezone.js"
import utc from "dayjs/plugin/utc.js"

// dayjs 是模块单例，这里 extend 一次即可全局生效
// （也顺带修复了 cmd_move 此前"严格模式校验"实际未生效的问题——
//   没有该插件时 dayjs 会**忽略** strict 标志，2021-02-30 也会被判为合法）
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

/** 国内拍摄的媒体，文件名里的墙钟时间按北京时间解释 */
export const MEDIA_NAME_TIMEZONE = "Asia/Shanghai"

/**
 * 日期与时间之间、以及时间之后的分隔符均可选/任意，
 * `(?![\d])` 确保时间字段后面不是数字——避免把 15 位长串
 * （如 `202109190811467`）错位匹配出一个假日期。
 */
const RE_MEDIA_NAME_DATETIME =
    /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?![\d])/

/**
 * 从文件名中提取日期时间
 *
 * 支持 `IMG_20210919_081146.jpg`、`IMG_20210919.081146.jpg`、
 * `20210919081146.jpg`、`IMG_20210919_081146_v2.jpg` 等；
 * 不支持 `2021-09-19 08:11:46.jpg`（分隔式日期，原本两个命令也不支持）。
 *
 * @param {string} filename - 文件名或完整路径
 * @param {Object} [options]
 * @param {string} [options.timezone] - 覆盖默认时区
 * @returns {null|{
 *   date: string,      // YYYYMMDD
 *   time: string,      // HHMMSS
 *   monthStr: string,  // YYYYMM
 *   iso: string,       // YYYY-MM-DDTHH:mm:ss
 *   tz: string,
 *   jsDate: Date,
 *   dayjs: import("dayjs").Dayjs,
 *   dayKey: string,    // YYYY-MM-DD
 * }} 解析失败返回 null
 */
export function parseDateFromName(filename, options = {}) {
    const base = String(filename ?? "").split(/[\\/]/).pop()
    if (!base) {
        return null
    }

    const m = base.match(RE_MEDIA_NAME_DATETIME)
    if (!m) {
        return null
    }
    const [, Y, M, D, h, mi, s] = m

    const year = Number(Y)
    const month = Number(M)
    const day = Number(D)
    const hour = Number(h)
    const minute = Number(mi)
    const second = Number(s)

    // 与原实现一致的合法性窗口，外加时分秒范围（此前 move 未校验）
    if (year < 2000 || year > 2050) return null
    if (month < 1 || month > 12) return null
    if (day < 1 || day > 31) return null
    if (hour > 23 || minute > 59 || second > 59) return null

    // 严格校验年月日（自动处理每月天数与闰年）
    const dateCheck = dayjs(`${year}-${month}-${day}`, "YYYY-M-D", true)
    if (!dateCheck.isValid()) {
        return null
    }

    const tz = options.timezone ?? MEDIA_NAME_TIMEZONE
    const d = dayjs.tz(`${Y}-${M}-${D} ${h}:${mi}:${s}`, tz)
    if (!d.isValid()) {
        return null
    }

    return {
        date: `${Y}${M}${D}`,
        time: `${h}${mi}${s}`,
        monthStr: `${Y}${M}`,
        iso: d.format("YYYY-MM-DDTHH:mm:ss"),
        tz,
        jsDate: d.toDate(),
        dayjs: d,
        dayKey: d.format("YYYY-MM-DD"),
    }
}

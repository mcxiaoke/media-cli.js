/*
 * File: filename-rules.js
 * Created: 2026-09-20 10:16:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
// 文件名清洗规则层：纯函数，无 IO。自 cmd/cmd_shared.js 拆分（2026-09-20）。
import { sify } from "chinese-conv"
import * as emoji from "node-emoji"
import * as log from "./debug.js"
import { combineRegexG, filenameSafe } from "./helper.js"

// 正则：仅包含数字
export const RE_ONLY_NUMBER = /^\d+$/i
export const RE_ONLY_ASCII = /^[A-Za-z0-9 ._-]+$/i
// 视频文件名各种前后缀
export const RE_VIDEO_EXTRA_CHARS = combineRegexG(
    /HD1080P|2160p|1080p|720p|BDRip/,
    /H264|H265|X265|8BIT|10bit/,
    /WEB-DL|SMURF|Web|AAC5\.1|Atmos/,
    /H\.264|DD5\.1|DDP5\.1|AAC/,
    /DJWEB|Play|VINEnc|DSNP|END/,
    /高清|特效|字幕组|公众号|电影|搬运/,
    /\[.+?\]/,
)
// 图片文件名各种前后缀
export const RE_IMAGE_EXTRA_CHARS =
    /更新|合集|画师|图片|套图|全?高清|写真|视频|插画|视图|作品|订阅|限定|差分|拷贝|自购|内购|无水印|付费|内容|高画質|高解像度|R18|PSD|PIXIV|PIC|ZIP|RAR/giu
// Unicode Symbols
// https://en.wikipedia.org/wiki/Script_%28Unicode%29
// https://www.regular-expressions.info/unicode.html
// https://symbl.cc/cn/unicode/blocks/halfwidth-and-fullwidth-forms/
// https://www.unicode.org/reports/tr18/
// https://ayaka.shn.hk/hanregex/
// 特例字符	中英	全半角	unicode范围	unicode码表名
// 单双引号	中文	全/半	0x2018-0x201F	常用标点
// 句号、顿号	中文	全/半	0x300x-0x303F	中日韩符号和标点
// 空格	中/英	全角	0x3000	中日韩符号和标点
// -	英	半角	0x0021~0x007E	半角符号
// -	英	全角	0xFF01~0xFF5E	全角符号
// -	中	全/半	0xFF01~0xFF5E	全角符号
// 正则：匹配除 [中文日文标点符号] 之外的特殊字符
// u flag is required
// \p{sc=Han} CJK全部汉字 比 \u4E00-\u9FFF = \p{InCJK_Unified_Ideographs} 范围大
// 匹配汉字还可以使用 \p{Unified_Ideograph}
// \p{sc=Hira} 日文平假名
// \p{P} 拼写符号
// \p{ASCII} ASCII字符
// \uFE10-\uFE1F 中文全角标点
// \uFF01-\uFF11 中文全角标点
export const RE_NON_COMMON_CHARS = /[^\p{Unified_Ideograph}\p{sc=Hira}\p{sc=Kana}\w\d]/giu
// 匹配空白字符和特殊字符
// https://www.unicode.org/charts/PDF/U3000.pdf
// https://www.asciitable.com/
export const RE_UGLY_CHARS = /[\s\p{Zs}\p{Punctuation}]+/giu
// 匹配开头和结尾的空白和特殊字符
export const RE_UGLY_CHARS_BORDER = /^([\s._-]+)|([\s._-]+)$/giu

// 匹配所有中英文标点、Unicode 特殊符号的正则（Node.js 专用）
export const RE_ALL_PUNCTUATION = /\p{P}+/gu

// 扩展版（包含易被忽略的特殊符号，如全角空格、连接符等）
export const RE_ALL_SYMBOLS = /[\p{P}\p{S}\p{Zs}\u2000-\u206F\u3000-\u303F]+/gu

// 图片视频子文件夹名过滤
// 如果有表示，test() 会随机饭后true or false，是一个bug
// 使用 string.match 函数没有问题
// 参考 https://stackoverflow.com/questions/47060553
// The g modifier causes the regex object to maintain state.
// It tracks the index after the last match.
export const RE_MEDIA_DIR_NAME = /^图片|视频|电影|电视剧|Image|Video|Thumbs$/giu

// filename clean func
export const cleanNameEx = (input, sep = " ") => {
    if (!input || typeof input !== "string") return ""

    let cleaned = input.trim()

    // 去掉视频常见前后缀
    cleaned = cleaned.replace(RE_VIDEO_EXTRA_CHARS, "")

    // =去掉图片常见前后缀
    cleaned = cleaned.replace(RE_IMAGE_EXTRA_CHARS, "")

    // 额外强化去掉 R18/R17/R16 ====================
    cleaned = cleaned.replace(/R1[6-8]/gi, "")

    // 去掉所有带规格的括号标签（[104P 922M]、【4K】、(崩坏) 等）
    // 优先清除带 P/V/G/M/B/K/DL/VIP/4K 的，避免后面留下空括号
    cleaned = cleaned.replace(/\[[^\]]*?(?:P|V|G|M|B|K|DL|VIP|4K)[^\]]*?\]/gi, "")
    cleaned = cleaned.replace(/【[^】]*?(?:P|V|G|M|B|K|DL|VIP|4K)[^】]*?】/gi, "")
    cleaned = cleaned.replace(/\([^)]*?(?:P|V|G|M|B|K)[^)]*?\)/gi, "")

    // 去掉文件大小（2.64G、1.52GB、953MB、69.8MB、7.00GB 等） ====================
    cleaned = cleaned.replace(/\b[\d.,_]+[MGT][B]?\b/gi, "")

    // 去掉图片数量（81P3V、150P19V、72P、23P 等） ====================
    cleaned = cleaned.replace(/\b\d{1,4}P[\dV]*\b/gi, "")

    // 去掉 +视频 等残留 ====================
    cleaned = cleaned.replace(/\+?视频/gi, "")

    // 去掉 Emoji ====================
    const RE_EMOJI =
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F700}-\u{1F77F}]/gu
    cleaned = cleaned.replace(RE_EMOJI, "")

    // 规范化分隔符（_ – — 全部转成sep） ====================
    // 保留原有的「 - 」作为分隔，但把下划线和长横线统一
    cleaned = cleaned.replace(/[_-— ]+/g, sep)

    // 去掉所有 Unicode 丑陋字符和标点（
    // 你原来的 RE_UGLY_CHARS + RE_ALL_SYMBOLS） ====================
    // 先把连续的空白、标点、符号全部替换成单个空格
    cleaned = cleaned.replace(RE_UGLY_CHARS, sep)

    // 最终只保留允许的字符（你原来的 RE_NON_COMMON_CHARS 思想 + 增强）
    // 保留：中日韩 + 平假名片假名 + 英文 + 数字 + 空格 + - . & '
    // 其他全部转空格（包括你 RE_NON_COMMON_CHARS 想去掉的那些）
    cleaned = cleaned.replace(
        /[^\p{Unified_Ideograph}\p{sc=Hira}\p{sc=Kana}\p{L}\p{N}\s\-_.'&]/gu,
        " ",
    )
    // 统一空格 + 去掉首尾多余的 - _ ====================
    cleaned = cleaned.replace(/\s+/g, " ").trim()
    cleaned = cleaned.replace(RE_UGLY_CHARS_BORDER, "")

    return cleaned
}

// 可以考虑将日文和韩文罗马化处理
// https://github.com/lovell/hepburn
// https://github.com/fujaru/aromanize-js
// https://www.npmjs.com/package/aromanize
// https://www.npmjs.com/package/@lazy-cjk/japanese
export function cleanFileName(nameString, options = {}) {
    let sep = options.separator || ""
    let nameStr = nameString
    // 去掉所有表情符号
    nameStr = emoji.strip(nameStr)
    // 去掉方括号 [xxx] 的内容
    // nameStr = nameStr.replaceAll(/\[.+?\]/gi, "");
    // 去掉图片集说明文字
    nameStr = nameStr.replaceAll(RE_IMAGE_EXTRA_CHARS, "")
    // 去掉视频说明文字
    nameStr = nameStr.replaceAll(RE_VIDEO_EXTRA_CHARS, "")
    // 去掉日期字符串
    if (!options.keepDateStr) {
        nameStr = nameStr.replaceAll(/\d+年\d+月/giu, "")
        nameStr = nameStr.replaceAll(/\d{4}-\d{2}-\d{2}/giu, "")
        nameStr = nameStr.replaceAll(/\d{4}\.\d{2}\.\d{2}/giu, "")
    }
    // 去掉 [100P5V 2.25GB] No.46 这种图片集说明
    nameStr = nameStr.replaceAll(/\[\d+P.*(\d+V)?.*?\]/giu, "")
    nameStr = nameStr.replaceAll(/No\.\d+|\d+MB|\d+\.?\d+GB?|\d+P|\d+V|NO\.(\d+)/giu, "$1")
    // 去掉中文标点，全角符号
    nameStr = nameStr.replaceAll(/[\u3000-\u303F\uFE10-\uFE2F\uFF00-\uFF20]+/giu, "")
    // () [] {} <> . - 改为下划线
    nameStr = nameStr.replaceAll(/[\s()[\]{}<>._-]+/giu, sep)
    // 日文转罗马字母
    // nameStr = hepburn.fromKana(nameStr);
    // nameStr = wanakana.toRomaji(nameStr);
    // 韩文转罗马字母
    // nameStr = aromanize.hangulToLatin(nameStr, 'rr-translit');
    if (options.tc2sc) {
        // 繁体转换为简体中文
        nameStr = sify(nameStr)
    }
    // 去掉所有特殊字符
    nameStr = nameStr.replaceAll(RE_NON_COMMON_CHARS, sep)
    // 连续的分隔符合并为一个 sep
    nameStr = nameStr.replaceAll(/[\s._-]+/giu, sep)
    // 去掉首尾的特殊字符
    nameStr = nameStr.replaceAll(RE_UGLY_CHARS_BORDER, "")
    log.debug(`cleanFileName SRC [${nameString}]`, options)
    log.debug(`cleanFileName DST: [${nameStr}]`)
    // 确保是合法的文件名
    return filenameSafe(nameStr)
}

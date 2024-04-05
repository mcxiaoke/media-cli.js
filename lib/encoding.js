import dayjs from 'dayjs';
import fs from 'fs-extra';
import iconv from 'iconv-lite';
import os from 'os';
import path from 'path';
import * as log from './debug.js';
import { strHasASCII, strHasHFKanaHira, strHasHiraKana, strOnlyASCII, strOnlyChinese, strOnlyJapanese } from './unicode.js';
import { CHINESE_CHARS_3500, MESSY_CJK_CHARS as MESSY_CJK_CHARS_ } from './unicode_data.js';

// https://github.com/bnoordhuis/node-iconv/
const ENCODING_FROM = [
    'SHIFT_JIS',
    'GBK',
    'UTF8',
    'UTF-16',
    'ISO-8859-1',
    // 'CP949',
    // 'EUC-KR',
]

const ENCODING_TO = [
    'SHIFT_JIS',
    'GBK',
    'UTF8',
    // 'CP949',
    // 'EUC-KR',
]

const ENCODING_TRY = ['SHIFT_JIS', 'UTF8']

export const MESSY_CJK_CHARS = MESSY_CJK_CHARS_

export const REGEX_MESSY_CJK = new RegExp(`[${MESSY_CJK_CHARS}]`, 'u')

export const REGEX_MESSY_CJK_EXT = /[\u8701-\u883f\u9200-\u9484]/u //生僻字: 虫字旁 金字旁

export const REGEX_MESSY_UNICODE = /[\u007f-\u00a0\u00c0-\u017f\u0400-\u1cff\u2070-\u26ff\u0e00-\u0e7f\u3400-\u4dbf\uac00-\uf8ff\ufe30-\ufe4f\ufff0-\uffff]/u

// 正则：只包含中文常用汉字，日文平假名片假名和ASCII字符
const RE_CHARS_MOST_USED = new RegExp(`^[${CHINESE_CHARS_3500}\\u3000-\\u303f\\p{sc=Hira}\\p{ASCII}]+$`, 'ui')

export function charUnique(str) {
    return String.prototype.concat.call(...new Set(str));
}

export function fixCJKEnc(str) {
    let results = fixCJKEncImpl(str)
    results = results.filter(r => r[2] >= 70).sort((a, b) => b[2] - a[2])
    return results[0] || [str, false, 0, 'fallback'];
}


const nowDateStr = dayjs().format("YYYYMMDDHHmmss");
const tempfile = path.join(os.tmpdir(), `z_mediac_log_${nowDateStr}.txt`)

export function checkBadUnicode(str) {
    const results = []
    if (str.includes('?') || str.includes('\ufffd')) {
        // 乱码标志 问号和黑问号
        results.push([true, 1, `问号和黑问号`])
    }
    if (/[\u00c0-\u024f\u3100-\u312f]/u.test(str)) {
        // 乱码标志 拉丁字母扩展 注音符号
        results.push([true, 2, `拉丁字母扩展`])
    }
    if (/[\u0530-\u1cff]/u.test(str)) {
        // 乱码标志 小众语言字母符号
        results.push([true, 3, `小众语言字母符号`])
    }
    if (/[\u3300-\u3357]/u.test(str)) {
        // 乱码标志 方块片假名
        results.push([true, 4, `方块片假名`])
    }
    if (/[\ue000-\uf8ff]/u.test(str)) {
        // 乱码标志 Unicode私有区
        results.push([true, 5, `Unicode私有区`])
    }
    // if (/[\uff66-\uffff]/u.test(str)) {
    //     // 乱码标志 半角平假名片假名
    //     results.push([true, 6, `半角平假名片假名`])
    // }
    if (/[㼿]/u.test(str)) {
        // 乱码标志 特殊生僻字
        results.push([true, 7, `特殊生僻字`])
    }
    return results
}

export function hasBadUnicode(str) {
    return checkBadUnicode(str)?.length > 0
}

export function fixCJKEncImpl(str, fromEnc = ENCODING_FROM, toEnc = ENCODING_TO) {
    log.info(`fixEnc processing ${str}`)
    if (str.includes('?')) {
        return [[str, false, 0, 'InvalidChars', ''],]
    }

    let results = []
    // 忽略含有片假名平假名的字符串
    if (strOnlyASCII(str)) {
        log.info('fixEnc OnlyASCII')
        // results.push([str, false, 0])
        return [[str, false, 0, 'OnlyASCII', ''],]
    }
    if (!REGEX_MESSY_UNICODE.test(str) && !REGEX_MESSY_CJK.test(str) && !REGEX_MESSY_CJK_EXT.test(str)) {
        log.info('fixEnc MESSY_CHARS', str)
        if (RE_CHARS_MOST_USED.test(str)) {
            log.info('fixEnc MOST_USED', str)
            results.push([str, false, 100, 'MOST_USED0', ''])
        }
        else if (strOnlyChinese(str)) {
            log.info('fixEnc ValidCN', str)
            results.push([str, false, 99, 'ValidCN0', ''])
        }
        else if (strHasHFKanaHira(str)) {
            // 包含不用的全角半角平假名片假名
            log.info('fixEnc HFKH', str)
            results.push([str, false, 65, 'HFKH0', ''])
        }
        else {
            fs.appendFileSync(tempfile, str + '\n')
            return [[str, false, 0, 'Ignore', ''],]
        }
    } else {
        log.info('fixEnc HAS MESSY_CHARS', str)
        if (strOnlyChinese(str) && !REGEX_MESSY_CJK_EXT.test(str)) {
            log.info('fixEnc OnlyCN', str)
            return [[str, false, 0, `OnlyCN0`, `${REGEX_MESSY_UNICODE.test(str)}`],]
        }
    }
    if ((strHasHiraKana(str) || strHasASCII(str))
        && strOnlyJapanese(str) && !REGEX_MESSY_CJK.test(str)) {
        log.info('fixEnc ValidJP', str)
        results.push([str, false, 99, 'ValidJP0', ''])
    }
    else if (strOnlyJapanese(str)) {
        log.info('fixEnc OnlyJP', str)
        results.push([str, false, 77, 'OnlyJP0', ''])
    }

    for (const enc1 of fromEnc) {
        for (const enc2 of toEnc) {
            if (enc1 === enc2) { continue }
            try {
                const strBuffer = iconv.encode(str, enc1)
                const strDecoded = iconv.decode(strBuffer, enc2)
                if (hasBadChars(strDecoded)) {
                    results.push([strDecoded, true, 1, `BadChar`, `${enc1}=>${enc2}`])
                    continue;
                }
                const onlyASCII = strOnlyASCII(strDecoded)
                const onlyCN = strOnlyChinese(strDecoded)
                const onlyJP = strOnlyJapanese(strDecoded)
                const messyUnicode = REGEX_MESSY_UNICODE.test(strDecoded)
                const messyCJK = REGEX_MESSY_CJK.test(strDecoded)
                if (onlyASCII) {
                    results.push([strDecoded, true, 99, `OnlyASCII`, `${enc1}=>${enc2}`])
                    break
                }
                if (RE_CHARS_MOST_USED.test(strDecoded)) {
                    results.push([strDecoded, true, 99, `MOST_USED`, `${enc1}=>${enc2}`])
                    break
                }
                // else if (onlyCN) {
                //     results.push([strDecoded, true, 78, `OnlyChn`, `${enc1}=>${enc2}`])
                // }
                // else if (onlyJP) {
                //     results.push([strDecoded, true, 76, `OnlyJap`, `${enc1}=>${enc2}`])
                // }
                else if (!messyUnicode && !messyCJK) {
                    results.push([strDecoded, true, 74, `messyBoth`, `${enc1}=>${enc2}`])
                }
                else if (messyCJK) {
                    results.push([strDecoded, true, 50, `messyCJK`, `${enc1}=>${enc2}`])
                }
                else if (messyUnicode) {
                    results.push([strDecoded, true, 50, `messyUn`, `${enc1}=>${enc2}`])
                }
                else {
                    // log.show(strDecoded, onlyCN, onlyJP, messyUnicode, messyCJK)
                    results.push([strDecoded, true, 60, `Unknown ${onlyCN} ${onlyJP}`, ` ${enc1}=>${enc2}`])
                }

            } catch (error) {
                log.info(`fixEnc ${error}`)
            }
        }
    }
    results.push([str, false, 70, 'fallback'])
    results = results.filter(r => r[2] >= 50).sort((a, b) => b[2] - a[2])
    log.info(results.slice(3))
    return results;
}
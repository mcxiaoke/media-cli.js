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

export const REGEX_MESSY_UNICODE = /[\u007f-\u00a0\u00c0-\u017f\u0400-\u1cff\u2070-\u24ff\u0e00-\u0e7f\u3400-\u4dbf\uac00-\uf8ff\ufe30-\ufe4f\ufff0-\uffff]/u

// 正则：只包含中文常用汉字，日文平假名片假名和ASCII字符
export const RE_CHARS_MOST_USED = new RegExp(`^[${CHINESE_CHARS_3500}\\u3000-\\u303f\\uff66-\\uff9dA-Za-z0-9\\-_ ]+$`, 'ui')

export function charUnique(str) {
    return String.prototype.concat.call(...new Set(str));
}

const nowDateStr = dayjs().format("YYYYMMDDHHmmss");
const tempfile = path.join(os.tmpdir(), `z_mediac_log_${nowDateStr}.txt`)

export function checkBadUnicode(str) {
    const results = []
    if (str.includes('?') || str.includes('\ufffd')) {
        // 乱码标志 问号和黑问号
        results.push([true, 0, `非法字符`])
    }
    if (/[\u00c0-\u00d6\u00d8-\u024f\u3100-\u312f\ua720-\ua7ff\uab30-\uabff]/u.test(str)) {
        // 乱码标志 拉丁字母扩展 注音符号
        results.push([true, 2, `拉丁字母扩展`])
    }
    if (/[\u0530-\u1cff]/u.test(str)) {
        // 乱码标志 小众语言字母符号
        results.push([true, 3, `小众语言符号`])
    }
    if (/[\u3300-\u3357]/u.test(str)) {
        // 乱码标志 方块片假名
        results.push([true, 4, `方块片假名`])
    }
    if (/[\ue000-\uf8ff]/u.test(str)) {
        // 乱码标志 Unicode私有区
        results.push([true, 5, `私有区`])
    }
    if (/[\uff66-\uff9d]/u.test(str)) {
        // 乱码标志 半角平假名片假名
        results.push([true, 6, `半角假名`])
    }
    if (/[㼿]/u.test(str)) {
        // 乱码标志 特殊生僻字
        results.push([true, 7, `生僻字`])
    }
    return results
}

export function hasBadUnicode(str) {
    return checkBadUnicode(str)?.length > 0
}

export function hasBadCJKChar(str) {
    return REGEX_MESSY_CJK.test(str) || REGEX_MESSY_CJK_EXT.test(str)
}

export function fixCJKEnc(str) {
    let results = fixCJKEncImpl(str)
    results = results.filter(r => r[2] >= 0).sort((a, b) => b[2] - a[2])
    log.debug('==================================')
    log.debug(str)
    if (results?.length > 0) {
        for (const r of results) {
            log.debug(r[0], '\t\t', r.slice(1))
        }
    }
    return results[0] || [str, false, 0, 'fallback'];
}

export function fixCJKEncImpl(str,
    fromEnc = ENCODING_FROM,
    toEnc = ENCODING_TO,
    threhold = 10) {
    if (str.includes('?') || str.includes('\ufffd')) {
        return [[str, false, 0, '信息丢失', ''],]
    }

    let results = []
    if (strOnlyASCII(str)) {
        // results.push([str, false, 0])
        return [[str, false, 0, '全英文数字', ''],]
    }
    if (!REGEX_MESSY_UNICODE.test(str)
        && !REGEX_MESSY_CJK.test(str)
        && !REGEX_MESSY_CJK_EXT.test(str)) {
        if (RE_CHARS_MOST_USED.test(str)) {
            results.push([str, false, 100, '常用汉字0', ''])
        }
        // else if (strOnlyChinese(str)) {
        //     results.push([str, false, 99, '全中文01', ''])
        // }
        else if (strHasHFKanaHira(str)) {
            // 包含不用的全角半角平假名片假名
            results.push([str, false, 65, '含半角假名0', ''])
        }
        else {
            // fs.appendFileSync(tempfile, str + '\n')
            return [[str, false, 0, '忽略0', ''],]
        }
    } else {
        if (strOnlyChinese(str) && !REGEX_MESSY_CJK_EXT.test(str)) {
            return [[str, false, 0, `全中文02`, `${REGEX_MESSY_UNICODE.test(str)}`],]
        }
    }
    if ((strHasHiraKana(str) || strHasASCII(str))
        && strOnlyJapanese(str) && !REGEX_MESSY_CJK.test(str)) {
        results.push([str, false, 99, '全日文01', ''])
    }
    else if (strOnlyJapanese(str)) {
        results.push([str, false, 80, '全日文02', ''])
    }
    // log.showRed(str)
    // log.show(Array.from(str).map(c => c.codePointAt(0).toString(16)).join(' '))
    for (const enc1 of fromEnc) {
        for (const enc2 of toEnc) {
            if (enc1 === enc2) { continue }
            try {
                const strBuffer = iconv.encode(str, enc1)
                let strDecoded = iconv.decode(strBuffer, enc2)
                const badDecoded = checkBadUnicode(strDecoded)
                // const strCleaned = strDecoded.replaceAll(/[\ufffd\u0020]/ugi, '')
                // 如果含有乱码字符
                if (badDecoded?.length > 0) {
                    for (const item of badDecoded) {
                        results.push([strDecoded, ...item, `${enc1}=>${enc2}`])
                    }
                    continue;
                }

                // log.showRed('========')
                // log.showRed(str)
                // log.showGreen(Array.from(str).map(c => c.codePointAt(0).toString(16)))
                // log.show(strDecoded, enc1, enc2)

                const onlyASCII = strOnlyASCII(strDecoded)
                const onlyCN = strOnlyChinese(strDecoded)
                const onlyJP = strOnlyJapanese(strDecoded)
                const messyUnicode = REGEX_MESSY_UNICODE.test(strDecoded)
                const messyCJK = REGEX_MESSY_CJK.test(strDecoded)
                if (onlyASCII && !strDecoded.includes('?')) {
                    results.push([strDecoded, true, 99, `全英文数字`, `${enc1}=>${enc2}`])
                    break
                }
                if (RE_CHARS_MOST_USED.test(strDecoded)) {
                    results.push([strDecoded, true, 99, `常用汉字`, `${enc1}=>${enc2}`])
                    break
                }
                log.debug(strDecoded, onlyCN, onlyJP, messyUnicode, messyCJK)

                if (onlyJP && strHasHiraKana(strDecoded)) {
                    results.push([strDecoded, true, 78, `日文字符`, `${enc1}=>${enc2}`])
                }
                else if (onlyCN) {
                    results.push([strDecoded, true, 76, `中文字符`, `${enc1}=>${enc2}`])
                }
                else if (!messyUnicode && !messyCJK
                    && [enc1, enc2].includes('SHIFT_JIS')
                    && [enc1, enc2].includes('UTF8')) {
                    results.push([strDecoded, true, 74, `无特殊字符`, `${enc1}=>${enc2}`])
                }
                // else if (messyCJK) {
                //     results.push([strDecoded, true, 51, `含特殊汉字`, `${enc1}=>${enc2}`])
                // }
                // else if (messyUnicode) {
                //     results.push([strDecoded, true, 52, `含特殊符号`, `${enc1}=>${enc2}`])
                // }
                else {
                    results.push([strDecoded, true, 60, `正常转换 ${onlyCN} ${onlyJP}`, ` ${enc1}=>${enc2}`])
                }

            } catch (error) {
                log.info(`fixEnc ${str} ${error}`)
            }
        }
    }
    results.push([str, false, 70, '原始字符串'])
    results = results.filter(r => r[2] >= threhold).sort((a, b) => b[2] - a[2])
    log.debug(results.slice(3))
    return results;
}
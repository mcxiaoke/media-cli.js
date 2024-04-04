import dayjs from 'dayjs';
import fs from 'fs-extra';
import iconv from 'iconv-lite';
import os from 'os';
import path from 'path';
import * as log from './debug.js';
import { strHasASCII, strHasHiraKana, strOnlyASCII, strOnlyChinese, strOnlyJapanese } from './unicode.js';
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

export const REGEX_MESSY_CJK_EXT = /[\u8701-\u883f]/u //虫字旁的多笔画字

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

export function fixCJKEncImpl(str, fromEnc = ENCODING_FROM, toEnc = ENCODING_TO) {
    log.info(`fixEnc processing ${str}`)
    if (str.includes('?')) {
        return [[str, false, 0, 'InvalidChars'],]
    }

    let results = []
    // 忽略含有片假名平假名的字符串
    if (strOnlyASCII(str)) {
        log.info('fixEnc OnlyASCII')
        // results.push([str, false, 0])
        return [[str, false, 0, 'OnlyASCII'],]
    }
    if (!REGEX_MESSY_UNICODE.test(str) && !REGEX_MESSY_CJK.test(str) && !REGEX_MESSY_CJK_EXT.test(str)) {
        log.info('fixEnc MESSY_CHARS', str)
        if (RE_CHARS_MOST_USED.test(str)) {
            log.info('fixEnc MOST_USED', str)
            results.push([str, false, 99, 'GOOD_CHARS_2'])
        }
        else if (strOnlyChinese(str)) {
            log.info('fixEnc ValidCN', str)
            results.push([str, false, 99, 'ValidCN'])
        }
        fs.appendFileSync(tempfile, str + '\n')
        return [[str, false, 0, 'Ignore'],]
    } else {
        log.info('fixEnc HAS MESSY_CHARS', str)
        if (strOnlyChinese(str) && !REGEX_MESSY_CJK_EXT.test(str)) {
            log.info('fixEnc OnlyCN', str)
            return [[str, false, 0, `OnlyCN0 ${REGEX_MESSY_UNICODE.test(str)}`],]
        }
    }
    if ((strHasHiraKana(str) || strHasASCII(str))
        && strOnlyJapanese(str) && !REGEX_MESSY_CJK.test(str)) {
        log.info('fixEnc ValidJP', str)
        results.push([str, false, 99, 'ValidJP'])
    } else if (strOnlyJapanese(str)) {
        log.info('fixEnc OnlyJP', str)
        results.push([str, false, 77, 'OnlyJP'])
    }

    for (const enc1 of fromEnc) {
        for (const enc2 of toEnc) {
            if (enc1 === enc2) { continue }
            // if (!ENCODING_TRY.includes(enc1)
            //     && !ENCODING_TRY.includes(enc2)) { continue }
            try {
                const strBuffer = iconv.encode(str, enc1)
                const strDecoded = iconv.decode(strBuffer, enc2)
                if (strDecoded.includes('?')) {
                    continue;
                }
                const onlyASCII = strOnlyASCII(strDecoded)
                const onlyCN = strOnlyChinese(strDecoded)
                const onlyJP = strOnlyChinese(strDecoded)
                const messyUnicode = REGEX_MESSY_UNICODE.test(strDecoded)
                const messyCJK = REGEX_MESSY_CJK.test(strDecoded)
                if (onlyASCII) {
                    results.push([strDecoded, true, 100, `OnlyASCII ${enc1}=>${enc2}`])
                    break
                }
                else if (RE_CHARS_MOST_USED.test(strDecoded)) {
                    results.push([strDecoded, true, 100, `MOST_USED ${enc1}=>${enc2}`])
                    break
                }
                else if (!messyUnicode && !messyCJK) {
                    results.push([strDecoded, true, 80, `messyBoth ${enc1}=>${enc2}`])
                }
                else if (onlyCN) {
                    results.push([strDecoded, true, 78, `OnlyChinese ${enc1}=>${enc2}`])
                }
                else if (onlyJP) {
                    results.push([strDecoded, true, 76, `OnlyJapanese ${enc1}=>${enc2}`])
                }
                else if (messyUnicode) {
                    results.push([strDecoded, true, 50, `messyUnicode ${enc1}=>${enc2} ${onlyCN} ${onlyJP}`])
                }
                else {
                    // log.show(strDecoded, onlyCN, onlyJP, messyUnicode, messyCJK)
                    results.push([strDecoded, true, 60, `Unknown ${enc1}=>${enc2} ${onlyCN} ${onlyJP}`])
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
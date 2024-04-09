/*
 * File: unicode_test.js
 * Created: 2024-04-03 20:42:56
 * Modified: 2024-04-08 22:21:19
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import * as enc from '../lib/encoding.js'
import * as unicode from '../lib/unicode.js'

import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { CHINESE_CHARS_3500, CHINESE_CHARS_7000, JAPANESE_HAN } from '../lib/unicode_data.js'
// log.setVerbose(1);

// https://github.com/bnoordhuis/node-iconv/
const ENC_LIST = [
    'ISO-8859-1',
    'UTF8',
    'UTF-16',
    'GBK',
    // 'BIG5',
    'SHIFT_JIS',
    'EUC-JP',
    // 'CP949',
    // 'EUC-KR',
]

function normalizeChars(filename = 'messy_hanzi.txt') {
    const c7000 = CHINESE_CHARS_7000
    const c3500 = CHINESE_CHARS_3500
    const jpHanzi = JAPANESE_HAN
    const dataDir = path.join(path.dirname(__dirname), 'data')
    const libDir = path.join(path.dirname(__dirname), 'lib')
    // const fileChars = fs.readFileSync(path.join(dataDir, 'messy_sample.txt'), 'utf8')
    const chars = enc.REGEX_MESSY_CJK + '堄拲儗儞亃僱僄僊儖'
    const valid = []
    // 排除1 汉字属于中国常用汉字7000字的范围
    // x排除2 汉字属于日本常用汉字2100字的范围 !jpHanzi.includes(c)
    // 这样可以确保输出的汉字是不常用的
    for (const c of chars) {
        if (!c7000.includes(c) && !/[\s]+/u.test(c)) {
            valid.push(c)
        }
    }
    // 只保留汉字
    let charsChanged = valid.join('').replaceAll(/[\s]|[^\p{sc=Han}]/ugi, '')
    charsChanged = charUnique(charsChanged)
    if (chars !== charsChanged) {
        console.log('messy chars changed:', charsChanged.length)
        fs.writeFileSync(path.join(os.tmpdir(), filename), charsChanged)

        fs.writeFileSync(path.join(libDir, filename), charsChanged)
    }

}

normalizeChars()

function charUnique(str) {
    return (String.prototype.concat.call(...new Set(str)))
        .split('').sort((a, b) => a.localeCompare(b)).join('')
}

function showStatus(str, title = '') {
    console.log(`================ ${title} ================`)
    console.log(str)
    console.log('REGEX_MESSY_CJK', enc.REGEX_MESSY_CJK.test(str))
    console.log('REGEX_MESSY_CJK_EXT', enc.REGEX_MESSY_CJK_EXT.test(str))
    console.log('REGEX_MESSY_UNICODE', enc.REGEX_MESSY_UNICODE.test(str))
    console.log('hasBadUnicode', enc.hasBadUnicode(str))
    console.log('strOnlyChinese', unicode.strOnlyChinese(str))
    console.log('strOnlyJapanese', unicode.strOnlyJapanese(str))
}

function fixEnc(str) {
    console.log(`Processing ${str}`)
    const results = enc.fixCJKEncImpl(str, ENC_LIST, ENC_LIST)
    for (const r of results) {
        console.log(r[0], '\t', r.slice(1))
    }
    console.log('INPUT:', [str])
    console.log('OUPUT:', results[0])
    return enc.fixCJKEnc(str)[0]
}

let fromStr = ''
// 这个特殊，解码出来有emoji JS转换会乱码
// 2024-01-10 06-00大鳳背面座位 
// 2024-01-10 06-00螟ｧ魑ｳ閭碁擇蠎ｧ菴郊生
// messyStr = '2024-01-10 06-00螟ｧ魑ｳ閭碁擇蠎ｧ菴郊生'
fromStr = '│  │      DOT_像度画像です（PNG ×PX）-_49_Z4K'
const toStr = process.argv.length > 2 ? fixEnc(process.argv[2]) : fixEnc(fromStr)
showStatus(fromStr, 'BEFORE FIX')
showStatus(toStr, 'AFTER FIX')
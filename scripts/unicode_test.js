import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import * as enc from '../lib/encoding.js';
import * as unicode from '../lib/unicode.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { CHINESE_CHARS_3500, CHINESE_CHARS_7000 } from '../lib/unicode_data.js';
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

function normalizeChars() {
    const c7000 = CHINESE_CHARS_7000
    const c3500 = CHINESE_CHARS_3500
    const chars = enc.REGEX_MESSY_CJK + ''
    const valid = []
    for (const c of chars) {
        if (!c3500.includes(c) && !/[\s]+/u.test(c)) {
            valid.push(c)
        }
    }
    // 只保留汉字
    let charsChanged = valid.join('').replaceAll(/[\s]|[^\p{sc=Han}]/ugi, '')
    charsChanged = charUnique(charsChanged)
    if (chars !== charsChanged) {
        console.log('messy chars changed:', charsChanged.length)
        fs.writeFileSync(path.join(os.tmpdir(), 'messy_hanzi.txt'), charsChanged)
        const libDir = path.join(path.dirname(__dirname), 'lib')
        fs.writeFileSync(path.join(libDir, 'messy_hanzi.txt'), charsChanged)
    }

}

normalizeChars()
let messyStr = ''
// 这个特殊，解码出来有emoji JS转换会乱码
// 2024-01-10 06-00大鳳背面座位
// 2024-01-10 06-00螟ｧ魑ｳ閭碁擇蠎ｧ菴郊生
// messyStr = '2024-01-10 06-00螟ｧ魑ｳ閭碁擇蠎ｧ菴郊生'
messyStr = '2022-10-14-Skeb(先生)'

function charUnique(str) {
    return (String.prototype.concat.call(...new Set(str)))
        .split('').sort((a, b) => a.localeCompare(b)).join('');
}

function fixEnc(str) {
    const results = enc.fixCJKEncImpl(str, ENC_LIST, ENC_LIST)
    console.log('-------------------')
    for (const r of results) {
        console.log(r[0], '\t', r.slice(1))
    }
    console.log('INPUT:', [str])
    console.log('OUPUT:', results[0])
}
if (process.argv.length > 2) {
    fixEnc(process.argv[2])
} else {
    fixEnc(messyStr)
}

console.log(messyStr, unicode.strOnlyChinese(messyStr), unicode.strOnlyJapanese(messyStr))
console.log(enc.REGEX_MESSY_CJK.test(messyStr), enc.REGEX_MESSY_CJK_EXT.test(messyStr), enc.REGEX_MESSY_UNICODE.test(messyStr))
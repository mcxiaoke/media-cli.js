
import path from 'path';
import { REGEX_MESSY_CJK, REGEX_MESSY_CJK_EXT, REGEX_MESSY_UNICODE, RE_CHARS_MOST_USED, checkBadUnicode, fixCJKEncImpl, hasBadUnicode } from '../lib/encoding.js';
import { REGEX_JAPANESE_HAN, strOnlyChinese, strOnlyJapanese, strOnlyJapaneseHan } from '../lib/unicode.js';

import assert from "assert";
import chalk from 'chalk';
import * as cliProgress from "cli-progress";
import dayjs from "dayjs";
import exif from 'exif-reader';
import fs from 'fs-extra';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import sharp from "sharp";
import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';


import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENC_LIST = [
    'ISO-8859-1',
    'UTF8',
    'UTF-16',
    'GBK',
    // 'BIG5',
    'SHIFT_JIS',
    'EUC-JP',
    'CP949',
    // 'EUC-KR',
]


export function fixMessyChars(str) {
    let results = fixCJKEncImpl(str, ENC_LIST, ENC_LIST, 10)
    return results.reverse()
}

function showStatus(r) {
    const str = r[0]
    const print = (a, b, c, d) => console.log(a.padEnd(24, ' '), `${b}`.padEnd(10, ' '), c?.padEnd(24, ' ') ?? "", d ?? "")
    console.log(`----------------------------------------------`)
    console.log(str, '\t', r.slice(1))
    print('String', Array.from(str).join('  '))
    print('Unicode', Array.from(str).map(c => c.codePointAt(0).toString(16)).join(' '))
    print('MESSY_UNICODE', REGEX_MESSY_UNICODE.test(str), 'BadUnicode', checkBadUnicode(str))
    print('MESSY_CJK', REGEX_MESSY_CJK.test(str), 'MESSY_CJK_EXT', REGEX_MESSY_CJK_EXT.test(str))
    print('OnlyChinese', strOnlyChinese(str), 'OnlyJapanese', strOnlyJapanese(str))
    print('OnlyJpHan', strOnlyJapaneseHan(str), 'MOST_USED', RE_CHARS_MOST_USED.test(str))

}

let fromStr = process.argv[2]
// fromStr = '\u8c4c\uff74\u9039\u0080\u8ff9\u6a23\uff76\uff74'
// fromStr = '\u0030\u0036\u0033\u002e\u8782\u0080\u0032'
const results = fixMessyChars(fromStr)
results.forEach(showStatus)
console.log()
console.log('INPUT:', [fromStr])
console.log('OUPUT:', results.pop())

// const data = await fs.readFile(process.argv[2], { encoding: 'utf8' })
// const lines = data.split('\r\n')
// for (const textLine of lines) {
//     if (textLine.startsWith('├─')) {
//         console.log(textLine)
//     } if (REGEX_MESSY_CJK.test(textLine)) {
//         console.log(textLine)
//     }
//     if (/\ufffd/.test(textLine)) {
//         console.log(textLine)
//     }
//     // if (hasBadUnicode(textLine) && !textLine.includes('?')) {
//     //     console.log(textLine)
//     //     console.log(checkBadUnicode(textLine))
//     // }
// }
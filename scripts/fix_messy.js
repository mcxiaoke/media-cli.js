
import path from 'path';
import { REGEX_MESSY_CJK, REGEX_MESSY_CJK_EXT, REGEX_MESSY_UNICODE, checkBadUnicode, fixCJKEncImpl, hasBadUnicode } from '../lib/encoding.js';
import { strOnlyChinese, strOnlyJapanese } from '../lib/unicode.js';




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

function showStatus(str, title = '') {
    const print = (a, b) => console.log(a.padEnd(20, ' '), b)
    console.log()
    console.log(`================ ${title} ================`)
    print('STRING', str)
    print('STRING', Array.from(str).map(c => c.codePointAt(0).toString(16)).join(' '))
    print('BadUnicode', checkBadUnicode(str))
    print('hasBadUnicode', hasBadUnicode(str))
    print('strOnlyChinese', strOnlyChinese(str))
    print('strOnlyJapanese', strOnlyJapanese(str))
    print('REGEX_MESSY_CJK', REGEX_MESSY_CJK.test(str))
    print('REGEX_MESSY_CJK_EXT', REGEX_MESSY_CJK_EXT.test(str))
    print('REGEX_MESSY_UNICODE', REGEX_MESSY_UNICODE.test(str))
}

let fromStr = process.argv[2]
// fromStr = '\u8c4c\uff74\u9039\u0080\u8ff9\u6a23\uff76\uff74'
// fromStr = '\u0030\u0036\u0033\u002e\u8782\u0080\u0032'
const results = fixMessyChars(fromStr)
const toStr = results.slice(-1)[0][0]
for (const r of results) {
    console.log(r[0], '\t\t', r.slice(1))
}
console.log()
console.log('INPUT:', [fromStr])
console.log('OUPUT:', results.pop())
showStatus(fromStr, 'fromStr')
showStatus(toStr, 'toStr')
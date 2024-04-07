
import chardet from 'chardet';
import * as log from '../lib/debug.js';
import * as enc from '../lib/encoding.js';
import * as unicode from '../lib/unicode.js';


const ENC_LIST = [
    'ISO-8859-1',
    'UTF8',
    'UTF-16',
    'GBK',
    'BIG5',
    'SHIFT_JIS',
    'EUC-JP',
    'EUC-KR',
]

export { aliases, builder, command, describe, handler };
const command = "decode <strings...>"
const aliases = ["dc"]
const describe = 'Decode text with messy or invalid chars'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya
        .positional('strings', {
            describe: 'string list to decode',
            type: 'string',
        })
        // 修复文件名乱码
        .option("from-enc", {
            alias: "f",
            type: "choices",
            choices: ['utf8', 'gbk', 'shift_jis', 'big5', 'euc-kr'],
            description: "from encoding name eg. utf8|gbk|shift_jis",
        })
        .option("to-enc", {
            alias: "t",
            type: "choices",
            choices: ['utf8', 'gbk', 'shift_jis', 'big5', 'euc-kr'],
            description: "to encoding name tg. utf8|gbk|shift_jis",
        }).po
}

const handler = async function cmdDecode(argv) {
    const logTag = "cmdDecode";
    log.info(logTag, 'Args:', argv);
    const strArgs = argv.strings;
    if (strArgs?.length === 0) {
        throw new Error(`text input required`);
    }
    const fromEnc = argv.fromEnc?.length > 0 ? [argv.fromEnc] : ENC_LIST;
    const toEnc = argv.toEnc?.length > 0 ? [argv.toEnc] : ENC_LIST;
    const threhold = log.isVerbose() ? 1 : 50;
    log.show(logTag, `Input:`, strArgs)
    log.show(logTag, `fromEnc:`, JSON.stringify(fromEnc))
    log.show(logTag, `toEnc:`, JSON.stringify(toEnc))

    for (const str of strArgs) {
        log.show(logTag, 'TryDecoding:', [str])
        const results = decodeText(str, fromEnc, toEnc, threhold)
        results.forEach(showResults)
        log.show('INPUT:', [str, str.length],)
        log.show('OUPUT:', results.pop())
        console.log()
    }
}

function decodeText(str, fromEnc = ENC_LIST, toEnc = ENC_LIST, threhold = 50) {
    let results = enc.tryDecodeText(str, fromEnc, toEnc, threhold)
    return results.reverse()
}

function showResults(r) {
    log.info(`-`)
    const str = r[0]
    const print = (a, b) => log.info(a.padEnd(16, ' '), b)
    log.show('Result:', str.padEnd(16, ' '), r.slice(1))
    let cr = chardet.analyse(Buffer.from(str))
    cr = cr.filter(ct => ct.confidence >= 70)
    cr?.length > 0 && print('Encoding', cr)
    print('String', Array.from(str))
    print('Unicode', Array.from(str).map(c => c.codePointAt(0).toString(16)))
    const badUnicode = enc.checkBadUnicode(str)
    badUnicode?.length > 0 && log.info(`badUnicode=true`)
    log.info(`MESSY_UNICODE=${enc.REGEX_MESSY_UNICODE.test(str)}`,
        `MESSY_CJK=${enc.REGEX_MESSY_CJK.test(str)}`,
        `MESSY_CJK_EXT=${enc.REGEX_MESSY_CJK_EXT.test(str)}`)
    log.info(`OnlyJapanese=${unicode.strOnlyJapanese(str)}`,
        `OnlyJpHan=${unicode.strOnlyJapaneseHan(str)}`,
        `HasHiraKana=${unicode.strHasHiraKana(str)}`
    )
    log.info(`HasHangul=${unicode.strHasHangul(str)}`,
        `OnlyHangul=${unicode.strOnlyHangul(str)}`)
    log.info(`HasChinese=${unicode.strHasChinese(str)}`,
        `OnlyChinese=${unicode.strOnlyChinese(str)}`,
        `OnlyChn3500=${enc.RE_CHARS_MOST_USED.test(str)}`)
}
import iconv from 'iconv-lite';
import { strHasHiraKana } from '../lib/unicode.js';
import { CHINESE_CHARS_7000 } from '../lib/unicode_data.js';


// https://github.com/bnoordhuis/node-iconv/
const ENC_LIST = [
    'ISO-8859-1',
    'UTF8',
    'UTF-16',
    'GBK',
    'SHIFT_JIS',
    'EUC-JP',
    'CP949',
    'EUC-KR',
    'KOI8-R',
    'KOI8-U',
    'KOI8-RU',
]


const JAPANESE_KANA = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖゝゞゟァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶヷヸヹヺーヽヾヿ'
const REGEX_INVALID_CJK = /[値倫倰倲倴倿偀偁偂偄偅偆偉偊偋偍偐偑偒偓偔偖偗偘偙偛偝偞偟偠偡偢偣偤偦偧偨偩偪偫偭偮偯偰偱偳側偵偸偹偺偼偽傁傂傃傄傆傇傉傊傋傌傎傏傐傑傒傓傔傕傖傗傘備傚傛傜傝傞傟傠傡傢傤傦傪傫傽傾傿僀僁僂僃僄僅僆僈僉僊僋僌働僎僐僑僒僓僔僕僗僘僙僛僜僝僞僟僠僡僢僣僤僥僨僩僪僫僯僱僲僴僶僷僸價僺僼僽僾僿儀儁儂儃億儅儈儉儊儌儍儎儏儐儑儓儔儕儖儗儘儙儚儛儜儝儞償儠儢儤儦儨優儬儮儰儲儴儶儸儺儼儽儾囥夈嬨嶃忋戙撱曘椼欍涖濄熴銇銈銉僼儕乕僫嫮惂庬晅偗漶囹芑苈蓴瑣糀瑩椹楝愛]/u

const REGEX_INVALID_UNICODE = /[\u00a0-\u00bf\u00c0-\u017f\u0400-\u1cff\u2000-\u206f\u2500-\u257f\u0e00-\u0e7f\u3400-\u4dbf\uac00-\ud7af\ufff0-\uffff]/u

function charUnique(str) {
    return String.prototype.concat.call(...new Set(str));
}

// \u7b80\u5355\u4e71\u7801\u6062\u590d\u653b\u7565
const s0 = '简单乱码恢复攻略'
// \u50fc\u5115\u4e55\u50eb\u5aee\u60c2\u5eac\u6645\u5057
const s1 = '僼儕乕僫嫮惂庬晅偗'
// \u30d5\u30ea\u30fc\u30ca\u5f37\u5236\u7a2e\u4ed8\u3051
const s2 = 'フリーナ強制種付け'
const s3 = 'J仠儌僨儖傢偐傜偣両 偍傑偲傔 價僉僯偺傒 儊僗僈僉JC 0001'


// && !REGEX_INVALID_UNICODE.test(strDecoded)
// && !REGEX_INVALID_CJK.test(strDecoded)

function fixJapaneseEncoding() {
    console.log(`${"FromEncoding".padEnd(16, ' ')}${"ToEncoding".padEnd(16, ' ')}${"ResultString".padEnd(40, ' ')}Comment`)
    for (const enc1 of ENC_LIST) {

        for (const enc2 of ENC_LIST) {
            try {
                const strBuffer = iconv.encode(s3, enc1)
                const strDecoded = iconv.decode(strBuffer, enc2)
                if (!strDecoded?.includes('?')
                    && !REGEX_INVALID_UNICODE.test(strDecoded)
                    && !REGEX_INVALID_CJK.test(strDecoded)
                ) {
                    console.log(`${enc1.padEnd(16, ' ')}${enc2.padEnd(16, ' ')}${strDecoded.padEnd(40, ' ')}`, strHasHiraKana(strDecoded))
                }
            } catch (error) {
                // console.log('??????')
            }
        }
    }
}

function test2() {
    const s1d = iconv.decode(iconv.encode(s1, "gbk"), 'shift_jis')
    const s2d = iconv.decode(iconv.encode(s2, "shift_jis"), 'gbk')
    console.log(s1d)
    console.log(s2d)
    console.log(s1 === s2d, s2 === s1d)
}

function test3() {
    const c7000 = CHINESE_CHARS_7000
    const chars = '漶囹芑苈蓴瑣糀瑩椹楝愛城病堡'
    const valid = []
    for (const c of chars) {
        if (!CHINESE_CHARS_7000.includes(c)) {
            valid.push(c)
        }
    }
    console.log(valid.join(''))
}

fixJapaneseEncoding()
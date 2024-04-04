import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fixCJKEncImpl, REGEX_MESSY_CJK } from '../lib/encoding.js';
import { strOnlyChinese, strOnlyJapanese } from '../lib/unicode.js';
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

function charUnique(str) {
    return (String.prototype.concat.call(...new Set(str))).split('').sort((a, b) => a.localeCompare(b)).join('');
}

function fixEnc(str) {
    const results = fixCJKEncImpl(str, ENC_LIST, ENC_LIST)
    console.log('-------------------')
    for (const entry of results) {
        console.log(entry.join(' '))
    }
    console.log('INPUT:', [str])
    console.log('OUPUT:', results[0])
}

function normalizeChars() {
    const c7000 = CHINESE_CHARS_7000
    const c3500 = CHINESE_CHARS_3500
    const chars = REGEX_MESSY_CJK + ''
    const valid = []
    for (const c of chars) {
        if (!c3500.includes(c) && !/[\s]+/u.test(c)) {
            valid.push(c)
        }
    }
    let sb = valid.join('').replaceAll(/[\u0001-\u3fff\uffe0-\uffff\p{ASCII}\p{sc=Kana}\p{sc=Hira}]/ugi, '')
    sb = sb.replaceAll(/\s+/gi, '')
    sb = charUnique(sb)
    if (chars !== sb) {
        console.log('messy chars changed:', sb.length)
        fs.writeFileSync(path.join(os.tmpdir(), 'mediac_messy_chars.txt'), sb)
    }

}

normalizeChars()

let soj = strOnlyJapanese;
let soc = strOnlyChinese;

/*
示例
如果转换结果里有问号？，说明有字节丢失，无法无损还原
字符串 阿戈魔AGM
'飩\ue6bf袈귩䆔䵇' s.encode('utf8').decode('utf16')
'é˜¿æˆˆé\xad”AGM' s.encode('utf8').decode('cp1252')
'髦ｿ謌磯ｭ尿GM' s.encode('utf8').decode('shift_jis')
'闃挎垐榄擜GM' s.encode('utf8').decode('gbk')
'垻滣杺AGM' s.encode('shift_jis').decode('gbk')
'ˆ¢œ÷–‚AGM' s.encode('shift_jis').decode('cp1252')
'°¢¸êÄ§AGM' s.encode('gbk').decode('cp1252')
'陝資藹AGM' s.encode('gbk').decode('big5')
*/

let messyStr = ''
messyStr = '關梧眠逕ｻ貂｣'
messyStr = '雋槫ｽｱ(Sadakage)'
messyStr = '2024-02-13 05-502024.2 灏忕箶1'
messyStr = '2023-10-31 21-54 [clip锛弍sd]GRID TECTOR 鍏姳'
messyStr = 'GRID TECTOR讎句｣ｴJPG蟐怜ｔ'
messyStr = '讎句｣ｴ蛛ｺ蟄句｣灘ｪ怜ｔ蟠悟い蛛｣'
messyStr = '2022-11-10-郤ｳ隘ｿ螯ｲ-4739248'
messyStr = '灏兼捣涔冲ご鍘讳簡'
messyStr = '蜊｡螟ｫ蜊｡'
messyStr = '閧我ｸ晉沿'
messyStr = '髮ｷ逾櫁｣ｸ1'
messyStr = '蜈ｨ陬ｸ4'
messyStr = '闔ｫ螽懈ｹｿ霄ｫ'
messyStr = '遐らｳ也區濶ｲ'
messyStr = '遐らｳ夜ｻ題牡'
messyStr = '闔ｫ螽懈焔驕ｮ謖｡1K'
messyStr = '闔ｫ螽廱K'
messyStr = '貂ｩ霑ｪ2023.2.22'
messyStr = '遉ｾ逡應ｺ秘ヮ'
messyStr = '灏兼捣涔冲ご鍘讳簡'
messyStr = '灏兼捣涔冲ご鍘讳簡涔虫眮'
messyStr = '逵ｼ鄂ｩ菴捺ｶｲ'
messyStr = '逵ｼ鄂ｩ閭ｸ雍ｴK'
messyStr = '蜴ｻ豌ｴ謇区恪K'
messyStr = '逵溽ｩｺ'
messyStr = '鬥呵拷蟾ｫ螂ｳ' //香草巫女
messyStr = '濶ｲ髦ｿ陌取藻霍､'
messyStr = '霎ｾ蟆碑ｾｾ蟆ｼ螟ｮ'
messyStr = '蜿ｯ辷ｱ蝟ｵ'
messyStr = '鬚ｨ髻ｳ'
messyStr = '.澹涘眴 .壛屆廋惓'
messyStr = '隗｣豈奪'
messyStr = '鐒￠槻鍌欙紵'
messyStr = '灞嬩笂'
messyStr = '蜈育函' // 先生
messyStr = '遨ｹ'
messyStr = '鍵山雛'
messyStr = '澶溿兓閮ㄥ眿'
messyStr = '扇風機'
messyStr = '瀹呴厤'
messyStr = '鮴呵拷'
messyStr = '鬯ｼ驥晁拷 2023.01.23'
messyStr = '閫叉崡'
messyStr = '闃挎垐榄擜GM'
messyStr = '垻滣杺AGM'
messyStr = '2024-01-11 11-26鄒主ｰ大･ｳpsd貅先枚莉ｶ'
messyStr = '闍ｱ莉吝ｺｧ'
messyStr = '闔ｱ闔守正ﾂｷ譁ｯ謇倡音'


if (process.argv.length > 2) {
    fixEnc(process.argv[2])
} else {
    fixEnc(messyStr)
}
let aa = [], bb = [], cc = []
for (let i = 0; i < messyStr.length; i++) {
    aa.push(messyStr.charAt(i))
}
for (let i = 0; i < messyStr.length; i++) {
    bb.push(strOnlyChinese(messyStr.charAt(i)) ? 1 : 0)
}
for (let i = 0; i < messyStr.length; i++) {
    cc.push(strOnlyJapanese(messyStr.charAt(i)) ? 1 : 0)
}
console.log('char', aa.join(' '))
console.log('chnv', bb.join(' '))
console.log('jpnv', cc.join(' '))


console.log(REGEX_MESSY_CJK.test('鬼針草 2023.01.23'))
console.log(REGEX_MESSY_CJK.test('虍幖耒陉归 2023.01.23'))
console.log(REGEX_MESSY_CJK.test('鬯ｼ驥晁拷 2023.01.23'))


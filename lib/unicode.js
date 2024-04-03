/*
 * File: unicode.js
 * Created: 2021-07-23 10:59:48
 * Modified: 2024-03-23 11:52:56
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

//-------------------------------------------------------------------------------

// 导出一个正则表达式，用于判断字符串中是否只包含ASCII字符
export const REGEX_ASCII_ONLY = /^[\x00-\x7F]+$/; // or es2018: /^[\p{ASCII}]+$/u
/**
 * 判断给定字符串是否只包含ASCII字符
 * @param {string} str 需要进行判断的字符串
 * @returns {boolean} 如果字符串只包含ASCII字符返回true，否则返回false
 */
export const strOnlyASCII = (str) => REGEX_ASCII_ONLY.test(str);

// 导出一个正则表达式，用于判断字符串中是否包含任何ASCII字符
export const REGEX_ASCII_ANY = /[\x00-\x7F]/;
/**
 * 判断给定字符串中是否包含任何ASCII字符
 * @param {string} str 需要进行判断的字符串
 * @returns {boolean} 如果字符串中包含任何ASCII字符返回true，否则返回false
 */
export const strHasASCII = (str) => REGEX_ASCII_ANY.test(str);

//-------------------------------------------------------------------------------

// 导出一个正则表达式，用于判断字符串中是否包含日文字符
export const REGEX_JAPANESE =
  /[\u3000-\u303f]|[\u3040-\u309f]|[\u30a0-\u30ff]|[\u3400-\u4dbf]|[\u4e00-\u9fff]|[\uff00-\uff9f]/;
/**
 * 判断给定字符串中是否包含日文字符
 * @param {string} str 需要进行判断的字符串
 * @returns {boolean} 如果字符串中包含日文字符返回true，否则返回false
 */
export const strHasJapanese = (str) => REGEX_JAPANESE.test(str);

// 导出一个正则表达式，用于判断字符串中是否包含平假名或片假名
export const REGEX_HAS_HIRA_OR_KANA = /[\p{sc=Hira}]|[\p{sc=Kana}]/u;
/**
 * 判断给定字符串中是否包含平假名或片假名
 * @param {string} str 需要进行判断的字符串
 * @returns {boolean} 如果字符串中包含平假名或片假名返回true，否则返回false
 */
export const strHasHiraKana = (str) => REGEX_HAS_HIRA_OR_KANA.test(str);

// 导出一个正则表达式，用于判断字符串是否只包含平假名或片假名
export const REGEX_ONLY_HIRA_OR_KANA = /^[\p{sc=Hira}]|[\p{sc=Kana}]+$/u;
/**
 * 判断给定字符串是否只包含平假名或片假名
 * @param {string} str 需要进行判断的字符串
 * @returns {boolean} 如果字符串只包含平假名或片假名返回true，否则返回false
 */
export const strOnlyHiraKana = (str) => REGEX_ONLY_HIRA_OR_KANA.test(str);

//-------------------------------------------------------------------------------

// 正则表达式，用于匹配中文字符
export const REGEX_CHINESE =
  /[\u3400-\u4dbf]|[\u3300-\u33ff]|[\u4e00-\u9fff]|[\uf900-\ufaff]|[\ufe30-\ufe4f]/u;

/**
 * 检查字符串中是否包含中文字符
 * @param {string} str 需要检查的字符串
 * @return {boolean} 如果字符串中包含中文字符，则返回true；否则返回false。
 */
export const strHasChinese = (str) => REGEX_CHINESE.test(str);
// Hani 汉字;  Common 公用符号
// Hang Hangul 朝鲜彦文; Hira 平假名; Kana 片假名;
// 定义一个正则表达式，用于匹配包含任何Unicode汉字的字符串
export const REGEX_UNICODE_HAN_ANY = /[\p{sc=Hani}]/u;
/**
 * 检查字符串中是否包含汉字
 * @param {string} str 需要检查的字符串
 * @returns {boolean} 如果字符串中包含汉字，则返回true；否则返回false。
 */
export const strHasHani = (str) => REGEX_UNICODE_HAN_ANY.test(str);

// 定义一个正则表达式，用于匹配仅包含Unicode汉字的字符串
export const REGEX_UNICODE_HAN_ONLY = /^[\p{sc=Hani}]+$/u;
/**
 * 检查字符串是否仅由汉字组成
 * @param {string} str 需要检查的字符串
 * @returns {boolean} 如果字符串仅由汉字组成，则返回true；否则返回false。
 */
export const strOnlyHani = (str) => REGEX_UNICODE_HAN_ONLY.test(str);


//-------------------------------------------------------------------------------

// 定义一个正则表达式，用于匹配包含任何Unicode朝鲜语字符的字符串
export const REGEX_HAS_HANGUL = /[\p{sc=Hang}]/u;
/**
 * 检查字符串中是否包含朝鲜语字符
 * @param {string} str 需要检查的字符串
 * @returns {boolean} 如果字符串中包含朝鲜语字符，则返回true；否则返回false。
 */
export const strHasHangul = (str) => REGEX_HAS_HANGUL.test(str);

// 定义一个正则表达式，用于匹配仅包含Unicode朝鲜语字符的字符串
export const REGEX_ONLY_HANGUL = /^[\p{sc=Hang}]+$/u;
/**
 * 检查字符串是否仅由朝鲜语字符组成
 * @param {string} str 需要检查的字符串
 * @returns {boolean} 如果字符串仅由朝鲜语字符组成，则返回true；否则返回false。
 */
export const strOnlyHangul = (str) => REGEX_ONLY_HANGUL.test(str);

//-------------------------------------------------------------------------------

// https://zh.wikipedia.org/wiki/ISO_15924
// 匹配中英日韩俄字符和字母数字空格之外的字符 = 含有特殊字符
export const NON_CJKERA_CHARS = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}A-Za-z0-9 _\-\.]/u;
export const REGEX_HAS_NON_WORD_CHARS = NON_CJKERA_CHARS;
export const strHasNonWordChars = (str) => REGEX_HAS_NON_WORD_CHARS.test(str);
export const REGEX_ONLY_NON_WORD_CHARS =
  /^[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}A-Za-z0-9]+$/u;
export const strOnlyNonWordChars = (str) => REGEX_ONLY_NON_WORD_CHARS.test(str);


//-------------------------------------------------------------------------------

/**
 * Unicode 中文简体字符集的范围是 U+4E00 到 U+9FFF，共包括20992个字符。
 * 其中，U+4E00 到 U+62FF 是常用汉字区，
 * U+6300 到 U+77FF 是次常用汉字区，
 * U+7800 到 U+8CFF 是非常用汉字区，
 * U+8D00 到 U+9FFF 是未分类汉字区。
 * 除了汉字，这个字符集还包括了汉语拼音、注音符号、部分汉语方言文字和一些符号等。
 * 
 * 需要注意的是，Unicode 中文简体字符集并不包括繁体字。
 * 如果需要支持繁体字，可以使用 Unicode 中文繁体字符集，
 * 其范围为 U+3400 到 U+4DBF，共包括了20902个字符。
 */

/**
 *  Unicode 字符集范围
 * 
1）标准CJK文字
http://www.unicode.org/Public/UNIDATA/Unihan.html
2）全角ASCII、全角中英文标点、半宽片假名、半宽平假名、半宽韩文字母：FF00-FFEF
http://www.unicode.org/charts/PDF/UFF00.pdf
3）CJK部首补充：2E80-2EFF
http://www.unicode.org/charts/PDF/U2E80.pdf
4）CJK标点符号：3000-303F
http://www.unicode.org/charts/PDF/U3000.pdf
5）CJK笔划：31C0-31EF
http://www.unicode.org/charts/PDF/U31C0.pdf
6）康熙部首：2F00-2FDF
http://www.unicode.org/charts/PDF/U2F00.pdf
7）汉字结构描述字符：2FF0-2FFF
http://www.unicode.org/charts/PDF/U2FF0.pdf
8）注音符号：3100-312F
http://www.unicode.org/charts/PDF/U3100.pdf
9）注音符号（闽南语、客家语扩展）：31A0-31BF
http://www.unicode.org/charts/PDF/U31A0.pdf
10）日文平假名：3040-309F
http://www.unicode.org/charts/PDF/U3040.pdf
11）日文片假名：30A0-30FF
http://www.unicode.org/charts/PDF/U30A0.pdf
12）日文片假名拼音扩展：31F0-31FF
http://www.unicode.org/charts/PDF/U31F0.pdf
13）韩文拼音：AC00-D7AF
http://www.unicode.org/charts/PDF/UAC00.pdf
14）韩文字母：1100-11FF
http://www.unicode.org/charts/PDF/U1100.pdf
15）韩文兼容字母：3130-318F
http://www.unicode.org/charts/PDF/U3130.pdf
16）太玄经符号：1D300-1D35F
http://www.unicode.org/charts/PDF/U1D300.pdf
17）易经六十四卦象：4DC0-4DFF
http://www.unicode.org/charts/PDF/U4DC0.pdf
18）彝文音节：A000-A48F
http://www.unicode.org/charts/PDF/UA000.pdf
19）彝文部首：A490-A4CF
http://www.unicode.org/charts/PDF/UA490.pdf
20）盲文符号：2800-28FF
http://www.unicode.org/charts/PDF/U2800.pdf
21）CJK字母及月份：3200-32FF
http://www.unicode.org/charts/PDF/U3200.pdf
22）CJK特殊符号（日期合并）：3300-33FF
http://www.unicode.org/charts/PDF/U3300.pdf
23）装饰符号（非CJK专用）：2700-27BF
http://www.unicode.org/charts/PDF/U2700.pdf
24）杂项符号（非CJK专用）：2600-26FF
http://www.unicode.org/charts/PDF/U2600.pdf
25）中文竖排标点：FE10-FE1F
http://www.unicode.org/charts/PDF/UFE10.pdf
26）CJK兼容符号（竖排变体、下划线、顿号）：FE30-FE4F
http://www.unicode.org/charts/PDF/UFE30.pdf
 * 
 * 
 */
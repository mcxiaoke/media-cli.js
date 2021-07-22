// https://developer.mozilla.org/zh-CN/docs/orphaned/Web/JavaScript/Guide/Regular_Expressions/Unicode_Property_Escapes
// https://www.unicode.org/Public/UCD/latest/ucd/PropertyValueAliases.txt
// https://tc39.es/ecma262/#table-unicode-script-values
// https://developer.mozilla.org/zh-CN/docs/orphaned/Web/JavaScript/Guide/Regular_Expressions
// https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt

const REGEX_ASCII_ONLY = /^[\x00-\x7F]*$/; // or es2018: /^[\p{ASCII}]+$/u
const strOnlyASCII = (str) => REGEX_ASCII_ONLY.test(str);

const REGEX_ASCII_ANY = /[\x00-\x7F]/;
const strHasASCII = (str) => REGEX_ASCII_ANY.test(str);

const REGEX_JAPANESE =
  /[\u3000-\u303f]|[\u3040-\u309f]|[\u30a0-\u30ff]|[\uff00-\uff9f]|[\u4e00-\u9faf]|[\u3400-\u4dbf]/;
const strHasJapanese = (str) => REGEX_JAPANESE.test(str);

const REGEX_CHINESE =
  /[\u4e00-\u9fff]|[\u3400-\u4dbf]|[\u{20000}-\u{2a6df}]|[\u{2a700}-\u{2b73f}]|[\u{2b740}-\u{2b81f}]|[\u{2b820}-\u{2ceaf}]|[\uf900-\ufaff]|[\u3300-\u33ff]|[\ufe30-\ufe4f]|[\uf900-\ufaff]|[\u{2f800}-\u{2fa1f}]/u;
const strHasChinese = (str) => REGEX_CHINESE.test(str);

// Han 汉字; Hira 平假名; Kana 片假名; Common 公用符号
const REGEX_UNICODE_HAN_ANY = /[\p{sc=Han}]/u;
const strHasHan = (str) => REGEX_UNICODE_HAN_ANY.test(str);
const REGEX_UNICODE_HAN_ONLY = /^[\p{sc=Han}]+$/u;
const strOnlyHan = (str) => REGEX_UNICODE_HAN_ONLY.test(str);

const REGEX_HIRA_OR_KANA = /[\p{sc=Hira}]|[\p{sc=Kana}]/u;
const strHasHiraKana = (str) => REGEX_HIRA_OR_KANA.test(str);

const newHCN = /[\p{sc=Han}]+/u;
const newOCN = /^[\p{sc=Han}]+$/u;

const input = process.argv.slice(2);
const onlyUS = strOnlyASCII(input);
const hasUS = strHasASCII(input);
const hasJA = strHasJapanese(input);
const hasCN = strHasChinese(input);
const hasHAN = strHasHan(input);
const onlyHAN = strOnlyHan(input);
const hasHaKa = strHasHiraKana(input);

console.log("Input:", input);
console.log(
  `hasCN:${hasCN} hasHAN:${hasHAN} onlyHAN:${onlyHAN} hasJA:${hasJA} hasHaKa:${hasHaKa} hasUS:${hasUS} onlyUS:${onlyUS}`
);

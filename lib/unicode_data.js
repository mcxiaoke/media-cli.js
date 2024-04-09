/*
 * File: unicode_data.js
 * Created: 2024-04-03 18:02:38
 * Modified: 2024-04-08 22:20:34
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// 初始化 unicode 数据
const unicodeDataFile = path.join(__dirname, 'unicode_data.json')
const unicodeDataJson = JSON.parse(await fs.readFile(unicodeDataFile))

export const CHINESE_CHARS_7000 = unicodeDataJson.chinese_7000
export const CHINESE_CHARS_3500 = unicodeDataJson.chinese_3500
export const JAPANESE_HAN = unicodeDataJson.japanese_han
export const JAPANESE_KANA = unicodeDataJson.japanese_kana
// 初始化汉字笔画数据
const strokeFile = path.join(__dirname, 'words.json')
const strokeJson = JSON.parse(await fs.readFile(strokeFile))
const strokeArray = strokeJson.map(entry => [entry.word, entry.strokes])
export const HANZI_STROKE_MAP = new Map(strokeArray)
// 初始化 乱码汉字数据
const messyCharsFile = path.join(__dirname, 'messy_hanzi.txt')
const messyCharsData = await fs.readFile(messyCharsFile)
export const MESSY_CJK_CHARS = messyCharsData

//https://exploringjs.com/nodejs-shell-scripting/ch_nodejs-path.html
// import * as url from 'node:url';

// if (import.meta.url.startsWith('file:')) { // (A)
//     const modulePath = url.fileURLToPath(import.meta.url);
//     if (process.argv[1] === modulePath) { // (B)
//         console.log(CHINESE_CHARS_7000.length)
//         console.log(CHINESE_CHARS_3500.length)
//     }
// }


// if (typeof module !== 'undefined' && !module.children) {
//     console.log(CHINESE_CHARS_7000.length)
//     console.log(CHINESE_CHARS_3500.length)
// }
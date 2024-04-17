/*
 * Project: mediac
 * Created: 2024-04-16 10:25:13
 * Modified: 2024-04-16 10:25:13
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from 'fs-extra'
import path from "path"

import * as log from '../lib/debug.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

import * as enc from '../lib/encoding.js'
import * as unicode from '../lib/unicode.js'

function saveChars() {
    const unicode_chars = []

    function addChars(from, to) {
        for (let i = from; i < to; i++) {
            const c = String.fromCharCode(i)
            unicode_chars.push(c)
        }
        unicode_chars.push('\n')
    }

    addChars(0x4e00, 0x9fff)
    addChars(0xf900, 0xfadf)

    // console.log(unicode_chars.join(''))`1

    fs.writeFileSync('data/unicode_cjk.txt', unicode_chars.join(''))
}


function convertStrokeJson(jsonObj) {
    let convertedArray = []
    for (let key in jsonObj) {
        let obj = jsonObj[key]
        obj.key = key
        delete obj.strokeid_list
        convertedArray.push(obj)
    }
    convertedArray.sort((a, b) => {
        return parseInt(a.num) - parseInt(b.num)
    })

    return convertedArray
}

function sortByStroke() {
    let strokeData = fs.readJSONSync('data/chinese_char_stroke.json')
    strokeData = convertStrokeJson(strokeData)

    // 复杂汉字
    // 不包含在中日常用汉字里
    let data = strokeData.filter(e => !(unicode.HANZI_COMMON_7000.includes(e.key) || unicode.HANZI_COMMON_JAPANESE.includes(e.key)))
    // 笔画大于等于18的汉字
    let complexChars = data.filter(sd => parseInt(sd.num) >= 18).map(sd => sd.key)
    //fs.writeFileSync('data/hanzi_complex.txt', complexChars.join(''))

    // 生僻汉字
    // 不包含在中日常用汉字里
    let rarelyUsedChars = Array.from(enc.MESSY_CJK_CHARS).filter(c => !(unicode.HANZI_COMMON_7000.includes(c) || unicode.HANZI_COMMON_JAPANESE.includes(c)))
    // 不包含在复杂汉字里
    rarelyUsedChars = rarelyUsedChars.filter(c => !complexChars.includes(c))
    //fs.writeFileSync('data/hanzi_rarely.txt', rarelyUsedChars.join(''))
    console.log(strokeData.length, complexChars.length, rarelyUsedChars.length)


    //fs.writeFileSync('data/hanzi_c7000.txt', unicode.HANZI_COMMON_7000)
    //fs.writeFileSync('data/hanzi_c3500.txt', unicode.HANZI_COMMON_3500)
    //fs.writeFileSync('data/hanzi_japan.txt', unicode.HANZI_COMMON_JAPANESE)
}

sortByStroke()
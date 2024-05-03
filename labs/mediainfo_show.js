/*
 * Project: mediac
 * Created: 2024-04-20 18:07:23
 * Modified: 2024-04-20 18:07:23
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import fs from 'fs-extra'
import path from 'path'
import * as helper from '../lib/helper.js'
import { getMediaInfo, getSimpleInfo } from '../lib/mediainfo.js' // 导入您之前定义的解析器函数

// 递归遍历目录，找到所有音视频文件
function findMediaFiles(directory, mediaFiles = []) {
    const files = fs.readdirSync(directory)

    files.forEach(file => {
        const filePath = path.join(directory, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
            // 递归遍历子目录
            findMediaFiles(filePath, mediaFiles)
        } else {
            // 检查文件扩展名是否为音视频格式
            if (helper.isMediaFile(filePath)) {
                mediaFiles.push(filePath)
            }
        }
    })

    return mediaFiles
}

// 递归遍历目录，找到所有音视频文件，并获取其信息
async function showMediaFilesInfo(input) {
    const st = await fs.stat(input)
    if (st.isFile()) {
        const isAudio = helper.isAudioFile(input)
        const info = await getMediaInfo(input, { audio: isAudio })
        console.log(path.basename(input))
        info && console.log(info)
        return
    }
    let files = findMediaFiles(input)
    for (const filePath of files) {
        const isAudio = helper.isAudioFile(filePath)
        const info = await getSimpleInfo(filePath, { audio: isAudio })
        console.log(path.basename(filePath))
        info && console.log(info)
    }
}

// 示例用法
await showMediaFilesInfo(process.argv[2])

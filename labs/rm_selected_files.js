/*
 * Project: mediac
 * Created: 2024-05-16 17:25:25
 * Modified: 2024-05-16 17:25:25
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import path from "path"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"

/**
 * 计算每个目录下的文件路径列表
 * @param {string[]} filePaths - 文件绝对路径列表
 * @returns {Map} - fileListMap: Map<string, string[]>
 */
function countFilesInDirectories(filePaths) {
    const fileListMap = new Map()

    filePaths.forEach((filePath) => {
        const dirname = path.dirname(filePath)
        const basename = path.basename(filePath)
        // 判断是否有扩展名
        const isFile = path.extname(basename) !== ""
        if (isFile) {
            // 更新文件列表Map
            if (fileListMap.has(dirname)) {
                fileListMap.get(dirname).push(filePath)
            } else {
                fileListMap.set(dirname, [filePath])
            }
        }
    })

    return fileListMap
}

async function rmFiles() {
    const root = process.argv[2]
    const threhold = process.argv?.[3] || 10000
    const divide = process.argv?.[4] || 0
    const walkOpts = {
        needStats: false,
        entryFilter: (f) => helper.isImageFile(f.path),
    }
    log.showGreen("rmFiles", `Walking files ... threhold=${threhold},divide=${divide}`)
    let entries = await mf.walk(root, walkOpts)
    let filePaths = entries.map((e) => e.path)
    let map = countFilesInDirectories(filePaths)
    for (const [key, value] of map) {
        log.show(`Found [${value.length}] files in ${key}`)
        if (value.length > threhold && divide > 0) {
            let i = 0
            for (const f of value) {
                // 删除1/4文件
                if (++i % divide === 0) {
                    await helper.safeRemove(f)
                }
            }
            if (i > 0) {
                log.showGreen(`Deleted [${Math.floor(i / divide)}/${value.length}] files in ${key}`)
            }
        }
    }
}

await rmFiles()

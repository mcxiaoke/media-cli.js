/*
 * Project: mediac
 * Created: 2024-04-30 15:02:31
 * Modified: 2024-04-30 15:02:31
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { promises as fsPromises } from 'fs'
import path from 'path'

async function removeRedundantDirectories(filePath) {
    try {
        const stats = await fsPromises.stat(filePath)

        if (stats.isDirectory()) {
            const files = await fsPromises.readdir(filePath)

            if (files.length === 1) {
                const subDir = path.join(filePath, files[0])
                return await removeRedundantDirectories(subDir)
            } else {
                return filePath
            }
        } else {
            return filePath
        }
    } catch (error) {
        throw error
    }
}

// 调用函数
removeRedundantDirectories(process.argv[2] || examplePath)
    .then(resultPath => console.log(resultPath))
    .catch(error => console.error(error))

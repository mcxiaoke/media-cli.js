/*
 * File: walk.js
 * Created: 2024-03-29 15:34:51 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from "fs/promises"
import path from "path"

async function walk(root, predicate) {
    let files = await fs.readdir(root)
    files = await Promise.all(
        files.map(async (fileName) => {
            const filePath = path.join(root, fileName)
            const stats = await fs.stat(filePath)
            if (stats.isDirectory()) {
                return this.walk(filePath, predicate)
            } else if (stats.isFile() && predicate(fileName)) {
                return {
                    name: fileName,
                    path: filePath,
                    stat: stats,
                }
            }
        }),
    )

    // Filter out undefined entries before concatenating
    return files.filter(Boolean).reduce((all, folderContents) => all.concat(folderContents), [])
}

async function* walk2(dir) {
    for await (const d of await fs.promises.opendir(dir)) {
        const entry = path.join(dir, d.name)
        if (d.isDirectory()) yield* await walk(entry)
        else if (d.isFile()) yield entry
    }
}

/*
 * Project: mediac
 * Created: 2021-07-20 23:54:19 +0800
 * Modified: 2024-04-09 22:15:42 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

const fs = require("fs-extra")

const root = process.argv.slice(2)[0]
console.log(root)
console.log(fs.existsSync(root))
console.log(fs.readdirSync(root))

let files = klawSync(root, { nodir: true })
console.log(files)

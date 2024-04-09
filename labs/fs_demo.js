const fs = require("fs-extra")

const root = process.argv.slice(2)[0]
console.log(root)
console.log(fs.existsSync(root))
console.log(fs.readdirSync(root))

let files = klawSync(root, { nodir: true })
console.log(files)

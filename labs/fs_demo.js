const fs = require("fs-extra");
const path = require("path");
const klawSync = require("klaw-sync");

const root = process.argv.slice(2)[0];
console.log(root);
console.log(fs.existsSync(root));
console.log(fs.readdirSync(root));

let files = klawSync(root, { nodir: true });
console.log(files);

const path = require("path");
const fs = require("fs-extra");

async function main() {
  console.log(process.argv);
  await fs.ensureDir(process.argv.slice(2)[0]);
}

main();

import path from "path";
import { walk as __walk } from "@nodelib/fs.walk";
import * as mf from '../lib/file.js'

async function main() {
  // console.log(process.argv);
  const root = path.resolve(process.argv[2]);
  console.log(root);
  let files = await mf.walk(root);
  console.log(files.length);
  for (const f of files) {
    // console.log(f);
  }
}

main();

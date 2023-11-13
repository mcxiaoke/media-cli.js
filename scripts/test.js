import path from "path";
import fs from 'fs-extra';
import { fdir } from "fdir";
import { walk as __walk } from "@nodelib/fs.walk";
import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'
import * as tools from '../lib/tools.js'
import * as unicode from '../lib/unicode.js'

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

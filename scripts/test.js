import path from "path";
import fs from 'fs-extra';
import { readdir } from 'node:fs/promises';
import { promisify } from 'util';
import chardet from 'chardet';
import { walk as __walk } from "@nodelib/fs.walk";
import * as mf from '../lib/file.js'

async function main() {
  // console.log(process.argv);
  const root = path.resolve(process.argv[2]);
  console.log(root);
  const afiles = await readdir(root)
  for (const f of afiles) {
    // const encoding = chardet.detect(Buffer.from(f));
    const sd = path.resolve(path.join(root, f));
    // console.log(sd, encoding);
    for (const f2 of await readdir(sd)) {
      console.log(path.join(sd, f2));
    }
  }
  let files = await promisify(__walk)(root);
  // let files = await mf.walk(root);
  for (const f of files) {
    console.log(f);
  }
}

main();

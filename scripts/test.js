import * as fsWalk from '@nodelib/fs.walk'
import chardet from 'chardet'
import { fdir } from "fdir"
import fs from 'fs-extra'
import { readdir } from 'fs/promises'
import path from "path"
import { promisify } from 'util'
import * as mf from '../lib/file.js'


async function* walk_a(dir) {
  const dirents = await readdir(dir, { withFileTypes: true })
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name)
    if (dirent.isDirectory()) {
      yield* walk_a(res)
    } else {
      yield res
    }
  }
}

async function main() {
  // console.log(process.argv);
  const root = path.resolve(process.argv[2])
  console.log(root)
  // const afiles = await readdir(root)
  // for (const f of afiles) {
  //   // const encoding = chardet.detect(Buffer.from(f));
  //   const sd = path.resolve(path.join(root, f));
  //   // console.log(sd, encoding);
  //   for (const f2 of await readdir(sd)) {
  //     console.log(path.join(sd, f2));
  //   }
  // }
  console.time("walk3")
  let files3 = await mf.walk(root)
  console.timeEnd("walk3")
  console.time("walk1")
  let files1 = await promisify(fsWalk.walk)(root, new fsWalk.Settings({
    stats: true
  }))
  console.timeEnd("walk1")
  console.time("walk2")
  let files2 = await new fdir().withFullPaths().filter(async (fPath, isDir) => {
    const st = await fs.stat(fPath)
    return true
  }).crawl(root).withPromise()
  console.timeEnd("walk2")
  // walk3: 9.977s
  // walk1: 12.729s
  // walk2: 11.342s
}

main()

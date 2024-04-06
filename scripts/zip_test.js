import AdmZip from 'adm-zip';
import chalk from 'chalk';
import chardet from 'chardet';
import { sify } from 'chinese-conv';
import fs from 'fs-extra';
import iconv from 'iconv-lite';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import { promisify } from 'util';
import { asyncFilter } from '../lib/core.js';
import * as log from '../lib/debug.js';
import * as enc from '../lib/encoding.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

let defaultEncoding = 'shift_jis'

let index = 0
const decodeNameFunc = (nameRaw) => {
    const buf = Buffer.from(nameRaw, 'binary')
    let cr = chardet.analyse(buf)
    // console.log(cr)
    cr = cr.filter(item => item.lang && item.confidence > 90 && !item.name.startsWith('ISO'))
    const encoding = cr && cr.length > 0 ? cr[0].name : defaultEncoding
    const name = iconv.decode(buf, encoding)
    console.log(name, encoding, buf.length, name?.length ?? -1, ++index)
    return name
}

async function zipTest(file) {
    const parts = path.parse(file)
    const baseName = parts.name;
    const rootDir = parts.dir
    const zipDir = path.join(rootDir, baseName)
    console.log('Output', zipDir)
    try {
        const zip = new AdmZip(file);
        const zipEntries = zip.getEntries();
        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue;
            }
            console.log('================================')
            // console.log(entry.toString())
            const fileName = decodeNameFunc(entry.rawEntryName);
            const fileNameParts = path.parse(fileName)

            const fileDstDir = path.join(zipDir, fileNameParts.dir)
            const fileDstPath = path.join(fileDstDir, fileNameParts.base)
            // console.log(`fileName`, fileNameParts)
            console.log(`fileDstDir ${fileDstDir}`)
            console.log(`fileDstPath ${fileDstPath}`)
            const data = entry.getData();
            console.log(data.length)
            if (!await fs.pathExists(fileDstDir)) {
                await fs.mkdir(fileDstDir, { recursive: true })
            }
            await fs.writeFile(fileDstPath, data)
        }
    } catch (error) {
        console.log(error)
    }
}

console.log(process.argv)
const root = process.argv[2]
defaultEncoding = process.argv[3] || defaultEncoding
await zipTest(root)

if (1 === 1) {
    process.exit(1);
}

let files = await mf.walk(root, {
    needStats: true,
    entryFilter: (entry) => entry.name.endsWith(".zip")
});
for (const file of files) {
    await zipTest(file.path)
}

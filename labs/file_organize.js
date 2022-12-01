#!/usr/bin/env node
const path = require("path");
const fs = require("fs-extra");
const dayjs = require('dayjs');
const { walk } = require("../lib/file");
const log = require("../lib/debug");
// debug and logging config
const prettyError = require("pretty-error").start();
prettyError.skipNodeFiles();

const pick = (obj, keys) => Object.keys(obj).filter(k => keys.includes(k)).reduce((res, k) => Object.assign(res, { [k]: obj[k] }), {});

function divideIntoChunks(arr, chunkSize) {
    const res = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);
        res.push(chunk);
    }
    return res;
}

const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
console.log(divideIntoChunks(arr, 3));

async function organize_files() {
    log.show(process.argv.slice(2));
    const input = process.argv.slice(2)[0];
    const output = process.argv.slice(2).length >= 2 ? process.argv.slice(2)[1] : input
    log.show(`Input:\t\t${input}`);
    log.show(`Output:\t\t${output}`);
    const date = dayjs().format('YYYYMMDD_HHmmss')
    log.show(date)
    const logfile = path.join(path.dirname(output), `log_${date}.txt`);
    // 读取所有文件列表
    let files = await walk(input);
    log.show('all files count=' + files.length)
    // 按修改日期排序
    files = files.sort((a, b) => a.mtime - b.mtime)
    // 按文件个数分组
    let groups = divideIntoChunks(files, 2000);
    const log_lines = []
    let moved_total = 0;
    for (const [i, v] of groups.entries()) {
        const group_name = String(i).padStart(4, '0')
        const group_dir = path.join(output, group_name)
        log_lines.push(logfile, '======================================================');
        log_lines.push(logfile, "DIR " + group_dir);
        log.show(`Moving ${v.length} files to ${group_dir}`)
        let moved = 0
        try {
            for (const f of v) {
                const name = f.name.replace(/\[\d+\]_/, '');
                log_lines.push(`---- ${name} @(${f.path})`)
                const src = f.path
                const dst = path.join(group_dir, name)
                if (!await fs.pathExists(dst)) {
                    //log.show(`Move ${src} to ${dst}`)
                    await fs.move(src, dst);
                    moved++;
                }
            }
        } catch (error) {
            log.error(error)
            break
        }
        moved_total += moved;
        log.show(`Moved ${moved}/${moved_total} files to ${group_dir}`)
    }
    await fs.writeFile(logfile, log_lines.join('\n'))
    console.log(logfile)
    log.show(dayjs().format())
}

async function save_all_filename() {
    log.show(dayjs().format())
    const date = dayjs().format('YYYYMMDD_HHmmss')
    const root = process.argv.slice(2)[0];
    const idfile = path.join(path.dirname(root), `all_ids_${date}.txt`);
    const namefile = path.join(path.dirname(root), `all_filenames_${date}.txt`);
    let files = await walk(root);
    for (const f of files) {
        const n = path.parse(f.name).name.replace(/\[\d+\]_/, '')
        await fs.appendFile(namefile, f.name + '\n', { encoding: 'utf8' })
        await fs.appendFile(idfile, n + '\n', { encoding: 'utf8' })
    }
    console.log(idfile)
    log.show(dayjs().format())
}

organize_files()
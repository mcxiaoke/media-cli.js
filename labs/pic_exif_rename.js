#!/usr/bin/env node

// We're using the singleton here for convenience:
// const exiftool = require("exiftool-vendored").exiftool;
const exifr = require('exifr')
const fs = require('fs');
const path = require('path');
const strftime = require(path.resolve(__dirname, "strftime.js"));

// console.log(process.argv);
if (process.argv.length < 3) {
    const nd = path.basename(process.argv[0]) // node path
    const st = path.basename(process.argv[1]) // script path
    console.log('No path args:', nd, st, '[source path]')
    process.exit(1)
    return
}

const sourcePath = process.argv[2];
const fileNames = fs.readdirSync(sourcePath);
const filePaths = fileNames.map(x => path.join(sourcePath, x)).filter(x => fs.existsSync(x) && fs.lstatSync(x).isFile());
// filePaths.forEach(x => console.log(x));

let options = { ifd0: true, exif: ['Model', , 'DateTimeOriginal', 'OffsetTimeOriginal'] }

let RAW_FORMATS = ['.arw', '.nef', 'nrw', '.cr2', '.cr3', '.dng']
let IMG_FORMATS = ['.jpg', '.jpeg', '.png', '.tiff', '.heif', '.heic']
let IMG_NAME_DATE_TIME = 'IMG_%Y%m%d_%H%M%S'
let RAW_NAME_DATE_TIME = 'DSC_%Y%m%d_%H%M%S'

async function exif_rename(files) {
    for (const x of files) {
        const oldName = path.basename(x)
        const oldExt = path.extname(oldName).toLowerCase()
        if (!RAW_FORMATS.includes(oldExt) && !IMG_FORMATS.includes(oldExt)) {
            console.log('[ERROR] Not Image:', oldName)
            continue
        }
        const format = RAW_FORMATS.includes(oldExt.toLowerCase()) ? RAW_NAME_DATE_TIME : IMG_NAME_DATE_TIME
        let tags = await exifr.parse(x, options)
        if (!tags) {
            console.log('[ERROR] No EXIF:', oldName)
            continue
        }
        if (!tags.hasOwnProperty('DateTimeOriginal')) {
            console.log('[ERROR] No DateTime:', oldName)
            continue
        }
        const dt = new Date(tags.DateTimeOriginal)
        const newBase = strftime(format, dt)
        var newName = `${newBase}${oldExt}`
        var y = path.join(sourcePath, newName)
        if (newName == oldName) {
            // check no need to rename
            console.log('Skip[1]:', oldName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
            continue
        }
        if (fs.existsSync(y)) {
            // new name duplicate, add suffix
            const numMatch = oldName.match(/\d+/)
            const numName = numMatch && numMatch[0] || 1
            newName = `${newBase}_${numName}${oldExt}`
            y = path.join(sourcePath, newName)
        }
        if (newName == oldName) {
            // check no need to rename with suffix
            console.log('Skip[2]:', oldName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
            continue
        }
        console.log(oldName, "=>", newName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
        fs.renameSync(x, y)
    }
}

function exif_rename_old(files) {
    files.forEach(x => {
        exifr.parse(x, options).then(tags => {
            const oldName = path.basename(x)
            const oldExt = path.extname(oldName)
            const format = RAW_FORMATS.includes(oldExt.toLowerCase()) ? RAW_NAME_DATE_TIME : IMG_NAME_DATE_TIME
            const dt = new Date(tags.DateTimeOriginal)
            const newBase = strftime(format, dt)
            var newName = `${newBase}${oldExt}`
            var y = path.join(sourcePath, newName)

            if (newName == oldName) {
                // check no need to rename
                console.log('Skip[1]:', oldName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
            } else {
                if (fs.existsSync(y)) {
                    // new name duplicate, add suffix
                    const numMatch = oldName.match(/\d+/)
                    const numName = numMatch && numMatch[0] || 1
                    newName = `${newBase}_${numName}${oldExt}`
                    y = path.join(sourcePath, newName)
                }
                if (newName == oldName) {
                    // check no need to rename with suffix
                    console.log('Skip[2]:', oldName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
                } else {
                    console.log(oldName, "=>", newName, tags.DateTimeOriginal, tags.OffsetTimeOriginal || 0)
                    fs.renameSync(x, y)
                }
            }
        })
    })
}

exif_rename(filePaths).then(x => console.log('Exif Rename Task Done'))

// (async () => {
//     console.log('before start');

//     await exif_rename(filePaths);

//     console.log('after start');
// })();

// filePaths.forEach(x => {
//     exiftool.read(x).then(tags => {
//         console.log(tags.DateTimeOriginal);
//     })
// })
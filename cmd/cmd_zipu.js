/*
 * File: cmd_zipu.js
 * Created: 2024-04-06 21:00:04 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import AdmZip from 'adm-zip'
import chalk from 'chalk'
import chardet from 'chardet'
import fs from 'fs-extra'
import iconv from 'iconv-lite'
import inquirer from 'inquirer'
import path from 'path'
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

export { aliases, builder, command, describe, handler }
const command = 'zipu <input> [output]'
const aliases = ['zipunicode']
const describe = 'Smart unzip command (auto detect encoding)'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya// 仅处理符合指定条件的文件，包含文件名规则
        // 修复文件名乱码
        .option('encoding', {
            alias: 'e',
            type: 'string',
            default: 'SHIFT_JIS',
            description: 'use this encoding foe zip filenames'
        })
        // 强制解压，覆盖之前的文件
        .option('override', {
            alias: 'o',
            type: 'boolean',
            default: false,
            description: 'force unzip, override existting files'
        })
        // 繁体转简体
        .option('tcsc', {
            alias: 't',
            type: 'boolean',
            default: false,
            description: 'convert Chinese from TC to SC'
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option('doit', {
            alias: 'd',
            type: 'boolean',
            default: false,
            description: 'execute os operations in real mode, not dry run'
        })
}

const handler = async function cmdZipUnicode(argv) {
    const testMode = !argv.doit
    const logTag = 'ZipU'
    log.info(logTag, argv)
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`)
    }
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }
    const startMs = Date.now()
    log.show(logTag, `Input: ${root}`)
    // 只包含ZIP文件
    let files = await mf.walk(root, {
        needStats: true,
        entryFilter: (entry) =>
            entry.stats.isFile() &&
            helper.pathExt(entry.name) === '.zip'
    })
    files = files.map((f, i) => {
        return {
            ...f,
            argv,
            index: i,
            total: files.length,
            encoding: argv.encoding,
            override: argv.override || false
        }
    })
    log.show(logTag, `Total ${files.length} zip files found in ${helper.humanTime(startMs)}`)
    log.show(logTag, argv)
    const showFiles = files.slice(-200)
    for (const f of showFiles) {
        log.show(logTag, 'File:', helper.pathShort(f.path), helper.humanSize(f.stats.size))
    }
    if (showFiles.length < files.length) {
        log.show(logTag, `Above lines are last 200 files, total ${files.length} files.}`)
    }
    testMode && log.showYellow('++++++++++ TEST MODE (DRY RUN) ++++++++++')
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Are you sure to unzip these ${files.length} files?`
            )
        }
    ])
    if (answer.yes) {
        let results = []
        for (const f of files) {
            results.push(await UnzipOneFile(f, testMode))
        }
        results = results.filter(Boolean)
        testMode && log.showYellow(logTag, 'NO file unzipped in TEST MODE.')
        log.showGreen(logTag, `There were ${results.length} files unzipped.`)
    } else {
        log.showYellow(logTag, 'Will do nothing, aborted by user.')
    }
}

async function UnzipOneFile(f, testMode = true) {
    const ipx = `${f.index}/${f.total}`
    const logTag = 'ZipU'
    const zipFilePath = f.path
    const zipFileName = path.basename(zipFilePath)
    const zipFileSize = (await fs.stat(zipFilePath)).size ?? 0
    const parts = path.parse(zipFilePath)
    const zipDir = path.join(parts.dir, parts.name)
    log.show(logTag, `Unzip: ${ipx} <${helper.pathShort(zipFilePath)}> (${helper.humanSize(zipFileSize)}) ${testMode} ${f.override}`)
    // 检查解压目录是否已存在，是否已解压
    if (await fs.pathExists(zipDir)) {
        // 强制覆盖，删除旧目录
        if (f.override) {
            log.showYellow(logTag, `Override Exists: <${zipDir}>`)
            !testMode && await helper.safeRemove(zipDir)
        } else {
            const zipDirSize = await mf.getDirectorySizeR(zipDir)
            log.info(logTag, `Exists: <${zipDir}> ${helper.humanSize(zipDirSize)}`)
            // 解压后的目录大于zip文件大小，认为解压成功，忽略
            if (zipDirSize >= zipFileSize - mf.FILE_SIZE_1M) {
                log.showYellow(logTag, `Skip Exists: <${zipDir}> ${helper.humanSize(zipDirSize)}`)
                return
            }
        }
    }
    let badNameFound = false
    try {
        const decodedNameMap = new Map()
        const zip = new AdmZip(zipFilePath)
        const zipEntries = zip.getEntries()

        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue
            }
            // 解码后的文件名，确保无乱码
            const { fileName, encoding, badName } = decodeNameSmart(entry.rawEntryName, f.encoding)
            if (badName) {
                badNameFound = true
                log.showYellow(logTag, `Unzip BadName: ${ipx} <${zipFileName}> <${fileName}> [${encoding}]`)
            } else {
                decodedNameMap.set(entry.rawEntryName, { fileName, encoding })
            }
        }

        if (badNameFound) {
            log.showYellow(logTag, `Unzip Skipped:  ${ipx} File:<${zipFilePath}> Reason: Some entries have bad names.`)
            return
        }

        if (testMode) {
            log.showYellow(logTag, `Unzip Skipped:  ${ipx} File:<${zipFilePath}> Reason: [Test Mode].`)
            return
        }

        let unzippedCount = 0
        const unzippedFiles = []
        const entryCount = zipEntries.length
        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue
            }
            ++unzippedCount
            const epx = `${unzippedCount}/${entryCount}`
            // 解码后的文件名，确保无乱码
            // const { fileName, encoding, badName } = decodeNameSmart(entry.rawEntryName, f.encoding)
            const { fileName, encoding } = decodedNameMap.get(entry.rawEntryName)
            const fileNameParts = path.parse(fileName)
            const dstDir = path.join(zipDir, fileNameParts.dir)
            const dstFile = path.join(dstDir, fileNameParts.base)
            log.info(logTag, `DstDir: ${epx} <${dstDir}>`)
            log.info(logTag, `DstFile: ${epx} <${dstFile}>`)
            if (!await fs.pathExists(dstDir)) {
                await fs.mkdir(dstDir, { recursive: true })
            }
            if (await fs.pathExists(dstFile)) {
                log.showGray(logTag, `Skip: ${epx} <${helper.pathShort(dstFile)}> [${encoding}]`)
            } else {
                const data = entry.getData()
                await fs.writeFile(dstFile, data)
                log.show(logTag, `Entry: ${epx} <${helper.pathShort(dstFile)}> [${encoding}]`)
            }
            unzippedFiles.push(dstFile)
        }
        if (unzippedCount === unzippedFiles.length) {
            f.done = true
            f.unzipped = unzippedFiles
            log.info(logTag, `Unzipped ${ipx} SRC:<${zipFilePath}>`)
            log.showGreen(logTag, `Unzipped ${ipx} DST:<${helper.pathShort(zipDir)}>`)
            log.fileLog(`Unzipped ${ipx} <${zipFilePath}>`, logTag)
            return f
        } else {
            // 解压失败，删除解压目录
            await helper.safeRemove(zipDir)
            log.showRed(logTag, `Failed ${ipx} <${helper.pathShort(zipFilePath)}>`)
        }
    } catch (error) {
        log.warn(logTag, zipFilePath, error)
    }
}

const INOGRE_ENCODING = ['Big5', 'ASCII', 'windows-1251', 'ISO-8859-1']
const TRY_ENCODING = [
    'GBK',
    'SHIFT_JIS',
    'UTF8',
    'BIG5',
    'CP949',
    'EUC-KR'
]
// 添加一个缓存，避免重复解析
const decodedNameCache = new Map()
// 智能解析文件， 如果发现乱码，就按编码列表逐个尝试，找到无乱码的文件名
const decodeNameSmart = (fileNameRaw, defaultEncoding = 'SHIFT_JIS') => {
    const cachedResult = decodedNameCache.get(fileNameRaw)
    if (cachedResult) { return cachedResult }
    const buf = Buffer.from(fileNameRaw, 'binary')
    const ca = chardet.analyse(buf)
    const cr = ca.filter(item => item.confidence >= 90 && !INOGRE_ENCODING.includes(item.name))
    let encoding = cr && cr.length > 0 ? cr[0].name : defaultEncoding
    let fileName = iconv.decode(buf, encoding)
    let badName = enc.hasBadUnicode(fileName)
    if (badName) {
        log.debug('ZipU', 'messyName:'.padEnd(14, ' '), fileName, encoding, buf.length, fileName?.length ?? -1)
        let betterNameFound = false
        for (const charEncoding of TRY_ENCODING) {
            const tryName = iconv.decode(buf, charEncoding)
            const invalidName = enc.hasBadUnicode(tryName)
            log.debug('ZipU', 'tryName:', tryName, charEncoding, invalidName)
            if (!invalidName) {
                if (!betterNameFound) {
                    betterNameFound = true
                    fileName = tryName
                    encoding = charEncoding
                    badName = false
                    log.info('ZipU', 'betterName:'.padEnd(14, ' '), fileName, encoding, badName)
                    continue
                }
                break
            }
        }
    }
    log.info('ZipU', 'Name:'.padEnd(14, ' '), fileName, encoding, badName)
    decodedNameCache.set(fileNameRaw, { fileName, encoding, badName })
    return { fileName, encoding, badName }
}

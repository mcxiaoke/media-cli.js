/*
 * File: cmd_zipu.js
 * Created: 2024-04-06 21:00:04 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import AdmZip from 'adm-zip'
import { writeFile as writeFileAtomic } from 'atomically'
import chalk from 'chalk'
import chardet from 'chardet'
import fs from 'fs-extra'
import iconv from 'iconv-lite'
import inquirer from 'inquirer'
import path from 'path'
import { asyncMap, compareSmartBy, countAndSort } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

import * as enc from '../lib/encoding.js'

import * as unzipper from 'unzipper'

import { finished } from 'stream/promises'

import os from 'os'

const FALLBACK_ENCODING = 'GBK'
const INOGRE_ENCODING = ['Big5', 'windows-1251', 'ISO-8859-1']
const TRY_ENCODING = [
    'GBK',
    'SHIFT_JIS',
    'UTF8',
    // 'BIG5',
    // 'CP949',
    // 'EUC-KR'
]

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
            description: 'use this encoding foe zip filenames'
        })
        // 强制解压，覆盖之前的文件
        .option('override', {
            alias: 'o',
            type: 'boolean',
            default: false,
            description: 'force unzip, override existting files'
        })
        // 列表处理，起始索引
        .option('start', {
            type: 'number',
            default: 0,
            description: 'start index of file list to process'
        })
        // 列表处理，每次数目
        .option('count', {
            type: 'number',
            default: 99999,
            description: 'group size of file list to process'
        })
        // 繁体转简体
        .option('tcsc', {
            alias: 't',
            type: 'boolean',
            default: false,
            description: 'convert Chinese from TC to SC'
        })
        // 解压成功后删除原ZIP文件
        .option('purge', {
            alias: 'delete-zip',
            type: 'boolean',
            default: false,
            description: 'delete zip file after unzipped ok'
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option('doit', {
            alias: 'd',
            type: 'boolean',
            default: false,
            description: 'execute os operations in real mode, not dry run'
        })
}

const handler = cmdZipUnicode

async function cmdZipUnicode(argv) {
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
            entry.isFile &&
            helper.pathExt(entry.name) === '.zip'
    })
    files = files.sort(compareSmartBy('path'))
    files = files.map((f, i) => {
        return {
            ...f,
            argv,
            index: i,
            total: files.length,
            encoding: argv.encoding,
            override: argv.override || false,
            testMode: testMode
        }
    })
    const showFiles = files.slice(-20)
    for (const f of showFiles) {
        log.show(logTag, 'File:', helper.pathShort(f.path), helper.humanSize(f.size))
    }
    if (showFiles.length < files.length) {
        log.show(logTag, `Above lines are last 20 files, total ${files.length} files.`)
    }
    log.show(logTag, `Total ${files.length} zip files found in ${helper.humanTime(startMs)}`)
    log.show(logTag, argv)

    if (files.length === 0) {
        log.showYellow(logTag, 'Nothing to do, abrot.')
        return
    }

    files = files.slice(argv.start, argv.start + argv.count)

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
        log.showGreen(logTag, `Now unzipping ${files.length} files...}`)
        const startMs = Date.now()
        files.forEach(f => f.startMs = startMs)
        let results = await asyncMap(files, UnzipOneFile)
        const okResults = results.filter((r) => r && r.done)
        const skippedResults = results.filter((r) => r && r?.skipped)
        const failedResult = results.filter((r) => !r || !(r.skipped || r.done))
        testMode && log.showYellow(logTag, 'NO file unzipped in TEST MODE.')

        if (!testMode) {
            okResults?.length > 0 && log.showGreen(logTag, `There were ${okResults.length} files unzipped. (${helper.humanTime(startMs)})`)
            skippedResults?.length > 0 && log.show(logTag, `There were ${skippedResults.length} files skipped. (${helper.humanTime(startMs)})`)
            failedResult?.length > 0 && log.showYellow(logTag, `There were ${failedResult.length} files failed. (${helper.humanTime(startMs)})`)

        }

        const purgeResults = results.filter(r => r && (r.done || r.skipped))
        if (argv.purge && purgeResults?.length > 0) {
            // 是否要删除原ZIP文件，谨慎操作
            const purgeConfirm = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'yes',
                    default: false,
                    message: chalk.bold.red(
                        `Are you sure to DELETE ${okResults?.length + skippedResults.length}  zip files after unzipped?`
                    )
                }
            ])
            if (purgeConfirm.yes) {
                for (const pr of purgeResults) {
                    log.show(logTag, `Purge: SafeDel ${pr.path}`)
                    await helper.safeRemove(pr.path)
                }
            }
        }
    } else {
        log.showYellow(logTag, 'Will do nothing, aborted by user.')
    }
}

async function UnzipOneFile(f) {
    const testMode = f.testMode
    const ipx = `${f.index + 1}/${f.total}`
    const logTag = 'ZipU'
    const zipFilePath = f.path
    const zipFileSize = f.size || 0
    const parts = path.parse(zipFilePath)
    const zipDir = path.join(parts.dir, parts.name)
    // 只有adm-zip有问题, unzipper可以正确处理大文件
    // if (zipFileSize >= mf.FILE_SIZE_1G * 2) {
    //     log.showYellow(logTag, `Too Big: ${ipx} <${zipFilePath}> (${helper.humanSize(zipFileSize)})`)
    //     log.fileLog(`Skip ${ipx} <${zipFilePath}> Reason:Too Big`, logTag)
    //     f.error = 'File size greatr than 2G.'
    //     return
    // }

    // if (1 === 1) { return }

    // 检查解压目录是否已存在，是否已解压
    if (await fs.pathExists(zipDir)) {
        // 强制覆盖，删除旧目录
        if (f.override) {
            log.showYellow(logTag, `OverrideExists: <${zipDir}>`)
            !testMode && await fs.remove(zipDir)
        } else {
            // 注释掉，直接解压途中跳过已存在的文件更快
            // const zipDirSize = await mf.getDirectorySizeR(zipDir)
            // log.info(logTag, `Exists: <${zipDir}> ${helper.humanSize(zipDirSize)}`)
            // 解压后的目录大于zip文件大小，认为解压成功，忽略
            // if (zipDirSize >= zipFileSize) {
            //     log.showYellow(logTag, `SkipExists: ${ipx} <${zipDir}> ${helper.humanSize(zipDirSize)}`)
            //     f.skipped = true
            //     return f
            // }
        }
    }

    log.info(logTag, `Processing: ${ipx} <${zipFilePath}> (${helper.humanSize(zipFileSize)}) (${helper.humanTime(f.startMs)})`)

    // 无法猜测出文件名的正确编码，不解压
    const useEncoding = await guessEncodingUseUnzipper(f)
    if (!useEncoding) {
        log.showYellow(logTag, `Skip[BadName]: ${ipx} <${zipFilePath}> Reason:Bad Name.`)
        log.fileLog(`Skip ${ipx} <${zipFilePath}> Reason:Bad Name`, logTag)
        f.error = 'File name is not valid.'
        return
    }

    // 测试模式，不解压文件
    if (testMode) {
        log.showYellow(logTag, `Skip[TestMode]: ${ipx} <${zipFilePath}> Reason:Test Mode.`)
        return
    }

    return await unzipFileUseUnzipper(f, useEncoding)
}

async function unzipFileUseAdmZip(f, useEncoding) {
    // adm-zip有内存泄漏，内存不足直接退出
    if (os.freemem() < mf.FILE_SIZE_1G * 4) {
        log.error(`Not enough memory to unzip ${zipFilePath}`)
        throw new Error(logTag, `Not enough memory to unzip ${zipFilePath}`)
    }

    const logTag = 'ZipU'
    const ipx = `${f.index + 1}/${f.total}`
    const zipFilePath = f.path
    const parts = path.parse(zipFilePath)
    const zipDir = path.join(parts.dir, parts.name)
    try {
        const zip = new AdmZip(zipFilePath)
        const zipEntries = zip.getEntries()

        let unzippedCount = 0
        const unzippedFiles = []
        const entryCount = zipEntries.length
        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue
            }

            // 解码后的文件名，确保无乱码
            // const { fileName, encoding, badName } = decodeNameSmart(entry.rawEntryName, bestEncoding)
            // const { fileName, encoding } = decodedNameMap.get(entry.rawEntryName)
            // 直接使用之前找到的最佳文件名编码，不再重复调用decodeNameSmart
            const fileName = iconv.decode(entry.rawEntryName, useEncoding)
            const fileNameParts = path.parse(fileName)
            const dstDir = path.join(zipDir, fileNameParts.dir)
            const dstFile = path.join(dstDir, fileNameParts.base)
            if (!await fs.pathExists(dstDir)) {
                await fs.mkdir(dstDir, { recursive: true })
            }
            if (await fs.pathExists(dstFile)) {
                const dstSize = (await fs.stat(dstFile)).size || 0
                if (dstSize === entry.header.size) {
                    log.info(logTag, `Skip: <${helper.pathShort(dstFile)}> [${useEncoding}]`)
                    continue
                }
            }
            ++unzippedCount
            const epx = `${unzippedCount}/${entryCount}`
            log.debug(logTag, `DstDir: ${epx} <${dstDir}>`)
            log.debug(logTag, `DstFile: ${epx} <${dstFile}>`)
            const data = entry.getData()
            await writeFileAtomic(dstFile, data)
            unzippedFiles.push(dstFile)
            log.info(logTag, `Entry: ${epx} <${helper.pathShort(dstFile)}> [${useEncoding}] ${helper.humanSize(entry.header.size)}`)
        }
        if (unzippedCount === unzippedFiles.length) {
            f.done = true
            f.unzipped = unzippedFiles
            log.info(logTag, `Done ${ipx} <${zipFilePath}> ${useEncoding}`)
            log.showGreen(logTag, `Done ${ipx} <${helper.pathShort(zipDir)}> ${useEncoding}`)
            // log.fileLog(`Unzipped ${ipx} <${zipFilePath}> ${useEncoding}`, logTag)
            return f
        } else {
            // 解压失败，删除解压目录
            await helper.safeRemove(zipDir)
            log.showRed(logTag, `Failed ${ipx} <${helper.pathShort(zipFilePath)}> ${useEncoding}`)
            log.fileLog(`Failed ${ipx} <${zipFilePath}> ${useEncoding}`, logTag)
            f.error = 'Some entries unzip failed.'
            return f
        }
    } catch (error) {
        log.error(logTag, zipFilePath, error)
        log.fileLog(`Error ${ipx} <${zipFilePath}> ${useEncoding} [${error}]`, logTag)
    }
}

function getTempFileName() {
    const randomness = Math.floor(Math.random() * 16777215).toString(16).slice(-6)
    const timestamp = Date.now().toString().slice(-10)
    return `_${timestamp}${randomness}.tmp`
}

async function unzipFileUseUnzipper(f, useEncoding) {
    const logTag = 'ZipU'
    const ipx = `${f.index + 1}/${f.total}`
    const zipFilePath = f.path
    const parts = path.parse(zipFilePath)
    const zipDir = path.join(parts.dir, parts.name)
    try {
        const stream = fs.createReadStream(zipFilePath)
        const zipEntries = stream.pipe(unzipper.Parse({ forceStream: true }))

        let unzippedCount = 0
        for await (const entry of zipEntries) {
            let entryEnc = useEncoding
            const isUnicode = entry.props.flags.isUnicode
            let entryName = isUnicode ? entry.path : iconv.decode(entry.props.pathBuffer, entryEnc)

            // 乱码文件名二次确认，再次解码测试
            if (hasBadChars(entryName, true)) {
                const { fileName, encoding, badName } = decodeNameSmart(entry.props.pathBuffer, entryEnc)
                entryName = fileName
                // log.showCyan(fileName, encoding, badName)
                // 如果二次解码还是乱码，报错
                if (hasBadChars(entryName, true)) {
                    entry.autodrain()
                    throw new Error(`BadName: ${ipx} ${entryName} in <${zipFilePath}> ${entryEnc}`)
                } else {
                    log.showGray(logTag, `NewName: <${entryName}> [${entryEnc}]`)
                }
            }

            const fileNameParts = path.parse(entryName)
            const dstDir = path.join(zipDir, fileNameParts.dir)
            const dstFile = path.join(dstDir, fileNameParts.base)
            const tmpDstFile = path.join(dstDir, `${getTempFileName()}${fileNameParts.ext}`)

            if (entry.type === 'Directory') {
                log.info(logTag, `SkipDir1: <${dstFile}> ${entry.type}`)
                // log.show(logTag, 'MkDir', dstDir)
                await fs.mkdir(dstDir, { recursive: true })
                entry.autodrain()
                continue
            }

            // 处理特殊情况，有的zip文件将目录报告为文件
            // 如果没有扩展名且大小为0，假定为目录
            // 文件名中间有. 会导致扩展名识别错误，需要处理
            // eg .mp4, .flac, .001, .accurip
            const hasExtensions = fileNameParts.ext
                && fileNameParts.ext.length <= 10
                && /^\.[A-Za-z0-9]+$/.test(fileNameParts.ext)
            if (!hasExtensions && entry.vars.uncompressedSize === 0) {
                log.info(logTag, `SkipDir2: <${dstFile}> ${entry.type}`)
                // 文件大小为0，移除
                if (await fs.pathExists(dstFile)) {
                    await fs.remove(dstFile)
                }
                entry.autodrain()
                continue
            }
            // 跳过已存在的文件，文件名和大小一致
            if (await fs.pathExists(dstFile)) {
                const dstSize = (await fs.stat(dstFile)).size || 0
                if (dstSize === entry.vars.uncompressedSize) {
                    log.info(logTag, `SkipEntry: <${helper.pathShort(dstFile)}> [${entryEnc}]`)
                    entry.autodrain()
                    continue
                }
            }
            const epx = `${++unzippedCount}`
            log.info(logTag, `ProcessEntry: ${epx} <${dstFile}> ${entry.type}`)
            log.debug(logTag, `DstDir: ${epx} <${dstDir}>`)
            log.debug(logTag, `DstFile: ${epx} <${dstFile}>`)
            if (!await fs.pathExists(dstDir)) {
                log.info(logTag, 'MkDir', dstDir)
                await fs.mkdir(dstDir, { recursive: true })
            }
            const tmpDstStream = fs.createWriteStream(tmpDstFile)
            // tmpDstStream.on('error', (error) => {
            //     log.warn(logTag, dstFile, error)
            // })
            await entry.pipe(tmpDstStream)
            await finished(tmpDstStream)
            // await new Promise(resolve => tmpDstStream.on("close", resolve))
            await fs.rename(tmpDstFile, dstFile)
            log.show(logTag, `NewEntry: ${epx} <${helper.pathShort(dstFile)}> [${entryEnc}] ${helper.humanSize(entry.vars.uncompressedSize)}`)
        }

        if (unzippedCount == 0) {
            f.skipped = true
            log.showYellow(logTag, `Skipped ${ipx} <${helper.pathShort(zipDir)}> ${useEncoding} ${helper.humanTime(f.startMs)}`)
            return f
        } else {
            f.done = true
            log.info(logTag, `Done ${ipx} <${zipFilePath}> ${useEncoding}`)
            log.showGreen(logTag, `Done ${ipx} <${helper.pathShort(zipDir)}> ${useEncoding} ${unzippedCount} ${helper.humanTime(f.startMs)}`)
            // log.fileLog(`Unzipped ${ipx} <${zipFilePath}> ${useEncoding}`, logTag)
            return f
        }

    } catch (error) {
        f.skipped = false
        f.done = false
        log.showRed(logTag, error.message)
        log.fileLog(`Error ${error.message}`, logTag)
    }

}

function guessEncodingUseAdmZip(f) {
    const logTag = 'guessEncoding'
    const zipFilePath = f.path
    const zipFileName = path.basename(zipFilePath)
    const decodedNameMap = new Map()
    const tryEncodings = []
    try {
        const zip = new AdmZip(zipFilePath)
        const zipEntries = zip.getEntries()

        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue
            }
            const nameBuf = entry.rawEntryName
            // 解码后的文件名，确保无乱码
            const { fileName, encoding, badName } = decodeNameSmart(nameBuf, f.encoding)
            if (badName) {
                log.info(logTag, `BadName: ${ipx} <${zipFileName}> <${fileName}> [${encoding}]`)
                return
            } else {
                tryEncodings.push(encoding)
                decodedNameMap.set(nameBuf, { fileName, encoding })
            }
        }

        let [useEncoding, allEncodings] = countAndSort(tryEncodings, ['ASCII'])
        let encoding = useEncoding || FALLBACK_ENCODING
        log.info(logTag, `Try Encoding:`, allEncodings)
        log.showGray(logTag, `Use ${encoding} for ${helper.pathShort(zipFileName)}`)
        return encoding
    } catch (error) {
        log.error(logTag, zipFilePath, error)
    }
}

async function guessEncodingUseUnzipper(f) {
    const logTag = 'guessEncoding2'
    const zipFilePath = f.path
    const zipFileName = path.basename(zipFilePath)
    const decodedNameMap = new Map()
    const tryEncodings = []
    try {
        const stream = fs.createReadStream(zipFilePath)
        const zipEntries = stream.pipe(unzipper.Parse({ forceStream: true }))
        for await (const entry of zipEntries) {
            // if some legacy zip tool follow ZIP spec then this flag will be set
            if (entry.type === 'Directory') {
                entry.autodrain()
                continue
            }
            // const isUnicode = entry.props.flags.isUnicode
            // decode "non-unicode" filename from OEM character set
            // const fileName = isUnicode ? entry.path : iconv.decode(entry.props.pathBuffer, 'gbk')
            // const type = entry.type // 'Directory' or 'File'
            // const size = entry.vars.uncompressedSize // There is also compressedSize
            // log.show(zipFileName)
            // log.show(logTag, `${type}: ${fileName} ${size}`)

            // 解码后的文件名，确保无乱码
            const { fileName, encoding, badName } = decodeNameSmart(entry.props.pathBuffer, f.encoding)
            entry.autodrain()
            if (badName) {
                log.info(logTag, `BadName: <${zipFileName}> <${fileName}> [${encoding}]`)
                continue
            } else {
                tryEncodings.push(encoding.toUpperCase())
                decodedNameMap.set(entry.props.pathBuffer, { fileName, encoding })
            }
        }

        let [useEncoding, allEncodings] = countAndSort(tryEncodings, ['ASCII'])
        let encoding = useEncoding || FALLBACK_ENCODING
        log.info(logTag, `Try Encoding:`, allEncodings)
        log.info(logTag, `Use ${encoding} for ${helper.pathShort(zipFileName)}`)
        await finished(stream)
        return encoding
    } catch (error) {
        log.showRed(logTag, zipFilePath, error)
    }
}


// 添加一个缓存，避免重复解析
// const decodedNameCache = new Map()
// 智能解析文件， 如果发现乱码，就按编码列表逐个尝试，找到无乱码的文件名
function decodeNameSmart(fileNameRaw, userEncoding = null) {
    // const cachedResult = decodedNameCache.get(fileNameRaw)
    // if (cachedResult) { return cachedResult }
    const buf = Buffer.from(fileNameRaw, 'binary')
    const ca = chardet.analyse(buf)
    const cr = ca.filter(item => item.confidence >= 85 && !INOGRE_ENCODING.includes(item.name))
    let encoding = (cr && cr.length > 0 ? cr[0].name : userEncoding) || FALLBACK_ENCODING
    log.debug('ZipU', encoding, userEncoding, ca)
    let fileName = iconv.decode(buf, encoding)
    let badName = hasBadChars(fileName, false)
    let betterNameFound = false
    if (badName) {
        log.debug('ZipU', 'badName:'.padEnd(10, ' '), fileName, encoding, buf.length, fileName?.length ?? -1)
        for (const charEncoding of TRY_ENCODING) {
            const tryName = iconv.decode(buf, charEncoding)
            const invalidName = hasBadChars(tryName, true)
            const invalidName2 = hasBadChars(tryName, false)
            log.info('ZipU', 'tryName:', tryName, charEncoding, invalidName, invalidName2)
            if (!invalidName2) {
                if (!betterNameFound) {
                    betterNameFound = true
                    fileName = tryName
                    encoding = charEncoding
                    badName = false
                    log.info('ZipU', 'bestName:'.padEnd(10, ' '), fileName, encoding, badName)
                    break
                }
            }
            else if (!invalidName) {
                if (!betterNameFound) {
                    betterNameFound = true
                    fileName = tryName
                    encoding = charEncoding
                    badName = false
                    log.info('ZipU', 'goodName:'.padEnd(10, ' '), fileName, encoding, badName)
                    continue
                }
            }
        }
    } else {
        log.info('ZipU', 'bestName2:'.padEnd(10, ' '), fileName, encoding, badName)
    }
    log.info('ZipU', 'Name:'.padEnd(10, ' '), fileName, encoding, badName)
    // decodedNameCache.set(fileNameRaw, { fileName, encoding, badName })
    return { fileName, encoding, badName }
}

function hasBadChars(str, strict = false) {

    if (enc.hasBadCJKChar(str)) { return true }

    const results = []
    if (!strict) {
        if (str.includes('?')) {
            // 乱码标志 问号
            results.push([true, 0, `问号`])
        }
        if (/[\u00c0-\u00d6\u00d8-\u024f]/u.test(str)) {
            // 乱码标志 拉丁字母扩展
            results.push([true, 2, `拉丁字母扩展`])
        }
        if (/[\u0370-\u1cff]/u.test(str)) {
            // 乱码标志 小众语言符号
            results.push([true, 3, `小众语言A`])
        }
        if (/[\ua000-\ua7ff\uab30-\uabff\ud7b0-\ud7ff]/u.test(str)) {
            // 乱码标志 小众语言符号
            results.push([true, 4, `小众语言B`])
        }
        if (/[\uff66-\uff9d]/u.test(str)) {
            // 乱码标志 半角平假名片假名
            results.push([true, 6, `半角假名`])
        }
    }
    if (str.includes('\ufffd')) {
        // 乱码标志 黑问号
        results.push([true, 0, `非法字符`])
    }
    if (/[\u3100-\u312f]/u.test(str)) {
        // 注音符号
        results.push([true, 2, `注音符号`])
    }
    if (/[\u3300-\u33ff]/u.test(str)) {
        // 乱码标志 特殊字符
        results.push([true, 4, `CJK特殊字符`])
    }
    if (/[\ud800-\udfff]/u.test(str)) {
        // 乱码标志 代理对，存疑
        results.push([true, 4, `代理对`])
    }
    if (/[\ue000-\uf8ff]/u.test(str)) {
        // 乱码标志 Unicode私有区
        results.push([true, 5, `私有区`])
    }
    if (/[\ufb50-\ufdff\ufe70-\ufeff]/u.test(str)) {
        // 乱码标志 阿拉伯字符
        results.push([true, 5, `阿拉伯字符`])
    }
    if (/[㼿]/u.test(str)) {
        // 乱码标志 特殊生僻字
        results.push([true, 7, `生僻字`])
    }

    return results?.length > 0
}


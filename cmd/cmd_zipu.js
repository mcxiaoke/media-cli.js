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
import { compareSmartBy, countAndSort } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

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
        // 繁体转简体
        .option('tcsc', {
            alias: 't',
            type: 'boolean',
            default: false,
            description: 'convert Chinese from TC to SC'
        })
        // 解压成功后删除原ZIP文件
        .option('purge', {
            type: 'boolean',
            default: false,
            description: 'purge zip file after unzipped ok'
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
    files = files.sort(compareSmartBy('path'))
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
        const okResults = results.filter((r) => r && r.done)
        const skippedResults = results.filter((r) => r && r?.skipped)
        const failedResult = results.filter((r) => !r || !(r.skipped || r.done))
        testMode && log.showYellow(logTag, 'NO file unzipped in TEST MODE.')
        okResults?.length > 0 && log.showGreen(logTag, `There were ${okResults.length} files unzipped.`)
        skippedResults?.length > 0 && log.show(logTag, `There were ${skippedResults.length} files skipped.`)
        failedResult?.length > 0 && log.showYellow(logTag, `There were ${failedResult.length} files failed.`)
        const purgeResults = results.filter(r => r && (r.done || r.skipped))
        if (argv.purge && purgeResults?.length > 0) {
            // 是否要删除原ZIP文件，谨慎操作
            const purgeConfirm = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'yes',
                    default: false,
                    message: chalk.bold.red(
                        `Are you sure to DELETE ${okResults?.length + skippedResults.length} orginal zip files after unzipped?`
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

async function UnzipOneFile(f, testMode = true) {
    log.show(' ')
    const ipx = `${f.index + 1}/${f.total}`
    const logTag = 'ZipU'
    const zipFilePath = f.path
    const zipFileName = path.basename(zipFilePath)
    const zipFileSize = (await fs.stat(zipFilePath)).size ?? 0
    const parts = path.parse(zipFilePath)
    const zipDir = path.join(parts.dir, parts.name)

    // adm-zip有内存泄漏，内存不足直接退出
    if (os.freemem() < mf.FILE_SIZE_1G * 4) {
        log.error(`Not enough memory to unzip ${zipFilePath}`)
        throw new Error(logTag, `Not enough memory to unzip ${zipFilePath}`)
    }

    log.showYellow(logTag, `Unzip: ${ipx} <${zipFilePath}> (${helper.humanSize(zipFileSize)}) ${testMode} ${f.override}`)
    if (zipFileSize >= mf.FILE_SIZE_1G * 2) {
        log.showYellow(logTag, `Too Big: ${ipx} <${zipFilePath}> (${helper.humanSize(zipFileSize)})`)
        log.fileLog(`Skip ${ipx} <${zipFilePath}> Reason:Too Big`, logTag)
        f.error = 'File size greatr than 2G.'
        return
    }
    // 检查解压目录是否已存在，是否已解压
    if (await fs.pathExists(zipDir)) {
        // 强制覆盖，删除旧目录
        if (f.override) {
            log.showYellow(logTag, `Override Exists: <${zipDir}>`)
            !testMode && await fs.remove(zipDir)
        } else {
            const zipDirSize = await mf.getDirectorySizeR(zipDir)
            log.info(logTag, `Exists: <${zipDir}> ${helper.humanSize(zipDirSize)}`)
            // 解压后的目录大于zip文件大小，认为解压成功，忽略
            if (zipDirSize >= zipFileSize - mf.FILE_SIZE_1M) {
                log.showGray(logTag, `Skip Exists: <${zipDir}> ${helper.humanSize(zipDirSize)}`)
                f.skipped = true
                return f
            }
        }
    }
    let badNameFound = false
    try {
        const decodedNameMap = new Map()
        const zip = new AdmZip(zipFilePath)
        const zipEntries = zip.getEntries()

        const tryEncodings = []
        for (const entry of zipEntries) {
            if (entry.isDirectory) {
                continue
            }
            // 解码后的文件名，确保无乱码
            const { fileName, encoding, badName } = decodeNameSmart(entry.rawEntryName, f.encoding)
            if (badName) {
                badNameFound = true
                log.showYellow(logTag, `Unzip BadName: ${ipx} <${zipFileName}> <${fileName}> [${encoding}]`)
                break
            } else {
                decodedNameMap.set(entry.rawEntryName, { fileName, encoding })
                tryEncodings.push(encoding)
            }
        }

        if (badNameFound) {
            log.showYellow(logTag, `Skip:  ${ipx} File:<${zipFilePath}> Reason: Some entries have bad names.`)
            log.fileLog(`Skip ${ipx} <${zipFilePath}> Reason:BadName`, logTag)
            f.error = 'Some entries have bad names.'
            return
        }

        let [useEncoding, allEncodings] = countAndSort(tryEncodings, ['ASCII'])
        useEncoding = useEncoding || FALLBACK_ENCODING
        log.info(logTag, `Try Encoding:`, allEncodings)
        log.show(logTag, `Use Encoding: ${useEncoding} for ${zipFileName}`)

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
            // const { fileName, encoding, badName } = decodeNameSmart(entry.rawEntryName, bestEncoding)
            // const { fileName, encoding } = decodedNameMap.get(entry.rawEntryName)
            // 直接使用之前找到的最佳文件名编码，不再重复调用decodeNameSmart
            const fileName = iconv.decode(entry.rawEntryName, useEncoding)
            const fileNameParts = path.parse(fileName)
            const dstDir = path.join(zipDir, fileNameParts.dir)
            const dstFile = path.join(dstDir, fileNameParts.base)
            log.debug(logTag, `DstDir: ${epx} <${dstDir}>`)
            log.debug(logTag, `DstFile: ${epx} <${dstFile}>`)
            if (!await fs.pathExists(dstDir)) {
                await fs.mkdir(dstDir, { recursive: true })
            }
            if (await fs.pathExists(dstFile)) {
                const dstSize = (await fs.stat(dstFile)).size || 0
                if (dstSize === entry.header.size) {
                    log.showGray(logTag, `Skip: ${epx} <${helper.pathShort(dstFile)}> [${useEncoding}]`)
                    continue
                }
            }
            const data = entry.getData()
            await writeFileAtomic(dstFile, data)
            log.info(logTag, `Entry: ${epx} <${helper.pathShort(dstFile)}> [${useEncoding}]`)

            unzippedFiles.push(dstFile)
        }
        if (unzippedCount === unzippedFiles.length) {
            f.done = true
            f.unzipped = unzippedFiles
            log.info(logTag, `Unzipped ${ipx} SRC:<${zipFilePath}> ${useEncoding}`)
            log.showGreen(logTag, `Unzipped ${ipx} DST:<${helper.pathShort(zipDir)}> ${useEncoding}`)
            // log.fileLog(`Unzipped ${ipx} <${zipFilePath}> ${useEncoding}`, logTag)
            return f
        } else {
            // 解压失败，删除解压目录
            await helper.safeRemove(zipDir)
            log.showRed(logTag, `Failed ${ipx} <${helper.pathShort(zipFilePath)}> ${useEncoding}`)
            f.error = 'Some entries unzip failed.'
            return f
        }
    } catch (error) {
        log.warn(logTag, zipFilePath, error)
    }
}


// 添加一个缓存，避免重复解析
// const decodedNameCache = new Map()
// 智能解析文件， 如果发现乱码，就按编码列表逐个尝试，找到无乱码的文件名
const decodeNameSmart = (fileNameRaw, userEncoding = null) => {
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
            log.debug('ZipU', 'tryName:', tryName, charEncoding, invalidName, invalidName2)
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

const hasBadChars = (str, strict = false) => {
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
        // 乱码标志 问号和黑问号
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


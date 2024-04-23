/*
 * File: cmd_fixname.js
 * Created: 2024-03-16 21:12:41 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk'
import { sify } from 'chinese-conv'
import fs from 'fs-extra'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import * as core from '../lib/core.js'
import { asyncFilter } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'
import { mergePath } from '../lib/path-merge.js'
import { applyFileNameRules, cleanFileName, renameFiles } from "./cmd_shared.js"

const TYPE_LIST = ['a', 'f', 'd']

export { aliases, builder, command, describe, handler }
const command = "rename <input>"
const aliases = ["fn", "fxn"]
const describe = 'Reanme files: fix encoding, replace by regex, clean chars, fro tc to sc.'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya// 仅处理符合指定条件的文件，包含文件名规则
        .positional('input', {
            describe: 'input directory',
            type: 'string',
        })
        // 正则，包含文件名规则
        .option("include", {
            alias: "I",
            type: "string",
            description: "filename include pattern",
        })
        //字符串或正则，不包含文件名规则
        // 如果是正则的话需要转义
        // 默认排除 [SHANA] 开头的文件
        .option("exclude", {
            alias: "E",
            type: "string",
            default: '[SHANA]',
            description: "filename exclude pattern ",
        })
        // 需要处理的扩展名列表，默认为常见视频文件
        .option("extensions", {
            alias: "e",
            type: "string",
            describe: "include files by extensions (eg. .wav|.flac)",
        })
        // 遍历目录层次深度限制
        .option("max-depth", {
            alias: 'depth',
            type: "number",
            default: 99,
            description: "max depth when walk directories and files",
        })
        // 要处理的文件类型 文件或目录或所有，默认只处理文件
        .option("type", {
            type: "choices",
            choices: TYPE_LIST,
            default: 'f',
            description: "applied to file type (a=all,f=file,d=dir)",
        })
        // 清理文件名中的特殊字符和非法字符
        .option("clean", {
            alias: "c",
            type: "boolean",
            description: "remove ugly and special chars in filename",
        })
        .option("separator", {
            alias: 'sep',
            type: "string",
            description: "word separator for clean filenames ",
        })
        // 使用正则表达式替换文件名中的特定字符，比如问号
        // 如果数组只有一项，就是替换这一项为空白，即删除模式字符串
        // 如果有两项，就是替换第一项匹配的字符串为第二项指定的字符
        // 只匹配文件名，不包含扩展名
        // 正则replace方法，占位符的特殊处理，需要注意 $ 符号
        // $是特殊符号，powershell中需要使用单引号包裹，双引号不行
        // 或者针对 $ 使用反引号转义，如 `$
        .option("replace", {
            alias: 'rp',
            type: "array",
            description: "replace filename chars by pattern [from,to]",
        })
        // 替换特殊模式flag
        // d = applied to dir names
        // f = applied to file names
        .option("replace-flags", {
            alias: 'rpf',
            type: "string",
            default: 'd,f',
            description: "special flag for replace operations",
        })
        // 默认使用字符串模式，可启用正则模式
        .option("regex", {
            alias: 're',
            type: "boolean",
            description: "match filenames by regex pattern",
        })
        // 修复文件名乱码
        .option("fixenc", {
            alias: 'fc',
            type: "boolean",
            description: "fix filenames by guess encoding",
        })
        // 繁体转简体
        .option("tcsc", {
            alias: 'tc2sc',
            type: "boolean",
            description: "convert from tc to sc for Chinese chars",
        })
        // 合并多层重复目录，减少层级，不改动文件名
        .option("merge-dirs", {
            alias: "simplify-dirs",
            type: "boolean",
            description: "reduce duplicate named directory hierarchy",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = cmdRename

async function cmdRename(argv) {
    const testMode = !argv.doit
    const logTag = "cmdRename"
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
    if (!(argv.clean || argv.fixenc || argv.tcsc || argv.replace || argv.mergeDirs)) {
        // log.error(`Error: replace|clean|encoding|tcsc|mergeDirs, one is required`)
        throw new Error(`replace|clean|encoding|tcsc|mergeDirs, one is required`)
    }
    const type = (argv.type || 'f').toLowerCase()
    if (!TYPE_LIST.includes(type)) {
        throw new Error(`Error: type must be one of ${TYPE_LIST}`)
    }
    const options = {
        needStats: true,
        withDirs: type === 'd',
        withFiles: type === 'a' || type === 'f',
        maxDepth: argv.maxDepth || 99,
    }
    let entries = await mf.walk(root, options)
    log.show(logTag, `Total ${entries.length} entries found (type=${type})`)
    // 应用文件名过滤规则
    entries = await applyFileNameRules(entries, argv)
    if (entries.length === 0) {
        log.showYellow(logTag, 'No files left after rules, nothing to do.')
        return
    }
    entries = entries.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: entries.length,
        }
    })
    const fCount = entries.length
    let tasks = await pMap(entries, preRename, { concurrency: cpus().length * 4 })
    tasks = tasks.filter(f => f && (f.outPath || f.outName))
    log.show(logTag, argv)
    const tCount = tasks.length
    log.showYellow(
        logTag, `Total ${fCount - tCount} files are skipped. (type=${type})`
    )
    if (tasks.length > 0) {
        log.showGreen(logTag, `Total ${tasks.length} files ready to rename. (type=${type})`
        )
    } else {
        log.showYellow(logTag, `Nothing to do, abort. (type=${type})`)
        return
    }

    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename these ${tasks.length} files (type=${type})? `
            ),
        },
    ])
    if (answer.yes) {
        if (testMode) {
            log.showYellow(logTag, `${tasks.length} files, NO file renamed in TEST MODE. (type=${type})`)
        }
        else {
            const results = await renameFiles(tasks, false)
            log.showGreen(logTag, `All ${results.length} file were renamed. (type=${type})`)
        }
    } else {
        log.showYellow(logTag, "Will do nothing, aborted by user. ")
    }
}

let badCount = 0
let nameDupCount = 0
// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set()
async function preRename(f) {
    const isDir = f.stats?.isDirectory()
    const flag = isDir ? "D" : "F"
    const logTag = `PreRename${flag}`
    const argv = f.argv
    const ipx = f.index
    const oldPath = path.resolve(f.path)
    const pathParts = path.parse(oldPath)
    // 这里由于文件名里有.等特殊字符
    // 需要分别处理目录和文件的情况
    const oldDir = pathParts.dir
    const oldBase = isDir ? pathParts.base : pathParts.name
    const ext = isDir ? "" : pathParts.ext
    // log.show([oldDir], [oldBase], [ext])
    let tmpNewDir = null
    let tmpNewBase = null

    // 重新组合修复后的目录路径
    function combinePath(...parts) {
        let joinedPath = path.join(...parts)
        // 如果原路径是UNC路径，则需要补上前缀
        if (core.isUNCPath(oldDir)) {
            joinedPath = "\\\\" + joinedPath
        }
        return joinedPath
    }
    // ==================================
    // 文件名和路径乱码修复
    // 适用 完整路径
    // ==================================
    if (argv.fixenc) {
        // 执行文件路径乱码修复操作
        // 对路径进行中日韩文字编码修复
        let [fs, ft] = enc.decodeText(oldBase)
        tmpNewBase = fs.trim()
        // 将目录路径分割，并对每个部分进行编码修复
        const dirNamesFixed = oldDir.split(path.sep).map(s => {
            let [rs, rt] = enc.decodeText(s)
            return rs.trim()
        })
        tmpNewDir = combinePath(...dirNamesFixed)
        // 显示有乱码的文件路径
        const strPath = oldPath.split(path.sep).join('')
        const strNewPath = combinePath(tmpNewDir, tmpNewBase + ext)
        if (enc.hasBadUnicode(strPath, true)) {
            log.showGray(logTag, `BadSRC:${++badCount} ${oldPath} `)
            log.showGray(logTag, `BadDST:${badCount} ${strNewPath} `)
            log.fileLog(`BadEnc:${ipx} <${oldPath}>`, logTag)
        }
    }
    // ==================================
    // 文件名和路径字符串替换
    // 正则模式 和 字符串模式
    // 适用 完整路径
    // ==================================
    if (argv.replace?.[0]?.length > 0) {
        // 替换不涉及扩展名和目录路径，只处理文件名部分
        // 只想处理特定类型文件，可以用include规则
        // $在powershell中是特殊符号，需要使用单引号包裹
        const strMode = argv.regex ? "regex" : "str"
        const strFrom = argv.regex ? new RegExp(argv.replace[0], "ugi") : argv.replace[0]
        const strTo = argv.replace[1] || ""
        const flags = argv.replaceFlags
        log.info(logTag, `Replace: ${oldDir} = ${oldBase} P=${strFrom} F=${flags}`)

        const replaceBaseName = flags.includes('f')
        const replaceDirName = flags.includes('d')
        // 默认使用字符串模式替换，可启用正则模式替换
        let tempBase = oldBase
        if (replaceBaseName) {
            tempBase = oldBase.replaceAll(strFrom, strTo)
            if (tempBase !== oldBase) {
                tmpNewBase = tempBase
            }
        }
        let tempDir = oldDir
        if (replaceDirName) {
            // 路径各个部分先分解，单独替换，然后组合路径
            // 过滤掉空路径，比如被完全替换，减少层级，然后再组合
            let parts = oldDir.split(path.sep).map(s => s.replaceAll(strFrom, strTo).trim())
            tempDir = combinePath(...parts.filter(Boolean))
            if (tempDir !== oldDir) {
                tmpNewDir = tempDir
            }
        }
        const tmpNewPath = path.join(tmpNewDir || oldDir, (tmpNewBase || oldBase) + ext)
        if (tmpNewPath !== oldPath) {
            log.info(logTag, `Replace: pattern=${strFrom} replacement=${strTo} mode=${strMode}`)
            log.info(logTag, `Replace: ${oldPath}=>${tmpNewPath} (${strMode})`)
        }
    }
    // ==================================
    // 文件名特殊字符清理
    // ==================================
    if (argv.clean) {
        // 执行净化文件名操作
        tmpNewBase = cleanFileName(oldBase, {
            separator: argv.separator,
            keepDateStr: true,
            tc2sc: false
        })
        tmpNewDir = oldDir
    }
    // ==================================
    // 文件名繁体转简体
    // ==================================
    if (argv.tcsc) {
        // 执行繁体转简体操作
        tmpNewBase = sify(oldBase)
        tmpNewDir = sify(oldDir)
    }

    tmpNewDir = tmpNewDir || oldDir
    tmpNewBase = tmpNewBase || oldBase

    // 保险措施，防止误替换导致文件名丢失
    if (tmpNewBase.length === 0) {
        log.showYellow(logTag, `Revert: ${ipx} ${helper.pathShort(oldPath)}`)
        tmpNewBase = oldBase
    }

    // ==================================
    // 生成修复后的新路径，包括路径和文件名和扩展名
    // ==================================
    // 确保文件名不含有文件系统不允许的非法字符
    tmpNewBase = helper.filenameSafe(tmpNewBase)
    let newDir = tmpNewDir || oldDir
    let newName = tmpNewBase + ext
    let newPath = path.resolve(path.join(newDir, newName))

    // ==================================
    // 合并重复名称的目录层级
    // 此项建议单独使用
    // ==================================
    if (argv.mergeDirs) {
        // 合并重复名称的目录层级
        // 比如解压后的多层同名目录
        const newPathBefore = newPath
        newPath = mergePath(newPath)
        // log.show(logTag, `MergeDirs: ${ipx} SRC:${newPathBefore}`)
        // log.show(logTag, `MergeDirs: ${ipx} DST:${newPath}`)
    }

    if (newPath === oldPath) {
        log.info(logTag, `Skip Same: ${ipx} ${helper.pathShort(oldPath)}`)
        f.skipped = true
    }
    else if (await fs.pathExists(newPath)) {
        let dupCount = 0
        do {
            newName = tmpNewBase + `_${++dupCount}` + ext
            newPath = path.resolve(path.join(newDir, newName))
        } while (await fs.pathExists(newPath))
        log.showGray(logTag, `NewPath[EXIST]: ${ipx} ${helper.pathShort(newPath)}`)
    }
    else if (nameDuplicateSet.has(newPath)) {
        let dupCount = 0
        do {
            newName = tmpNewBase + `_${++dupCount}` + ext
            newPath = path.resolve(path.join(newDir, newName))
        } while (nameDuplicateSet.has(newPath))
        log.showGray(logTag, `NewPath[DUP]: ${ipx} ${helper.pathShort(newPath)}`)
    }
    if (f.skipped) {
        // log.fileLog(`Skip: ${ipx} ${oldPath}`, logTag);
        // log.info(logTag, `Skip: ${ipx} ${oldPath}`);
        return
    }

    if (f.fixenc && enc.hasBadUnicode(newPath, true)) {
        // 如果修复乱码导致新文件名还是有乱码，就忽略后续操作
        log.showGray(logTag, `BadEncFR:${++badCount}`, oldPath)
        log.show(logTag, `BadEncTO:${++badCount}`, newPath)
        log.fileLog(`BadEncFR: ${ipx} <${oldPath}>`, logTag)
        log.fileLog(`BadEncTO: ${ipx} <${newPath}>`, logTag)
    }
    else {
        // 最后，保存重命名准备参数，返回结果
        const pathDepth = oldPath.split(path.sep).length
        f.skipped = false
        // 新的完整路径，优先使用
        f.outPath = newPath
        // 没有outPath时使用
        f.outName = newName
        // 如果二者都没有，取消重命名
        log.showGray(logTag, `SRC: ${ipx} <${oldPath}> ${pathDepth}`)
        log.show(logTag, `DST: ${ipx} <${newPath}> ${pathDepth}`)
        log.fileLog(`Add: ${ipx} <${oldPath}> [SRC]`, logTag)
        log.fileLog(`Add: ${ipx} <${newPath}> [DST]`, logTag)
        return f
    }

}
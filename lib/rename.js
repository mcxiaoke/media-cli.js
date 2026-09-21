/*
 * File: rename.js
 * Created: 2026-09-20 10:16:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
// 重命名域服务：renameFiles 两阶段并发重命名 + 命令前置处理（addEntryProps/applyFileNameRules）。
// 自 cmd/cmd_shared.js 拆分（2026-09-20），行为零变化。
import chalk from "chalk"
import fs from "fs-extra"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import { asyncFilter, copyFields, randomString } from "./core.js"
import * as log from "./debug.js"
import { ErrorTypes, createError } from "./errors.js"
import { moveSafe } from "./file.js"
import * as helper from "./helper.js"

async function renameOneFile(f) {
    const ipx = `[${f.index}/${f.total}]`
    const flag = f.stats?.isDirectory() ? "D" : "F"
    const logTag = "Rename" + flag + ipx
    // 生成输出文件的路径，优先 outPath
    const srcParts = path.parse(f.path)
    const outPath = f.outPath || path.join(path.dirname(f.path), f.outName)
    log.showGray(logTag, `Source: ${f.path} ${flag}`)
    // 如果输出文件名不存在或者输入文件路径等于输出文件路径，忽略该文件并打印警告信息
    if (!f.outName || f.path === f.outPath) {
        log.showYellow(logTag, "Ignore:", f.path, flag)
        return
    }
    try {
        // 确保输出目录已存在，如果不存在则创建
        const outDir = path.dirname(outPath)
        if (!(await fs.pathExists(outDir))) {
            await fs.mkdirs(outDir)
        }

        // 如果目标文件已存在，不能覆盖
        if (await fs.pathExists(outPath)) {
            log.showYellow(logTag, "SkipExists:", outPath, flag)
            return
        }

        // 使用 fs 模块的 rename 方法重命名文件，并等待操作完成
        await moveSafe(f.path, outPath)
        // 打印重命名成功的日志信息，显示输出文件的路径
        log.show(logTag, chalk.green(`OK:`), `${outPath} ${flag}`)
        log.fileLog(`SRC: <${f.path}>`, logTag)
        log.fileLog(`DST: <${f.outPath}>`, logTag)
        // 附加文件如字幕和封面也需要重命名
        if (f.extraExts?.length > 0) {
            for (const ext of f.extraExts) {
                const eSrc = path.join(srcParts.dir, srcParts.name + ext)
                const eDst = path.join(outDir, f.outBase + ext)
                if (await fs.pathExists(eSrc)) {
                    await moveSafe(eSrc, eDst)
                    log.show(logTag, chalk.yellow(`Extra:`), `${eDst}`)
                }
            }
        }
        return f
    } catch (error) {
        // 捕获并打印重命名过程中出现的错误信息，显示错误原因和输入文件的路径
        log.error(logTag, `Error: <${f.path}> => <${outPath}}> ${error.message} ${flag}`)
        log.fileLog(`Error: <${f.path}> ${error.message}`, logTag)
    }
}

// 这个函数是一个异步函数，用于重命名文件
export async function renameFiles(files, parallel = false) {
    // 打印日志信息，显示要重命名的文件总数
    log.show("Rename", `total ${files.length} files to rename. (parallel=${parallel})`)
    let results = []
    if (parallel) {
        results = await renameFilesTwoPhase(files)
    } else {
        for (const file of files) {
            results.push(await renameOneFile(file))
        }
    }
    const allCount = results.length
    results = results.filter(Boolean)
    const okCount = results.length
    log.show("Rename", `total ${okCount}/${allCount} files renamed (parallel=${parallel})`)
    return results
}

/**
 * 两阶段并行重命名（消除链式重命名的 TOCTOU 竞态）
 *
 * 问题：单阶段并发 rename 时，若存在链式重命名（A→B 且 B→C），
 * 任务1 检查 B 不存在 → 任务2 把 B 改成 C → 任务1 rename(A,B)
 * 会覆盖任务2 刚产出的内容（Windows 上也可能随机 EPERM）。
 *
 * 方案：阶段1 把所有源文件并发改到同目录下的唯一临时名，
 * 先清空全部原路径占位；阶段2 再把临时名并发改到最终名。
 * 两阶段都无跨任务路径依赖，既保留并发性能又消除覆盖。
 * 任一步失败则回滚该文件，绝不丢文件。
 *
 * @param {Array} files - 待重命名文件列表
 * @returns {Promise<Array>} 成功重命名的文件列表
 */
async function renameFilesTwoPhase(files) {
    const concurrency = cpus().length

    // ---------- 阶段 1：源文件 → 唯一临时名 ----------
    const plan = []
    await pMap(
        files,
        async (f) => {
            const outPath = f.outPath || path.join(path.dirname(f.path), f.outName)
            if (!f.outName || f.path === outPath) {
                return
            }
            const srcParts = path.parse(f.path)
            const outDir = path.dirname(outPath)
            try {
                await fs.ensureDir(outDir)
                // 临时名与源文件同目录，确保 rename 不跨卷
                const tmpName = `.mediac_tmp_${randomString(12)}_${srcParts.base}`
                const tmpPath = path.join(srcParts.dir, tmpName)
                await moveSafe(f.path, tmpPath)

                // 附加文件（字幕/封面）一并改到临时名
                const extras = []
                if (f.extraExts?.length > 0) {
                    for (const ext of f.extraExts) {
                        const eSrc = path.join(srcParts.dir, srcParts.name + ext)
                        if (await fs.pathExists(eSrc)) {
                            const eTmp = path.join(
                                srcParts.dir,
                                `.mediac_tmp_${randomString(12)}_${srcParts.name}${ext}`,
                            )
                            await moveSafe(eSrc, eTmp)
                            extras.push({ ext, tmp: eTmp })
                        }
                    }
                }
                plan.push({ f, outPath, outDir, srcParts, tmpPath, extras })
            } catch (error) {
                log.error("Rename", `Phase1 failed: <${f.path}> ${error.message}`)
                log.fileLog(`Error: <${f.path}> ${error.message}`, "RenameP1")
            }
        },
        { concurrency },
    )

    // ---------- 阶段 2：临时名 → 最终名 ----------
    const results = await pMap(
        plan,
        async ({ f, outPath, outDir, srcParts, tmpPath, extras }) => {
            const flag = f.stats?.isDirectory() ? "D" : "F"
            const logTag = "Rename" + flag
            try {
                // 目标已存在则不覆盖，回滚到原名
                if (await fs.pathExists(outPath)) {
                    await moveSafe(tmpPath, f.path)
                    log.showYellow(logTag, "SkipExists:", outPath, flag)
                    return null
                }
                await moveSafe(tmpPath, outPath)
                log.show(logTag, chalk.green(`OK:`), `${outPath} ${flag}`)
                log.fileLog(`SRC: <${f.path}>`, logTag)
                log.fileLog(`DST: <${outPath}>`, logTag)

                for (const { ext, tmp } of extras) {
                    const eDst = path.join(outDir, f.outBase + ext)
                    if (await fs.pathExists(eDst)) {
                        await moveSafe(tmp, path.join(srcParts.dir, srcParts.name + ext))
                    } else {
                        await moveSafe(tmp, eDst)
                        log.show(logTag, chalk.yellow(`Extra:`), `${eDst}`)
                    }
                }
                return f
            } catch (error) {
                // 回滚：尽量把文件恢复到原名，避免丢文件
                try {
                    if (await fs.pathExists(tmpPath)) {
                        await moveSafe(tmpPath, f.path)
                    }
                    for (const { ext, tmp } of extras) {
                        if (await fs.pathExists(tmp)) {
                            await moveSafe(tmp, path.join(srcParts.dir, srcParts.name + ext))
                        }
                    }
                } catch (rollbackError) {
                    log.error(logTag, `Rollback failed: <${tmpPath}> ${rollbackError.message}`)
                }
                log.error(logTag, `Error: <${f.path}> => <${outPath}> ${error.message} ${flag}`)
                log.fileLog(`Error: <${f.path}> ${error.message}`, logTag)
                return null
            }
        },
        { concurrency },
    )

    return results
}

/**
 * 根据模式过滤文件名
 * @param {string} fpath - 文件路径
 * @param {string} pattern - 过滤模式
 * @param {boolean} useRegex - 是否使用正则表达式匹配，默认为false
 * @returns {boolean} 是否匹配模式
 */
function filterFileNames(fpath, pattern, useRegex = false) {
    const name = path.basename(fpath)
    if (useRegex) {
        let rgx
        try {
            rgx = new RegExp(pattern, "ui")
        } catch (error) {
            // 非法正则（用户多打一个 `[` 就会触发）此前会一路冒泡终止整批任务，
            // 且报错是底层 SyntaxError，不提示是哪个参数写错。
            // 这里降级为字面匹配并告警，与 cmd_remove 的处理保持一致。
            log.warn(
                "NameRules",
                `BadRegex: "${pattern}" (${error?.message || error}), fallback to literal match`,
            )
            return name.includes(pattern)
        }
        return name.includes(pattern) || rgx.test(name)
    }
    return name.includes(pattern)
}
// 通用文件名过滤 = 扩展名规则 包含规则 排除规则
// 仅匹配文件名，不包含路径
export async function applyFileNameRules(fileEntries, argv) {
    const beforeCount = fileEntries.length
    const logTag = chalk.green("NameRules")
    if (argv.extensions || argv.include || argv.exclude) {
        log.show(
            logTag,
            `extensions="${argv.extensions || ""}", include="${argv.include || ""}", exclude="${argv.exclude || ""}"`,
        )
    }
    const extensions = argv.extensions?.toLowerCase()
    if (extensions?.length > 0) {
        if (!/\.[a-z0-9]{2,4}/.test(extensions)) {
            // 有扩展名参数，但是参数错误，报错
            throw createError(
                ErrorTypes.INVALID_ARGUMENT,
                `Invalid extensions argument: ${extensions}`,
            )
        }
        fileEntries = fileEntries.filter((entry) => extensions.includes(helper.pathExt(entry.name)))
        log.info(logTag, `${fileEntries.length} entries left by extension rules`)
    }
    // include 与 exclude 是"交集"关系（先收窄再剔除），不是互斥。
    // 此前写成 if/else-if，而 --exclude 在多数命令里有非空默认值，
    // 导致 else 分支永不进入 —— --include 事实上永远不生效。
    if (argv.include?.length > 0) {
        // 处理include规则
        fileEntries = await asyncFilter(fileEntries, (x) =>
            filterFileNames(x.path, argv.include, argv.regex),
        )
        log.info(logTag, `${fileEntries.length} entries left by include rules`)
    }
    if (argv.exclude?.length > 0) {
        // 处理exclude规则
        fileEntries = await asyncFilter(
            fileEntries,
            (x) => !filterFileNames(x.path, argv.exclude, argv.regex),
        )
        log.info(logTag, `${fileEntries.length} entries left by exclude rules`)
    }
    const afterCount = fileEntries.length
    if (beforeCount - afterCount > 0) {
        log.show(
            logTag,
            `${beforeCount - afterCount} entries removed by include/exclude/extension rules`,
        )
    }
    return fileEntries
}

export function addEntryProps(entries, extraProps = {}) {
    const startMs = Date.now()
    entries.forEach((entry, index) => {
        entry.startMs = startMs
        entry.index = index
        entry.total = entries.length
        copyFields(extraProps, entry)
    })
    return entries
}

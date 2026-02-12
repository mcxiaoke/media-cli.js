/*
 * File: cmd_lr.js
 * Created: 2026-02-12 09:16:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Command: Move JPEG output of RAW files to other folder
 */

import chalk from "chalk"
import fs from "fs-extra"
import inquirer from "inquirer"
import path from "path"
import yargs from "yargs"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError, handleError, withErrorHandling } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import { i18n, t } from "../lib/i18n.js"

export { aliases, builder, command, describe, handler }

const command = "lrmove <input> [output]"
const aliases = ["lv"]
const describe = t("commands.lrmove.description")

const builder = (ya) => {
    // 可以在这里添加特定于这个命令的选项
    return ya
}

const handler = async (argv) => {
    await cmdLRMove(argv)
}

async function cmdLRMove(argv) {
    log.show("cmdLRMove", argv)
    const root = path.resolve(argv.input)

    // 使用新的错误处理系统验证输入
    if (!root) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, t("input.path.empty"), null, "ERROR")
    }

    if (!(await fs.pathExists(root))) {
        const error = createError(
            ErrorTypes.FILE_NOT_FOUND,
            t("input.path.not.exists", { path: root }),
        )
        await handleError(error, { command: "lrmove", input: root })
        return
    }

    log.show(`LRMove: input:`, root)

    let filenames = await mf.walk(root, { needStats: true, withFiles: false, withDirs: true })
    filenames = filenames.map((entry) => entry.path).filter((f) => path.basename(f) === "JPEG")
    log.show("LRMove:", t("commands.lrmove.total.folders", { count: filenames.length }))

    if (filenames.length === 0) {
        log.showGreen(t("commands.lrmove.nothing.to.do"))
        return
    }

    const files = filenames.map((f) => {
        const fileSrc = f
        const fileBase = path.dirname(fileSrc)
        const fileDst = fileBase.replace("RAW" + path.sep, "JPEG" + path.sep)
        const task = {
            fileSrc: fileSrc,
            fileDst: fileDst,
        }
        log.show(`${t('path.source')}:`, fileSrc)
        log.show(`${t('path.destination')}:`, fileDst)
        return task
    })

    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(t("commands.lrmove.move.confirm", { count: files.length })),
        },
    ])

    if (answer.yes) {
        // 使用错误处理包装器处理文件移动
        const moveFile = withErrorHandling(
            async (f) => {
                await fs.move(f.fileSrc, f.fileDst)
                log.showGreen(t("commands.lrmove.moved", { src: f.fileSrc, dst: f.fileDst }))
                return f
            },
            { operation: "move", file: f.fileSrc },
        )

        let successCount = 0
        let errorCount = 0

        for (const f of files) {
            const result = await moveFile(f)
            if (result) {
                successCount++
            } else {
                errorCount++
            }
        }

        log.showCyan(t("operation.completed", { success: successCount, error: errorCount }))
    } else {
        log.showYellow(t("operation.cancelled"))
    }
}

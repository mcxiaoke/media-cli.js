/*
 * Project: mediac
 * Created: 2026-02-05 17:32:08
 * Modified: 2026-02-05 17:32:08
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import * as log from "../lib/debug.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

//
export { aliases, builder, command, describe, handler }

const command = "execute [input]"
const aliases = ["run"]
const describe = t("run.description")

const builder = function addOptions(ya) {
    return (
        ya
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: t("option.common.output"),
                type: "string",
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "re",
                type: "boolean",
                default: true,
                description: t("option.common.regex"),
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
    )
}

const handler = cmdRunTask

async function cmdRunTask(argv) {
    const logTag = "cmdRunTask"
    const root = await helper.validateInput(argv.input)
    log.show(logTag, `${t("path.input")}:`, root)
    log.showYellow(logTag, t("run.not_implemented"))
}

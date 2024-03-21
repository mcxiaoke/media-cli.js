#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from "inquirer";
import path from "path";

import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';


export { aliases, builder, command, describe, handler };

const command = "moveup <input> [output]"
const aliases = ["mu"]
const describe = "Move files to sub top folder or top folder"

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya
        // 输出文件名名称
        .option("output", {
            alias: "o",
            type: "string",
            normalize: true,
            description: "Output sub folder name",
        })
        // 移动所有文件到根目录的指定目录
        .option("topmost", {
            alias: "r",
            type: "boolean",
            description: "move files to sub dirs in root dir",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = async function cmdMoveUp(argv) {
    log.show('cmdMoveUp', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        log.error("MoveUp", `Invalid Input: '${root}'`);
        throw new Error("Invalid Input: " + argv.input);
    }
    const testMode = !argv.doit;
    const toRoot = argv.topmost || false;
    // 读取顶级目录下所有的子目录
    const defaultDirName = "文件";
    const picDirName = argv.output || "图片";
    const videoDirName = "视频";
    const bookDirName = "电子书";
    const otherDirName = "其它";
    const outDirNames = [defaultDirName, picDirName, videoDirName, bookDirName, otherDirName];
    let subDirs = (await fs.readdir(root, { withFileTypes: true }))
        .filter(d => d.isDirectory() && !outDirNames.includes(d.name))
        .map(d => d.name);
    log.show("MoveUp", "found sub dirs:", subDirs);
    log.info("MoveUp", argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to move all files to top sub folder?`
            ),
        },
    ]);
    if (!answer.yes) {
        log.showYellow("MoveUp", "Will do nothing, aborted by user.");
        return;
    }

    let keepDirList = new Set();
    keepDirList.add(path.resolve(root));

    // 移动深层子目录的文件到 子目录或根目录的 图片/视频 目录
    let movedCount = 0;
    let totalCount = 0;
    for (const subDirN of subDirs) {
        const subDirPath = path.join(root, subDirN);
        log.info("MoveUp", "processing files in ", subDirPath);
        let curDir = toRoot ? root : subDirPath;
        let files = await mf.walk(subDirPath);
        totalCount += files.length;
        log.show("MoveUp", `Total ${files.length} media files found in ${subDirPath}`);
        const outDirPaths = outDirNames.map(x => path.join(curDir, x));
        keepDirList.add(curDir);
        for (const odp of outDirPaths) {
            keepDirList.add(odp);
        }
        if (outDirNames.includes(subDirN)) {
            log.showYellow("MoveUp", `Skip dir ${subDirPath}`);
        }

        log.info("MoveUp", `output:${curDir}${path.sep}{${outDirNames}}`);
        log.info("MoveUp", `moving ${files.length} files in ${subDirPath} ...`);
        let dupCount = 0;
        for (const f of files) {
            ++dupCount;
            const fileSrc = f.path;
            const [srcDir, srcBase, srcExt] = helper.pathSplit(fileSrc);
            const srcDirName = path.basename(srcDir);
            const fileType = helper.getFileTypeByExt(fileSrc);
            let fileDst = path.join(outDirPaths[fileType], path.basename(fileSrc));
            // if(helper.isArchiveFile(fileSrc)){
            //     fileDst = path.join(otherOutput, `${srcBase}_${dupCount}${srcExt}`);
            // }
            if (srcDir === path.dirname(fileDst)) {
                log.info("MoveUp", "Skip InDst:", fileDst);
                continue;
            }
            if (fileSrc === fileDst) {
                log.info("MoveUp", "Skip Same:", fileDst);
                continue;
            }
            if (!(await fs.pathExists(fileSrc))) {
                log.showYellow("MoveUp", "Not Found:", fileSrc);
                continue;
            }

            await fs.ensureDir(path.dirname(fileDst));

            if (await fs.pathExists(fileDst)) {
                const stSrc = await fs.stat(fileSrc);
                const stDst = await fs.stat(fileDst);
                if (stSrc.size !== stDst.size) {
                    // same name ,but not same file
                    const [dstDir, dstBase, dstExt] = helper.pathSplit(fileDst);
                    fileDst = path.join(dstDir, `${srcDirName}_${dstBase}_${dupCount}${dstExt}`);
                    log.showYellow("MoveUp", "New Name:", fileDst);
                }
            }
            if (await fs.pathExists(fileDst)) {
                log.showYellow("MoveUp", "Skip Exists:", fileDst);
                continue;
            }

            try {
                if (testMode) {
                    log.debug("MoveUp", "NotMoved:", fileSrc, "to", fileDst);
                } else {
                    await fs.move(fileSrc, fileDst);
                    // movedFiles.push([fileSrc, fileDst]);
                    movedCount++;
                    log.debug("MoveUp", "Moved:", fileSrc, "to", fileDst);
                }

            } catch (error) {
                log.error("MoveUp", "Failed:", error, fileSrc, "to", fileDst);
            }
        }
        log.showGreen("MoveUp", `${files.length} in ${helper.pathShort(subDirPath)} are moved.`, testMode ? "[DRY RUN]" : "");
    };
    log.showGreen("MoveUp", `Total ${movedCount}/${totalCount} files moved.`, testMode ? "[DRY RUN]" : "");
    log.showYellow("MoveUp", "There are some unused folders left after moving up operations.")

    const cleanupAnswer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Do you want to cleanup these unused sub folders?`),
        },
    ]);
    if (!cleanupAnswer.yes) {
        return;
    }

    keepDirList = new Set([...keepDirList].map(x => path.resolve(x)));
    let subDirList = await mf.walkDir(root);
    subDirList = new Set([...subDirList].map(x => path.resolve(x)));
    const toRemoveDirList = setDifference(subDirList, keepDirList)

    log.show("MoveUp", `There are ${keepDirList.size} output dirs ${chalk.red("DO NOTHING")}`);
    log.show(keepDirList)
    log.showYellow("MoveUp", `There are ${toRemoveDirList.size} unused dirs to ${chalk.red("DELETE")}, samples:`)
    log.show([...toRemoveDirList].slice(-20));
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const removeUnusedAnswer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to DELETE these unused folders?`),
        },
    ]);
    if (!removeUnusedAnswer.yes) {
        log.showYellow("MoveUp", "Will do nothing, aborted by user.");
        return;
    }
    let delCount = 0;
    for (const td of toRemoveDirList) {
        !testMode && await helper.safeRemove(td);
        if (!testMode) ++delCount;
        log.showGreen('MoveUp', "SafeDel", helper.pathShort(td), testMode ? "[DRY RUN]" : "");
    }
    log.showGreen('MoveUp', `${delCount} dirs were`, testMode ? "[NOT DELETED]" : "SAFE DELETED");
}

function setDifference(setA, setB) {
    const ds = new Set(setA);
    for (const elem of setB) {
        ds.delete(elem);
    }
    return ds;
}
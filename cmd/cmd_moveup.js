#!/usr/bin/env node

import inquirer from "inquirer";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';
import dayjs from "dayjs";

import * as log from '../lib/debug.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'


export { command, aliases, describe, builder, handler }

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
    const outputDirName = argv.output || "图片";
    const videoDirName = "视频";
    const trashDirName = "其它";
    let subDirs = await fs.readdir(root, { withFileTypes: true });
    subDirs = toRoot ? ["."] : subDirs.filter(x => x.isDirectory()).map(x => x.name);
    log.show("MoveUp", "to folders:", subDirs)
    log.showYellow("MoveUp:", argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to move files in these folders to top sub folder?`
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
    for (const subDir of subDirs) {
        let curDir = toRoot ? root : path.join(root, subDir)
        let files = await mf.walk(curDir)
        log.info("MoveUp", `Total ${files.length} media files found in ${subDir}`);
        const picOutput = path.join(curDir, outputDirName)
        const videoOutput = path.join(curDir, videoDirName);
        const otherOutput = path.join(curDir, trashDirName);
        keepDirList.add(curDir);
        keepDirList.add(picOutput);
        keepDirList.add(videoOutput);
        keepDirList.add(otherOutput);
        log.info("MoveUp", `picOutput = ${picOutput}`);
        let dupCount = 0;
        for (const f of files) {
            ++dupCount;
            const fileSrc = f.path;
            const [srcDir, srcBase, srcExt] = helper.pathSplit(fileSrc);
            const srcDirName = path.basename(srcDir);
            let fileDst;
            if (helper.isVideoFile(fileSrc)) {
                fileDst = path.join(videoOutput, path.basename(fileSrc));
            } else if (helper.isImageFile(fileSrc)) {
                fileDst = path.join(picOutput, path.basename(fileSrc));
            } else {
                if (helper.isArchiveFile(fileSrc)) {
                    log.showYellow("MoveUp", `archive file: ${fileSrc}`);
                }
                fileDst = path.join(otherOutput, `${srcBase}_${dupCount}${srcExt}`);
            }
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
                    log.info("MoveUp", "NotMoved:", fileSrc, "to", fileDst);
                } else {
                    await fs.move(fileSrc, fileDst);
                    // movedFiles.push([fileSrc, fileDst]);
                    movedCount++;
                    log.info("MoveUp", "Moved:", fileSrc, "to", fileDst);
                }

            } catch (error) {
                log.error("MoveUp", "Failed:", error, fileSrc, "to", fileDst);
            }
        }
        log.showGreen("MoveUp", `Files in ${curDir} are moved to ${picOutput}.`, testMode ? "[DRY RUN]" : "");
    };
    log.showGreen("MoveUp", `${movedCount} files moved.`, testMode ? "[DRY RUN]" : "");
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
    let toRemoveDirList = setDifference(subDirList, keepDirList)

    log.showYellow("MoveUp", `There are ${keepDirList.size} output dirs NOT TO DELETE`);
    log.show(keepDirList)
    log.showYellow("MoveUp", `There are ${toRemoveDirList.size} unused dirs to DELETE, samples:`)
    log.showYellow([...toRemoveDirList].slice(-20));
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
    } else {
        let delCount = 0;
        for (const td of toRemoveDirList) {
            !testMode && await helper.safeRemove(td);
            !testMode && ++delCount;
            log.showGreen('MoveUp', "SafeDel", helper.pathShort(td), testMode ? "[DRY RUN]" : "");
        }
        log.showGreen('MoveUp', `${delCount} dirs were`, testMode ? "[NOT DELETED]" : "SAFE DELETED");
    }
}

function setDifference(setA, setB) {
    const ds = new Set(setA);
    for (const elem of setB) {
        ds.delete(elem);
    }
    return ds;
}
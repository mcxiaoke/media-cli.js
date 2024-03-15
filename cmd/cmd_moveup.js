#!/usr/bin/env node
import assert from "assert";
import dayjs from "dayjs";
import inquirer from "inquirer";
import throat from 'throat';
import pMap from 'p-map';
import sharp from "sharp";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';
import yargs from "yargs";
import { cpus } from "os";
import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
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
        .option("to-root", {
            alias: "topmost",
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
    const testMode = !argv.doit || true;
    const toRoot = argv.toRoot || false;
    // 读取顶级目录下所有的子目录
    const outputDirName = argv.output || "图片";
    const videoDirName = "视频"
    let subDirs = await fs.readdir(root, { withFileTypes: true });
    subDirs = toRoot ? ["."] : subDirs.filter(x => x.isDirectory()).map(x => x.name);
    log.show("MoveUp", "to folders:", subDirs)
    log.showYellow("MoveUp:", argv);
    testMode && log.showGreen("++++++++++ TEST MODE (DRY RUN) ++++++++++")
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

    // 移动各个子目录的文件到 子目录/图片 目录
    let movedCount = 0;
    for (const subDir of subDirs) {
        let curDir = toRoot ? root : path.join(root, subDir)
        let files = await exif.listMedia(curDir)
        log.show("MoveUp", `Total ${files.length} media files found in ${subDir}`);
        const fileOutput = path.join(curDir, outputDirName)
        const videoOutput = path.join(curDir, videoDirName);
        log.show("MoveUp", `fileOutput = ${fileOutput}`);
        let dupCount = 0;
        for (const f of files) {
            ++dupCount;
            const fileSrc = f.path;
            const [srcDir, srcBase, srcExt] = helper.pathSplit(fileSrc);
            const srcDirName = path.basename(srcDir);
            let fileDst = path.join(helper.isVideoFile(fileSrc) ? videoOutput : fileOutput, path.basename(fileSrc));
            if (fileSrc === fileDst) {
                log.info("Skip Same:", fileDst);
                continue;
            }
            if (!(await fs.pathExists(fileSrc))) {
                log.showYellow("Not Found:", fileSrc);
                continue;
            }
            if (await fs.pathExists(fileDst)) {
                const stSrc = await fs.stat(fileSrc);
                const stDst = await fs.stat(fileDst);
                if (stSrc.size !== stDst.size) {
                    // same name ,but not same file
                    const [dstDir, dstBase, dstExt] = helper.pathSplit(fileDst);
                    fileDst = path.join(dstDir, `${srcDirName}_${dstBase}_${dupCount}${dstExt}`);
                    log.showYellow("New Name:", fileDst);
                }
            }
            if (await fs.pathExists(fileDst)) {
                log.showYellow("Skip Exists:", fileDst);
                continue;
            }
            if (!(await fs.pathExists(fileOutput))) {
                await fs.mkdirp(fileOutput);
            }
            try {
                if (testMode) {
                    log.info("Moved[DryRun]:", fileSrc, "to", fileDst);
                } else {
                    await fs.move(fileSrc, fileDst);
                    // movedFiles.push([fileSrc, fileDst]);
                    movedCount++;
                    log.info("Moved:", fileSrc, "to", fileDst);
                }

            } catch (error) {
                log.error("Failed:", error, fileSrc, "to", fileDst);
            }
        }
        log.showGreen("MoveUp", `Files in ${curDir} are moved to ${fileOutput}.`, testMode ? "[DRY RUN]" : "");
    };
    log.showGreen("MoveUp", `All ${movedCount} files moved.`, testMode ? "[DRY RUN]" : "");
}

#!/usr/bin/env node
const os = require("os");
const klawSync = require("klaw-sync");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs-extra");
const fsp = require("fs/promises");
const inquirer = require("inquirer");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;
const h = require("../lib/helper");
const d = require("../lib/debug");
const un = require("../lib/unicode");
const exif = require("../lib/exif");
const { boolean, options } = require("yargs");
const sqlite3 = require("sqlite3");
const sanitize = require("sanitize-filename");

const yargs = require("yargs/yargs")(process.argv.slice(2));
yargs
  .usage("Usage: $0 <command> <source> [options]")
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .epilog(
    "<Audio Utilities>\nRename/Move/Convert audio files\nCopyright 2021 @ Zhang Xiaoke"
  )
  .demandCommand()
  .showHelpOnFail()
  .help();
d.setLevel(yargs.argv.verbose);
d.D(yargs.argv);
const argv = yargs
  .command(
    // format and name is important!
    // <> means required
    // [] means optional
    // <source> is argument name
    ["convert <source> [options]", "ct"],
    "Convert audio files to m4a(aac) format in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          description: "Force to override exists file",
        });
    },
    (argv) => {
      commandConvert(argv);
    }
  )
  .command(
    ["check <source> [options]", "ck"],
    "Check audio files by exif tags in source dir",
    (yargs) => {
      yargs.positional("source", {
        describe: "Source folder that contains audio files",
        type: "string",
      });
    },
    (argv) => {
      commandCheckTags(argv);
    }
  )
  .command(
    ["move <source> [options]", "mv"],
    "Move audio files by language in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
        })
        .option("lng", {
          alias: "l",
          type: "array",
          default: [],
          description: "Audio language that should be moved (cn,ja,kr,en)",
        })
        .option("ignore", {
          alias: "g",
          type: boolean,

          description: "Ingore rare language audio files (don't move)",
        });
    },
    (argv) => {
      commandMoveByLng(argv);
    }
  ).argv;

async function commandConvert(argv) {
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await executeConvert(root);
}

async function checkFiles(files) {
  const results = await Promise.all(
    // true means keep
    // false mean skip
    files.map(async (f, i) => {
      const index = i + 1;
      if (h.ext(f, true) == ".m4a") {
        d.L(chalk.gray(`SkipAAC (${index}): ${h.ps(f)}`));
        return false;
      }
      const aacName = h.getAACFileName(f);
      const p1 = path.join(path.dirname(f), "output", aacName);
      if (await fs.pathExists(p1)) {
        d.W(chalk.gray(`SkipExists (${i}): ${h.ps(p1)}`));
        return false;
      }
      const p2 = path.join(path.dirname(f), aacName);
      if (await fs.pathExists(p2)) {
        d.W(chalk.gray(`SkipExists (${index}): ${h.ps(p2)}`));
        return false;
      }
      d.L(chalk.green(`Prepared (${index}): `) + `${h.ps(f)}`);
      return true;
    })
  );
  return files.filter((_v, i) => results[i]);
}

async function allToAAC(files) {
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      const file = path.resolve(f);
      const result = await pool.exec("toAAC", [file, i + 1]);
      return result;
    })
  );
  await pool.terminate();
  const elapsedSecs = (Date.now() - startMs) / 1000;
  d.L(`Result: ${results.length} files converted in ${elapsedSecs}s.`);
  return results;
}

async function executeConvert(root) {
  const startMs = Date.now();
  // list all files in dir recursilly
  let files = klawSync(root, { nodir: true }).map((f) => f.path);
  const filesCount = files.length;
  // keep only non-m4a audio files
  // todo add check to ensure is audio file
  files = await checkFiles(files);
  d.L(`Total ${filesCount} files processed in ${Date.now() - startMs}ms`);
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    d.L(`Total ${skipCount} audio files are skipped`);
  }
  const output = path.join(root, "output");
  d.L(`Input: ${root}`);
  d.L(`Output: ${output}`);
  if (files.length == 0) {
    d.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  d.L(`Total ${files.length} audio files ready to convert`);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to convert ${files.length} files?`),
    },
  ]);
  if (answer.yes) {
    allToAAC(files).then((results) => {
      d.L(chalk.green(`There are ${results.length} audio files converted.`));
    });
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function commandCheckTags(argv) {
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await executeCheckTags(root);
}

async function readTagsFromFile(file) {
  const startMs = Date.now();
  const data = await fsp.readFile(file, { encoding: "utf8" });
  const lines = data
    .split("\n")
    .filter((l) => typeof l === "string" && l.startsWith("{"));
  d.L(`readTagsFromFile: ${lines.length} lines from ${file}`);
  const tagMap = new Map();
  await Promise.all(
    lines.map(async (line, i) => {
      try {
        const tags = JSON.parse(line);
        const key = h.replaceAll("/", path.sep, tags.SourceFile);
        tagMap.set(key, tags);
      } catch (error) {
        d.E(error);
      }
    })
  );
  // const tagMap = tagArr.reduce((map, obj) => {
  //   map[obj.path] = obj.tags;
  // }, {});
  d.L(`readTagsFromFile: ${tagMap.size} tags has loaded (${h.ht(startMs)})`);
  return tagMap;
}

async function executeCheckTags(root) {
  d.L(`Input: ${root}`);
  const jsonName = sanitize(root, { replacement: "_" });
  const jsonPath = path.join("data", `alltags.json`);
  const startMs = Date.now();
  let files = exif.listFiles(root, (f) => h.isAudioFile(f.path));
  const fileCount = files.length;
  d.L(`executeCheckTags: total ${fileCount} files found (${h.ht(startMs)})`);
  const tagMap = await readTagsFromFile(jsonPath);
  files = files.map((f) => {
    f.tags = tagMap.get(f.path);
    return f;
  });
  // files = await exif.readTags(files);
  files = files.filter((f) => f.tags);
  if (files.length < fileCount) {
    d.W(
      chalk.yellow(
        `executeCheckTags: ${fileCount - files.length} files has no tags`
      )
    );
  }
  d.L(
    `executeCheckTags: ${files.length}/${fileCount} files has tags (${h.ht(
      startMs
    )})`
  );
  // (await fs.pathExists(jsonPath)) &&
  //   (await fs.move(jsonPath, jsonPath + `.${Date.now()}`));
  // let i = 0;
  // for (const f of files) {
  //   await fs.appendFile(jsonPath, JSON.stringify(f.tags) + "\n");
  //   if (++i % 1000 == 0) {
  //     d.L(`WriteJson[${++i}/${files.length}]: ${h.ht(startMs)}`);
  //   }
  // }

  // sqlite3.verbose();
  // const db = new sqlite3.Database("./data/audio.db");
  // await db.exec(
  //   "CREATE TABLE IF NOT EXISTS tags (name TEXT, path TEXT, tags TEXT, PRIMARY KEY(path));"
  // );

  // const iout = path.join(path.dirname(root), "invalid");
  // if (!fs.pathExistsSync(iout)) {
  //   fs.mkdirSync(iout);
  // }
  // files.forEach((f, i) => {
  //   const t = f.tags;
  //   if (!t.Artist || !t.Title) {
  //     d.L(`Move Invalid: ${f.path}`);
  //     // fs.moveSync(f.path, path.join(iout, path.basename(f.path)));
  //   }
  // });
  d.L(`Input: ${root}`);
  d.L(`Processed ${files.length} files in ${h.ht(startMs)}`);

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to check these files?`),
    },
  ]);
}

async function commandMoveByLng(argv) {
  d.I(`commandMoveByLng:`, argv);
  const root = path.resolve(argv.source);
  const lng = argv.lng || [];
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  if (lng.length == 0) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Language list is empty, abort!`));
    return;
  }
  if (!argv.ignore) {
    lng.push("xx");
  }
  await executeMoveByLng(root, lng);
}

async function executeMoveByLng(root, lng = []) {
  let outputs = {};
  lng.forEach((x) => {
    outputs[x] = {
      id: x,
      input: [],
      output: path.join(path.dirname(root), `${path.basename(root)}_${x}`),
    };
  });
  d.L(`executeMoveByLng:`, root);
  d.I(outputs);
  const startMs = Date.now();
  let files = exif.listFiles(root);
  files = await exif.readTags(files);
  files = files.filter((f) => {
    return f.tags && f.tags.Title && f.tags.Artist;
  });
  const fileCount = files.length;
  files.forEach((f, i) => {
    const t = f.tags;
    const name = path.basename(f.path);
    if (t.Title && t.Artist) {
      if (un.strHasHiraKana(name + t.Title + t.Artist)) {
        d.I(chalk.yellow(`JA: ${name} ${t.Artist}-${t.Title}`));
        outputs["ja"] &&
          outputs["ja"].input.push([
            f.path,
            path.join(outputs["ja"].output, name),
          ]);
      } else if (un.strHasHangul(name + t.Title + t.Artist)) {
        d.I(chalk.cyan(`KR: ${name} ${t.Artist}-${t.Title}`));
        outputs["kr"] &&
          outputs["kr"].input.push([
            f.path,
            path.join(outputs["kr"].output, name),
          ]);
      } else if (un.strHasHanyu(name + t.Title + t.Artist)) {
        d.I(chalk.green(`CN: ${name} ${t.Artist}-${t.Title}`));
        outputs["cn"] &&
          outputs["cn"].input.push([
            f.path,
            path.join(outputs["cn"].output, name),
          ]);
      } else if (un.strOnlyASCII(name + t.Title + t.Artist)) {
        // only ascii = english
        d.I(chalk.gray(`EN: ${name} ${t.Artist}-${t.Title}`));
        outputs["en"] &&
          outputs["en"].input.push([
            f.path,
            path.join(outputs["en"].output, name),
          ]);
      } else {
        d.I(chalk.gray(`MISC: ${name} ${t.Artist}-${t.Title}`));
        outputs["xx"] &&
          outputs["xx"].input.push([
            f.path,
            path.join(outputs["xx"].output, name),
          ]);
      }
    } else {
      d.W(`Invalid: ${path.basename(f.path)}`);
    }
  });

  d.L(`Input: ${root} lng=${lng}`);
  let taskCount = 0;
  for (const [k, v] of Object.entries(outputs)) {
    taskCount += v.input.length;
    d.L(
      `Prepared: [${v.id.toUpperCase()}] ${
        v.input.length
      } files will be moved to "${v.output}"`
    );
  }

  if (taskCount == 0) {
    d.L(chalk.green(`No files need to be processed, abort.`));
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to move there files?`),
    },
  ]);
  if (answer.yes) {
    const dout = path.join(path.dirname(root), "duplicate");
    if (!fs.pathExists(dout)) {
      await fs.mkdir(dout);
    }
    async function ensureMove(src, dst) {
      if (src == dst) {
        d.W(`Skip:${src}`);
        return;
      }
      if (await fs.pathExists(dst)) {
        d.W(`Duplicate:${src}`);
        await fs.move(src, path.join(dout, path.basename(src)));
      } else {
        d.D(`Moving to ${dst}`);
        await fs.move(src, dst);
        d.I(`Moved to ${dst}`);
      }
    }
    // https://zellwk.com/blog/async-await-in-loops/
    // https://techbrij.com/javascript-async-await-parallel-sequence
    // paralell execute
    // outputs = await Promise.all(
    //   Object.entries(outputs).map(async ([k, v]) => {
    //     if (!fs.pathExistsSync(v.output)) {
    //       fs.mkdirSync(v.output);
    //     }
    //     if (v.input.length == 0) {
    //       return v;
    //     }
    //     v.results = await Promise.all(
    //       v.input.map(async (a) => {
    //         const [src, dst] = a;
    //         await ensureMove(src, dst);
    //         return dst;
    //       })
    //     );
    //     d.L(`Progress: ${v.results.length} ${v.id} files moved to ${v.output}`);
    //     return v;
    //   })
    // );
    // sequential execute
    for (const [k, v] of Object.entries(outputs)) {
      if (!fs.pathExistsSync(v.output)) {
        fs.mkdirSync(v.output);
      }
      if (v.input.length == 0) {
        continue;
      }
      v.results = await Promise.all(
        v.input.map(async (a) => {
          const [src, dst] = a;
          await ensureMove(src, dst);
          return dst;
        })
      );
      d.L(
        chalk.magenta(
          `Progress: ${v.results.length} ${v.id} files moved to ${v.output}`
        )
      );
    }

    for (const [k, v] of Object.entries(outputs)) {
      v.results &&
        d.L(
          chalk.green(
            `Result: ${v.results.length} ${v.id} files moved to "${v.output}"`
          )
        );
    }
    d.L(chalk.green(`Total ${fileCount} files processed in ${h.ht(startMs)}`));
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

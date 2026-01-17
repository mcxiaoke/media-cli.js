#!/usr/bin/env/node

/*
 * Project: mediac
 * Created: 2021-07-20 16:59:09 +0800
 * Modified: 2024-04-09 22:16:36 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

const yargs = require("yargs/yargs")
const { hideBin } = require("yargs/helpers")

yargs(hideBin(process.argv))
    .command(
        "serve [port]",
        "start the server",
        (yargs) => {
            return yargs.positional("port", {
                describe: "port to bind on",
                default: 5000,
            })
        },
        (argv) => {
            if (argv.verbose) console.info(`start server on :${argv.port}`)
            serve(argv.port)
        },
    )
    .option("verbose", {
        alias: "v",
        type: "boolean",
        description: "Run with verbose logging",
    }).argv

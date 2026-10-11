/*
 * Project: mediac
 * File: sleep_blocker.js
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { spawn } from "node:child_process"
import os from "node:os"
import process from "node:process"
import * as log from "./debug.js"
import { t } from "./i18n.js"

const LOG_TAG = "SleepBlocker"

const WINDOWS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PowerHelper {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public static uint PreventSleep() {
        return SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
    }
}
"@
[PowerHelper]::PreventSleep()
while ($null -ne [Console]::In.ReadLine()) {}
`

let activeLocks = 0
let activeProcess = null
let currentReason = ""
let exitHooksInstalled = false

// 可在测试中注入自定义 runner
let customRunner = null

/**
 * 启动对应平台的阻止休眠子进程
 * @param {string} reason - 阻止休眠原因
 * @returns {import("node:child_process").ChildProcess|Object|null}
 */
function startPlatformProcess(reason) {
    if (customRunner) {
        return customRunner.start(reason)
    }

    const platform = os.platform()
    try {
        if (platform === "win32") {
            const child = spawn(
                "powershell.exe",
                [
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    WINDOWS_SCRIPT,
                ],
                {
                    stdio: ["pipe", "ignore", "ignore"],
                    windowsHide: true,
                },
            )
            child.on("error", (err) => {
                log.logWarn(LOG_TAG, t("sleepBlocker.failed", { error: err.message }))
            })
            return child
        }

        if (platform === "darwin") {
            const child = spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], {
                stdio: "ignore",
                detached: false,
            })
            child.on("error", (err) => {
                log.logWarn(LOG_TAG, t("sleepBlocker.failed", { error: err.message }))
            })
            return child
        }

        if (platform === "linux") {
            const child = spawn(
                "systemd-inhibit",
                [
                    "--what=idle:sleep",
                    `--why=${reason || "MediaCli batch processing"}`,
                    "--mode=block",
                    "sleep",
                    "infinity",
                ],
                {
                    stdio: "ignore",
                    detached: false,
                },
            )
            child.on("error", (err) => {
                log.logDebug(LOG_TAG, `systemd-inhibit unavailable: ${err.message}`)
            })
            return child
        }
    } catch (err) {
        log.logWarn(LOG_TAG, t("sleepBlocker.failed", { error: err.message }))
    }

    return null
}

/**
 * 终止休眠阻止子进程
 * @param {Object} child - 子进程实例
 */
function stopPlatformProcess(child) {
    if (!child) return
    if (customRunner && typeof customRunner.stop === "function") {
        customRunner.stop(child)
        return
    }

    try {
        if (child.stdin && !child.stdin.destroyed) {
            child.stdin.end()
        }
    } catch {
        // 忽略管道已关闭异常
    }

    try {
        if (!child.killed) {
            child.kill("SIGTERM")
        }
    } catch {
        // 忽略进程退出信号发送异常
    }
}

/**
 * 注册进程退出清理钩子
 */
function installExitHooks() {
    if (exitHooksInstalled) return
    exitHooksInstalled = true

    const cleanup = () => {
        if (activeProcess) {
            stopPlatformProcess(activeProcess)
            activeProcess = null
        }
    }

    process.once("exit", cleanup)
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, cleanup)
    }
}

/**
 * 获取系统休眠锁（阻止系统睡眠）
 * 支持引用计数，多次获取需相应次数释放
 *
 * @param {string} [reason="批处理任务"] - 锁定原因（用于日志）
 * @returns {() => void} 释放锁的函数（幂等）
 */
export function acquireSleepLock(reason = "批处理任务") {
    installExitHooks()
    activeLocks++

    if (activeLocks === 1) {
        currentReason = reason
        activeProcess = startPlatformProcess(reason)
        log.logInfo(LOG_TAG, t("sleepBlocker.activated", { reason }))
    }

    let released = false
    return function release() {
        if (released) return
        released = true

        activeLocks = Math.max(0, activeLocks - 1)
        if (activeLocks === 0 && activeProcess) {
            stopPlatformProcess(activeProcess)
            activeProcess = null
            currentReason = ""
            log.logDebug(LOG_TAG, t("sleepBlocker.released"))
        }
    }
}

/**
 * 显式完全释放休眠锁（强制归零）
 */
export function releaseSleepLock() {
    if (activeProcess) {
        stopPlatformProcess(activeProcess)
        activeProcess = null
    }
    activeLocks = 0
    currentReason = ""
    log.logDebug(LOG_TAG, t("sleepBlocker.released"))
}

/**
 * 查询当前是否处于休眠阻止状态
 * @returns {boolean}
 */
export function isSleepLockActive() {
    return activeLocks > 0
}

/**
 * 获取当前锁引用计数
 * @returns {number}
 */
export function getSleepLockCount() {
    return activeLocks
}

/**
 * 获取当前锁定的任务原因
 * @returns {string}
 */
export function getSleepLockReason() {
    return currentReason
}

/**
 * 以休眠保护作用域执行异步任务
 * 无论成功、失败或抛出异常，都会在 finally 块中确保释放锁
 *
 * @template T
 * @param {() => Promise<T>|T} taskFn - 执行的任务函数
 * @param {Object} [options={}] - 配置项
 * @param {string} [options.reason="批处理任务"] - 任务原因
 * @param {boolean} [options.enabled=true] - 是否启用休眠保护
 * @returns {Promise<T>}
 */
export async function withSleepLock(taskFn, options = {}) {
    const { reason = "批处理任务", enabled = true } = options
    if (!enabled) {
        return await taskFn()
    }

    const release = acquireSleepLock(reason)
    try {
        return await taskFn()
    } finally {
        release()
    }
}

/**
 * 用于测试环境注入 mock runner
 * @param {Object|null} runner - { start: (reason) => child, stop: (child) => void }
 */
export function _setCustomRunnerForTest(runner) {
    customRunner = runner
}

/**
 * 用于测试环境重置内部状态
 */
export function _resetStateForTest() {
    if (activeProcess) {
        stopPlatformProcess(activeProcess)
        activeProcess = null
    }
    activeLocks = 0
    currentReason = ""
    customRunner = null
}

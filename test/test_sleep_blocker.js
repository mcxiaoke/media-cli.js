import assert from "node:assert/strict"
import test from "node:test"
import {
    _resetStateForTest,
    _setCustomRunnerForTest,
    acquireSleepLock,
    getSleepLockCount,
    getSleepLockReason,
    isSleepLockActive,
    releaseSleepLock,
    withSleepLock,
} from "../lib/sleep_blocker.js"

test.beforeEach(() => {
    _resetStateForTest()
})

test.afterEach(() => {
    _resetStateForTest()
})

test("acquireSleepLock and release with ref-counting", () => {
    let startCalls = 0
    let stopCalls = 0
    const mockProcess = { id: 1234 }

    _setCustomRunnerForTest({
        start: (reason) => {
            startCalls++
            assert.equal(reason, "测试长任务")
            return mockProcess
        },
        stop: (proc) => {
            stopCalls++
            assert.equal(proc, mockProcess)
        },
    })

    assert.equal(isSleepLockActive(), false)
    assert.equal(getSleepLockCount(), 0)

    // 第一次获取锁
    const release1 = acquireSleepLock("测试长任务")
    assert.equal(startCalls, 1)
    assert.equal(stopCalls, 0)
    assert.equal(isSleepLockActive(), true)
    assert.equal(getSleepLockCount(), 1)
    assert.equal(getSleepLockReason(), "测试长任务")

    // 第二次获取锁（重入）
    const release2 = acquireSleepLock("子任务")
    assert.equal(startCalls, 1, "重入不应重复启动进程")
    assert.equal(stopCalls, 0)
    assert.equal(isSleepLockActive(), true)
    assert.equal(getSleepLockCount(), 2)

    // 释放一次
    release2()
    assert.equal(stopCalls, 0, "计数未归零前不应终止进程")
    assert.equal(isSleepLockActive(), true)
    assert.equal(getSleepLockCount(), 1)

    // 重复释放 release2 幂等性测试
    release2()
    assert.equal(getSleepLockCount(), 1, "重复调用 release 不应额外递减")

    // 释放最后一个锁
    release1()
    assert.equal(stopCalls, 1, "计数归零时应终止进程")
    assert.equal(isSleepLockActive(), false)
    assert.equal(getSleepLockCount(), 0)
    assert.equal(getSleepLockReason(), "")
})

test("withSleepLock wraps async task and releases on success", async () => {
    let started = false
    let stopped = false

    _setCustomRunnerForTest({
        start: () => {
            started = true
            return { id: 1 }
        },
        stop: () => {
            stopped = true
        },
    })

    const result = await withSleepLock(
        async () => {
            assert.equal(isSleepLockActive(), true)
            return 42
        },
        { reason: "异步测试" },
    )

    assert.equal(result, 42)
    assert.equal(started, true)
    assert.equal(stopped, true)
    assert.equal(isSleepLockActive(), false)
})

test("withSleepLock releases lock when task throws error", async () => {
    let stopped = false

    _setCustomRunnerForTest({
        start: () => ({ id: 1 }),
        stop: () => {
            stopped = true
        },
    })

    await assert.rejects(async () => {
        await withSleepLock(
            async () => {
                assert.equal(isSleepLockActive(), true)
                throw new Error("Task failed unexpectedly")
            },
            { reason: "异常测试" },
        )
    }, /Task failed unexpectedly/)

    assert.equal(stopped, true, "发生异常时也必须在 finally 中释放锁")
    assert.equal(isSleepLockActive(), false)
})

test("withSleepLock bypasses lock when enabled is false", async () => {
    let started = false

    _setCustomRunnerForTest({
        start: () => {
            started = true
            return { id: 1 }
        },
        stop: () => {},
    })

    const result = await withSleepLock(
        async () => {
            assert.equal(isSleepLockActive(), false)
            return "bypassed"
        },
        { enabled: false, reason: "已禁用" },
    )

    assert.equal(result, "bypassed")
    assert.equal(started, false, "enabled 为 false 时不应获取休眠锁")
    assert.equal(isSleepLockActive(), false)
})

test("releaseSleepLock forces reset of active locks", () => {
    let stopped = false

    _setCustomRunnerForTest({
        start: () => ({ id: 1 }),
        stop: () => {
            stopped = true
        },
    })

    acquireSleepLock("task1")
    acquireSleepLock("task2")
    assert.equal(getSleepLockCount(), 2)

    releaseSleepLock()
    assert.equal(stopped, true)
    assert.equal(getSleepLockCount(), 0)
    assert.equal(isSleepLockActive(), false)
})

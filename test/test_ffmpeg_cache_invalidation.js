/*
 * File: test_ffmpeg_cache_invalidation.js
 * Created: 2026-09-26
 *
 * 换用另一个 ffmpeg 二进制时，进程内两份探测缓存必须失效：
 *   1. hwdetect 的硬件能力（模块级单例，缓存键**不含** ffmpegPath）
 *   2. hwaccel 的各层文件探测（probeCacheKey 有意不含 ffmpegPath）
 *
 * 两者此前都只暴露了 clear* 函数却无人调用 —— 桌面端「设置 → 工具路径」改 ffmpeg 后
 * 会一直沿用旧二进制探测出的能力（编码器集合/版本/代次）与分层结论。
 *
 * 需要真实 ffmpeg；找不到时整组 skip（与 data/ 语料用例同一口径）。
 */

import assert from "assert"
import { describe, it } from "node:test"

import { resolveFFmpegBinary } from "../src/transcode/ffmpeg_bin.js"
import { setFFmpegPath } from "../src/transcode/ffmpeg_run.js"
import { clearHwCapabilitiesCache, detectHardwareCapabilities } from "../src/transcode/hwdetect.js"

// 能力探测会真实起子进程，deviceProbe:false 跳过较慢的设备初始化
const detect = (bin) => detectHardwareCapabilities({ ffmpegPath: bin, deviceProbe: false })

describe("切换 ffmpeg 二进制时失效探测缓存", () => {
    it("setFFmpegPath 换路径清空能力缓存，同路径不清空", async () => {
        const bin = await resolveFFmpegBinary()
        if (!bin) {
            return // 无 ffmpeg：skip（node:test 无独立 skip API，空返回即跳过）
        }

        // 基线：同路径连续两次命中同一份缓存
        const first = await detect(bin)
        const cached = await detect(bin)
        assert.strictEqual(cached, first, "同路径第二次探测应命中缓存（返回同一对象）")

        // 换路径（首次由 null → bin 也属「变化」）→ 必须重新探测
        setFFmpegPath(bin)
        const afterSwitch = await detect(bin)
        assert.notStrictEqual(
            afterSwitch,
            first,
            "setFFmpegPath 变化后必须重新探测，不能返回旧能力对象",
        )

        // 同路径再次设置：不应误清空（否则每次启动都白白重探）
        const reCached = await detect(bin)
        setFFmpegPath(bin)
        const afterSame = await detect(bin)
        assert.strictEqual(afterSame, reCached, "setFFmpegPath 传入相同路径时不应清空缓存")

        clearHwCapabilitiesCache()
    })
})

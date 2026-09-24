import assert from "assert"
import test from "node:test"
import { WebServer } from "../ffweb/server.js"

test("ffweb API requires token and same-origin requests", async (t) => {
    const server = new WebServer({ port: 0, host: "127.0.0.1", autoExit: false })
    const info = await server.start()
    const baseUrl = `http://${info.host}:${info.port}`

    t.after(async () => {
        await server.close()
    })

    let res = await fetch(`${baseUrl}/api/snapshot`)
    assert.strictEqual(res.status, 401)

    res = await fetch(`${baseUrl}/api/snapshot`, {
        headers: { "X-Token": "wrong-token" },
    })
    assert.strictEqual(res.status, 401)

    res = await fetch(`${baseUrl}/api/snapshot`, {
        headers: {
            "X-Token": info.token,
            Origin: "http://evil.example",
        },
    })
    assert.strictEqual(res.status, 403)

    res = await fetch(`${baseUrl}/api/snapshot`, {
        headers: {
            "X-Token": info.token,
            Origin: baseUrl,
        },
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get("access-control-allow-origin"), baseUrl)

    res = await fetch(`${baseUrl}/api/snapshot`, {
        method: "OPTIONS",
        headers: { Origin: baseUrl },
    })
    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.headers.get("access-control-allow-origin"), baseUrl)
})

test("ffweb rejects oversized request bodies before planning", async (t) => {
    const server = new WebServer({ port: 0, host: "127.0.0.1", autoExit: false })
    const info = await server.start()
    const baseUrl = `http://${info.host}:${info.port}`

    t.after(async () => {
        await server.close()
    })

    const res = await fetch(`${baseUrl}/api/plan`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Token": info.token,
        },
        body: JSON.stringify({
            inputs: [String.fromCharCode(0x41).repeat(2 * 1024 * 1024)],
        }),
    })
    assert.strictEqual(res.status, 413)
})

test("ffweb refuses non-loopback binding", async () => {
    const server = new WebServer({ port: 0, host: "0.0.0.0", autoExit: false })
    await assert.rejects(() => server.start(), /remote binding is disabled/)
})

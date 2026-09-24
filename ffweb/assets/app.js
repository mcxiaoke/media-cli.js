/* global document, window, EventSource, alert, confirm */
/**
 * ffweb 客户端逻辑
 */
const state = {
    env: null,
    inputs: [],
    output: "",
    preset: "hevc_2k",
    status: "IDLE",
    plan: null,
    progress: null,
    logs: [],
}

// DOM 元素引用
const el = {
    hwBadge: document.getElementById("hwBadge"),
    stateBadge: document.getElementById("stateBadge"),
    presetSelect: document.getElementById("presetSelect"),
    presetBadges: document.getElementById("presetBadges"),
    inputsList: document.getElementById("inputsList"),
    inputManual: document.getElementById("inputManual"),
    outputDir: document.getElementById("outputDir"),
    videoQuality: document.getElementById("videoQuality"),
    dimensionSelect: document.getElementById("dimensionSelect"),
    dimensionCustom: document.getElementById("dimensionCustom"),
    videoBitrateSelect: document.getElementById("videoBitrateSelect"),
    videoBitrateCustom: document.getElementById("videoBitrateCustom"),
    fpsSelect: document.getElementById("fpsSelect"),
    speedSelect: document.getElementById("speedSelect"),
    audioCodecSelect: document.getElementById("audioCodecSelect"),
    audioBitrateSelect: document.getElementById("audioBitrateSelect"),
    optAnime: document.getElementById("optAnime"),
    optOverride: document.getElementById("optOverride"),
    optStrict: document.getElementById("optStrict"),
    btnPlan: document.getElementById("btnPlan"),
    btnStart: document.getElementById("btnStart"),
    btnStop: document.getElementById("btnStop"),
    tasksTableBody: document.getElementById("tasksTableBody"),
    planSummary: document.getElementById("planSummary"),
    cmdPreview: document.getElementById("cmdPreview"),
    progressBarFill: document.getElementById("progressBarFill"),
    progressPercent: document.getElementById("progressPercent"),
    progressSpeed: document.getElementById("progressSpeed"),
    progressFps: document.getElementById("progressFps"),
    progressCurrentTime: document.getElementById("progressCurrentTime"),
    progressCurrentFile: document.getElementById("progressCurrentFile"),
    terminalLogs: document.getElementById("terminalLogs"),
}

// 初始化
async function init() {
    setupSSE()
    await loadEnv()
    bindEvents()
}

// 建立 SSE 实时通道
function setupSSE() {
    const es = new EventSource("/api/events")

    es.addEventListener("SNAPSHOT", (e) => {
        const snap = JSON.parse(e.data)
        if (snap.status) updateStatus(snap.status)
        if (snap.recentLogs) {
            state.logs = snap.recentLogs
            renderLogs()
        }
        if (snap.currentPlan) {
            state.plan = snap.currentPlan
            renderPlan()
        }
    })

    es.addEventListener("STATUS_CHANGE", (e) => {
        const data = JSON.parse(e.data)
        updateStatus(data.status)
    })

    es.addEventListener("PROGRESS", (e) => {
        const data = JSON.parse(e.data)
        state.progress = data
        renderProgress()
    })

    es.addEventListener("FILE_DONE", (e) => {
        const data = JSON.parse(e.data)
        updateTaskStatus(data.index, data.ok ? (data.skipped ? "skipped" : "done") : "failed")
    })

    es.addEventListener("LOG", (e) => {
        const logItem = JSON.parse(e.data)
        state.logs.push(logItem)
        if (state.logs.length > 300) state.logs.shift()
        appendLogItem(logItem)
    })

    es.addEventListener("ALL_DONE", (e) => {
        const summary = JSON.parse(e.data)
        renderSummary(summary)
    })
}

// 加载系统与预设环境
async function loadEnv() {
    try {
        const res = await fetch("/api/env")
        const data = await res.json()
        if (!data.ok) return

        state.env = data
        const gpuNames = data.hwCaps.gpus.map((g) => g.name || g.model).join(", ")
        el.hwBadge.textContent = gpuNames ? `GPU: ${gpuNames}` : "GPU: CPU Mode"

        // 填充预设下拉框，显示关键参数
        el.presetSelect.innerHTML = ""
        for (const p of data.presets) {
            const opt = document.createElement("option")
            opt.value = p.name
            const parts = []
            if (p.videoCodecFamily) parts.push(p.videoCodecFamily.toUpperCase())
            if (p.audioCodec) parts.push(p.audioCodec.toUpperCase())
            if (p.videoQuality) parts.push(`CRF:${p.videoQuality}`)
            if (p.dimension) parts.push(`${p.dimension}p`)
            if (p.maxBitrate) parts.push(`Max:${Math.round(p.maxBitrate / 1000000)}M`)
            const badgeStr = parts.length ? ` [${parts.join(" | ")}]` : ""
            opt.textContent = `${p.name}${badgeStr}`
            if (p.name === "hevc_2k" || p.name === "h264_2k") opt.selected = true
            el.presetSelect.appendChild(opt)
        }
        if (!el.presetSelect.value && data.presets.length > 0) {
            el.presetSelect.value = data.presets[0].name
        }
        updatePresetDesc()
    } catch (err) {
        console.error("Failed to load env", err)
    }
}

function updatePresetDesc() {
    const selectedName = el.presetSelect.value
    const p = state.env?.presets?.find((x) => x.name === selectedName)
    el.presetBadges.innerHTML = ""
    if (!p) return

    const badges = []
    badges.push({ text: p.type === "video" ? "🎬 视频预设" : "🎵 音频预设", highlight: false })
    if (p.format) badges.push({ text: `输出容器: ${p.format}`, highlight: false })
    if (p.videoCodecFamily)
        badges.push({ text: `编码族: ${p.videoCodecFamily.toUpperCase()}`, highlight: true })
    if (p.audioCodec)
        badges.push({ text: `音频编码: ${p.audioCodec.toUpperCase()}`, highlight: false })
    if (p.videoQuality) badges.push({ text: `基准 CRF: ${p.videoQuality}`, highlight: true })
    if (p.dimension) badges.push({ text: `尺寸限制: ${p.dimension}p`, highlight: false })
    if (p.maxBitrate)
        badges.push({ text: `峰值码率: ${Math.round(p.maxBitrate / 1000000)}M`, highlight: false })
    if (p.audioBitrate)
        badges.push({ text: `音频码率: ${Math.round(p.audioBitrate / 1000)}k`, highlight: false })
    if (p.desc) badges.push({ text: p.desc, highlight: false })

    for (const b of badges) {
        const span = document.createElement("span")
        span.className = `preset-badge ${b.highlight ? "highlight" : ""}`
        span.textContent = b.text
        el.presetBadges.appendChild(span)
    }
}

function updateStatus(newStatus) {
    state.status = newStatus
    el.stateBadge.className = `state-badge state-${newStatus}`
    el.stateBadge.textContent = newStatus

    el.btnStart.disabled = newStatus === "RUNNING" || !state.plan
    el.btnStop.disabled = newStatus !== "RUNNING"
    el.btnPlan.disabled = newStatus === "RUNNING"
}

// 绑定用户交互事件
function bindEvents() {
    el.presetSelect.addEventListener("change", updatePresetDesc)

    // 选择源文件
    const btnBrowseFiles = document.getElementById("btnBrowseFiles")
    btnBrowseFiles.addEventListener("click", async () => {
        const origText = btnBrowseFiles.textContent
        btnBrowseFiles.disabled = true
        btnBrowseFiles.textContent = "⏳ 打开中..."
        try {
            const res = await fetch("/api/dialog/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "file", multi: true, title: "选择媒体文件" }),
            })
            const data = await res.json()
            if (data.paths?.length) {
                addInputs(data.paths)
            }
        } catch (err) {
            alert(`打开文件选择窗口失败: ${err.message}`)
        } finally {
            btnBrowseFiles.disabled = false
            btnBrowseFiles.textContent = origText
        }
    })

    // 选择源目录
    const btnBrowseDir = document.getElementById("btnBrowseDir")
    btnBrowseDir.addEventListener("click", async () => {
        const origText = btnBrowseDir.textContent
        btnBrowseDir.disabled = true
        btnBrowseDir.textContent = "⏳ 打开中..."
        try {
            const res = await fetch("/api/dialog/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "directory", title: "选择源媒体文件夹" }),
            })
            const data = await res.json()
            if (data.paths?.length) {
                addInputs(data.paths)
            }
        } catch (err) {
            alert(`打开目录选择窗口失败: ${err.message}`)
        } finally {
            btnBrowseDir.disabled = false
            btnBrowseDir.textContent = origText
        }
    })

    // 手动添加输入路径
    document.getElementById("btnAddManual").addEventListener("click", () => {
        const val = el.inputManual.value.trim()
        if (val) {
            addInputs([val])
            el.inputManual.value = ""
        }
    })

    el.inputManual.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = el.inputManual.value.trim()
            if (val) {
                addInputs([val])
                el.inputManual.value = ""
            }
        }
    })

    // 清空输入
    document.getElementById("btnClearInputs").addEventListener("click", () => {
        state.inputs = []
        renderInputs()
    })

    // 自定义分辨率与码率输入框切换
    el.dimensionSelect.addEventListener("change", () => {
        el.dimensionCustom.style.display = el.dimensionSelect.value === "custom" ? "block" : "none"
    })
    el.videoBitrateSelect.addEventListener("change", () => {
        el.videoBitrateCustom.style.display =
            el.videoBitrateSelect.value === "custom" ? "block" : "none"
    })

    // 选择输出目录
    const btnBrowseOutput = document.getElementById("btnBrowseOutput")
    btnBrowseOutput.addEventListener("click", async () => {
        const origText = btnBrowseOutput.textContent
        btnBrowseOutput.disabled = true
        btnBrowseOutput.textContent = "⏳ 打开中..."
        try {
            const res = await fetch("/api/dialog/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "directory", title: "选择输出目录" }),
            })
            const data = await res.json()
            if (data.paths?.length) {
                el.outputDir.value = data.paths[0]
                state.output = data.paths[0]
            }
        } catch (err) {
            alert(`打开输出目录选择窗口失败: ${err.message}`)
        } finally {
            btnBrowseOutput.disabled = false
            btnBrowseOutput.textContent = origText
        }
    })

    // 生成计划
    el.btnPlan.addEventListener("click", async () => {
        if (state.inputs.length === 0) {
            alert("请先添加至少一个输入文件或目录！")
            return
        }

        const options = {
            anime: el.optAnime.checked,
            override: el.optOverride.checked,
            strict: el.optStrict.checked,
        }
        if (el.videoQuality.value) {
            options.videoQuality = Number(el.videoQuality.value)
        }
        // 分辨率
        if (el.dimensionSelect.value === "custom") {
            if (el.dimensionCustom.value) options.dimension = Number(el.dimensionCustom.value)
        } else if (Number(el.dimensionSelect.value) > 0) {
            options.dimension = Number(el.dimensionSelect.value)
        }
        // 视频码率
        if (el.videoBitrateSelect.value === "custom") {
            if (el.videoBitrateCustom.value.trim())
                options.videoBitrate = el.videoBitrateCustom.value.trim()
        } else if (el.videoBitrateSelect.value) {
            options.videoBitrate = el.videoBitrateSelect.value
        }
        // 帧率
        if (Number(el.fpsSelect.value) > 0) {
            options.fps = Number(el.fpsSelect.value)
        }
        // 倍速
        if (Number(el.speedSelect.value) > 0) {
            options.speed = Number(el.speedSelect.value)
        }
        // 音频
        if (el.audioCodecSelect.value) {
            options.audioCodec = el.audioCodecSelect.value
        }
        if (el.audioBitrateSelect.value) {
            options.audioBitrate = el.audioBitrateSelect.value
        }

        try {
            el.btnPlan.disabled = true
            el.btnPlan.textContent = "分析中..."
            const res = await fetch("/api/plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inputs: state.inputs,
                    output: el.outputDir.value.trim(),
                    preset: el.presetSelect.value,
                    options,
                }),
            })
            const data = await res.json()
            if (data.ok) {
                state.plan = data.plan
                renderPlan()
                updateStatus("IDLE")
            } else {
                alert(`生成计划失败: ${data.error}`)
            }
        } catch (err) {
            alert(`请求出错: ${err.message}`)
        } finally {
            el.btnPlan.disabled = false
            el.btnPlan.textContent = "分析并生成计划"
        }
    })

    // 开始执行
    el.btnStart.addEventListener("click", async () => {
        if (!state.plan) return
        const res = await fetch("/api/task/start", { method: "POST" })
        const data = await res.json()
        if (!data.ok) {
            alert(`启动失败: ${data.error}`)
        }
    })

    // 终止任务
    el.btnStop.addEventListener("click", async () => {
        if (!confirm("确定要终止正在运行的转码任务吗？")) return
        const res = await fetch("/api/task/stop", { method: "POST" })
        const data = await res.json()
        if (!data.ok) {
            alert(`终止失败: ${data.message || data.error}`)
        }
    })

    // 清空日志
    document.getElementById("btnClearLogs").addEventListener("click", () => {
        state.logs = []
        el.terminalLogs.innerHTML = ""
    })
}

function addInputs(paths) {
    for (const p of paths) {
        if (p && !state.inputs.includes(p)) {
            state.inputs.push(p)
        }
    }
    renderInputs()
}

function renderInputs() {
    el.inputsList.innerHTML = ""
    for (let i = 0; i < state.inputs.length; i++) {
        const p = state.inputs[i]
        const tag = document.createElement("div")
        tag.className = "tag-item"
        tag.innerHTML = `<span>${escapeHtml(p)}</span><span class="tag-remove" data-idx="${i}">✕</span>`
        el.inputsList.appendChild(tag)
    }

    el.inputsList.querySelectorAll(".tag-remove").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const idx = Number(e.target.getAttribute("data-idx"))
            state.inputs.splice(idx, 1)
            renderInputs()
        })
    })
}

function renderPlan() {
    if (!state.plan) return
    const p = state.plan
    el.planSummary.textContent = `待处理文件: ${p.totalTasks} 个 | 预估总时长: ${p.humanDuration} | 预估体积: ${p.humanSize}`
    el.cmdPreview.textContent = p.previewCmd || "N/A"

    el.tasksTableBody.innerHTML = ""
    for (const t of p.tasks) {
        const tr = document.createElement("tr")
        tr.id = `task-row-${t.index}`
        tr.innerHTML = `
            <td>${t.index + 1}</td>
            <td style="word-break: break-all;">${escapeHtml(t.name)}</td>
            <td>${t.humanSize}</td>
            <td>${t.humanDuration}</td>
            <td class="task-status">${renderStatusBadge(t.status)}</td>
        `
        el.tasksTableBody.appendChild(tr)
    }

    el.btnStart.disabled = state.status === "RUNNING"
}

function updateTaskStatus(index, status) {
    const row = document.getElementById(`task-row-${index}`)
    if (row) {
        const cell = row.querySelector(".task-status")
        if (cell) cell.innerHTML = renderStatusBadge(status)
    }
}

function renderStatusBadge(status) {
    switch (status) {
        case "done":
            return `<span style="color: #10b981; font-weight: bold;">✓ 完成</span>`
        case "running":
            return `<span style="color: #38bdf8; font-weight: bold;">● 运行中</span>`
        case "failed":
            return `<span style="color: #ef4444; font-weight: bold;">✕ 失败</span>`
        case "skipped":
            return `<span style="color: #f59e0b;">跳过</span>`
        default:
            return `<span style="color: #64748b;">待处理</span>`
    }
}

function renderProgress() {
    if (!state.progress) return
    const p = state.progress
    el.progressBarFill.style.width = `${p.percent}%`
    el.progressPercent.textContent = `${p.percent}%`
    el.progressSpeed.textContent = p.speed || "0x"
    el.progressCurrentFile.textContent = `[${p.taskIndex + 1}/${p.totalTasks}] ${p.currentFile}`
    el.progressCurrentTime.textContent = `${formatSeconds(p.currentTime)} / ${formatSeconds(p.srcDuration)}`

    updateTaskStatus(p.taskIndex, "running")
}

function renderSummary(s) {
    alert(
        `转码批次完成！\n总计: ${s.total} 个 | 成功: ${s.success} | 失败: ${s.failed}\n耗时: ${s.humanElapsed}`,
    )
}

function renderLogs() {
    el.terminalLogs.innerHTML = ""
    for (const item of state.logs) {
        appendLogItem(item)
    }
}

function appendLogItem(item) {
    const div = document.createElement("div")
    div.className = `log-line log-${item.level} log-tag-${item.tag?.toLowerCase()}`

    let tagColor = "var(--accent)"
    if (item.tag === "Command") tagColor = "#38bdf8"
    else if (item.tag === "Prepare") tagColor = "#a7f3d0"
    else if (item.tag === "Done") tagColor = "#4ade80"
    else if (item.level === "error") tagColor = "var(--danger)"
    else if (item.level === "warn") tagColor = "var(--warning)"

    div.innerHTML = `
        <span class="log-time">[${item.time}]</span>
        <span class="log-tag" style="color: ${tagColor}; font-weight: 700;">[${item.tag}]</span>
        <span class="log-msg" style="${item.tag === "Command" ? "color: #7dd3fc; font-weight: 500;" : ""}">${escapeHtml(item.message)}</span>
    `
    el.terminalLogs.appendChild(div)
    el.terminalLogs.scrollTop = el.terminalLogs.scrollHeight
}

function formatSeconds(sec) {
    if (!sec || isNaN(sec)) return "00:00:00"
    const s = Math.floor(sec)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = s % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

window.addEventListener("DOMContentLoaded", init)

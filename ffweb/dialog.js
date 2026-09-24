/**
 * 本地系统原生对话框服务
 *
 * 通过操作系统原生对话框（Windows PowerShell / .NET WinForms）呼出文件/目录选择窗口，
 * 直接返回操作系统的绝对物理路径，规避普通 Web 浏览器沙箱屏蔽真实文件路径的限制。
 */
import { execa } from "execa"
import * as log from "../lib/debug.js"

export function sanitizeDialogTitle(title) {
    return [...String(title ?? "Select")]
        .map((char) => {
            const code = char.charCodeAt(0)
            return code <= 0x1f || code === 0x7f ? " " : char
        })
        .join("")
        .trim()
        .slice(0, 200)
}

/**
 * 调起系统原生文件或目录选择对话框
 * @param {Object} options
 * @param {"file"|"directory"} [options.mode="file"] - 对话框模式
 * @param {boolean} [options.multi=true] - 是否允许多选（仅文件模式有效）
 * @param {string} [options.title="Select"] - 窗口标题
 * @returns {Promise<string[]>} 选中的绝对路径列表，取消则返回空数组
 */
export async function openNativeDialog({
    mode = "file",
    multi = true,
    title = "Select File or Directory",
} = {}) {
    const safeTitle = sanitizeDialogTitle(title)
    if (process.platform === "win32") {
        return openWindowsDialog({ mode, multi, title: safeTitle })
    }
    if (process.platform === "darwin") {
        return openMacDialog({ mode, multi, title: safeTitle })
    }
    return openLinuxDialog({ mode, multi, title: safeTitle })
}

/**
 * 通过 PowerShell 运行脚本并确保 Base64 编码与 STA 运行环境
 */
async function runPowerShell(script, env = {}) {
    const b64 = Buffer.from(script, "utf16le").toString("base64")
    const { stdout } = await execa(
        "powershell",
        ["-NoProfile", "-STA", "-InputFormat", "None", "-EncodedCommand", b64],
        {
            encoding: "utf8",
            timeout: 120000,
            env: { ...process.env, ...env },
        },
    )
    return stdout
}

/**
 * Windows 平台原生对话框实现
 */
async function openWindowsDialog({ mode, multi, title }) {
    try {
        const filterStr =
            "Media Files (*.mp4;*.mkv;*.mov;*.flv;*.avi;*.ts;*.webm;*.mp3;*.m4a;*.flac;*.wav)|*.mp4;*.mkv;*.mov;*.flv;*.avi;*.ts;*.webm;*.mp3;*.m4a;*.flac;*.wav|Video Files (*.mp4;*.mkv;*.mov;*.avi;*.flv;*.ts;*.webm)|*.mp4;*.mkv;*.mov;*.avi;*.flv;*.ts;*.webm|Audio Files (*.mp3;*.m4a;*.flac;*.wav;*.aac)|*.mp3;*.m4a;*.flac;*.wav;*.aac|All Files (*.*)|*.*"
        const isDirectory = mode === "directory"
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.Opacity = 0
$form.ShowInTaskbar = $false
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.Show()
$form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
$form.Activate()
$form.BringToFront()
$title = [Environment]::GetEnvironmentVariable("MEDIAC_DIALOG_TITLE")
${
    isDirectory
        ? `
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = $title
$dlg.ShowNewFolderButton = $true
$res = $dlg.ShowDialog($form)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine($dlg.SelectedPath)
}
`
        : `
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = $title
$dlg.Multiselect = ${multi ? "$true" : "$false"}
$dlg.Filter = "${filterStr}"
$res = $dlg.ShowDialog($form)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    foreach ($f in $dlg.FileNames) {
        [Console]::Out.WriteLine($f)
    }
}
`
}
$form.Dispose()
`
        const stdout = await runPowerShell(psScript, { MEDIAC_DIALOG_TITLE: title })
        const lines = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        return lines
    } catch (err) {
        log.logWarn("Dialog", `Failed to open native dialog: ${err.message}`)
        return []
    }
}

/**
 * macOS 平台对话框（备用）
 */
async function openMacDialog({ mode, multi, title }) {
    try {
        const script = `on run argv
set theTitle to item 1 of argv
set theMode to item 2 of argv
set allowMultiple to item 3 of argv
if theMode is "directory" then
    choose folder with prompt theTitle
else
    choose file with prompt theTitle multiple selections allowed allowMultiple
end if
end run`
        const { stdout } = await execa("osascript", [
            "-e",
            script,
            "--",
            title,
            mode,
            multi ? "true" : "false",
        ])
        const res = stdout.trim()
        return res ? [res] : []
    } catch {
        return []
    }
}

/**
 * Linux 平台对话框（备用）
 */
async function openLinuxDialog({ mode, multi, title }) {
    try {
        const args = ["--file-selection", `--title=${title}`]
        if (mode === "directory") args.push("--directory")
        if (multi) args.push("--multiple", "--separator=\\n")
        const { stdout } = await execa("zenity", args)
        return stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
    } catch {
        return []
    }
}

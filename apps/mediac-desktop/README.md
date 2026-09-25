# MediaCli Desktop

独立的 Electron 客户端实验包，根目录的 `mediac` CLI 保持不变。主进程经根项目
`src/transcode/index.js` facade 使用转码能力，不直接依赖其内部模块。

## 开发运行

```powershell
cd apps/mediac-desktop
npm install
npm run dev
```

需要 Chromium 远程调试时：

```powershell
npm run dev:debug
```

## 检查与构建

```powershell
npm run typecheck
npm run build
npm run package:win
```

`win-unpacked` 位于 `apps/mediac-desktop/release/win-unpacked`。
首次安装如果 Electron 二进制尚未下载，可执行：

```powershell
npm run ensure:electron
```

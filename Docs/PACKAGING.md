# Bojin 桌面安装包构建指南

## 1. 当前支持的安装包

桌面端的 `desktop/package.json` 已使用 Electron Builder 配置以下目标：

| 系统 | 架构 | 产物 |
| --- | --- | --- |
| macOS | Apple Silicon `arm64` | DMG、ZIP |
| macOS | Intel `x64` | DMG、ZIP |
| Windows | `x64` | NSIS 安装程序 EXE |

构建产物位于 `desktop/release/`。每次开始正式构建时，该目录都会被清理，因此需要提前移走仍需保留的旧安装包。

项目包含 `better-sqlite3` 和 `ffmpeg-static` 等平台原生文件。Windows 包应在 Windows x64 上构建；Mac 包应在对应架构的 Mac 上构建。不要把一台机器的 `node_modules` 复制到另一种系统或架构后直接打包。

## 2. 推荐：新机器一键打包

仓库提供的自举脚本不要求预装 Node.js 或 pnpm。脚本会：

1. 在 `desktop/.packaging-tools/` 下载固定版本的便携 Node.js `22.23.2`。
2. 使用 Node.js 官方 `SHASUMS256.txt` 校验下载文件。
3. 在同一目录安装 pnpm `10.28.2`，不修改系统全局 Node/pnpm。
4. 安装桌面端与浏览器插件的锁定依赖、运行 TypeScript 检查并构建安装包。
5. Windows 下自动使用国内可访问的 FFmpeg、Electron、Electron Builder 和 `better-sqlite3` 二进制镜像，并在依赖安装出现短暂网络失败时重试三次。

该目录已被 Git 忽略，第二次构建会复用已经下载的工具。
脚本以非交互模式运行；如果检测到来自其他 pnpm 版本、系统或 CPU 架构的 `node_modules`，pnpm 可以直接重建，而不会停在终端确认提示。
Electron Builder 会被明确指定为 `--publish never`，一键脚本只在本机生成安装文件，不会创建或上传远程 Release。

标准安装包会显式关闭已经停用的官方账号登录与会员入口，启动后直接进入本地工作台；本地空间创建也不再依赖官方会员状态。

### 2.1 macOS

从仓库根目录执行：

```bash
cd desktop
bash ./scripts/package-macos.sh
```

默认生成当前 Mac CPU 架构对应的无签名本地测试包：

- Apple Silicon Mac 生成 `arm64` 包。
- Intel Mac 生成 `x64` 包。

构建过程中如果提示缺少原生编译工具，先运行：

```bash
xcode-select --install
```

完成系统弹窗中的安装后，再重新运行一键命令。

### 2.2 Windows

在 Windows PowerShell 中从仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\package-windows.ps1
```

如果已经进入 `desktop` 目录，也可以执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

默认生成无签名的 Windows x64 NSIS 安装程序：

```text
desktop\release\Bojin-<版本>-x64.exe
```

通常预编译原生依赖可以直接安装。如果出现 `node-gyp`、C++ 编译或 `better-sqlite3` 错误，需要安装：

- Visual Studio Build Tools 2022；
- `Desktop development with C++`（使用 C++ 的桌面开发）工作负载；
- Windows 10/11 SDK；
- Python 3。

这些组件体积较大、需要管理员权限和交互确认，所以自举脚本不会静默安装它们。

## 3. 已安装 Node.js 时手动打包

项目要求 Node.js `>=22 <23`，推荐 Node.js `22.23.2` 和 pnpm `10.28.2`。

安装依赖和检查源码：

```bash
cd desktop
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
pnpm run check:types
```

macOS 无签名构建：

```bash
pnpm run build:mac:nosign
```

此项目的旧命令会同时请求 `x64` 和 `arm64` 两套 Mac 产物。由于 FFmpeg 和 SQLite 原生文件与架构有关，发布时更推荐使用上一节的一键脚本，只构建当前机器的原生架构。

Windows x64 构建：

```powershell
pnpm run build:win
```

不建议在 Mac 上直接运行 `pnpm run build:all` 生成 Windows 正式包。即使 Electron Builder 能完成交叉打包，包内也可能混入 Mac 版本的 FFmpeg 或原生 Node 模块。

## 4. 正式签名和分发

### 4.1 macOS 签名与公证

无签名 DMG 适合本机或内部验证；其他用户打开时会遇到 Gatekeeper 警告。正式对外分发需要：

- Apple Developer Program 账号；
- `Developer ID Application` 证书；
- 与证书一致的 Team ID；
- Apple 公证认证信息。

仓库的 `desktop/package.json` 当前写有特定组织的签名 identity 和 Team ID。只有持有对应证书的机器才能直接使用；其他组织应先把它们替换为自己的值，且不能把证书、密码或 API 私钥提交进仓库。

配置好钥匙串证书与公证环境变量后执行：

```bash
cd desktop
bash ./scripts/package-macos.sh --signed
```

验证签名、公证和安装包：

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Bojin.app
spctl --assess --verbose --type execute release/mac-arm64/Bojin.app
xcrun stapler validate release/Bojin-<版本>-arm64.dmg
```

Intel Mac 构建时，将路径中的 `mac-arm64` 和 `arm64` 换成 `mac`/实际输出目录及 `x64` 文件名。

### 4.2 Windows 代码签名

无签名 EXE 可以安装，但 Windows 可能显示“未知发布者”或 SmartScreen 警告。准备好 Authenticode 证书后，在当前 PowerShell 会话设置凭据：

```powershell
$env:WIN_CSC_LINK = 'C:\secure\codesign.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<证书密码>'
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\package-windows.ps1 -Mode Signed
```

凭据只应保存在安全的本地环境或 CI Secret 中。

## 5. 网络与镜像配置

首次构建需要下载 Node.js、pnpm 包、Electron、FFmpeg 和项目依赖。仓库的 `desktop/.npmrc` 已为 Electron 配置下载镜像。

Windows 一键脚本默认使用以下镜像，通常不需要手动配置：

- `FFMPEG_BINARIES_URL=https://npmmirror.com/mirrors/ffmpeg-static`
- `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- `npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3`

如需使用公司镜像或代理，可以在运行脚本前设置同名环境变量；脚本会保留用户已设置的值。

如果 npm registry 访问较慢，可以只对当前命令设置镜像。

macOS：

```bash
npm_config_registry=https://registry.npmmirror.com bash ./desktop/scripts/package-macos.sh
```

Windows PowerShell：

```powershell
$env:npm_config_registry = 'https://registry.npmmirror.com'
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\package-windows.ps1
```

也可以通过 `REDBOX_NODE_DIST_URL` 指定包含目标 Node 压缩包和 `SHASUMS256.txt` 的版本目录。示例：

```bash
REDBOX_NODE_DIST_URL=https://nodejs.org/dist/v22.23.2 bash ./desktop/scripts/package-macos.sh
```

## 6. 常见问题

### TypeScript 检查失败

一键脚本会在打包前执行 `pnpm run check:types`。必须先修复所有 TypeScript 错误，安装包构建才会继续。

### 依赖来自另一套系统或 CPU 架构

不要复制 `desktop/node_modules`。在目标机器重新克隆源码或删除该生成目录，然后重新运行一键脚本，让 pnpm 安装与当前平台匹配的依赖。

### Node.js 下载校验失败

脚本会删除校验失败的缓存压缩包并退出。检查代理或镜像是否修改了下载内容，再运行一次。不要绕过 SHA-256 校验。

### Windows 安装依赖时出现 `ETIMEDOUT` 或 `ffmpeg-static install failed`

这是 FFmpeg 二进制文件从 GitHub 下载超时，不是项目代码编译错误。更新到最新的 `scripts/package-windows.ps1` 后直接重新执行一键打包命令即可；脚本会切换到 FFmpeg 镜像并自动重试，不需要删除已下载的便携 Node.js 或 pnpm。

如果暂时无法更新脚本，可在当前 PowerShell 窗口先执行：

```powershell
$env:FFMPEG_BINARIES_URL = 'https://npmmirror.com/mirrors/ffmpeg-static'
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:npm_config_better_sqlite3_binary_host = 'https://registry.npmmirror.com/-/binary/better-sqlite3'
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\package-windows.ps1
```

### Windows 构建插件时出现 `spawnSync pnpm.cmd EINVAL`

这是 Node.js 在 Windows 上把 `pnpm.cmd` 当作普通可执行文件启动失败。更新最新的 `scripts/prepare-plugin-runtime.cjs` 和 `scripts/package-windows.ps1` 后，重新执行一键打包命令即可。脚本会直接复用便携 pnpm 的 JavaScript 入口，并自动安装浏览器插件依赖，不要求系统全局安装 pnpm。

### macOS 可以构建但别的电脑打不开

确认使用的是匹配对方 CPU 的包；对外分发还必须完成 Developer ID 签名和 Apple 公证。无签名包只作为本地测试产物。

### Windows 安装后视频能力异常

检查安装包内是否包含 Windows x64 的 `ffmpeg.exe`，并确认安装包确实是在 Windows 上用全新依赖构建，而不是从 Mac 交叉打包得到。

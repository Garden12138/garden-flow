# GardenFlow 安装包构建与发布

GardenFlow 通过 GitHub Releases 提供公开安装包。项目采用非商业 Source-Available 许可证，并非 OSI 认可的开源软件；安装包及其使用仍受仓库 `LICENSE` 约束。

## 前置检查

```bash
node --version
pnpm --version
pnpm run setup
pnpm check
pnpm test
```

要求 Node.js 22 与 pnpm 10.28.2。构建会准备两个浏览器扩展、Native Host、FFmpeg、prompt library、renderer 和 Electron main bundle。

## 当前平台无签名构建

```bash
pnpm build
```

产物位于 `desktop/release/`。根命令调用桌面端的当前平台无签名构建，不会自动创建 GitHub Release。

用于复现正式发行产物的单平台命令：

```bash
pnpm --dir desktop build:release:mac:arm64
pnpm --dir desktop build:release:mac:x64
pnpm --dir desktop build:release:win:x64
pnpm --dir desktop build:release:linux:x64
```

原生模块、Native Host 和 `ffmpeg-static` 必须在与目标平台、目标架构一致的环境中构建。不要在 arm64 Mac 上交叉生成 x64 正式包，反之亦然。

## Tag 自动发行

`.github/workflows/release.yml` 仅接受稳定版 tag。发布前先把 `desktop/package.json` 的 `version` 更新为目标版本并合并到 `main`，然后创建并推送对应 tag：

```bash
git tag -a v0.0.1 -m "GardenFlow v0.0.1"
git push origin v0.0.1
```

约束如下：

- tag 必须严格使用 `vX.Y.Z`，不接受 beta、rc 或其他后缀；
- tag 必须与 `desktop/package.json` 的版本完全一致；
- tag 指向的提交必须包含在 `main` 历史中；
- `pnpm check` 和 `pnpm test` 必须先通过。

验证通过后，Actions 会在目标系统 runner 上并行构建：

| 平台 | 架构 | Release 资产 |
| --- | --- | --- |
| macOS | arm64 | `GardenFlow-X.Y.Z-arm64.dmg` |
| macOS | x64 | `GardenFlow-X.Y.Z-x64.dmg` |
| Windows | x64 | `GardenFlow-X.Y.Z-x64.exe` |
| Linux | x64 | `GardenFlow-X.Y.Z-x64.AppImage`、`GardenFlow-X.Y.Z-x64.deb` |

汇总任务会确认五个安装包完整且名称正确，生成 `SHA256SUMS.txt` 和 GitHub 构建来源证明。Release 会先保持草稿状态，所有资产上传成功后才公开并设为 Latest；失败流程不会公开半成品。重新运行失败任务可以复用同 tag 的草稿，但工作流不会覆盖已经公开的 Release。

## 校验下载

下载安装包和 `SHA256SUMS.txt` 后，可在支持 `sha256sum` 的环境执行：

```bash
sha256sum -c SHA256SUMS.txt
```

也可以使用 GitHub CLI 验证构建来源证明：

```bash
gh attestation verify GardenFlow-0.0.1-arm64.dmg --repo Garden12138/garden-flow
```

## 无签名包提示

当前公开安装包没有 Apple 公证或 Windows 代码签名：

- macOS 首次启动可能被 Gatekeeper 拦截，可在 Finder 中右键应用并选择“打开”，确认安装包确实来自本仓库 Release 后再继续；
- Windows 可能显示 SmartScreen 提示，应先核对发布地址和 SHA-256，再决定是否运行；
- Linux AppImage 下载后需要赋予执行权限，deb 可交给系统包管理器安装。

证书、公证凭据或私钥不得写入仓库、日志、Actions artifact 或安装包。未来接入签名时应使用 GitHub Actions secrets，并让签名失败阻止 Release 公开。

## Native Host 与许可文件

- macOS/Linux：`desktop/.native-host-runtime/unix/gardenflow-browser-native-host.cjs`
- Windows x64：`desktop/.native-host-runtime/win32-x64/gardenflow-browser-native-host.exe`
- Manifest 名称：`com.gardenflow.browser_control`

安装包只携带当前平台的 Native Host，并包含 GardenFlow `LICENSE`、FreeCut attribution，以及内置浏览器扩展自己的第三方声明。

## 发布验收

- 在干净机器安装并冷启动每个平台产物。
- 检查窗口、图标、应用 ID、数据库名和 Native Host。
- 验证卸载不会删除用户主动选择的外部 workspace。
- 验证两个内置扩展及其版本。
- 遍历 `Docs/TESTING.md` 的产品漫游与隐私检查。
- 核对 Release 的五个安装包、SHA-256、来源证明、自动生成说明与许可证。

应用内自动更新当前保持关闭；tag 自动发行只负责生成和公开下载产物。

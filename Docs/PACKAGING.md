# GardenFlow 安装包构建

## 前置检查

```bash
node --version
pnpm --version
pnpm run setup
pnpm check
pnpm test
```

要求 Node.js 22 与 pnpm 10.28.2。构建会准备当前浏览器扩展、Native Host、FFmpeg、prompt library、renderer 和 Electron main bundle。

## 当前平台无签名构建

```bash
pnpm build
```

产物位于 `desktop/release/`。根命令调用 `desktop` 的 `build:nosign`，不会自动发布 Release。

## 指定平台

在 `desktop/` 中可运行：

```bash
pnpm build:mac:nosign
pnpm build:win
```

跨平台打包受原生模块、electron-builder 和签名工具限制；正式产物应尽量在目标平台构建。

## Native Host

- macOS/Linux：`desktop/.native-host-runtime/unix/gardenflow-browser-native-host.cjs`
- Windows x64：`desktop/.native-host-runtime/win32-x64/gardenflow-browser-native-host.exe`
- Manifest 名称：`com.gardenflow.browser_control`

安装包只携带当前 Host 和当前 GardenFlow 品牌文件。

## 签名

仓库默认脚本生成无签名包。对外分发前，维护者应在安全的发布环境配置平台证书、公证和密钥，并确保密钥不进入仓库、日志或 CI artifact。

## 发布前检查

- 在干净机器安装和冷启动。
- 检查窗口、图标、应用 ID、数据库名和 Native Host。
- 验证卸载不会删除用户主动选择的外部 workspace。
- 验证两个扩展构建目录和版本。
- 遍历 `Docs/TESTING.md` 的产品漫游与隐私检查。
- 核对 `LICENSE`、第三方 notices、FreeCut attribution 和 README 截图。
- 不在此流程中自动提交、推送或创建 Release。

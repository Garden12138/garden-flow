# GardenFlow v0.0.1

把收集的资料，变成有来源的稿件和封面。GardenFlow 是本地优先的 AI 内容创作桌面工作台，覆盖资料、选题、写作和媒体资产管理。

## 下载

| 系统 | 选择 | 安装包 |
| --- | --- | --- |
| macOS Apple Silicon | M 系列芯片，arm64 | [DMG](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/GardenFlow-0.0.1-arm64.dmg) |
| macOS Intel | Intel 芯片，x64 | [DMG](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/GardenFlow-0.0.1-x64.dmg) |
| Windows | x64 | [安装程序](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/GardenFlow-0.0.1-x64.exe) |
| Linux | x64，便携运行 | [AppImage](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/GardenFlow-0.0.1-x64.AppImage) |
| Linux | x64，Debian/Ubuntu 系 | [deb](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/GardenFlow-0.0.1-x64.deb) |

普通用户无需安装 Node.js、pnpm 或自行编译扩展。macOS 可在“关于本机”查看芯片；Windows 可在系统信息中确认系统类型；Linux 可用 `uname -m` 检查架构。

## 首次启动

1. 安装并打开 GardenFlow，在“设置 → 通用”确认工作空间目录。
2. 在“设置 → AI 供应商”添加供应商，填写对应 Endpoint、Key 和模型。
3. 在能力路由中将所需文本能力设为“自定义”，选择供应商和模型，保存设置。先用简单文本请求检查可用性。
4. 在知识库“添加文件”导入一份公开 Markdown 资料，在 AI 创作中通过 `#` 或来源选择器加入资料，选择角度并生成介绍稿。
5. 核对事实和来源，保存后在稿件页重新打开。封面需要单独配置图片生成服务，成功后在媒体库检查实际文件。

应用不提供共享密钥、默认云端网关或模型余额。你可以配置自己的云端服务或已经运行的本地兼容服务；云端供应商可能收费。没有配置模型时仍可管理本地资料。

## 浏览器扩展

在“设置 → 隐私与诊断 → 浏览器插件”点击“准备插件”，再点“打开插件目录”。应用会导出扩展并准备 Native Messaging Host。在 Chrome、Edge 或 Brave 的扩展管理页开启开发者模式，加载该目录；保持 GardenFlow 打开，并检查知识库中的连接状态。

“已准备”不表示“已连接”。如仍未连接，检查加载目录、重新加载扩展，并在原网页完成平台要求的登录或验证。本地文件创作不依赖浏览器扩展。

## 已知限制与数据边界

- 当前安装包未进行 Apple 公证或 Windows 代码签名，系统可能显示安全提示。先核对来源与校验值，再按系统提供的应用打开流程处理；不需要全局关闭系统保护。
- 图片、视频、音频与工具调用取决于所配置模型。聊天配置完整不等于媒体服务可用。
- 本次 v0.0.1 实测中，Agent 已完成封面并写入媒体库后，结果流卡片仍可能显示“运行中”；稿件在封面选择器也可能显示“未命名”且生成记录未自动绑定。请从稿件页和媒体库核对实际文件。
- 应用内自动更新当前关闭，后续版本请从本仓库 Releases 下载。
- 工作空间与数据库默认在本机；使用外部模型时，相关输入发送给所选供应商。没有使用分析或自动诊断上传。
- 项目按 [GardenFlow Source-Available License (Non-Commercial)](https://github.com/Garden12138/garden-flow/blob/v0.0.1/LICENSE) 提供，非 OSI 认可的开源许可证；商业使用需事先书面授权。

## 校验下载

下载 [SHA256SUMS.txt](https://github.com/Garden12138/garden-flow/releases/download/v0.0.1/SHA256SUMS.txt)，将与你所下载文件同名的一行与本地计算结果比较。只下载单个平台包时，不必要求其他平台文件也存在。

macOS 示例：

```bash
shasum -a 256 GardenFlow-0.0.1-arm64.dmg
```

Windows PowerShell 示例：

```powershell
Get-FileHash .\GardenFlow-0.0.1-x64.exe -Algorithm SHA256
```

Linux 示例：

```bash
sha256sum GardenFlow-0.0.1-x64.AppImage
chmod +x GardenFlow-0.0.1-x64.AppImage
```

也可使用 GitHub CLI 验证构建来源：

```bash
gh attestation verify GardenFlow-0.0.1-arm64.dmg --repo Garden12138/garden-flow
```

## 文档与反馈

- [使用手册](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/USER_MANUAL.md) · [模型配置](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/AI_PROVIDERS.md)
- [使用问答与作品分享](https://github.com/Garden12138/garden-flow/discussions)
- [报告可复现缺陷](https://github.com/Garden12138/garden-flow/issues/new?template=bug_report.yml) · [功能建议](https://github.com/Garden12138/garden-flow/issues/new?template=feature_request.yml)

反馈请写明版本、系统、执行步骤与实际结果，不要附 API Key、Cookie 或私密资料。

**Full Changelog**: https://github.com/Garden12138/garden-flow/commits/v0.0.1

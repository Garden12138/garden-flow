# GardenFlow 公开介绍资料

资料整理日期：2026-09-06。基于 v0.0.1 的公开说明；后续版本请重新核对。

## 产品与用途

GardenFlow 是本地优先的 AI 内容创作桌面工作台。它将资料采集、知识整理、选题、AI 写作、多媒体生成与自动化组织在同一套工作流中。典型使用者是需要把收集的资料变成文章、图文或其他内容的创作者。

来源：[项目 README](https://github.com/Garden12138/garden-flow/blob/v0.0.1/README.md)

## 能力与边界

- 知识库支持本地资料、来源查看、全文和向量检索；语义能力需要对应模型配置。
- AI 创作支持引用、会话和稿件；输出应人工核对并确认已实际保存。
- 图片、视频、音频的可用范围取决于所配置供应商及模型；聊天服务不自动提供图片服务。
- 浏览器扩展通过 Native Messaging 连接本机应用。用户需要准备扩展并在浏览器加载。
- MCP 和 Skills 在代码中已有实现；首次体验教程不依赖这两项。

来源：[使用手册](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/USER_MANUAL.md)、[模型配置](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/AI_PROVIDERS.md)、[MCP 实现](https://github.com/Garden12138/garden-flow/blob/v0.0.1/desktop/electron/core/mcpRuntime.ts)、[Skills 实现](https://github.com/Garden12138/garden-flow/blob/v0.0.1/desktop/electron/core/skillManager.ts)

## 安装与模型

v0.0.1 提供 macOS arm64/x64 DMG、Windows x64 exe、Linux x64 AppImage/deb。当前安装包没有 Apple 公证或 Windows 代码签名。应用不提供共享 API Key、默认云端网关或模型余额；用户自行配置供应商或运行本地模型服务。

来源：[v0.0.1 Release](https://github.com/Garden12138/garden-flow/releases/tag/v0.0.1)、[构建与发布](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/PACKAGING.md)

## 数据与许可

工作空间、SQLite 数据与诊断默认在本机，没有使用分析或自动诊断上传。使用外部模型、网页采集等功能时会访问对应第三方服务；“本地优先”不表示全部功能离线，也不表示外部供应商不会收到请求内容。

项目按 GardenFlow Source-Available License (Non-Commercial) 提供，非 OSI 认可许可证。商业使用需事先书面授权。不要把它介绍为无限制免费商用软件。

来源：[隐私说明](https://github.com/Garden12138/garden-flow/blob/v0.0.1/README.md#数据与隐私)、[LICENSE](https://github.com/Garden12138/garden-flow/blob/v0.0.1/LICENSE)

## 这份资料没有提供的事实

没有用户规模、增长率、节省时间的实测、收入、模型费用或作者个人经历。不得补写此类数字和故事。介绍中应区分已有能力、这次实际验证的操作与尚未验证的平台。

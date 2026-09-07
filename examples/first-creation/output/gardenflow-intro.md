# 从资料到稿件：GardenFlow 首次创作

对中文 AI 内容创作者来说，一篇文章的资料常常散在多处：浏览器里剪藏的网页、笔记软件里粘贴的片段、文件夹里堆积的 PDF 和文档。等到写作时，出处找不到，引用要逐条手工核对。

GardenFlow 是一个本地优先的 AI 内容创作桌面工作台。它把资料采集、知识整理、选题、AI 写作、多媒体生成与自动化组织在同一套工作流中，面向需要把收集的资料变成文章、图文或其他内容的创作者（[项目 README](https://github.com/Garden12138/garden-flow/blob/v0.0.1/README.md)）。

按公开文档，这条链路大致分四步：

1. **资料进知识库**：知识库支持本地资料、来源查看、全文和向量检索；其中语义检索等能力需要配置对应模型（[使用手册](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/USER_MANUAL.md)）。
2. **选题与写作**：AI 创作支持引用、会话和稿件，可以围绕带来源的资料组织选题；输出仍需人工核对，并确认稿件已经实际保存（[使用手册](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/USER_MANUAL.md)）。
3. **封面补齐**：图片、视频、音频的可用范围取决于所配置的供应商及模型；文本服务不自动提供图片服务，封面能力需要单独配置（[模型配置](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/AI_PROVIDERS.md)）。
4. **网页采集（可选）**：浏览器扩展通过 Native Messaging 连接本机应用，需要自行准备扩展并在浏览器中加载（[使用手册](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/USER_MANUAL.md)）。

v0.0.1 提供 macOS arm64/x64 DMG、Windows x64 exe、Linux x64 AppImage/deb（[v0.0.1 Release](https://github.com/Garden12138/garden-flow/releases/tag/v0.0.1)）。应用不提供共享 API Key、默认云端网关或模型余额；用户需自行配置模型供应商，或运行本地模型服务（[模型配置](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/AI_PROVIDERS.md)）。

首次创作可以走这条路径：安装应用 → 配置文本模型 → 把已有资料导入知识库 → 选择带来源的资料发起创作 → 生成稿件并人工核对 → 如需封面，再单独配置图片服务后生成。

当前也有几项需要先知道的限制：安装包没有 Apple 公证或 Windows 代码签名（[构建与发布](https://github.com/Garden12138/garden-flow/blob/v0.0.1/Docs/PACKAGING.md)）。“本地优先”也不等于全部功能离线：工作空间、SQLite 数据与诊断默认留在本机，但使用外部模型、网页采集等功能时会访问对应第三方服务，相关输入会发送给用户选择的供应商（[隐私说明](https://github.com/Garden12138/garden-flow/blob/v0.0.1/README.md#数据与隐私)）。

项目采用 GardenFlow Source-Available License (Non-Commercial)，非 OSI 认可的开源许可证；商业使用需事先获得书面授权（[LICENSE](https://github.com/Garden12138/garden-flow/blob/v0.0.1/LICENSE)）。以上内容基于 v0.0.1 的公开说明整理，后续版本请以官方文档重新核对。

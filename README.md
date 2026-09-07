# GardenFlow

**把收集的资料，变成有来源的稿件和封面。**

GardenFlow 是本地优先的 AI 内容创作工作台，把素材、选题、AI 写作和媒体资产放在同一处。

[下载安装包](https://github.com/Garden12138/garden-flow/releases/latest) · [观看演示](./Docs/DEMO.md) · [首次体验](./Docs/FIRST_CREATION.md) · [English](./README_EN.md)

[![GardenFlow 首次创作流程预览](./images/first-creation-demo.gif)](./Docs/DEMO.md)

- **从已有资料开始写**，保留来源与引用。
- **素材、会话、稿件和封面集中管理**，围绕同一空间组织。
- **自行选择模型服务**，工作空间保存在本机。

> [首次体验](./Docs/FIRST_CREATION.md)需要自行配置文本模型；封面需要单独配置图片服务。云端请求可能产生供应商费用。GardenFlow 采用[非商业 Source-Available 许可证](./LICENSE)，并非 OSI 认可的开源软件。

如果这个工作流对你有用，欢迎 Star 关注更新，或在 [Discussions](https://github.com/Garden12138/garden-flow/discussions) 分享使用反馈。

## 从一篇介绍稿开始

[用 GardenFlow 介绍 GardenFlow](./Docs/FIRST_CREATION.md)：下载公开示例资料 → 添加到知识库 → 选择角度 → 带来源写作并保存 → 可选生成封面。教程提供输入资料和分步提示词，先完成文字稿，再逐步启用其他能力。

## 为什么选择 GardenFlow

- **从研究直接进入创作**：浏览器采集进入知识库，灵感池把证据和选题交给创作工作台。
- **多媒体进入统一媒体库**：图片、视频、音频可继续用于封面、稿件和视频工程，能力范围取决于所配置模型。
- **自动化可见、可停、可复核**：计划任务、执行状态和产物在本地留档。
- **隐私边界清楚**：没有使用分析和自动诊断上传；外部 AI 请求按用户选择发送给对应供应商。

## 产品流程

```mermaid
flowchart LR
    A[浏览器与本地文件] --> B[素材采集]
    B --> C[知识库]
    C --> D[灵感与选题]
    D --> E[AI 创作]
    E --> F[图片 / 视频 / 音频]
    F --> G[媒体库与发布资产]
    E --> H[自动化计划]
    H --> C
```

## 产品界面

以下截图来自同一个实际使用中的 GardenFlow 空间，展示的是已有素材、选题、稿件和媒体产物，而不是静态原型。

![GardenFlow 浅色主工作台](./images/workbench-light.jpg)

### 从采集素材到形成选题

| 浏览器采集后的素材库 | 带证据与评分的灵感桌 |
| --- | --- |
| ![GardenFlow 素材库](./images/material-library.jpg) | ![GardenFlow 灵感工作台](./images/ideation-desk.jpg) |

### 带引用、任务耗时与稿件结果的 AI 创作

![GardenFlow AI 创作工作台](./images/creative-brief.jpg)

### 统一媒体库与自动化计划

| 图片、视频与音频资产 | 定时任务与插件就绪诊断 |
| --- | --- |
| ![GardenFlow 媒体库](./images/media-library.jpg) | ![GardenFlow 自动化计划](./images/automation-desk.jpg) |

深色模式保留相同的信息层级与操作密度：

![GardenFlow 深色工作台](./images/workbench-dark.jpg)

## 能力矩阵

| 阶段 | 能力 | 主要产物 |
| --- | --- | --- |
| 采集 | Chrome/Edge/Brave 扩展、小红书结构化采集、通用网页正文提取、本地文件导入 | 网页快照、素材条目、引用来源 |
| 知识 | 文档索引、全文检索、向量检索、来源回看、空间隔离 | 可检索知识库 |
| 灵感 | 素材漫步、评论洞察、候选选题、证据绑定 | 选题与创作方向 |
| 创作 | 多会话 AI、引用上下文、任务时间线、结构化小红书稿件、封面工作台 | 文章、脚本、卡片、封面 |
| 生成 | 图片、视频、音频、语音、视频工程与字幕 | 媒体资产与工程文件 |
| 自动化 | 定时任务、内置采集任务、后台执行、审批与运行记录 | 可追踪任务和产物 |

具体能力取决于所配置供应商的协议和模型支持范围。

## 快速开始

### 下载安装包

前往 [GitHub Releases](https://github.com/Garden12138/garden-flow/releases/latest) 下载与系统和架构匹配的公开安装包：macOS 提供 Apple Silicon（arm64）和 Intel（x64）DMG，Windows 提供 x64 安装程序，Linux 提供 x64 AppImage 与 deb。

当前公开安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。GardenFlow 采用非商业 Source-Available 许可证，并非 OSI 认可的开源软件；下载安装即表示使用者应遵守本仓库的 [LICENSE](./LICENSE)。

安装后从[首次创作教程](./Docs/FIRST_CREATION.md)开始。普通用户不需要 Node.js 或 pnpm；网页采集扩展可以从应用内准备和导出。

### 源码开发环境

![CI](https://github.com/Garden12138/garden-flow/actions/workflows/ci.yml/badge.svg)
![Node.js 22](https://img.shields.io/badge/Node.js-22-3c873a?logo=nodedotjs&logoColor=white)
![pnpm 10.28.2](https://img.shields.io/badge/pnpm-10.28.2-f69220?logo=pnpm&logoColor=white)
![Electron 39](https://img.shields.io/badge/Electron-39-47848f?logo=electron&logoColor=white)

- Node.js 22
- pnpm 10.28.2
- macOS、Windows 或 Linux；打包目标以 `desktop/package.json` 为准
- 原生依赖构建工具。macOS 可执行 `xcode-select --install`

### 源码运行

```bash
git clone https://github.com/Garden12138/garden-flow.git
cd garden-flow
corepack enable
pnpm run setup
pnpm dev
```

首次启动会创建当前 GardenFlow 数据目录、`gardenflow.db` 和默认空间。随后打开“设置 → AI 供应商”添加供应商并选择能力路由；视频服务单独配置。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm run setup` | 按锁文件安装根目录、两个扩展和桌面端依赖 |
| `pnpm dev` | 准备本地运行时并启动 Vite + Electron |
| `pnpm check` | 品牌、文档、接口、类型和扩展检查 |
| `pnpm test` | 运行桌面端 Node.js 测试 |
| `pnpm build` | 构建当前平台的无签名桌面安装包 |
| `pnpm build:plugin` | 构建采集扩展与发布扩展 |

## 配置 AI 供应商

GardenFlow 不提供共享密钥或默认云端网关。新安装的 AI 路由为 `disabled`；保存有效供应商并选择模型后才会启用。

| 类型 | 适合场景 | 必填项 |
| --- | --- | --- |
| OpenAI | 文本、视觉、图片等 OpenAI API 能力 | API Key、模型；自定义代理时填写 Endpoint |
| Anthropic | Claude 文本与视觉 | API Key、模型 |
| Gemini | Gemini 文本与多模态 | API Key、模型 |
| 本地服务 | Ollama、LM Studio、vLLM、LocalAI 等 | Endpoint、模型；允许空 Key |
| 自定义 | OpenAI-compatible 或项目支持的原生协议 | 协议、Endpoint、Key、模型 |

视频预设为 `aliyun-bailian`、`minimax`、`new-api-aliyun`、`new-api-minimax` 或 `custom`。两类 `new-api` 预设必须显式选择并填写 Endpoint、Key 和模型，GardenFlow 不会根据 URL 或模型名猜测上游。

完整说明见 [AI 供应商配置](./Docs/AI_PROVIDERS.md)。

## 浏览器扩展

安装包用户：在“设置 → 隐私与诊断 → 浏览器插件”点击“准备插件”，再点“打开插件目录”。应用会导出扩展并安装或修复 Native Messaging Host。

在 Chrome、Edge 或 Brave 的扩展管理页开启开发者模式，选择“加载已解压的扩展程序”并加载导出的目录。保持 GardenFlow 打开，检查知识库中的插件连接状态。“已准备”不代表浏览器已连接。详见[首次体验中的插件步骤](./Docs/FIRST_CREATION.md#需要采集网页时再装扩展)。

开发者从源码构建时使用：

```bash
pnpm build:plugin
```

采集扩展构建目录为 `Plugin/dist/extension/`，Native Host 仍通过应用的插件准备流程安装。

扩展只把用户明确采集的内容传给本机 GardenFlow；诊断最多在浏览器本地保存 40 条脱敏记录，仅在用户点击导出时生成报告。详见 [浏览器扩展说明](./Plugin/README.md)。

## 架构摘要

```text
React renderer
      │ typed bridge / IPC
Electron main ── AI runtime / tools / automation
      │                    │
SQLite + workspace         └── user-configured providers
      │
Native Messaging ── browser extensions
```

- `desktop/src/`：React、TypeScript、TailwindCSS renderer。
- `desktop/electron/`：Electron 主进程、SQLite、AI runtime、工具、媒体和自动化服务。
- `Plugin/`：内容采集与浏览器控制扩展。
- `PublishPlugin/`：小红书发布辅助扩展。
- `desktop/src/vendor/freecut/`：带独立归属声明的 FreeCut 工程能力。

深入了解见[架构文档](./Docs/ARCHITECTURE.md)。

## 数据与隐私

- 数据库：当前用户数据目录中的 `gardenflow.db`。
- 工作空间：用户选择的目录；默认内部目录为 `.gardenflow`。
- API Key：保存在本地应用设置中，仅发送给用户选择的供应商。
- 诊断：本地有界记录，导出时剔除 Cookie、Token、密钥、网页正文、Data URI 和绝对路径。
- 网络：核心功能可离线管理资料；AI、网页采集、模型下载和发布功能按操作访问相应第三方服务。

## 文档

- [首次创作教程](./Docs/FIRST_CREATION.md)
- [演示与验证记录](./Docs/DEMO.md)
- [路线图](./ROADMAP.md)
- [文档导航](./Docs/README.md)
- [使用手册](./Docs/USER_MANUAL.md)
- [本地开发与部署](./Docs/LOCAL_DEPLOYMENT.md)
- [AI 供应商配置](./Docs/AI_PROVIDERS.md)
- [测试与验收](./Docs/TESTING.md)
- [安装包构建](./Docs/PACKAGING.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

## 参与贡献

使用提问与作品分享请到 [Discussions](https://github.com/Garden12138/garden-flow/discussions)，可复现缺陷和功能建议请用 [Issues](https://github.com/Garden12138/garden-flow/issues)。开始贡献前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)、[路线图](./ROADMAP.md)和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告，不要公开披露密钥或个人数据。

## 许可证

Copyright © Garden12138。

本仓库按 [GardenFlow Source-Available License (Non-Commercial)](./LICENSE) 提供，允许非商业使用、学习、修改和分发，商业使用需要事先书面授权。商业授权请通过仓库所有者的 GitHub 联系方式沟通。

第三方依赖与 vendored 代码继续适用其各自许可证；详见[浏览器扩展第三方声明](./Plugin/src/THIRD_PARTY_NOTICES.txt)、[FreeCut 归属声明](./desktop/src/vendor/freecut/ATTRIBUTION.md)和依赖声明。

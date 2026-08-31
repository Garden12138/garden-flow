# GardenFlow 本地部署方案

## 1. 目标与推荐范围

本方案面向当前仓库的 Electron 开源快照，优先保证桌面核心链路在本机运行：

```text
本地工作空间 → 自选 AI Endpoint → GardenFlow / 知识库 / 稿件 / 媒体 / 自动化
```

当前模块的部署状态：

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Electron 桌面核心 | 可本地开发和打包 | 需要 Node 22、pnpm 和原生模块构建环境 |
| 自定义 AI 源 | 可用 | 主 AI 链路优先使用 OpenAI-compatible Chat Completions |
| 本地模型 | 可用 | 可接 Ollama、LM Studio、vLLM、LocalAI、llama.cpp 等兼容端点 |
| 官方登录/会员能力 | 开源版降级 | `desktop/private/` 未包含时自动生成空实现 |
| 浏览器插件静态构建 | 可用 | 可生成并加载 `Plugin/dist/extension` |
| 插件与 Electron 端到端连接 | 当前未闭环 | 插件使用生产 Native Bridge，Electron 快照保留旧 HTTP 接口 |
| 签名发布 | 需要发布凭据 | 本地验证应使用无签名构建 |

推荐先完成“桌面核心 + 自定义 AI 源”的本地部署，再决定是否投入插件桥接适配。

## 2. 环境要求

### 2.1 通用要求

- Git
- Node.js `>=22 <23`，建议使用最新 Node 22 LTS 补丁版本
- pnpm `10.28.2`
- 至少 8 GB 内存；涉及本地大模型、视频生成或 Remotion 导出时建议更多
- 足够的磁盘空间存放 `node_modules`、Electron、FFmpeg、模型和媒体素材

检查版本：

```bash
node --version
pnpm --version
```

如果 Node 自带 Corepack：

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
```

不要使用 Node 16/18/20 直接安装本项目。Node 24 也不在当前声明的支持范围内；即使部分命令能运行，也可能造成 lockfile、原生模块或 Electron ABI 差异。

### 2.2 原生构建工具

`better-sqlite3` 和部分 Electron 依赖可能需要本机编译。

macOS：

```bash
xcode-select --install
```

Windows：

- Visual Studio Build Tools 2022
- “Desktop development with C++” 工作负载
- Python 3（供 node-gyp 使用）

Linux：

- C/C++ 编译工具链、Python 3、make
- Electron 所需的 GTK/NSS/音频等系统库，包名随发行版变化

## 3. 获取源码与安装依赖

桌面端和插件是两个独立的 pnpm 项目。GardenFlow 在根目录提供统一入口：首次安装执行 `pnpm run setup`，启动执行 `pnpm dev`。下文的模块内命令仍可单独使用。

### 3.1 完整初始化（含桌面端）

```bash
git clone https://github.com/Garden12138/garden-flow.git
cd garden-flow
pnpm run setup
```

安装完成后应至少存在：

```text
desktop/node_modules/.bin/tsc
desktop/node_modules/.bin/vite
desktop/node_modules/.bin/electron-builder
```

如果 `better-sqlite3` ABI 或安装脚本失败，可在确认 Node 22 和系统工具链正确后重装，再在 `desktop/` 内执行：

```bash
pnpm rebuild better-sqlite3
pnpm run postinstall
```

### 3.2 浏览器插件（单独安装）

已执行根目录 `pnpm run setup` 时无需重复安装。只安装扩展依赖时，从仓库根目录执行：

```bash
pnpm --dir Plugin install --frozen-lockfile
```

插件与桌面端仍使用独立依赖目录；根 `setup` 命令会分别安装两者。

## 4. 启动桌面开发环境

在 `desktop/` 下执行：

```bash
pnpm dev
```

该命令会依次：

1. 生成可选 private runtime；开源仓库没有 `desktop/private/` 时生成降级 UI。
2. 准备插件 runtime 目录。
3. 同步 prompt library。
4. 启动 Vite 和 Electron main/preload。

首次启动会创建：

- SQLite：`<Electron userData>/gardenflow.db`
- 默认工作空间：`~/.gardenflow`
- 当前空间的知识、稿件、媒体、资产、记忆和 GardenFlow 子目录

开发服务启动后，完成以下最低 smoke test：

1. 主窗口可以打开且无白屏。
2. 侧边栏可切换“新对话、知识库、资产库、自动化、自由创作、选题中心”。
3. 设置页可以保存工作空间和 AI 源。
4. 重启应用后设置和空间仍存在。

`pnpm preview` 只预览已构建的 renderer，不能替代 Electron IPC、文件系统和后台服务验收。

## 5. 配置 AI

进入 `设置 → AI`，创建或选择 AI 源，填写：

- 协议
- API Endpoint / Base URL
- API Key
- 模型名称

建议先用“测试连接/获取模型”验证，再保存并发起新对话。

### 5.1 远程 OpenAI-compatible 服务

典型 Endpoint 形式：

```text
https://provider.example.com/v1
```

主 AI QueryRuntime 当前以 `/chat/completions` 为核心。虽然设置页可识别 Anthropic Native 和 Gemini Native，若希望 GardenFlow、工具循环和长任务获得最完整兼容性，优先选择供应商提供的 OpenAI-compatible Endpoint。

### 5.2 Ollama

先安装并启动 Ollama，再拉取一个支持聊天的模型：

```bash
ollama pull <model-name>
ollama serve
```

GardenFlow 中填写：

```text
协议：OpenAI Compatible
Endpoint：http://127.0.0.1:11434/v1
API Key：按本地服务要求填写，Ollama 默认可留空
模型：<model-name>
```

### 5.3 其他本地服务

| 服务 | 默认兼容 Endpoint |
| --- | --- |
| LM Studio | `http://127.0.0.1:1234/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |
| LocalAI | `http://127.0.0.1:8080/v1` |
| llama.cpp server | `http://127.0.0.1:8080/v1` |

模型名称必须与服务实际暴露的 ID 一致。聊天可用不代表 embedding、图片、语音和视频也由同一服务支持；这些能力需要分别配置对应路由。

### 5.4 专用模型路由

根据实际需求配置：

- 转录模型：音频/视频转文字。
- Embedding 模型：向量索引。
- 视觉索引模型：理解图片和 PDF 页面。
- 视频分析模型。
- 图片、视频、TTS 和音色克隆模型。

建议先只启用聊天模型，逐项验证其他路由。视觉索引和媒体生成可能产生额外调用费用或占用大量本地算力。

## 6. 运行时端口

默认本地监听：

| 端口 | 服务 | 默认状态 | 安全说明 |
| --- | --- | --- | --- |
| `23456` | 旧插件采集 HTTP API | 默认关闭 | 仅设置 `GARDENFLOW_ENABLE_LEGACY_PLUGIN_HTTP=1` 时绑定 `127.0.0.1`；历史接口无强认证，不应在生产环境启用 |
| `31957` | Session Bridge HTTP/WebSocket | 按需启动 | 使用进程级随机 token，仅供受信任本地 Agent |
| `31937` | Assistant daemon / ACP / 渠道 webhook | 默认禁用 | 启用前配置 token，并限制监听地址和防火墙 |

内容采集默认通过 Native Messaging 和当前用户可访问的 UDS/Windows Named Pipe，不监听 TCP 端口。

## 7. 代码检查

在 `desktop/` 下：

```bash
pnpm check:types
pnpm check:bridge-domains
pnpm check:ui-parity
pnpm check:parity
```

`check:parity` 会串行运行 UI source parity、bridge domain parity 和 TypeScript 检查。

在仓库根目录或 `desktop/` 执行 `pnpm test`，可运行 `desktop/tests/` 中的 Node.js 测试。`src/vendor/freecut/` 的测试不在此命令范围内，现有测试也不代表全部业务均有自动化覆盖。重要变更仍需执行后文的人工验收。

## 8. 本地打包

新机器如果尚未安装 Node.js 或 pnpm，优先使用[安装包构建指南](./PACKAGING.md)中的 macOS/Windows 自举脚本；它会在项目内准备固定版本工具链并执行一键打包。

### 8.1 推荐：无签名构建

在 `desktop/` 下：

```bash
pnpm build:nosign
```

输出目录：

```text
desktop/release/
```

构建会运行 TypeScript、Vite、FFmpeg 准备和 `electron-builder`。macOS 本地构建若使用默认 `pnpm build`，配置中的发布签名身份可能导致无证书机器失败，因此本地验收优先使用 `build:nosign` 或 `build:mac:nosign`。

平台命令：

```bash
pnpm build:mac:nosign
pnpm build:win
```

Windows 打包应在 Windows 主机或已验证的交叉构建环境中完成。正式发布需要替换为组织自己的签名、公证和发布凭据，不能复用仓库中的身份字符串或提交密钥。

### 8.2 打包验收

安装或解压产物后验证：

1. 冷启动与单实例行为。
2. 自定义 AI 源连接和普通对话。
3. 新建/切换空间，导入一份文本，重启后仍可见。
4. 创建并保存稿件。
5. 导入一份媒体文件，确认预览和本地路径。
6. 创建一个定时任务，执行“立即运行”。
7. 退出应用，确认后台进程和本地端口按预期释放。
8. 重新安装新版，确认旧 `gardenflow.db` 和 workspace 未丢失。

## 9. 浏览器插件部署

### 9.1 构建并加载 UI

在 `Plugin/` 下执行：

```bash
pnpm build
```

然后在 Chrome/Edge 中：

1. 打开扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择 `Plugin/dist/extension/`。

该步骤可以验证 manifest、side panel、content script 和扩展 UI 是否正确构建。

### 9.2 准备与连接

桌面端“准备浏览器插件”现在是幂等安装/修复操作：

1. 构建并校验 `Plugin/dist/extension`，只把可加载扩展复制到 runtime/export 根目录。
2. 为当前用户安装 Chrome、Edge、Brave 的 Native Messaging manifest；manifest 只接受官方固定扩展 ID。
3. 浏览器 Native Host 以隐藏 Electron 模式启动，通过带独立 token 的 UDS/Windows Named Pipe 连接桌面 Bridge。
4. Bridge 只开放内容采集 typed action，不接受任意 HTTP、IPC 或本地文件路径。

开发模式下先分别安装 `Plugin/` 与 `desktop/` 的依赖，再从知识库或设置页执行“准备浏览器插件”。浏览器仍需手动开启开发者模式并加载导出的目录。

### 9.3 平台登录边界

公开网页、公开 YouTube 和知乎内容不要求登录 GardenFlow 或绑定平台账号。若用户已在浏览器登录平台，页面自己的请求会自然复用该浏览器会话；插件不申请 Cookie 权限，也不读取或传输密码、验证码、Cookie。遇到登录墙或安全挑战时，只引导用户回到原网页自行处理。

本次 Electron Bridge 只覆盖内容采集；AI 浏览器控制和 `accounts.*` 账号档案绑定不属于这条闭环。

## 10. 数据备份与迁移

完整备份需要同时保存：

1. 当前工作空间根目录，默认 `~/.gardenflow`。
2. `<Electron app.getPath('userData')>/gardenflow.db`。

数据库精确父目录会因系统、应用名和历史迁移而不同。常见名称包括 GardenFlow、GardenFlow、GardenFlow、GardenFlow 和 `gardenflow-desktop`。不要只按品牌展示名猜目录；应在退出应用后搜索 `gardenflow.db` 或通过诊断日志确认实际 userData。

推荐备份流程：

1. 真正退出应用，等待后台任务停止。
2. 复制 `gardenflow.db`，如存在 `-wal`、`-shm` 文件也一起复制。
3. 复制整个 workspace，而不是只复制 `manuscripts/`。
4. 在新机器先安装同版本应用，再恢复数据库和 workspace。
5. 启动后检查空间、会话、知识、媒体和自动化任务。

API Key、Endpoint、代理和 MCP 配置保存在本地 SQLite，当前开源代码未提供密钥加密层。备份文件应按敏感数据保存，不要提交到 Git 或公共云盘。

## 11. 常见故障

### Node 或 pnpm 版本错误

症状：`Unsupported engine`、lockfile 重写、Corepack 下载错误或原生模块安装失败。

处理：切换到 Node 22，激活 pnpm 10.28.2，删除由错误包管理器生成的临时依赖后重新安装。不要混用根/desktop/Plugin 的 `node_modules`。

### `better-sqlite3` 加载失败

症状：`NODE_MODULE_VERSION`、`dlopen`、`.node` 文件错误。

处理：确认 Node/Electron 版本正确，安装系统编译工具，重新执行 `pnpm install`、`pnpm rebuild better-sqlite3` 和 `pnpm run postinstall`。

### FFmpeg 准备失败

症状：`ffmpeg-static binary missing` 或构建阶段下载失败。

处理：确认网络可访问依赖下载源，然后运行：

```bash
pnpm prepare:ffmpeg
```

### AI 连接测试成功，但 GardenFlow 失败

检查：

- Endpoint 是否包含正确的 API base。
- 模型 ID 是否真实存在。
- 服务是否支持 OpenAI-compatible `/chat/completions` 和工具调用。
- 代理是否绕过 `localhost,127.0.0.1,::1`。
- 当前业务路由是否选中了另一 AI 源或专用模型。

### 应用能启动，但官方登录/会员不可用

开源仓库缺少 `desktop/private/` 时这是预期降级，不是安装损坏。请使用自定义 AI 源，并以开源范围内的功能为准。

### 插件已加载，但显示桌面端未连接

在知识库或设置页查看插件状态：先执行“准备浏览器插件”，再确认浏览器扩展管理页加载的是应用导出的目录。状态应依次变为“等待浏览器连接”和“采集插件已连接”。若提示 Native Host 过期，再次执行准备即可修复。

### 自动化到点未运行

检查应用是否仍在运行、任务是否启用、时区是否为本地、AI 源是否可用，以及后台任务/诊断日志中的失败原因。关闭窗口不总是等于退出应用；使用系统菜单真正退出才会停止 runner。

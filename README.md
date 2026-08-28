# GardenFlow

GardenFlow — Grow content with AI.

基于 RedClaw / Bojin 迁移的本地优先 AI 内容工作台，包含 Electron 桌面端与 Chrome 浏览器扩展，支持内容创作、知识库、媒体管理和自动化采集。

## 快速开始

需要 Node.js 22（建议与本次验收环境一致使用 22.23.2）、pnpm 10.28.2，以及原生模块构建工具。macOS 可通过 `xcode-select --install` 安装 Command Line Tools。

在仓库根目录执行：

```bash
pnpm run setup
pnpm dev
```

`setup` 使用锁文件分别安装根目录、浏览器扩展和桌面端的依赖。`dev` 会准备运行时、构建浏览器扩展，并启动 Vite 与 Electron。

首次启动后，在应用设置中选择工作空间并配置 AI 服务地址、模型及 API Key；密钥和用户工作空间不要提交到仓库。未包含的私有登录/会员模块会使用源项目已有的降级实现。

## 常用命令

以下命令均在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `pnpm run setup` | 按锁文件安装全部依赖 |
| `pnpm dev` | 启动桌面开发环境 |
| `pnpm check` | 桌面类型与接口一致性检查，以及扩展构建、类型检查和测试 |
| `pnpm test` | 运行 `desktop/tests/` 中的 Node.js 测试 |
| `pnpm build` | 为当前平台构建无签名桌面安装包，输出到 `desktop/release/` |
| `pnpm build:plugin` | 构建扩展，输出到 `Plugin/dist/extension/` |

在 Chrome 的 `chrome://extensions` 中开启开发者模式，再加载 `Plugin/dist/extension/`。浏览器桥接的准备步骤见 [扩展说明](./Plugin/README.md)。

## 项目结构

- `desktop/`：Electron + React + TypeScript 桌面应用。
- `Plugin/`：Chrome Manifest V3 扩展与浏览器控制桥接。
- `Docs/`：架构、部署、打包与验收文档。
- `images/`：文档图片和演示资源。

## 迁移说明

源码来自 `redclaw` 的 `feature/newapi-gateway-and-automation-upgrade` 分支，基线提交为 `cd8455f093e6653852ac03986f602f60662f64e2`。迁移保留 GardenFlow 仓库已有的 Git 历史与远端，不包含源仓库历史、依赖缓存、构建产物或用户运行数据。

本次未做应用层品牌替换：Bojin / RedClaw 名称、应用与扩展 ID、协议及数据目录保持兼容。**发布安装包前需要单独审查源项目的发布仓库、更新地址与签名配置。**

详见 [迁移记录](./Docs/MIGRATION.md)、[文档导航](./Docs/README.md) 和 [本地部署](./Docs/LOCAL_DEPLOYMENT.md)。

## 许可证

保留源项目的 [LICENSE](./LICENSE)（文件标题为 `MIT License – Non-Commercial Use Only`）及各目录中的第三方声明；迁移不改变授权条款。

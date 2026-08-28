# 项目脚本

GardenFlow 的统一命令定义在根 `package.json`，从仓库根目录运行：

| 命令 | 用途 |
| --- | --- |
| `pnpm run setup` | 按各自锁文件安装根目录、扩展和桌面端依赖 |
| `pnpm dev` | 启动桌面开发环境 |
| `pnpm check` | 桌面一致性/类型检查与扩展检查 |
| `pnpm test` | 桌面 Node.js 测试 |
| `pnpm build` | 当前平台无签名安装包 |
| `pnpm build:plugin` | 浏览器扩展构建 |

桌面构建和运行时准备脚本位于 `desktop/scripts/`；扩展构建与测试脚本位于 `Plugin/scripts/`。源文档曾提及的下载统计、日报及 LaunchAgent 安装脚本未包含在迁移快照中，不作为可用命令提供。

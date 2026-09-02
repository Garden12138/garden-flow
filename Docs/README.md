# GardenFlow 项目文档

本目录面向需要本地运行、使用或继续开发本仓库的人。基础文档继承自 GardenFlow 开源快照，GardenFlow 的迁移基线与当前验收范围见迁移记录。

## 文档导航

| 文档 | 适合读者 | 内容 |
| --- | --- | --- |
| [迁移记录](./MIGRATION.md) | 开发者、维护者 | GardenFlow 迁移基线、保留范围、初始化调整和验收结果 |
| [项目架构](./ARCHITECTURE.md) | 开发者、维护者 | 产品边界、运行时架构、模块、数据流、持久化和扩展点 |
| [本地部署](./LOCAL_DEPLOYMENT.md) | 部署者、开发者 | 环境准备、源码启动、本地模型、打包、验收、备份和故障排查 |
| [安装包构建](./PACKAGING.md) | 发布者、测试人员 | 新机器自举环境、macOS/Windows 一键打包、签名和故障排查 |
| [使用手册](./USER_MANUAL.md) | 最终用户、测试人员 | 首次配置、各工作台操作、典型工作流、数据管理和常见问题 |
| [自然编辑部界面规范](./NATURAL_NEWSROOM_UI.md) | 设计师、开发者、测试人员 | 新版信息架构、视觉令牌、布局、快捷键、响应式规则和页面模式 |
| [自测步骤：网关 + 自动化](./SELF_TEST_NEWAPI_AND_AUTOMATION.md) | 测试人员、开发者 | new-api 网关、对话建任务、内置小红书采集（插件编排）的验收清单与实测结论 |

相关模块文档：

- [桌面 renderer 说明](../desktop/src/README.md)
- [浏览器插件说明](../Plugin/README.md)
- [插件通用网页采集架构](../Plugin/docs/generic-web-capture-architecture.md)

## 名称与版本说明

当前仓库名为 **GardenFlow**。迁移暂时保留源项目的 **GardenFlow / GardenFlow** 产品名称，以及 `gardenflow-*`、`gardenflow-*` 和 `gardenflow-*` 等兼容名称。它们通常出现在应用 ID、数据库文件、协议名、IPC channel、工作目录和历史迁移代码中，不代表存在多套产品。

各模块版本独立维护：

- 桌面开源快照：以 `desktop/package.json` 为准。
- 浏览器插件：以 `Plugin/package.json` 为准。
- 根 `README.md`：面向产品和发布信息，不作为源码版本号的唯一依据。

## 维护约定

- 功能、命令或目录发生变化时，同步更新对应文档。
- 文档只声明开源仓库中可验证的能力；生产版专有能力应明确标为未包含或降级。
- 路径使用仓库相对路径，不写个人机器的绝对路径。
- 部署命令优先来自各模块 `package.json`，避免复制已经失效的历史命令。

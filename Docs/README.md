# GardenFlow 文档

从[首次创作](./FIRST_CREATION.md)开始配置文本模型，或查看[商品创作与发布](./PRODUCT_CREATION.md)，完成商品视频或套图。

| 文档 | 内容 |
| --- | --- |
| [首次创作](./FIRST_CREATION.md) / [English](./FIRST_CREATION_EN.md) | 导入公开资料、选择角度并保存第一篇介绍稿 |
| [新用户场景使用手册](./USER_SCENARIO_GUIDE.md) / [Word](./USER_SCENARIO_GUIDE.docx) | 按实际任务体验全部主要入口，包含示例输入、完成标志、发布与复盘 |
| [商品创作与发布](./PRODUCT_CREATION.md) | 平台选择、视频／套图工程、持续编辑、导出和两步发布 |
| [三栏创作工作台](./CREATION_WORKBENCH.md) | 对话、作品编辑、效果预览与自动保存 |
| [图文创作入口与预设改造方案](./CREATION_PRESETS_DESIGN.md) | 已实施：统一入口、文章来源、可编辑卡片模板与本地图片交付 |
| [梦境故事](./DREAM_STORY.md) | 私密记录、八幕故事、画面与声音、导出及 TikTok Studio 手动发布 |
| [使用手册](./USER_MANUAL.md) | 空间、采集、知识、灵感、创作、生成、自动化和隐私 |
| [演示与示例](./DEMO.md) | 实际界面、示例输入与可查看的创作产物 |
| [AI 供应商](./AI_PROVIDERS.md) | 文本与多媒体供应商、配置检查和错误处理 |
| [路线图](../ROADMAP.md) | 当前能力、已知限制和后续改进 |
| [架构](./ARCHITECTURE.md) | 进程、模块、数据、IPC、浏览器桥和安全边界 |
| [本地开发与部署](./LOCAL_DEPLOYMENT.md) | 环境、源码运行、调试、配置和备份 |
| [测试](./TESTING.md) | 自动检查、隔离应用验证和真实服务验证边界 |
| [安装包构建与发布](./PACKAGING.md) | 无签名构建、tag 自动发行和平台产物 |
| [自然编辑部界面规范](./NATURAL_NEWSROOM_UI.md) | 信息架构、视觉令牌、布局与交互原则 |

模块文档：

- [浏览器采集扩展](../Plugin/README.md)
- [平台发布插件](../PublishPlugin/README.md)
- [renderer 架构](../desktop/src/README.md)
- [bridge 约定](../desktop/src/bridge/README.md)
- [FreeCut 归属](../desktop/src/vendor/freecut/ATTRIBUTION.md)

使用文档描述当前源码能力，已下载的安装包可能属于较早版本；标明「设计提案」的文档描述拟议行为，不代表已经实现。命令以各级 `package.json` 为准；配置示例不包含真实密钥、私有地址或个人绝对路径。精选界面截图放在 `images/`，Agent 开发计划、验收日志及原始证据集中保留在 Git 忽略的 `.local-development/`，不作为公开文档发布。

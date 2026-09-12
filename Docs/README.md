# GardenFlow 文档

这里记录当前公开仓库中可以验证的产品、架构与维护方式。

| 文档 | 内容 |
| --- | --- |
| [首次创作](./FIRST_CREATION.md) / [English](./FIRST_CREATION_EN.md) | 下载后配置文本模型、导入公开资料并保存第一篇介绍稿 |
| [演示与验证记录](./DEMO.md) | 实际产物、演示素材与各平台验证范围 |
| [阶段 0 验收记录](./PHASE_0_ACCEPTANCE.md) | 京东商品采集、保存和资产库回看的基础闭环验收 |
| [路线图](../ROADMAP.md) | 当前能力、近期改进与反馈驱动的后续方向 |
| [首轮推广工作包](./launch/README.md) | 发布草稿、录制脚本、贡献任务及人工复盘模板 |
| [使用手册](./USER_MANUAL.md) | 首次启动、空间、采集、知识、灵感、创作、生成、自动化和隐私 |
| [AI 供应商](./AI_PROVIDERS.md) | 文本与多媒体供应商、路由、配置检查和错误处理 |
| [架构](./ARCHITECTURE.md) | 进程、模块、数据、IPC、浏览器桥和安全边界 |
| [本地开发与部署](./LOCAL_DEPLOYMENT.md) | 环境、源码运行、调试、配置和备份 |
| [测试与验收](./TESTING.md) | 静态检查、测试、构建、冷启动和隐私验证 |
| [安装包构建与发布](./PACKAGING.md) | 无签名构建、tag 自动发行、平台产物与验收 |
| [自然编辑部界面规范](./NATURAL_NEWSROOM_UI.md) | 信息架构、视觉令牌、布局与交互原则 |

模块文档：

- [浏览器采集扩展](../Plugin/README.md)
- [renderer 架构](../desktop/src/README.md)
- [bridge 约定](../desktop/src/bridge/README.md)
- [FreeCut 归属](../desktop/src/vendor/freecut/ATTRIBUTION.md)

文档约定：命令以各级 `package.json` 为准；配置示例不包含真实密钥、私有地址或个人绝对路径；产品名、协议、数据库和 Native Host 统一使用当前 GardenFlow 契约。

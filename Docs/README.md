# GardenFlow 文档

这里记录当前公开仓库中可以验证的产品、架构与维护方式。

| 文档 | 内容 |
| --- | --- |
| [首次创作](./FIRST_CREATION.md) / [English](./FIRST_CREATION_EN.md) | 下载后配置文本模型、导入公开资料并保存第一篇介绍稿 |
| [演示与验证记录](./DEMO.md) | 实际产物、演示素材与各平台验证范围 |
| [阶段 0 验收记录](./PHASE_0_ACCEPTANCE.md) | 京东商品采集、保存和资产库回看的基础闭环验收 |
| [阶段 1 验收记录](./PHASE_1_ACCEPTANCE.md) | 商品资产整理、引用和创作上下文闭环验收 |
| [抖音阶段 3 验收记录](./DOUYIN_STAGE3_ACCEPTANCE.md) | 独立商品视频版本、发布插件及真实页面验收状态 |
| [淘宝／天猫阶段 4 验收记录](./TAOBAO_TMALL_STAGE4_ACCEPTANCE.md) | 手动商品与评论采集、独立商品同款关联及待验收实页 |
| [TikTok 阶段 5 验收记录](./TIKTOK_STAGE5_ACCEPTANCE.md) | 国际版独立商品视频、语言建议、Studio 适配与真实验收余项 |
| [商品套图阶段 6 验收记录](./PRODUCT_IMAGE_SET_ACCEPTANCE.md) | 持久方案确认、独立图文工程、模板编辑、PNG／ZIP 导出与恢复 |
| [视频混剪阶段 7 验收记录](./PRODUCT_VIDEO_REMIX_ACCEPTANCE.md) | 自有片段选择、持久确认、截取／原音编辑、MP4 导出与恢复 |
| [商品创作真实验收](./PRODUCT_CREATIVES_REAL_ACCEPTANCE.md) | 伟嘉 3.6kg 真实模型方案、套图与混剪导出、开发版／安装版重开 |
| [目标平台阶段 8 验收](./PRODUCT_TARGET_STAGE8_ACCEPTANCE.md) | 平台前置、规格快照、直接平台工程、独立版本与发布准备校验 |
| [持续对话编辑阶段 9 验收](./PRODUCT_PROJECT_EDITOR_STAGE9_ACCEPTANCE.md) | 工程绑定、受控批量修改、共享撤销、草稿冲突及本地事务恢复 |
| [统一发布阶段 10 验收](./PUBLICATION_STAGE10_ACCEPTANCE.md) | 两步确认、账号与草稿核验、独立完成询问、恢复和隔离验收 |
| [阶段 8／9／10 真实验收](./PRODUCT_STAGES_8_10_REAL_ACCEPTANCE.md) | 真实商品规划、33 轮对话编辑、实际成片与套图、冷启动、五件逐件发布、两个可信回执、最终冷启动及验收余项 |
| [路线图](../ROADMAP.md) | 当前能力、阶段 8–10 的平台创作／对话编辑／发布主线及验收余项 |
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
- [淘宝／天猫自动采集验收](./TAOBAO_TMALL_AUTO_CAPTURE_ACCEPTANCE.md)
- [renderer 架构](../desktop/src/README.md)
- [bridge 约定](../desktop/src/bridge/README.md)
- [FreeCut 归属](../desktop/src/vendor/freecut/ATTRIBUTION.md)

文档约定：命令以各级 `package.json` 为准；配置示例不包含真实密钥、私有地址或个人绝对路径；产品名、协议、数据库和 Native Host 统一使用当前 GardenFlow 契约。

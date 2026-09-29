# Design

## Atomic mention snapshot

`ChatComposerHandle` 暴露只读的 `getAssetMentionIds()`。表单提交回调在同一调用栈内读取 contenteditable DOM，并用当前选项与已选缓存解析完整引用；后续快捷指令仍可显式传递引用，不受 DOM 快照影响。

粘贴时使用当前资产目录进行确定性解析：仅唯一、完整的 `@名称` 匹配会被原地替换成资产 token，并继承真实资产 ID。解析按最长名称优先，避免名称前缀误配；同名歧义保留为普通文本并提示用户选择。提交时再次扫描 token 之外的纯文本，如果仍包含目录中的完整资产标签则 fail closed，避免粘贴事件、React state 或 DOM ref 竞态把引用静默降级。

## Fail-closed runtime policy

`product_video_compose` 的商品归属检查不再依赖路由是否正确命中。任何直接调用都必须携带唯一 `explicitProductRefs`，并校验 `productId` 和 `productUpdatedAt`。商品工作流中继续禁止代理绕过工程直接调用图片或视频生成工具。

此外，前台 `video_generate` 一律返回带 `requiresUserAcknowledgement` 的确认决策。Pi 前台运行时不得自动放行此决策，也不为等待确认设置计时器；用户取消后 QueryRuntime 终止本轮视频生成，不把取消结果重新喂给模型触发重试。商品工程内部的 reference-guided 任务直接由工程服务提交，不经过此代理工具，因此不受重复确认影响。

普通视频确认在当前主进程生命周期内保留完整请求快照，用户切换会话再返回时仍能恢复确认卡；商品视频分镜继续使用数据库中的持久化审批记录，因此应用重启后也可恢复。任何无法恢复执行上下文的普通视频请求均不得静默提交。

## Visual grounding

主进程保留已解析的 `ProductCreativeReference`。Pi 运行时先完成正式 LLM 意图路由；只有最终路由为 `product-video-compose` 且恰好一个商品时，才回调主进程解析素材绝对路径，并用 Electron `nativeImage` 生成有尺寸上限的 JPEG 数据 URL。运行时用户消息由文本、每张图的 `assetId/role` 标签和对应图片组成。若当前用户选择的聊天模型未声明图片输入能力，则在代理运行前返回明确错误；不得静默切换到 GardenFlow 官方源或其他供应商。

图片只用于本轮规划，不持久化到消息内容或元数据。结构化商品 JSON 仍只包含 `assetId/role/origin/previewUrl`。

在导演代理启动前，主进程使用同一视觉模型执行隔离的图片预检，并附加一张随机校验图。随机值只绘制在图片像素中，不出现在文字提示；返回值必须精确匹配，且分析结果必须完整覆盖全部输入 `assetId`。预检结果以不含原图和绝对路径的结构化证据进入任务元数据，正式规划同时接收原图与已验证的逐图描述。这样即使兼容网关静默丢弃多模态内容，也会在创建提案前失败，而不是降级为猜测。

`QueryRuntime` 在首轮请求前验证多模态消息、视觉标签、图片块与证据同时存在，并把安全摘要写入 `query.start` checkpoint。`product_video_compose` 权限策略再次校验商品 ID、版本和视觉证据，拒绝预检标记为价格、促销或活动日期的素材。商品视频模式禁止 `bash`/`app_cli` 文件列表作为视觉理解回退。

视觉预检结果在 QueryRuntime 创建前合并进任务元数据，因此确认卡持久化、应用重启后的审批恢复以及最终工具门禁读取的是同一份验证证据。多个商品不会启动视觉预检或进入缺图门禁，而是直接要求用户保留一个主商品。

## Heartbeat isolation

普通心跳报告使用 `gardenflow-heartbeat:<space>` 独立上下文与稳定会话 ID。主会话不再作为后台状态输出目标，因而暂停的人工确认卡不会被周期消息打断。

## 2026-09-29 收尾：视觉诊断与无视频模型路径

结构化视觉错误与脱敏诊断、当前模型重试、严格校验码、运行时 AI 动效能力、无视频模型纯图片提案与采集报告隔离已实现。

详细结果与未完成证据见 [商品视频流程收尾验收](../../Docs/PRODUCT_VIDEO_CLOSEOUT_ACCEPTANCE.md)。

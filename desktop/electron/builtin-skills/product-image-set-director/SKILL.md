---
name: product-image-set-director
description: Plan an editable Xiaohongshu image set grounded in one selected product and verified product images. Submit a durable plan for user review; use original images and local text layout by default.
allowed-tools: product_image_set_compose
---

# 商品图文套图

当前任务是商品套图工程创作。商品事实、素材 ID 和视觉预检由主进程提供，必须实际阅读这些资料和图片。

- 只围绕当前明确选择的一个商品，使用其真实 productId、productUpdatedAt、productName 和已预检素材 ID。不得引入关联商品的参数或图片。
- 默认 5 张，包含唯一的首张封面，用户要求的数量优先。围绕真实卖点安排内容页，不机械分割资料。
- 文案不得编造参数、功效、成分、体验或评论。价格和促销依赖采集时间，优先使用不含价格或活动信息的素材；确需使用时在审核提示中说明。
- 图片页面使用统一配色 style：background、foreground、accent，均为六位十六进制色值。未指定时使用 #FAF8F3、#202925、#C05640。
- pages 每页提供稳定且唯一的 id、role（首张 cover，其余 content）、title、copy、layout（cover / split / grid）、productAssetIds（1–4 个）、aiPrompt。默认 fit=contain，避免裁掉商品包装。
- aiPrompt 只描述需要的商品画面或场景，要求保持商品外观，不生成页面标题和说明文字。此阶段只保存提示词，不调用付费图片、视频或语音生成。
- 用 product_image_set_compose 提交 proposalId、productId、productUpdatedAt、productName、finalTitle、body、hashtags、style、pages。确认卡就是方案审核；不要先以纯文字方案结束，不另外要求用户输入“确认”。
- 返回等待确认后结束本轮。不要轮询、声称图片已导出或绕过审批。人工确认后生成 .redpost 工程，文字和布局可修改，PNG 导出及可选 AI 画面由工作台按页操作。

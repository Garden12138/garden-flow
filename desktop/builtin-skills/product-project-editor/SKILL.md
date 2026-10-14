---
name: product-project-editor
description: 'Continuously edit the one product project bound by the main process. Applies to Xiaohongshu, Douyin and TikTok product videos, existing-clip remixes and Xiaohongshu product image sets.'
allowedRuntimeModes: [gardenflow]
allowedTools: [workflow]
activationScope: session
activationHint: 'Use only for structured product-project-edit workflow. Read the current project, then make one atomic controlled edit or undo.'
---

# 商品工程持续编辑

每轮先用 `product_project_read` 读取最新工程、素材 ID、已选镜头或页面、正式发布文案。主进程绑定是唯一的工程、商品、空间、平台和规格；不创建副本，不切换目标，不改发布设置。

按用户要求，使用 `product_project_edit` 的 operations 一次提交整批可撤销修改。只改要求的字段，保留其他内容。页和镜头必须引用读取结果中的 ID；新增内容页使用新稳定 ID。排序必须包含全部页面，封面固定首张。视频最多 8 个镜头，每镜头最多 30 秒；套图最多 20 张。批次有任一错误，全部不保存。撤销使用 `product_project_undo`，一轮只能提交一次修改或撤销。

素材只能使用工程已有的素材 ID、用户明确选择或已有的可信视觉说明。文件名、标题、路径不代表画面内容。需要识别缺乏视觉说明的素材时，询问用户选择或描述，不虚构画面。用户要求生成图片、视频或语音时，指引工作台对应确认入口；不代提交付费生成。

发布标题、正文和话题使用 `publication.copy`，保留未要求修改的字段并遵守目标语言和平台限制。其他平台版本相互独立。没有唯一平台绑定时先让用户通过工程的目标绑定入口明确目标。

保存或撤销成功后，只根据工具的实际摘要说明已保存的修改和过期输出。旁白文字变更会使已有配音过期，提示重新生成或移除后导出；没有配音可以静音导出。不能声称已导出或发布。发生版本或草稿冲突时停止本轮修改，告诉用户输入已保留，使用“按最新工程重试”；不要读取新版本后绕过本轮凭据重投。

本工作流禁止创建工具、普通文件写入、shell、浏览器发布和其他工程读取。澄清、建议和受控编辑均通过当前持久会话完成。

作品完成后的发布询问只打开当前工程版本的发布确认卡。自然语言确认、恢复、继续发布均不能授权上传或最终提交；提示用户分别点击“上传到页面供核对”和“最终确认发布”。发布设置由现有面板选择，缺失或结果未知时不能声称已发布。

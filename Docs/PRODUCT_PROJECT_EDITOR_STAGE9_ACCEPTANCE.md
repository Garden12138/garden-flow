# 阶段 9：商品工程持续对话编辑验收

日期：2026-10-13。基于 `e734280` 和工作区的阶段 8 成果继续开发，保留原有未提交代码及文档。阶段 10 仍待开发。

## 实现范围

- 每个商品工程版本绑定独立、持久编辑对话；套图复用原稿件会话，视频工作台接入 `Chat`，原创作工程链接提供“继续编辑此作品”。
- 主进程验证 `ProductProjectEditorBinding` 的空间、工程、商品、平台规格及选中对象。`product-project-edit` 工作流只开放当前工程读取、批量修改与撤销；禁止创建、普通文件写入、shell、付费生成或浏览器发布绕过。
- 发送前保存手动输入。版本凭据和草稿 epoch 校验覆盖模型等待期间的新保存、新输入及后台结果；冲突保留输入并提供按最新工程重试。
- 手动编辑、对话编辑、素材替换及正式平台文案共用提交服务。批次先完整校验，一次保存、一次撤销；稳定请求 ID 去重。最近 20 步编辑历史统一管理，新修改保存在 SQLite，旧工程文件中的撤销记录按需兼容；撤销产生新修订并保留素材、生成记录、目标关系和发布历史。
- `product_project_edits` 持久日志协调工程文件与正式平台稿件的修改，启动时完成或回滚本地事务，不重投模型或媒体任务。派生 HTML 和清单可恢复。
- 局部套图修改只使相关页面输出过期；仅发布文案／设置变更保留媒体。待提交发布确认立即失效，提交中、已提交、结果未知、已发布记录保持原快照。
- 旁白文字修改使绑定配音过期且不自动生成；导出阻断过期配音，未绑定音频可静音导出。迟到视频、语音及页面结果保留为素材，不覆盖新编辑；迟到视频导出也不回写旧工程内容。

## 自动检查

使用 Node.js 22.23.2、pnpm 10.28.2 和既有锁文件，按以下顺序完成：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 464 项通过，失败／跳过均为 0 |
| `pnpm check` | 品牌、文档、224 个 UI 文件、609 个 IPC API 路径、22 个技能清单、TypeScript、插件构建及回归通过；采集插件各专项（28／24／6／29／83 项）及发布插件 120 项通过 |
| `pnpm build --config.compression=normal` | macOS arm64 未签名 `.app`、DMG、ZIP 构建通过；沿用锁文件，仅设置压缩等级 |

编辑专项回归 18 项覆盖完整批次校验、80 操作回执的完整 JSON、连续 20 次撤销、旧撤销记录、文件提交后输入变化的回滚，以及撤销后新的发布摘要凭据。

新增回归文件：`desktop/tests/productProjectEditor.test.ts`。命令：根目录 `pnpm test`。覆盖绑定路由、工具越权、唯一会话、空间／商品／平台隔离、整批回滚、请求去重、并发冲突、草稿 epoch、共享撤销、局部过期、正式文案、确认失效、受保护发布历史、配音过期、迟到媒体及事务中断恢复。

## 实际应用验收

驱动：`desktop/scripts/product-project-editor-electron-qa.cjs`。使用临时目录、同一隔离商品、本地模拟文本服务及实际主进程、预加载、界面和渲染器。验收期间阻断外部模型请求，图片／视频／语音生成入口计数必须为零。

两种环境共用隔离商品 `product_1791849959120_fe12e3c0`，验收目录 `/private/tmp/gardenflow-stage9-qa-final`。使用固定提案、真实审批卡及本地模拟文本响应，编辑响应走实际模型适配器、工作流和受控工具。模拟消息按已知操作编排，真实自然语言编辑质量单独验收。

| 工程类型 | 开发版六轮编辑／冷启动 | macOS arm64 包六轮编辑／冷启动 |
| --- | --- | --- |
| 小红书原图视频 | 通过 | 通过 |
| 抖音原图视频 | 通过 | 通过 |
| TikTok 原图视频 | 通过 | 通过 |
| TikTok 已有片段混剪 | 通过 | 通过 |
| 小红书套图 | 通过 | 通过 |

- 共 60 轮编辑、180 次本地文本 HTTP 请求；每种环境读取 30 次、批量修改 25 次、对话撤销 5 次。冷启动文本及媒体请求均为 0。
- 第 2 轮交错手动输入，发送前自动保存；第 4 轮交错手动撤销；第 3／6 轮导出。共 20 次检查导出及后台刷新保留尚未发送的对话输入，套图对话保持挂载。
- 每轮比较其余四个工程的完整快照；编辑前后工程数量相同。重新打开复用相同会话、修订、工程内容、文案和撤销历史。草稿 epoch 在打开时递增，独立于持久内容核对；打包验收后再次打开开发版也通过。
- 图片／视频／语音生成计数始终为 0；真实模型、上传与提交均未调用。所有外部模型网络请求在隔离驱动中阻断。

导出检查共 16 个 MP4、4 个 ZIP。测试视频均为两段 0.5 秒镜头：实际视频流为 1080×1920、30fps、1 秒；容器时长含 AAC 填充，另行记录。PNG 均为 1440×1920，ZIP 为封面优先的连续编号，含文案和清单；两次套图导出中未修改的五张图 SHA-256 与媒体 ID 相同，新增内容页排在末尾。已查看实际视频帧、中文封面、网格布局、裁切和工作台截图，中文无缺字；字幕位于 `{top:120,right:144,bottom:320,left:72}` 的推荐安全区内。

修复并回归了极短镜头淡入淡出区间重叠、长批次 JSON 回执截断、套图刷新卸载对话、连续撤销窗口、旧撤销记录兼容，以及文件提交后出现新输入时的回滚。最终包的 DMG 校验及 ZIP 压缩数据完整性检查通过。

结果见 [验证汇总](./evidence/product-project-editor-stage9/validation-summary.json)、[开发版创建](./evidence/product-project-editor-stage9/development-create-result.json)、[开发版重开](./evidence/product-project-editor-stage9/development-reopen-result.json)、[打包创建](./evidence/product-project-editor-stage9/native-create-result.json)、[打包重开](./evidence/product-project-editor-stage9/native-reopen-result.json)、[跨环境重开](./evidence/product-project-editor-stage9/cross-environment-reopen-result.json)、[导出尺寸与顺序](./evidence/product-project-editor-stage9/export-verification.json)及[包 SHA-256](./evidence/product-project-editor-stage9/package-sha256.txt)。

界面与实际产物：[开发版套图](./evidence/product-project-editor-stage9/development-image-set-workbench.png)、[打包套图](./evidence/product-project-editor-stage9/native-image-set-workbench.png)、[打包混剪](./evidence/product-project-editor-stage9/native-remix-workbench.png)、[中文视频字幕](./evidence/product-project-editor-stage9/native-video-subtitle.png)、[封面 PNG](./evidence/product-project-editor-stage9/native-cover.png)、[内容页 PNG](./evidence/product-project-editor-stage9/native-grid.png)、[混剪视频帧](./evidence/product-project-editor-stage9/native-remix.png)。

## 未运行分支

真实文本模型编辑质量、真实付费图片／视频／语音生成、真实账号上传及提交未运行。这些分支需按具体工程、页面／镜头和账号确认后单独验收，不计入本次模拟服务的结果。未新增发布平台、套图发布或完成后自动询问。

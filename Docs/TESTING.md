# 测试

[文档首页](./README.md) · [本地开发](./LOCAL_DEPLOYMENT.md) · [贡献指南](../CONTRIBUTING.md)

使用 Node.js 22、pnpm 10.28.2 和现有锁文件。首次安装运行根目录 `pnpm run setup`。

## 自动检查

在仓库根目录串行运行：

```sh
pnpm test
pnpm check
pnpm build
```

`pnpm test` 运行 `desktop/tests/*.test.ts`。Desktop Bridge 测试需要本地 Unix Domain Socket 或 Windows Named Pipe，应在允许本地 IPC 的环境运行。

`pnpm check` 包含品牌与隐私标识、生成资源一致性、Markdown 链接与图片、desktop bridge／UI parity、TypeScript，以及采集和发布扩展的构建、校验与回归。`pnpm build` 生成当前平台的无签名安装包。

只修改公开文档时，可运行 `pnpm check:docs` 和 `git diff --check`；涉及运行时、接口或构建时仍需执行对应测试及完整检查。命令定义见各级 `package.json`。

## 商品工程回归入口

| 范围 | 测试 |
| --- | --- |
| 三栏空白创作、草稿恢复、同一会话、幂等与手动冲突合并 | [creationWorkspace.test.ts](../desktop/tests/creationWorkspace.test.ts) |
| 卡片预设、来源快照、v1 迁移、重组、撤销、受限工具、导出缓存及模拟配图 | [noteCards.test.ts](../desktop/tests/noteCards.test.ts) |
| 目标、规格、平台副本与旧工程 | [productCreationTarget.test.ts](../desktop/tests/productCreationTarget.test.ts) |
| 套图审批、逐页过期、渲染、ZIP 与模拟生成 | [productImageSet.test.ts](../desktop/tests/productImageSet.test.ts) |
| 工程绑定、幂等修改、撤销、冲突与事务恢复 | [productProjectEditor.test.ts](../desktop/tests/productProjectEditor.test.ts) |
| 统一发布、两步确认、完成询问与恢复 | [publicationManagement.test.ts](../desktop/tests/publicationManagement.test.ts) |
| 采集报告路由、跨空间保护与恢复 | [gardenflowCaptureReportNavigation.test.ts](../desktop/tests/gardenflowCaptureReportNavigation.test.ts) |
| 自动采集保存与任务页面清理状态 | [marketplaceAutoCaptureRuntime.test.ts](../desktop/tests/marketplaceAutoCaptureRuntime.test.ts) |
| TikTok 真实页面夹具执行 | [tiktokPublisherDom.test.ts](../desktop/tests/tiktokPublisherDom.test.ts) |

三栏创作的定向回归：

```sh
pnpm --dir desktop exec node --test tests/creationWorkspace.test.ts tests/creationEntryUi.test.ts tests/gardenflowCaptureReportNavigation.test.ts
```

扩展专项可分别运行：

```sh
pnpm --dir Plugin check
pnpm --dir PublishPlugin check
pnpm --dir Plugin test:marketplace-search
pnpm --dir Plugin test:taobao-product
pnpm --dir Plugin test:jd-product
```

夹具和模拟服务用于复现边界条件，不代表对应真实平台分支已通过。

## 隔离应用验证

普通图文卡片使用临时用户目录和本地模拟文本模型，验证真实 DOCX／PDF 读取、结构化保存、自动保存、重启、六类模板、溢出检查、PNG／ZIP 与多种窗口尺寸。先构建 Electron 输出，再执行：

```sh
pnpm --dir desktop exec vite build
node desktop/scripts/note-card-electron-qa.cjs /private/tmp/gardenflow-note-card-qa create
node desktop/scripts/note-card-electron-qa.cjs /private/tmp/gardenflow-note-card-qa reopen
```

该驱动不调用真实付费模型，也不上传或发布内容；运行环境须允许本地监听和 Electron 图形窗口。

以下驱动使用临时用户目录、隔离商品和模拟服务，运行实际 Electron 主进程、renderer 及媒体渲染：

- [目标选择与版本](../desktop/scripts/product-target-electron-qa.cjs)
- [持续对话编辑](../desktop/scripts/product-project-editor-electron-qa.cjs)
- [统一发布](../desktop/scripts/product-publication-electron-qa.cjs)

三者参数均为 `<temporary-root> <app-root> <create|reopen> [native]`。临时目录必须位于 `/private/tmp/` 或 `/tmp/`；每个驱动和环境使用全新目录，只有 `reopen` 复用对应 `create` 的目录。不要在已完成目录重复运行 `create`。

以目标驱动为例，从仓库根目录进入 `desktop` 后运行：

```sh
cd desktop
node scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-target-dev "$PWD" create
node scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-target-dev "$PWD" reopen
```

先完成构建，再验证 macOS arm64 包：

```sh
node scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-target-native "$PWD/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" create native
node scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-target-native "$PWD/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" reopen native
```

其他驱动替换脚本名并使用自己的临时目录。启动前退出正在运行的 GardenFlow；开发版验证期间避免另一构建或开发进程刷新同一产物。保留原空间和设置，确认新工程、版本、会话与媒体都属于隔离目录。

检查目标选择、审批创建、交错手动与对话编辑、撤销、导出和冷启动；核对 MP4／PNG 实际尺寸、字幕、音轨、ZIP 顺序，以及其他平台版本未改变。发布验证使用模拟服务检查上传回读、第二次确认、编辑失效和历史恢复，不向真实账号发帖。

## 真实服务与记录

文本质量、媒体计费生成和平台页面分别验证。提交前明确商品或作品、发送素材、模型及费用；真实上传与最终发布逐件、逐动作确认。没有真实样本的分支标记未运行，模拟通过不能替代真实结论；提交结果未知时先核实，不重新投递。

Agent 开发计划、任务清单、逐轮验收记录、原始日志和截图放在 Git 忽略的 `.local-development/`，按日期或任务归档。公开仓库保留可复现脚本、脱敏测试夹具、使用方法和已知限制。公开 Markdown 不得链接本地辅助资料，`pnpm check:docs` 会阻断这类引用。

用于公开教程的精选截图需获授权并检查密钥、账号、私人内容和路径，另放 `images/`，注明演示背景。自动采集标签清理和 TikTok 审核／异常分支的当前限制见[路线图](../ROADMAP.md)。

## 梦境故事

专项测试通过真实工程文件和 SQLite 操作日志，隔离供应商接口，使用合成记录和本地媒体；覆盖长句字幕切分、实测音频时间覆盖、手工字幕保留、商品字幕兼容，以及手动封面复核的按钮授权和版本变化保护：

连续性及三模式专项另覆盖参考哈希、前序确认、下游过期、旧格式副本、真实本地视频绑定、单次调用、超时长阻止，以及生产视频服务的私密注册与禁自动创建重试：

```bash
pnpm --dir desktop exec node --test tests/dreamStoryContinuity.test.ts tests/dreamStoryReferences.test.ts tests/dreamVideoPrivacy.test.ts
pnpm --dir desktop exec node --test tests/dreamImagePromptBudget.test.ts tests/imageProviderAdapters.test.ts
node desktop/scripts/dream-story-modes-qa.cjs /private/tmp/gardenflow-dream-modes
node desktop/scripts/dream-story-modes-qa.cjs /private/tmp/gardenflow-dream-modes desktop reopen
# macOS：真实 Electron 裁切像素、实际参考数量、分享解包及重开；仅用合成素材
node desktop/scripts/dream-story-reference-qa.cjs /private/tmp/gardenflow-dream-reference
node desktop/scripts/dream-story-reference-qa.cjs /private/tmp/gardenflow-dream-reference desktop reopen
# 合成超长指令：可预览全文，确认被拦截、无生成任务
node desktop/scripts/dream-story-reference-qa.cjs /private/tmp/gardenflow-dream-reference desktop reopen budget
```

三模式脚本使用新的临时目录、合成图片/声音/视频与隔离数据库，验证本地预览、正式成片、分享包和重开。第二个参数可替换为解包应用的 `GardenFlow.app/Contents/Resources/app.asar`，验证安装包的渲染资源；它不调用真实供应商、不上传或发布。图像人物一致性仍需要另行授权的真实生成与人工检查。

```bash
pnpm --dir desktop exec node --test tests/dreamStory*.test.ts
```

隔离应用验证使用临时用户目录，模拟文本供应商，覆盖创作、保存重开、本地媒体、预览和正式渲染、导出及发布来源核验：

```bash
node desktop/scripts/dream-story-electron-qa.cjs /private/tmp/gardenflow-dream-qa desktop create
node desktop/scripts/dream-story-electron-qa.cjs /private/tmp/gardenflow-dream-qa desktop reopen
```

安装包验证将第二个参数替换为解包应用的 `GardenFlow.app/Contents/Resources/app.asar`，并在命令最后加 `native`。使用新的临时目录；不连接真实模型或账号。真实供应商调用、上传和最终发布须另外逐次确认，不以离线结果替代。


单张前序参考与精简单幕的安装包验证（合成色块、仅预览，无供应商调用）：

```sh
node desktop/scripts/dream-story-reference-qa.cjs /private/tmp/gardenflow-previous-frame-qa desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar new previous
node desktop/scripts/dream-story-reference-qa.cjs /private/tmp/gardenflow-previous-frame-qa desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar reopen previous
```

验证前序整图字节与哈希一致、只引用一份、固定基准未变、完整指令在预算内且无生成任务。`dreamStoryReferences.test.ts` 与 `dreamImagePromptBudget.test.ts` 覆盖选择变化使旧调用卡失效、锁定／旧格式保护和分享提示词排除。

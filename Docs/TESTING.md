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
| 目标、规格、平台副本与旧工程 | [productCreationTarget.test.ts](../desktop/tests/productCreationTarget.test.ts) |
| 套图审批、逐页过期、渲染、ZIP 与模拟生成 | [productImageSet.test.ts](../desktop/tests/productImageSet.test.ts) |
| 工程绑定、幂等修改、撤销、冲突与事务恢复 | [productProjectEditor.test.ts](../desktop/tests/productProjectEditor.test.ts) |
| 统一发布、两步确认、完成询问与恢复 | [publicationManagement.test.ts](../desktop/tests/publicationManagement.test.ts) |
| 采集报告路由、跨空间保护与恢复 | [gardenflowCaptureReportNavigation.test.ts](../desktop/tests/gardenflowCaptureReportNavigation.test.ts) |
| 自动采集保存与任务页面清理状态 | [marketplaceAutoCaptureRuntime.test.ts](../desktop/tests/marketplaceAutoCaptureRuntime.test.ts) |
| TikTok 真实页面夹具执行 | [tiktokPublisherDom.test.ts](../desktop/tests/tiktokPublisherDom.test.ts) |

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

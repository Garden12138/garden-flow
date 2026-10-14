# 测试与验收

2026-10-13–14 的[阶段 8／9／10 真实验收](./PRODUCT_STAGES_8_10_REAL_ACCEPTANCE.md)使用同一伟嘉 3.6kg 商品、已授权真实文本模型及两段已有视频，在独立目录完成规划、33 轮编辑、实际导出和安装包恢复。五件作品逐件获得上传与最终提交确认，均单次提交并完成发布记录；两个 TikTok 版本各有可信回执，小红书两件和抖音一件的链接缺失明确保留。最终冷启动保留五条冻结发布快照、人工核实来源、六个工程及询问投影，原空间 176 个文件未变，媒体生成调用为零。修复真实账号读取、重复导出询问、串行上传回读和延迟预览等待后，串行 `pnpm test` 487 项、`pnpm check`（发布插件 139 项）、`pnpm build` 通过；本轮最后两条结果核实仅修改记录和文档，文档链接检查通过。后续独立抖音副本完成单次全自动上传、文案与字幕修改失效、两次撤销和冷启动；追加抖音专项 12 项通过，没有最终提交。付费生成仅在具体对象确认后另验，非静音混剪沿用阶段 7 的既有余项；两者未运行，也不作为本轮默认主流程的收尾门槛。

阶段 8 的目标／版本回归为 `desktop/tests/productCreationTarget.test.ts`，在 desktop 目录运行 `node --test tests/productCreationTarget.test.ts`。平台选择和实际开发版／打包程序的隔离创建、导出、重开使用 `desktop/scripts/product-target-electron-qa.cjs`，命令与边界见[阶段 8 验收](PRODUCT_TARGET_STAGE8_ACCEPTANCE.md)。

商品图文套图的回归为 `desktop/tests/productImageSet.test.ts`，包含审批恢复／幂等、商品和空间隔离、逐页过期与导出复用、ZIP 顺序及模拟 AI 的请求去重和失败恢复。实际 Electron 工作台与打包程序的隔离验收命令见[套图验收记录](PRODUCT_IMAGE_SET_ACCEPTANCE.md)；不调用真实付费图片、视频或语音模型。

## 自动检查

在 Node.js 22、pnpm 10.28.2 环境运行：

```bash
pnpm check
pnpm test
pnpm build
```

`pnpm check` 包含：

- 当前品牌与隐私标识扫描；
- 生成品牌文件一致性；
- Markdown 本地链接和图片检查；
- desktop bridge / UI parity 与 TypeScript；
- 采集扩展和发布扩展的构建、验证与测试。

`pnpm test` 运行 `desktop/tests/*.test.ts`。浏览器 Desktop Bridge 测试需要创建 Unix Domain Socket 或 Windows Named Pipe；受限容器中应在允许本地 IPC 的测试环境运行。

## 隔离验收顺序

阶段 9 的受控工程编辑回归见 `desktop/tests/productProjectEditor.test.ts`，由根目录 `pnpm test` 运行。实际应用驱动使用本地模拟文本服务、临时用户目录和真实渲染，不连接真实媒体模型或发布账号：

```sh
node desktop/scripts/product-project-editor-electron-qa.cjs /private/tmp/gardenflow-stage9-qa-new desktop create
node desktop/scripts/product-project-editor-electron-qa.cjs /private/tmp/gardenflow-stage9-qa-new desktop reopen
node desktop/scripts/product-project-editor-electron-qa.cjs /private/tmp/gardenflow-stage9-qa-new desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar create native
node desktop/scripts/product-project-editor-electron-qa.cjs /private/tmp/gardenflow-stage9-qa-new desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar reopen native
```

使用全新的临时目录依次运行四个命令；`create` 不应在已经完成的验收目录重复执行，`reopen` 可以重跑。每个环境覆盖三平台视频、混剪和套图各六轮消息，交错手动输入、撤销、导出，并核对其他平台快照、导出保留未发送输入与冷启动恢复。运行开发版驱动期间不要同时执行会触发 Vite 重载的 `pnpm check`。验收范围及未运行分支见 [阶段 9 验收记录](./PRODUCT_PROJECT_EDITOR_STAGE9_ACCEPTANCE.md)。

Release 验收使用独立的临时 `userData` 和 workspace，并分为两个阶段。两个阶段不能混用：

### 阶段 A：未配置冷启动

从空的临时 `userData` 启动，只验证：

- 只创建当前 GardenFlow 目录与 `gardenflow.db`；
- 默认空间可用；
- 不显示数据转换、账号、会员、积分或支付界面；
- AI 初始状态为 `disabled`；
- 未配置文本模型、图片模型或浏览器插件时，界面给出准确的下一步。

完成缺失配置提示检查后结束本阶段。这里出现的“API Key 未配置”属于预期边界，不作为真实创作流程的失败。

### 阶段 B：已配置真实流程

运行资料导入、选题、稿件和封面前，先把当前可用的模型配置同步到隔离测试数据库。同步应满足：

- 覆盖文本、图片、视频、向量、转写、解析、重排及其路由和代理配置；
- 保留隔离 workspace 与测试空间，不复制聊天、稿件、知识库、媒体库等业务数据；
- 测试数据库和备份仅保存在权限为 `600` 的临时目录；
- 不在命令输出、截图、文档或诊断日志中打印 Key 和私有 Endpoint；
- 先确认本轮所需能力已配置，再开始真实模型调用。缺失时先修复测试夹具，不等流程报错后再补配置。

同步完成后，在同一个隔离 QA 空间执行完整流程。验收结束后删除包含凭据的临时测试目录。

## AI 路由

至少覆盖：

- OpenAI、Anthropic、Gemini、自定义 OpenAI-compatible 与本地无 Key 服务；
- 保存、重启恢复、启停和 scope 路由；
- 缺少 Endpoint、Key 或模型的明确错误；
- `new-api-aliyun` 与 `new-api-minimax` 的显式 preset、请求路由和能力矩阵；
- URL 或模型名不会触发 new-api 推断。

## 浏览器与诊断

- 当前扩展和 Native Host 完成握手、注册、allowlist 与操作去重。
- 采集不请求 `cookies` 权限，Host 不输出页面 payload。
- 插件错误最多保留 40 条，不触发诊断公网请求。
- 手动导出的桌面和插件报告不包含 Cookie、Token、API Key、网页正文、Data URI 或个人绝对路径。

## 产品漫游

在已同步模型配置的同一个隔离 QA 空间遍历：

1. 主工作台统计与最近工作；
2. 浏览器或本地素材进入知识库；
3. 灵感候选绑定来源并交给创作；
4. AI 创作显示引用、任务时间线和真实稿件；
5. 图片、视频、音频结果进入媒体库；
6. 自动化任务可启停、立即运行并显示结果；
7. 设置页保存并恢复所有供应商配置。

## 截图检查

README 截图统一 1600×900，浅色为主并保留一张深色模式。逐张检查：

- 无账号、API Key、联系人或个人路径；
- 无私密素材和内部服务信息；
- 文字清晰，没有 loading、错误 toast 或调试浮层；
- 图片被 README 引用，单图经过压缩；
- 不提交重复大图或未引用 GIF。

已有视频混剪使用 `desktop/tests/productVideoRemix.test.ts`（desktop 目录运行 `node --test tests/productVideoRemix.test.ts`），完整集成使用 `desktop/scripts/product-video-remix-electron-qa.cjs`。开发版／安装包创建、导出、重开及真实来源选择入口的隔离验收见[视频混剪首版记录](./PRODUCT_VIDEO_REMIX_ACCEPTANCE.md)。所有来源为本地合成片段，规划审批为夹具，真实付费媒体调用为零。

真实商品补充验收见[商品创作真实验收](./PRODUCT_CREATIVES_REAL_ACCEPTANCE.md)。`desktop/tests/productVideoRemixRuntime.test.ts` 可在 desktop 目录运行 `node --test tests/productVideoRemixRuntime.test.ts`；它直接覆盖统一运行时到人工审批的混剪路径，并验证普通商品视频／套图不能绕过图片视觉输入校验。来源时长测试增加超出 FFmpeg 诊断缓存长度的 15 秒视频，编辑测试增加已导出工程的过期状态和无内容变化命令。


阶段 10 统一发布回归：`pnpm --dir desktop exec node --test tests/publicationManagement.test.ts`；发布插件本地页面回归：`pnpm --dir PublishPlugin test`。应用驱动为 `desktop/scripts/product-publication-electron-qa.cjs`，真实插件 Chromium 页面夹具为 `desktop/scripts/publication-plugin-electron-qa.cjs`；只使用 `/private/tmp/` 的独立用户数据及本地发布服务，禁止真实平台请求与付费生成。串行执行 `pnpm test`、`pnpm check`、`pnpm build`，再按[阶段 10 验收记录](./PUBLICATION_STAGE10_ACCEPTANCE.md)核对打包程序与冷启动。真实发布需具体作品、账号与动作单独确认，不能把夹具结果当成真实发布结论。

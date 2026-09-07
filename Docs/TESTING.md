# 测试与验收

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

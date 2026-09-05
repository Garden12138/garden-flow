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

## 冷启动

使用临时 userData 验证：

- 只创建当前 GardenFlow 目录与 `gardenflow.db`；
- 默认空间可用；
- 不显示数据转换、账号、会员、积分或支付界面；
- AI 初始状态为 `disabled`；
- 配置有效供应商后 readiness 变为可用。

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

使用同一真实空间遍历：

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

# [Docs] 补充 MCP 配置与连接排障指南

草稿；建议标签：`documentation`、`help wanted`。维护者确认入口和复现范围后再公开，不预先标为适合所有新手。

## 问题

仓库已有 MCP runtime，但使用手册缺少一条从配置到发现工具、验证调用和失败恢复的可复现路径。不能把“存在实现”写成“任何第三方 MCP 都能使用”。

## 实现入口

- [mcpStore.ts](../../desktop/electron/core/mcpStore.ts)：配置与预设。
- [mcpRuntime.ts](../../desktop/electron/core/mcpRuntime.ts)：连接、协议和工具请求。
- [appCliTool.ts](../../desktop/electron/core/tools/appCliTool.ts)：应用 CLI 的 MCP 操作。
- [当前设置页](../../desktop/src/pages/Settings.tsx)：核对公开 UI 是否暴露对应入口；不要引用旧设置组件冒充现行入口。

## 交付

新增 MCP 使用文档，区分用户可用入口与开发者入口。选一个无凭据、只读的本地示例，写清前置依赖、配置方式、发现工具、调用结果、禁用方法。包含进程启动失败、握手失败、超时三类排障；不改 runtime、不新增默认外部服务。

## 验收

从干净配置依照文档得到真实工具列表和一次只读结果；错误情况给出对应的恢复步骤。记录系统和示例版本，说明未验证的传输方式。新文档链接加入文档导航，`pnpm check:docs` 通过。若当前版本没有可用用户入口，明确标为开发者指南并单独记录产品缺口。

# Product Video Durable Approval Design

## Architecture

`product_video_compose` 使用可持久化暂停/恢复流程：

1. 模型提交工具调用后，主进程校验参数并将提案写入 `pending_tool_approvals`。
2. 工具执行器返回结构化 `tool-confirmation-pending` 成功结果，查询运行时立即结束当前模型轮次。
3. 任务图保存为 `paused`；聊天仍正常结束，确认卡保持可操作。
4. 用户确认时，主进程从数据库读取原始参数，直接执行 `ProductVideoComposeTool`，避免再次让模型改写提案。
5. 成功后登记工程产物并完成原任务；取消则取消原任务。

通用工具仍保留既有实时确认行为，避免扩大安全策略变更。

## Data Model

`pending_tool_approvals`：

- `call_id`：稳定的审批 ID。
- `session_id`、`task_id`、`tool_name`。
- `proposal_id`、`proposal_digest`。
- `params_json`、`details_json`：确认时唯一可信输入。
- `status`：`pending | executing | completed | cancelled | failed | superseded`。
- `result_json`、`error_message` 与时间字段。

应用启动时把遗留的 `executing` 恢复为 `pending`，依赖工程层 `proposalId` 幂等避免重复扣费或重复建工程。

## Runtime Contract

- `ToolConfirmationOutcome.Defer` 表示已持久化等待，不表示失败或取消。
- `tool-confirmation-pending` 是等待态而非错误，不进入完成验收重试。
- `QueryRuntime.run()` 返回 `awaitingApproval`，`PiChatService` 保存等待提示并暂停任务。
- 审批恢复服务负责执行、产物登记、任务完成和结果消息持久化。

## UI

- 会话加载时同时读取未决审批。
- `pending` 显示确认/取消按钮；`executing` 显示不可重复点击的执行状态。
- 操作完成后重新加载会话消息。
- 商品视频卡使用“确认后将创建工程并消耗 AI 镜头额度”的业务说明，并显示每个场景的全部参考素材。

## Testing

- 工具执行器：`Defer` 返回 `tool-confirmation-pending`，不会执行工具。
- 完成状态：等待审批不会被视为失败或触发模型重提案。
- 提案存储：相同 ID 不覆盖原参数，新 ID 废弃旧审批。
- 回归：路由、确认硬门禁、项目幂等、类型检查与完整测试套件。

## 2026-09-29 收尾：商品变更后的分镜失效

审批增加 invalidated 和更新/删除原因；事件、会话加载、恢复、确认多处复核；快照并发写入中止，新入口复用原始要求并产生新提案 ID。

详细结果与未完成证据见 [商品视频流程收尾验收](../../Docs/PRODUCT_VIDEO_CLOSEOUT_ACCEPTANCE.md)。

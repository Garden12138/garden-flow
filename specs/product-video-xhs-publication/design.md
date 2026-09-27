# 技术设计

- 新增语义发布意图；结构化策略强制前台、人工确认、只暴露 `xhs_publish_prepare`。
- 工具 `inspect` 从当前会话工程产物解析来源；`prepare` 通过业务服务读成片、存笔记、绑定素材、申请发布确认，不调用生成或发布。
- RenderOutput 增加可选渲染指纹。新导出记录实际 composition 的画面、文字和音轨指纹；旧工程仅在现有 composition 快照可核验时兼容。
- 小红书稿件记录源工程/成片/资产/指纹，确认与提交前重新校验。发布摘要包含实际媒体文件 SHA-256。
- 发布任务增加 `triggerOrigin`，旧记录默认为 artifact-ready，主动请求为 explicit-request；旧自动触发行为保持，主动任务不受自动提示开关影响。
- 复用现有确认卡、插件协议和恢复状态机，卡片增加视频及文案预览。设置页未提交改动保持原样。

## 失败恢复

- 发布准备、候选构建、插件请求三层校验标题上限；可修正参数错误返回非终止工具结果，允许模型缩短后重新准备。
- 插件读取原生表单 validity、aria-invalid 与明确表单错误；提交后的无成功结果仍为未知，不凭页面停留推断未发布。
- typed recover IPC 和对话核实共同调用恢复状态机；需 `acknowledgedNotPublished: true`。插件通过 `amend` 核验 job/digest/tab、同稿件/媒体，原地修改指定字段，不清空或上传。旧记录保留 superseded/unknown 并标记用户核验，新版本重新授权。
- 已阻断的未提交任务通过 prepare 更新稿件后，尝试原地修改旧发布页；更新失败保留稿件并说明原因。不同媒体不能复用，不相关草稿不覆盖。跨版本 unresolved unknown 阻止提交。
- 确认卡沿用工业工具型左对齐布局、现有 SF Pro Text/PingFang SC 与主题 token（项目品牌覆盖技能默认配色限制）；补充字数、核验复选框、恢复入口。

## 对话续接

- 唯一 `routeIntent` 同时输出 intent 与 `xhsPublishAction`（intent/confidence/publicationRequested/acknowledgedNotPublished）。主进程按当前绑定稿件或唯一来源选择最新版本，提供只读上下文，前台 `PiChatService` 将路由动作直接交给 `handleConversationAction`；删除独立前置分类器。
- 明确发布授权由运行时处理，工具不可自行提交；同轮修改只准备。未知状态需独立人工核实，确认队列仍绑定最新版本+digest，运行中与发布成功不重复。
- 路由失败或动作不确定明确结束为失败，不再 fallback 到准备。发布动作仅接受队列/已有回执，prepare 不满足发布完成条件。无关请求无强制发布 metadata；后台不能通过对话动作授权发布。
- `unpublished_review_json` 保存用户核实结论及会话、时间；先保存后尝试 amend，失败仍可在重启后继续修改/重发。此字段不改变平台 publishStatus，历史 unknown 仅在归属/媒体校验与 amend 成功后 superseded。后续明确重发可使用本任务已保存的核实结论，不把结论推广到新提交或其他会话。
- 插件 amend 转移 prepared owner 至新 job ID，旧 unknown cache 不删除；只填变化字段并回读验证，媒体 snapshot 必须未变。Legacy owner 缺快照时需原正文+可见媒体锚点。严格 discard 仍用于取消/清理，不用于正常改标题。

## 路由传输修复

- Pi 的当前用户轮次 AbortSignal 经 AgentRuntime 传入 routeIntent，覆盖 fetch 和正文读取，finally 清理计时器及监听。每个同源请求默认 90 秒；仅 400/422 显式拒绝 response_format/json_object 才进行不带该参数的兼容请求。不自动切换模型、代理或官方源，不自动重试其他网络/HTTP 失败。
- 传输失败使用强类型 routingFailure，不靠错误文案判断用户意图。routingDiagnostic 只包含模型名、主机、耗时、期限、次数和 HTTP 状态，随任务 route/trace 持久化；错误正文不进入日志。发布服务遇失败直接回执未修改/未提交，不进入生成或发布。
- 虚拟时钟覆盖超过旧 20 秒期限的成功响应、90 秒超时、正文阶段停止、预先停止、独立兼容重试期限；实际 Pi 准备方法的集成测试检查传入模型与 signal。

## 原地重发与重连

- 发布插件定期通过 ping 的 desktopBridge.connected 验证实际连接，失败保留可恢复状态并重试 extension.register；连接过程合并并发调用，同一浏览器的 instanceId 和页面 ownership 保留。持久 alarm 使用 0.5 分钟周期，遵循 [Chrome 官方 alarm 最小周期](https://developer.chrome.com/docs/extensions/reference/api/alarms)。恢复连接不会触发发布。
- Bridge 提供可停止的、针对指定 instanceId/capability 的短暂等待，不选择第一个其他实例。socket cleanup 只删除该 socket 仍拥有的注册，防止旧 socket 关闭抹掉重连结果。
- 已核实任务先等待原实例恢复，再 amend→文字/媒体回读→confirm/prepare→submit；本轮停止信号覆盖等待和提交前检查。连接错误单独提示保持应用和专用发布浏览器打开，其他页面错误按实际失败阶段回执。不重置发布页、不重新上传已有媒体、不回放旧授权。

## 旧草稿媒体与话题兼容

- 真实页面只读检查发现：旧超长标题尚未更新；视频文件名与持久任务一致；页面末尾为 `#原料透明猫粮[话题]#`，稿件为 `#原料透明`。既有严格全文比对阻止原地更新，不能用装饰规范化掩盖话题名的变化。
- 主进程为 explicit-request 最新稿件发送强类型 `XhsDraftAmendmentV1.copyPolicy = replace-confirmed-copy`。旧快照缺失时，仅用户核实、同任务/稿件/媒体、唯一视频文件名精确匹配且原正文主体完全一致的末尾话题列表可恢复。写入最新版本正文/话题并严格回读；自动任务仍只改指定变化字段。
- 自包含注入读取器新增 mediaFileNames，从文件输入和正文外可见直接文本/标题读取完整视频文件名；不从正文任意提及推断媒体。与 mediaSources 一起快照并在 amend 后、prepare 与 submit 前核验。无法识别则报告缺媒体；其他正文变化独立报告。
- 回归不再仅使用理想化 blob/body：执行实际注入读取器，跨主进程/插件使用真实页面差异夹具。真实平台点击提交仍需另行授权，不能把模拟平台成功作为实际发布验收。

## 发布按钮可信点击

- CDP 先通过 AX/穿透 DOM 确认唯一候选及 backendDOMNodeId，然后 scrollIntoViewIfNeeded 并重新查询节点。布局框仅识别候选，不作为可命中证据。Runtime.resolveNode/callFunctionOn 在实际按钮上读取视口矩形，核验主页面、disabled/busy、按钮自身根及最外层宿主的 elementFromPoint；hover 后重新核验，再单次按下/松开。坐标遵循 [Chrome Input 协议](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl) 的主视口 CSS 像素。
- 按钮内安装临时被动 capture 监听器，仅接受 isTrusted 的同坐标左键 click；最多观察 1.5 秒，不重新发送点击。finally 删除监听器、释放远程对象并 detach。按下发送前即标记可能已发送，传输错误不能当作未提交。
- 平台反馈等待沿用 60 秒，与人工确认无超时不同。成功页要求明确成功标签、返回或倒计时且编辑器已退出；普通进度通知不作为失败。明确字段拒绝为 not_submitted；安全验证、服务器提示及无回执仍为 unknown，并区分未观察到点击与已观察到但缺成功反馈。未知缓存阻止重复点击。
- 对话动作先检查当前任务正在执行，再处理 unknown/review；执行中不保存核实记录、不重复入队。真实平台点击未验收时明确保留缺口，不以浏览器模拟或源码回归声称已发帖。

## 媒体对象字段顺序

- 真实第 4 版插件 ownership.media 按 mimeType/order/path/role/slotId 返回，桌面第 5 版请求按 slotId/role/path/mimeType/order 构造。字段值完全一致，JSON.stringify 全串比较却失败，导致 PREPARED_JOB_NOT_FOUND。旧 legacy owner 没有 media 字段，首次恢复绕过此比较，第二次恢复才暴露。
- 插件与桌面统一比较媒体列表长度、列表顺序、每条扁平协议记录的全部自有字段和值，不比较对象字段排列；不做字符串/数字转换，不忽略缺失或新增字段。页面媒体快照、任务/摘要/会话/稿件约束保持原有校验。
- 测试 storage.get/set 深拷贝并重排对象字段，跨进程流程增加真实生命周期的第二次重发；平台成功只在本次预期点击后出现，不能沿用上一次点击计数伪造完成。

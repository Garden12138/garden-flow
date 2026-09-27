# 验证记录

## 自动测试

- `pnpm test`：289 项通过。发布集成测试追加标题失败、跨版本未知结果保护、人工恢复、新版确认及重启恢复窗口。桥接测试需要沙箱外的本地 socket 权限。
- `pnpm check`：桌面主进程/渲染器类型、桥接、技能及两个插件检查通过。
- `pnpm build`：本轮标题失败恢复的最终代码完整未签名打包通过，生成 macOS arm64 DMG 与 ZIP。

## 主进程集成

使用真实发布准备工具、稿件文件存储、媒体库绑定及发布状态机；Electron/外部浏览器与主业务 DB 为隔离适配器。测试覆盖未确认/文字确认/取消零提交、按钮确认单次提交、重复准备幂等、时间线更新阻断、提交结果未知不重发。主动请求不访问自动触发配置。DB 增量迁移另外使用实际 SQLite 文件验证并重新打开。

## 页面检查

浏览器打开隔离页面，渲染实际 `XhsPublishConsentCard`，仅发布接口为模拟：

- 确认卡显示视频、标题、完整正文、话题、修改入口及持久等待说明。
- 使用 `session_1790235694798` 的现有 MP4 只读预览，媒体加载成功，浏览器读到时长 27.05 秒、readyState=4、无媒体错误。
- 取消后显示“已取消，本版本未发布”，不再展示提交按钮。
- 重载确认卡正常，无控制台警告或错误。
- 原工程的 composition 快照与当前时间线指纹一致，旧导出可兼容复用。

## 未执行项

未修改历史会话或实际商品工程，未启动真实生成或小红书发帖。Mac 锁屏，未在原生应用中验证真实稿件跳转；隔离页面仅核对入口展示。真实 Chrome 发布、账号状态与发布后笔记管理核验仍需用户在更新后的应用中点击确认，不能将模拟提交记为 P0 真发布通过。

## 标题失败与恢复回归

- 真实会话只读复现：第 2 版标题 23 字符，状态 `submit_result_unknown`；第 4 版标题 20 字符，状态 `blocked/EXISTING_DRAFT`。
- 发布插件 32 项测试通过，新增真实 background 生命周期隔离测试：超长标题零上传、明确字段错误返回未提交、无明确证据继续未知、未知结果缓存不重复点击、归属/原文/媒体变化不清理、恢复仅导航且不点击发布。
- 浏览器隔离页 `/`、`/?unknown`、`/?long` 使用实际确认卡。修复前未知卡没有恢复入口；修复后默认恢复按钮禁用，勾选人工核验并触发恢复后回到 20/20 字符的第 4 版待确认卡；超长标题显示 23/20 并禁用发布按钮。使用键盘 Space/Enter 完成交互，页面控制台无错误或警告；IAB 鼠标模拟未触发受控表单状态，不计作真实鼠标验收。
- 截图：`/private/tmp/gardenflow-xhs-recovery-confirmation.png`。浏览器 API 为模拟，没有清理真实发布页、核验真实笔记管理或发帖；需更新应用并重新加载发布插件后，由用户执行人工核验与恢复。

## 对话连续修改与原地重发（2026-09-27）

- 最终 `pnpm test`：293/293；`pnpm check`：类型、桥接、技能与两个扩展回归通过，其中发布插件 36/36。完整桥接检查需要沙箱外的临时 socket；首次沙箱 EPERM 不是业务失败。构建依赖安装时不能并发运行扩展 build/check，否则会出现临时缺模块。
- 最终源码的 `pnpm build` 完整退出 0，生成未签名 macOS arm64 DMG/ZIP 及 blockmap。构建沿用已有大 chunk 警告，没有新增构建配置或锁文件修改。日志 `/private/tmp/gardenflow-dialogue-final-build.log`。
- 真实工具/存储/发布服务隔离集成覆盖：失败/未知任务的语义续接 metadata、低置信度零授权、无关请求不强制发布、未核实未知任务不得重发、对话人工核实只 amend 不 submit、明确重发当前版本入队一次、重复请求不重复发布、未知回执不报告为未发布。语义模型输出使用 fixture，不调用真实付费模型。
- 真实插件 background 隔离测试覆盖：指定标题覆盖、正文/媒体保留、无导航/上传/点击发布、legacy 长标题兼容、媒体处理中/替换/其他任务/未要求改动正文阻断、平台成功回执不能被人工未发布声明覆盖。
- 浏览器 `http://127.0.0.1:41987/` 使用真实 `fillEditor/readPreparedEditorSnapshot/amend`，只模拟 Chrome 传输和页面模式。旧恢复校验对手改标题返回 PREPARED_EDITOR_CHANGED；新操作成功回读短标题，正文未变、mediaRetained=true，edits=1、uploads/navigations/submits=0。切换为其他任务 owner 后拒绝覆盖，计数未变。控制台无错误/警告。
- 实际 `XhsPublishConsentCard` 隔离页 `http://127.0.0.1:5178/?unknown` 展示对话修改/明确重发提示，不再宣称按钮是唯一入口；人工核实入口默认禁用，键盘核实/模拟恢复后显示最新第 4 版待确认文案。IPC 为模拟，没有执行真实发布。
- 浏览器使用 CUA 代替不可用的 agent-browser。IAB 鼠标模拟未触发按钮，使用键盘 Enter/Space 完成验收；不记为真实鼠标通过。验收截图 `/private/tmp/gardenflow-dialogue-amend-proof.png`。
- 只读复核历史 session 的两条任务仍为 revision 2 unknown 与 revision 4 blocked/EXISTING_DRAFT，没有改写历史 DB 或真实发布页。真实 Chrome/模型语义/小红书提交仍待用户在更新后的应用与发布插件中验收。

## 重发动作接线与核实持久化（2026-09-27）

- 真实会话只读基线：15:27、15:28 两次“重新发布当前版本”均路由为 xhs_publishing，却只 prepare 第 4 版；没有发布入队。独立前置分类器低置信/失败会静默退回只准备工作流，具体当次分类器 API 失败原因未记录，不推测。
- 删除独立前置语义请求。唯一 routeIntent 增加 xhsPublishAction，实际 Pi 入口直接调用服务；发布动作的完成验收拒绝 prepare/MP4 代替执行回执。动作失效记为失败并展示明确提示。
- 最终 `pnpm test`：295/295。集成测试运行从实际 PiChatService 源码提取的准备入口、实际路由/准备工具/发布服务/文件存储；仅模型输出、任务 DB/Electron、外围初始化及浏览器传输隔离。覆盖 response_format 不兼容、非 JSON、网络中止、缺失动作、低置信、后台/停止零提交、修改不提交、明确重发单次入队、重复与成功回执不重发。
- 实际 SQLite migration、upsert SQL 和 row mapper 验证旧任务保留、新核实字段重开后可读、损坏/跨会话记录不授权。页面恢复失败前保存人工核实结论；重新实例化服务后可查询已保存结论、恢复页面并重发，无需重复核实。平台 unknown 记录不改成 published/not_submitted。
- 本轮没有改渲染器或浏览器表单；上述入口异步流程由隔离集成验证，不新增真实浏览器/账号验收。真实模型的语义输出及原生应用→Chrome→小红书最终提交仍未验证；未修改真实会话、笔记、发布页或调用付费模型。
- 最终 `pnpm check` 退出 0（桌面双 TypeScript、桥接/技能、两个扩展通过，发布扩展 36/36）；`pnpm build` 完整退出 0，生成未签名 arm64 DMG/ZIP 与 blockmap。先前打包主动停止用于加入核实状态提示修复，不计作最终打包通过。日志为 `/private/tmp/gardenflow-unified-publish-test.log`、`/private/tmp/gardenflow-unified-publish-check.log`、`/private/tmp/gardenflow-unified-publish-final-build.log`。
- 对最终 app.asar 只读抽取 main bundle，确认包含 handleRoutedConversationAction、unpublished_review_json 与已保存核实状态提示，且不包含 handlePendingChatReply。只读复核真实 DB 仍为旧 revision 2 unknown、revision 4 blocked；旧核实失败的结论未自动补写，用户加载新版后需明确核实一次。

## 路由传输修复（2026-09-27）

- 真实 DB 只读复核：16:14:40/16:15:51 的两次请求在 20061/20022 ms 后路由失败，未进入队列，符合旧路由 20 秒本地期限；当时没有记录底层错误，不能排除模型/代理返回错误，不能宣称已实测证明服务端根因。
- 默认期限提高到每次 90 秒，Pi→AgentRuntime→routeIntent 的本轮 AbortSignal 覆盖请求和正文。400/422 明确格式不兼容才同源再试，独立期限；其他失败不重试或切换模型。人工确认等待没有新增超时。
- `pnpm test` 302/302，`pnpm check` 退出 0，发布扩展 36/36。新增虚拟时钟测试证明 25 秒响应成功、90 秒超时、不吞正文中止、停止零请求/监听清理、兼容请求总耗时 105 秒成功、HTTP/网络/无效输出分类及密钥/正文脱敏。真实 AgentRuntime 准备方法验证 signal 传递、route/trace 保存诊断；实际 Pi 入口集成验证前台模型与 signal 传入。
- 真实模型意图测试准备只读当前聊天配置，目标 qwen3.8-max / dashscope.aliyuncs.com，仅发送“重新发布当前版本”与当前发布任务上下文；执行前被安全审查拒绝，需要单独外发授权。没有发出请求、调用服务执行动作、修改配置/任务/页面或真实发帖。未将此项记为通过。
- 本轮纯主进程传输修复，未改变界面布局或页面适配器；隔离入口回归不能替代真实模型与小红书发布验收。
- `pnpm build` 完整退出 0，未签名 arm64 DMG/ZIP 与 blockmap 生成成功；只读抽取最终 app.asar 主进程 chunk，确认包含 `DEFAULT_ROUTE_TIMEOUT_MS = 9e4`、routingDiagnostic、停止信号转发及超时专属提示。
- 测试/检查日志：`/private/tmp/gardenflow-route-transport-test.log`、`/private/tmp/gardenflow-route-transport-check.log`；完整打包日志：`/private/tmp/gardenflow-route-transport-build.log`。

### 获得单独授权后的真实模型意图实测

- 用户明确回复“允许”后，使用当前聊天配置 qwen3.8-max / dashscope.aliyuncs.com、真实路由实现与提示词，仅测试“重新发布当前版本”及只读发布任务上下文。一次请求 HTTP 200，耗时 20969 ms，90 秒期限内完成，无兼容重试。
- 输出 xhs_publishing / xhs-publish；动作 confirm、confidence=0.95、publicationRequested=true、acknowledgedNotPublished=false，routingFailure=null。仅运行路由，没有调用发布服务、改写任务、恢复发布页或发帖，publishOperations=0。
- 这次实际响应超过旧 20 秒期限，验证本地期限过短确实会中断此类慢响应；不能据此认定历史每一次失败都只有同一原因。真实小红书提交仍未验收，未知提交保护和用户核实要求保持不变。

## 发布页重连与真实插件执行链回归

- 只读实际记录：最新重发正确路由为 confirm/confidence=0.95，模型耗时 28704 ms，但在 amend 前因绑定实例不可用失败。旧第 2 版的核实结论已保存，第 4 版标题 20 字，不需要再次改标题或核实。
- 发布插件缺少存活端口上的桌面重连探测：connectNative 遇已有 nativePort 直接返回，应用重启只丢失桌面 socket/注册时不会触发浏览器 onDisconnect。新增 0.5 分钟 alarm 探测 desktopBridge.connected 并重注册同一实例，合并并发连接；不触发发布、清空 ownership 或改绑。
- 只读 control.listInstances 查询发现原 xhs-publisher-da90d3af-7448-4dc4-886d-b77239f2c657 已于 1790501216318 再次注册，native host PID=23882。查询只返回实例元数据，不修改历史任务/页面或触发提交；不能据此宣称尚未加载的新插件代码已线上验收。
- Bridge 新增指定实例/capability 的可停止等待（默认最多 35 秒，属于连接恢复期限，不是人工确认期限）。旧 socket 延迟 close 仅清理自己仍拥有的注册，防止抹掉替换连接。发布服务连接恢复后执行已有 amend→回读→prepare→submit；失败持久化具体错误且不再建议修改无关文案。
- `pnpm test` 303/303，`pnpm check` 退出 0，发布插件 37/37。新增真实 socket 测试覆盖指定实例等候、不能换另一个浏览器、停止和旧 socket close 竞态。实际 Pi 准备入口/路由/发布服务与真实插件 background 在同一隔离集成中完成旧长标题→当前 20 字标题→文字/媒体回读→一次提交→模拟平台成功；Chrome DOM/点击/回执为测试适配器，不能记作真实小红书发布。
- 跨模块集成另外验证断连和 MEDIA_PROCESSING 零改动/提交、核实记录保留、失败卡片更新为当前错误、媒体源不变、只写标题、提交前 snapshot 是最新标题、零媒体上传、重复请求不再次点击。
- 最终 `pnpm build` 退出 0，arm64 DMG/ZIP 和两份 blockmap 完整生成。只读检查最终 app.asar：main-C8Du3Qa-.js 加载的 appMain-hAQnVZVF.js 含指定实例等待、BROWSER_WAIT_CANCELLED 与连接专属提示；打包的 .plugin-runtime/xhs-publisher-extension/background.js 含周期探测及 desktopBridge.connected 检查。
- 日志：`/private/tmp/gardenflow-publish-reconnect-test.log`、`/private/tmp/gardenflow-publish-reconnect-check.log`、`/private/tmp/gardenflow-publish-reconnect-build.log`。发布插件需在应用更新后重新加载现有实例，不删除重装以免丢失实例 ID/ownership；真实平台提交仍需用户在更新后的应用明确重发，当前修复没有代为发帖。

## 旧任务话题差异与视频文件锚点（2026-09-27）

- 真实 Chrome 发布页只读检查确认：视频文件为 `media_1790242761384_97f48d4e.mp4`，与旧/新任务媒体一致；页面仍是旧超长标题，正文主体与原稿一致，但末尾为 `#原料透明猫粮[话题]#`，而持久稿件是 `#原料透明`。不能将不同名称当作展示装饰而直接通过比对；此前理想化正文/blob 夹具没有覆盖这次实际差异。
- 新 `replace-confirmed-copy` 强类型策略只由 explicit-request 最新稿件触发。缺旧媒体快照时，核实结论、同任务/稿件/标签页、唯一上传视频精确文件名和原正文主体一起作为独立锚点；只放行末尾话题列表恢复为当前文案，严格回读最新版本。普通局部修改、其他任务/正文主体或视频文件差异仍失败，未知/成功回执保护不变。
- 实际自包含注入函数测试覆盖无 video 元素/URL、文件标签含子图标、隐藏标签及正文内文件名干扰；生命周期和跨主进程/插件集成覆盖无视频 URL 的真实话题差异、只更新文案、零上传、prepare 后单次 submit、文件名被替换后零点击、无核实/策略或正文主体变化零修改。
- `pnpm test` 303/303，`pnpm check` 退出 0，发布扩展 43/43；最后单媒体限制追加后针对注入读取器和发布恢复测试 13/13。`git diff --check` 通过。日志 `/private/tmp/gardenflow-legacy-draft-test.log`、`/private/tmp/gardenflow-legacy-draft-check.log`。
- 已只读检查打包的 app.asar 主进程 `appMain-Dgsp7C13.js` 含当前文案替换策略；内置发布插件含 mediaFileNames、提交前媒体锚点检查、旧话题恢复及单媒体限制。`pnpm build` 完整退出 0，未签名 arm64 DMG/ZIP 及两份 blockmap 完整生成；日志 `/private/tmp/gardenflow-legacy-draft-build.log`。
- 本轮没有写入真实发布页、修改真实任务或点击发布，也未调用付费模型。模拟平台回执不是实际小红书验收；需安装新版并重新加载现有插件，再明确发布当前版本。

## 发布按钮点击证据（2026-09-27）

- 只读现状：第 4 版 job `xhs_publish_23c917a7-b2e8-4aed-b81f-0efeb4fb1837` 在 19:10:24 开始 submitting，19:11:25 为 unknown，没有 publishedAt；页面标题已是当前 20 字标题，发布按钮仍在。不能据页面停留断言未提交。执行中“点击发布”被旧任务核实提示误导，已改为当前执行优先。
- 原代码直接使用布局框坐标，候选固定 hitTestable=true；新代码滚动并重新查询 backend node，在实际按钮根与最外层宿主核验视口命中，hover 后再次复核。观察实际按钮 isTrusted 左键事件，不再把 CDP 命令返回当作网页收到点击。按下发送开始后任何歧义都保留 unknown，不自动再点。
- 新 `trustedPublishClick.test.mjs` 执行实际 background dispatcher/submit 与自包含 Runtime 函数；Chrome 传输、DOM、事件和平台反馈为隔离夹具，不是真实发布。覆盖闭合根宿主内外遮挡、原页面外坐标滚动、hover 后遮挡、合成/缺失事件、传输中断、字段拒绝、服务器提示、安全验证、成功与缓存幂等；共 5 项通过。
- 实际 probePage 测试接受成功标签加返回按钮或倒计时，拒绝仍有编辑器的假成功；过滤进度/成功 toast，仅平台错误触发反馈分型。实际注入读取器/点击针对测试 8/8。
- `cloudbase:web-development` 浏览器验证使用 CUA（agent-browser 不可用）：闭合 Shadow DOM 的真实 arm 函数返回命中可用，原位置 y=2401.6875 在 825 高度视口外，滚动后 x=29.3359375/y=799.1875。CUA 拒绝操作闭合根控件；普通按钮的鼠标操作同样未触发事件，停止鼠标重试，不记作可信鼠标通过。
- 普通 DOM 隔离页验证键盘激活 isTrusted=true 但 clickObserved=false，不被误报成同坐标鼠标点击；监听器 cleanup=true。dialog 遮挡返回 PUBLISH_BUTTON_OBSCURED，未发出点击；errors=0，控制台无错误/警告。截图 `/private/tmp/gardenflow-publish-click-keyboard-proof.png`、`/private/tmp/gardenflow-publish-click-obscured-proof.png`。测试服务已停止，临时页已关闭。
- IAB 鼠标受限后改用原生 Chrome 的独立本地标签页（不操作小红书页）。实际闭合 Shadow DOM 按钮滚动后坐标 x=29.3359375/y=424.1875，原生窗口按该点单次鼠标点击，生产观察函数返回 clickCount=1、isTrusted=true、clickObserved=true、hitTestable=true、cleanup=true、errors=0。遮挡返回 PUBLISH_BUTTON_OBSCURED。截图 `/private/tmp/gardenflow-publish-click-chrome-proof.png`、`/private/tmp/gardenflow-publish-click-chrome-obscured.png`；已关闭该测试标签并停止服务。此项证明真实 DOM 命中/鼠标事件观察，不是实际 CDP 传输或小红书提交回执验收。
- `pnpm test` 303/303，`pnpm check` 退出 0（桌面类型/桥接/技能及两个扩展通过，发布扩展 50/50），最后增强执行中核实及候选节点断言后再次运行全量测试和发布扩展均通过；`git diff --check` 通过。`pnpm build` 完整退出 0，未签名 arm64 DMG、ZIP 与两份 blockmap 完整生成，沿用已有大 chunk 警告。
- 已只读抽取最终 app.asar，核对内置插件包含滚动、实际事件观察、宿主外层命中、歧义按下标记与反馈分型；主进程包含执行中提示及当前这次提交说明。日志 `/private/tmp/gardenflow-publish-click-test.log`、`/private/tmp/gardenflow-publish-click-check.log`、`/private/tmp/gardenflow-publish-click-plugin.log`、`/private/tmp/gardenflow-publish-click-build.log`。
- 未回放真实请求、改写历史记录、点击真实发布页或调用模型。第 4 版这次未知是新的提交尝试，不能沿用第 2 版核实记录授权重发；实际 CDP→小红书点击和平台回执仍需用户更新并明确授权后验收。安装新版后重新加载现有发布插件，不删除/重装以免丢失原实例与草稿归属。

## Chrome 存储字段重排导致第二次重发被拒绝（2026-09-27）

- 第 5 版任务在 20:01/20:03 被 PREPARED_JOB_NOT_FOUND 阻断，confirmedAt/submittedAt 均为空；不是再次点击后失败。第 4 版已保存核实记录。Native Host 有 publisher.publish 请求和及时响应，连接正常。
- 只读检查已知发布插件 `jafdjmajegkaabbohedhmmlhogdejkpb` 的 prepared ownership 持久记录及对应任务：jobId、digest、session、project、noteType 全部一致；视频的每个字段值完全一致。Chrome 记录的键顺序为 mimeType/order/path/role/slotId，桌面为 slotId/role/path/mimeType/order。旧 JSON 字符串比较为 false，修复后的按字段和值比较为 true。这解释了没有 media 字段的旧记录首次恢复成功，写入 media 后第二次恢复反而失败。
- 新连续重发测试先在旧实现失败，再在修复后通过。storage.get/set 深拷贝并重排对象键；实际主进程/插件跨模块覆盖第一次未知→用户核实→恢复新任务→第二次准备/单次点击→模拟成功及重复请求不再点击。之前夹具的成功回执只依赖累计点击数，现改为本次预期点击才出现成功。
- 桌面与插件媒体比较保持列表顺序、全部自有字段和值严格一致；覆盖路径/角色/槽位/MIME/order 变化、数字变字符串、缺字段、额外字段与列表重排拒绝。媒体快照、会话/任务/摘要和发布确认约束未放宽。
- `pnpm test` 304/304、`pnpm check` 退出 0，发布扩展 51/51。日志 `/private/tmp/gardenflow-media-identity-test.log`、`/private/tmp/gardenflow-media-identity-check.log`。
- 当前 Chrome 安装路径只读确认是仓库的 `PublishPlugin/dist/extension`，其中已生成修复函数。用户手动解锁后，在扩展详情页重新加载现有插件，收到“已重新加载”反馈；未删除插件、改绑或清空 ownership。只读 bridge 查询确认原绑定实例 `xhs-publisher-da90d3af-7448-4dc4-886d-b77239f2c657` 重新连接，nativeHostPid=77509。插件弹窗显示已识别唯一可用发布按钮。截图 `/private/tmp/gardenflow-media-identity-extension-reload.png`、`/private/tmp/gardenflow-media-identity-plugin-connected.png`；临时详情页已关闭，原发布页保留。
- `pnpm build` 完整退出 0，arm64 DMG、ZIP 及两份 blockmap 均已生成；日志 `/private/tmp/gardenflow-media-identity-build.log`。已只读核对新 app.asar 实际入口 main-Bbaac8gr.js 加载的 appMain-zXYKw8lt.js 包含媒体字段值比较；内置发布插件也包含修复，旧 JSON 对象字符串比较已移除。本轮未改写真实任务/页面或点击真实发布按钮，真实平台回执仍未验收。

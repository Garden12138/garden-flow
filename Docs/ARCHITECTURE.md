# GardenFlow 架构

## 1. 系统边界

GardenFlow 是本地优先的 Electron 桌面应用，配套两个 Chromium 扩展。桌面端持有数据、工作空间、AI 编排、媒体任务和自动化状态；扩展只承担用户明确触发的采集、浏览器控制与发布辅助。

```text
┌──────────────── React renderer ────────────────┐
│ 工作台 · 知识 · 灵感 · 创作 · 生成 · 自动化 │
└─────────────────────┬──────────────────────────┘
                      │ typed bridge / IPC
┌─────────────────────▼──────────────────────────┐
│ Electron main                                   │
│ SQLite · workspace · AI runtime · tools · media│
│ automation · diagnostics · Native Messaging    │
└──────────────┬───────────────────┬──────────────┘
               │                   │
      user-configured AI      Chromium extensions
```

应用没有 GardenFlow 官方账号、会员、积分、支付或共享模型网关。新安装的 AI 路由为 `disabled`，只有用户保存有效供应商后才启用。

## 2. 目录

- `desktop/src/`：renderer 页面、组件、状态、typed bridge 和主题。
- `desktop/electron/`：主进程入口、IPC handlers、数据库、AI runtime、工具与后台服务。
- `desktop/shared/`：主进程、renderer 和测试共享的纯数据契约。
- `desktop/electron/builtin-skills/`：随应用分发的系统 Skill。
- `desktop/src/vendor/freecut/`：FreeCut 编辑器与工程格式集成，保留独立许可证和 attribution。
- `Plugin/`：采集与浏览器控制扩展。
- `PublishPlugin/`：小红书、抖音与 TikTok 创作者页面的发布辅助扩展，按平台能力和页面归属分别校验。
- `desktop/shared/platformPublisher.ts`：公共发布请求、目标和状态契约；保留小红书旧请求格式，抖音使用独立版本与账号绑定。自选图片封面携带源图及横／竖生成文件的哈希快照，插件通过 `douyin.image-cover.v1` 显式声明能力；仅上传供核对与最终提交使用不同结构化阶段。
- 抖音封面适配器按可见上传器及已有上传图片状态选择原始／替换输入，排除 AI 参考图输入。输入文件须精确匹配哈希；保存前核对加载状态，保存后独立核对图片画面。最终准备期间预览身份再次变化时，重新用原上传文件校验两张图片，再由新页面快照复核；按横、竖方向比较精确签名，不依赖浏览器序列化后的对象字段顺序。媒体须保持原上传身份，`preparing` 状态不可提交。诊断只保留方向、尺寸、数值误差、变化字段及检查项，不保存签名 URL、完整校验文案或图片数据。
- `branding/`：当前品牌身份和视觉源文件。
- `scripts/`：生成一致性、品牌与文档检查。

`desktop/dist/`、`desktop/dist-electron/`、扩展 `dist/` 和 `desktop/release/` 都是生成产物，不应手工修改。

## 3. 启动与进程

`desktop/electron/main.ts` 先应用 GardenFlow 当前 userData 基线，再加载 `appMain.ts`。主进程创建隐藏窗口，renderer 完成首次提交后发送 `renderer:ready`，窗口才显示，减少冷启动白屏。

主进程初始化：

1. 当前 `GardenFlow` userData 和 `gardenflow.db`。
2. 幂等 SQLite schema 升级。
3. 默认空间与 workspace 目录。
4. IPC、资源协议、AI、媒体、自动化和浏览器桥。
5. 已安装的当前 Native Messaging Host 健康检查。

后台自动化可通过显式运维变量 `GARDENFLOW_HOLD_AUTOMATION=1` 暂停。该变量不改变交互式本地功能。

## 4. 数据模型

`desktop/electron/db.ts` 管理 SQLite schema。数据库保存设置、空间元数据、会话、任务、索引、媒体登记和运行记录；用户可见的素材、稿件与媒体文件保存在 workspace。

内容研究、观测、实验与成组内容的共享契约位于 `desktop/shared/`，主进程实现位于 `desktop/electron/core/content-intelligence/`，使用同一 SQLite 连接中的增量 `ci_*` 表。来源适配只读现有商品和知识库，引用由确定性原文定位验证；指标计算与空间授权不交给模型。工程创建复用现有 `CreationWorkspace` 和持久化请求，文件与关联保存分步恢复。研究与实验解释作业重启后中断，不自动追加请求；成组规划接入现有 Agent 的只读与候选工具，作品、媒体和发布仍逐项确认。界面入口见[消费者机会](./CONTENT_OPPORTUNITIES.md)、[观测与实验](./CONTENT_EXPERIMENTS.md)和[成组内容](./CONTENT_CAMPAIGNS.md)。

来源维护复用上述只读适配和不可变来源快照，以来源身份与旧版本定位证据、机会及工程，再沿注册工程的 `sourceId` 查找派生关系。独立扫描器计数排除记录并拒绝超限，不把工作选择器的分页结果当作完整范围。`ci_source_changes` 保存冻结的差异与影响图，`ci_source_maintenance_decisions` 追加逐项人工决定；工程版本或影响图变化形成新轮次。请求幂等、空间授权及原文定位均由主进程执行，处理记录不改变历史引用、原工程或发布状态。

梦境连续性复核使用 `shared/dreamStoryContinuity.ts` 中的梦境专用纯报告，复用既有分镜、人物／场景及实际参考选择函数。报告仅检查声明与登记状态，界面默认收起，不持久化派生字段，也不参与生成和发布授权。现有格式3／4、八幕语义、原引用哈希校验和逐幕确认保持原服务负责；尚无两个实际工作流的复用证据，因此未引入通用叙事引擎。

schema 升级必须：

- 幂等，可对同一数据库重复执行；
- 在事务内完成相关变更；
- 不依赖网络或用户账号；
- 保留当前数据并为新字段提供明确默认值；
- 配套 Node.js 测试。

工作空间内部目录为 `.gardenflow`。本地媒体通过 `gardenflow-asset://` 访问，主进程会规范化路径并验证允许根目录。

商品视频导出使用随安装包分发的 Remotion 页面、平台合成器和独立 Node 渲染运行时。构建时按当前锁定依赖复制完整渲染器依赖树，去除 pnpm 链接并保留嵌套版本；安装包从 `Resources/remotion-renderer-runtime` 加载，避免依赖桌面源码的 `node_modules`。开发环境仍使用已安装的依赖。

## 5. AI 与工具运行时

`PiChatService`、`QueryRuntime` 和工具注册表共同处理流式对话、上下文压缩、Skill 激活、工具调用、审批与产物验证。路由层只接受显式配置：

- 全局模式：`custom | disabled`；
- 文本供应商：OpenAI、Anthropic、Gemini、本地或自定义；
- 媒体路由：图片、视频、音频与 Embedding 各自保存；
- 视频预设：`aliyun-bailian | minimax | new-api-aliyun | new-api-minimax | custom`。

模型意图通过结构化状态、Skill 和工具 contract 传递。运行时只做输入验证、安全约束和能力检查，不根据用户消息中的零散关键词决定产品路由。

## 6. Renderer bridge

`desktop/src/bridge/ipcRenderer.ts` 组合领域 bridge；`desktop/electron/appMain.ts` 持有对应 handler。新增 IPC 时应同时更新：

1. 主进程 handler；
2. 领域 bridge；
3. `desktop/src/types.d.ts`；
4. parity 检查或行为测试。

缺失 handler 是开发错误，不应通过返回空数组或伪成功对象掩盖。超时只用于确实需要 UI 有界等待的读取操作。

## 7. 浏览器桥

采集扩展通过当前 Native Messaging Host `com.gardenflow.browser_control` 与桌面端通信。Host 再连接本机 Desktop Bridge 的 Unix Domain Socket 或 Windows Named Pipe；不开放公网监听端口。

安全边界包括：

- 扩展 ID 和 origin allowlist；
- 注册握手与会话令牌；
- typed capability 和参数验证；
- 操作 ID 去重；
- 采集 payload 不读取浏览器 Cookie；
- Native Host 不记录页面 payload；
- 插件诊断只保存在浏览器本地并手动导出。

## 8. 媒体与 FreeCut

图片、视频和音频生成以 job registry 记录状态与产物。媒体库只登记真实文件；生成失败不会伪造成功资产。视频编辑工程使用 vendored FreeCut 能力，其工程格式兼容逻辑属于当前文件格式支持，不属于产品数据转换入口。

### 商品工程、编辑与发布

`desktop/shared/productCreationTarget.ts` 保存版本化目标和规格契约。用户在规划前选定平台与形式，通过结构化元数据贯穿提案、审批和工程；运行时验证选择，模型不能替换绑定。视频及 `.redpost` 套图保留原文件格式，并保存独立商品／素材快照和平台版本关系。

`productProjectEditorService.ts` 提供共同的快照、批量修改、草稿同步和撤销服务。主进程从真实工程验证 `ProductProjectEditorBinding`，按请求 ID 和修订保证幂等及冲突保护；工程与正式平台稿件的联合修改使用 SQLite 事务日志恢复。编辑工作流只开放当前工程的受控工具，每个版本拥有独立持久会话。

`desktop/shared/publication.ts` 定义发布来源、快照、上传核验和任务投影；`unifiedPublisherService.ts` 路由已有三平台服务。任务持久区分待上传与待最终确认，`publicationSource.ts` 从实际工程解析空间、平台、文案、设置和媒体，按钮授权与执行策略共同阻止模型或 CLI 绕过两步确认。提交后的快照保持冻结，未知结果先核实。

`publicationCompletionService.ts` 接收成功完整导出事件，以空间、工程版本及内容摘要持久去重，将询问投递到对应编辑会话。恢复只核验已有产物，不重新请求模型、生成、上传或提交。套图渲染读取工程规格，页面输出按内容过期和复用；局部编辑只更新受影响页面。

## 9. 安全与隐私

- API Key 只发送给用户选择的供应商。
- 文件系统工具受 workspace 根目录限制。
- 高影响工具和发布操作需要显式确认或结构化审批。
- 诊断记录有界，导出前脱敏 Cookie、Token、密钥、网页正文、Data URI 和绝对路径。
- 应用不包含使用分析、自动诊断上传或硬编码内部服务地址。

安全报告流程见 [SECURITY.md](../SECURITY.md)。

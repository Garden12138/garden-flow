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
- `PublishPlugin/`：小红书发布辅助扩展。
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

schema 升级必须：

- 幂等，可对同一数据库重复执行；
- 在事务内完成相关变更；
- 不依赖网络或用户账号；
- 保留当前数据并为新字段提供明确默认值；
- 配套 Node.js 测试。

工作空间内部目录为 `.gardenflow`。本地媒体通过 `gardenflow-asset://` 访问，主进程会规范化路径并验证允许根目录。

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

## 9. 安全与隐私

- API Key 只发送给用户选择的供应商。
- 文件系统工具受 workspace 根目录限制。
- 高影响工具和发布操作需要显式确认或结构化审批。
- 诊断记录有界，导出前脱敏 Cookie、Token、密钥、网页正文、Data URI 和绝对路径。
- 应用不包含使用分析、自动诊断上传或硬编码内部服务地址。

安全报告流程见 [SECURITY.md](../SECURITY.md)。

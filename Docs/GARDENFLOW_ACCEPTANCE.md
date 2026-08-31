# GardenFlow 本机验收报告

迁移日期：2026-08-28。最终构建与复核日期：2026-08-31。平台：macOS arm64。Node.js 22.23.2，pnpm 10.28.2。

## 已完成

- 桌面、扩展、AI 自称、内置提示词与技能、源码命名及运行接口统一为 GardenFlow；品牌图标使用蓝紫鸢尾花，不含字母。取鸢尾常见的希望、智慧与勇气寓意，并以环抱花朵的叶片表达灵感生长与创意流动。
- 完整备份、独立归档已有副本后迁移真实数据；未合并副本、未删除原数据，备份未进入仓库。
- SQLite 原库及目标库完整性检查通过；切换前逐行逐列与结构化迁移预期一致。历史表、记录 ID、正文、凭据和向量保持不变。
- 工作空间 362 个文件全部迁移：361 个字节不变，1 个应用配置 JSON 进行了明确的结构化替换；项目目录更名。
- 桌面安装包启动成功，窗口与应用菜单显示 GardenFlow，历史会话与图片可读；知识库显示原有 16 个条目，资产库显示原有 80 个媒体条目，历史媒体预览成功。
- 从原历史会话打开稿件，正文、封面、六页预览正常读取。
- 从应用菜单正常退出、确认文件占用释放后重启，历史会话和资产库恢复成功。
- 2026-08-31 使用最终构建产物再次启动，窗口标题、应用菜单、历史会话和历史稿件均正常；退出后数据库与用户目录无进程占用。
- 2026-08-31 修复重命名后白屏：未配置超时的 guarded IPC 不再被错误压缩为 1ms；窗口在 React 首次提交后才显示，并主动触发首次重绘。加载失败、preload 异常、渲染进程退出和 10 秒无界面均写入 `logs/startup-window.log`，失败时提供重新加载或退出。
- 最终包冷启动记录 `renderer-ready`、`rootChildCount=1`、`readyState=complete`，未出现加载失败或超时事件；重复打开后仍只有 1 个桌面主进程，没有创建第二个窗口。
- 在最终构建中通过 macOS 原生保存对话框导出历史小红书素材包，实际 ZIP 包含 HTML、Markdown、manifest 和历史媒体，`unzip -t` 完整性检查通过。
- 实机期间会话、消息、任务、轨迹和运行事件数量未增加，未运行现有付费自动任务。
- 新 Native Host 与旧兼容入口均已注册，来源白名单仅含原扩展 ID。macOS Native Host 改为包内独立 CJS 运行时和用户目录启动器；旧 manifest 指向主程序的升级场景会自动转交并退出，然后将新旧 manifest 都改写到独立启动器，不再占用桌面应用身份。

| 数据表 | 迁移前 | 迁移后 |
| --- | ---: | ---: |
| chat_sessions | 63 | 63 |
| chat_messages | 352 | 352 |
| agent_tasks | 299 | 299 |
| agent_task_traces | 5106 | 5106 |
| session_checkpoints | 950 | 950 |
| session_tool_results | 489 | 489 |
| session_transcript_records | 1864 | 1864 |
| runtime_events | 542 | 542 |
| knowledge_vectors | 8 | 8 |
| wander_history | 7 | 7 |

允许的库内差异仅涉及 settings 配置、会话/消息元数据及任务的运行模式、路由元数据、产物元数据；每个变更字段的记录数量保存在本机备份的 `verification.json`。正常打开会话可能更新访问时间，不改历史正文。

实机复核：全部记录数量及受保护字段仍一致；1 个会话的访问时间与界面元数据更新。初次启动时调度配置的下一次运行时间及 2 个工作项的摘要/更新时间发生了正常化更新，未改变启用开关、任务状态、完成轮次或用户正文。随后已增加暂停期间只读加载保护，避免验收继续更新调度投影；原始文件仍在完整备份中。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 201 项通过 |
| `pnpm check` | 通过：品牌扫描、桌面接口一致性与类型检查、扩展构建与回归检查 |
| 扩展构建 | 通过，`Plugin/dist/extension` |
| `pnpm build` | 通过，无签名 macOS arm64 DMG / ZIP |
| `git diff --check` | 通过 |

最终安装包完整性：DMG 通过 `hdiutil verify`，ZIP 通过 `unzip -t`；`Info.plist` 的应用 ID 为 `com.gardenflow.app`。从最终 `.app` 反向提取的 1024×1024 `icon.icns` 已确认使用鸢尾花图标。构建未使用 Developer ID、原公司证书或公证身份，Electron 可执行文件仅带链接器生成的 ad-hoc 签名。

| 产物 | SHA-256 |
| --- | --- |
| `GardenFlow-2.5.0-arm64.dmg` | `e3ea6b047e15083dffe39204b5fa65e2f954776d796e768314c156d5cd6df7fe` |
| `GardenFlow-2.5.0-arm64.zip` | `678347952f5aa2a2c334fa9b08f2c7b65192c068635c79c043dc48c026816083` |

新增覆盖：目录冲突、WAL、重复迁移、中断回滚、会话上下文、历史日志保护、向量与密钥保护、存储键、旧资源协议和路径、符号链接越界、旧 CLI/扩展消息权限、11 个模型的新 ID 请求及网关拒绝错误、可选 IPC 超时、首次渲染显示、单实例保护、macOS Native Host 身份隔离。网络模型请求用模拟响应，不调用实际付费接口。

## 尚未通过完整验收的部分

- Chrome 未安装本次验收工具所需的 ChatGPT 浏览器扩展及其连接组件，无法自动完成真实扩展重新加载、连接和网页采集。已完成应用扩展导出、Native Host 注册与协议回归测试，不能据此宣称真实采集通过。需要在 Codex 的「设置 → Computer use」完成浏览器连接后补验。
- 新网关未搭建或验证。当前 Endpoint 保留，11 个新模型 ID 已启用；真实调用可能返回模型未配置错误。
- 自动任务保持迁移暂停状态。完成剩余验收后，按[迁移说明](GARDENFLOW_REBRAND.md)恢复；不会自动补跑停机期间的任务。

## 交付物

- 安装包：`desktop/release/GardenFlow-2.5.0-arm64.dmg`、同名 ZIP。
- 可直接启动的应用：`desktop/release/mac-arm64/GardenFlow.app`。
- 扩展：`Plugin/dist/extension`，沿用原公钥和扩展 ID。
- 品牌主图：`branding/gardenflow-iris-master.png`；桌面、网页标记、模型标记及扩展多尺寸图标均由同一鸢尾主题同步更新。
- 工具：`desktop/scripts/gardenflow-data-migration.cjs`，含预览、备份迁移、回滚和调度恢复命令。
- 品牌与兼容清单：`branding/identity.json`；模型对照与操作步骤见[迁移说明](GARDENFLOW_REBRAND.md)。

未签名、公证、发布、上传安装包或提交代码；没有将备份或密钥加入仓库。

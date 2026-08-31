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
- 2026-08-31 修复禁用更新后的启动错误：主进程在更新功能关闭时不再安排远程检查，IPC 在任何网络动作前返回明确的禁用结果，React 外壳移除重复检查；未包含的可选私有功能保持静默。真实开发版与重新打包的最终 `.app` 均越过原 1.8 秒触发点，未再出现更新检查或可选模块警告；最新最终包在 276ms 记录 `renderer-ready`。
- 2026-08-31 更新浏览器兼容数据：`caniuse-lite` 从 `1.0.30001769` 更新为 `1.0.30001810`，`baseline-browser-mapping` 从 `2.9.19` 更新为 `2.11.20`，未升级其他传递依赖。使用用户相同的 `pnpm dev` 路径复跑并等待渲染完成后，不再出现 Browserslist 数据过期提示。
- 2026-08-31 修复开发版真实白屏：Vite 开发服务器不会为仓库内的 CommonJS 兼容模块合成 `default` 导出，导致 `storageBootstrap.ts` 和延迟加载页面在 React 提交前抛出 `brandCompatibility.cjs does not provide an export named 'default'`。品牌同步脚本现在从同一兼容源额外生成浏览器原生 ESM，渲染器共享代码统一引用 ESM，主进程与迁移脚本继续引用 CJS；不存在两套手写映射。使用 `pnpm dev` 复跑并经本机窗口检查，完整 GardenFlow 界面、历史会话和知识库素材均正常显示，等待后未再出现该异常或启动失败弹窗。渲染器控制台错误也会写入启动诊断日志，避免以后只记录空根节点。
- 最终包冷启动记录 `renderer-ready`、`rootChildCount=1`、`readyState=complete`，未出现加载失败或超时事件；重复打开后仍只有 1 个桌面主进程，没有创建第二个窗口。
- 在最终构建中通过 macOS 原生保存对话框导出历史小红书素材包，实际 ZIP 包含 HTML、Markdown、manifest 和历史媒体，`unzip -t` 完整性检查通过。
- 本次插件修复与 14:38 的最终安装包冷启动没有新增会话、消息、任务、轨迹、运行事件或向量。只读复核发现内置“小红书自动采集”曾于 2026-08-31 10:56–11:01 在本次插件修复前运行，新增 1 条知识、1 条消息、1 个任务、9 条任务轨迹和 1 个向量；这些有效业务数据保留，不做删除或回滚。
- 新 Native Host 与旧兼容入口均已注册，来源白名单仅含原扩展 ID。macOS Native Host 改为包内独立 CJS 运行时和用户目录启动器；旧 manifest 指向主程序的升级场景会自动转交并退出，然后将新旧 manifest 都改写到独立启动器，不再占用桌面应用身份。
- 实机确认 Chrome 原先仍从旧用户目录加载解压扩展。现已在保持原公钥、扩展 ID `dhfphfekcjahljnefpdjoidehnhhoeie` 和 Chrome 存储的前提下完成原目录备份及原子刷新；扩展详情、侧边栏标题、采集模块、图标和标签组均显示 GardenFlow。重载后连接状态显示“可保存 · AI控制可用”；验收未点击保存按钮，未新增用户数据。
- 应用启动会按扩展全目录指纹刷新新导出目录，并同步已存在且公钥匹配的旧加载目录；同一应用版本下插件资源变化不再被旧版本号缓存遗漏。公钥不匹配的目录会拒绝覆盖。

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

迁移切换时全部记录数量及受保护字段一致；1 个会话的访问时间与界面元数据更新。初次启动时调度配置的下一次运行时间及 2 个工作项的摘要/更新时间发生了正常化更新，未改变启用开关、任务状态、完成轮次或用户正文。随后已增加暂停期间只读加载保护，避免验收继续更新调度投影；原始文件仍在完整备份中。

2026-08-31 最终只读快照：`chat_sessions=63`、`chat_messages=353`、`agent_tasks=300`、`agent_task_traces=5115`、`session_checkpoints=950`、`session_tool_results=489`、`session_transcript_records=1864`、`runtime_events=542`、`knowledge_vectors=9`、`wander_history=7`。相对迁移快照的差异全部对应上述 10:56 自动采集；数据库 `PRAGMA integrity_check` 为 `ok`。迁移状态的 `automationHold` 仍为 `true`，最终冷启动验证完成后应用已关闭，未恢复调度。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 205 项通过 |
| `pnpm check` | 通过：品牌扫描、桌面接口一致性与类型检查、扩展构建与回归检查 |
| 扩展构建 | 通过，`Plugin/dist/extension` |
| `pnpm build` | 通过，无签名 macOS arm64 DMG / ZIP |
| `git diff --check` | 通过 |

最终安装包完整性：DMG 通过 `hdiutil verify`，ZIP 通过 `unzip -t`；`Info.plist` 的应用 ID 为 `com.gardenflow.app`。从最终 `.app` 反向提取的 1024×1024 `icon.icns` 已确认使用鸢尾花图标。构建未使用 Developer ID、原公司证书或公证身份，Electron 可执行文件仅带链接器生成的 ad-hoc 签名。

| 产物 | SHA-256 |
| --- | --- |
| `GardenFlow-2.5.0-arm64.dmg` | `76fe7e56c9549c315032d55c88f2b8787ee88f7c1758596af8b0a2745fa816c5` |
| `GardenFlow-2.5.0-arm64.zip` | `c86fca0c9c59de803052e55c3b7d8f535dee46c7a93e83608dba0b4db254b5bc` |

新增覆盖：目录冲突、WAL、重复迁移、中断回滚、会话上下文、历史日志保护、向量与密钥保护、存储键、旧资源协议和路径、符号链接越界、旧 CLI/扩展消息权限、11 个模型的新 ID 请求及网关拒绝错误、可选 IPC 超时、首次渲染显示、单实例保护、macOS Native Host 身份隔离、扩展资源指纹、原目录原子刷新/一次性备份、公钥不匹配拒绝、旧标签组名称迁移及禁用更新策略。网络模型请求用模拟响应，不调用实际付费接口。

## 尚未通过完整验收的部分

- Chrome 已完成真实扩展重载、界面品牌、扩展 ID、标签组迁移和连接状态验证；为避免改动用户数据，本次没有执行真实网页保存，因此不宣称新增采集记录已经端到端落库。
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

# 自动化模块升级实现方案:Chat 创建任务 + 内置 computer-use 自动采集

> 状态:方案评审稿(未实施)
> 范围:`desktop/`(Electron 主进程 + renderer)、`Plugin/`(仅依赖现状,不改动)、外部依赖 [Garden12138/computer-use](https://github.com/Garden12138/computer-use)

---

## 0. 目标概述

本方案覆盖两个需求与若干补充建议:

1. **Chat 创建自动化任务**:用户在聊天中用自然语言描述"每天 9 点帮我做 X",AI 完成参数确认并创建定时/长周期任务,任务出现在自动化页,可继续在 chat 或自动化页管理。
2. **内置自动化任务(小红书自动采集)**:应用内置一个"小红书自动采集"任务,基于 computer-use 驱动**真实 Chrome**(非 Playwright/CDP),配合已安装的 RedClaw 浏览器插件完成采集入库。默认关闭,自动化页可手动开关与配置。
3. **补充建议**(第 4 节):执行历史、采集后处理流水线、内置任务模板化、接管安全机制等。

---

## 1. 现状盘点

### 1.1 自动化模块现状

当前自动化 = **RedClaw Background Runner 上的"定时/长周期 Prompt 执行器"**,不是动作编排 DSL:

- 核心引擎:`desktop/electron/core/redclawBackgroundRunner.ts`
  - 任务模型 `RedClawScheduledTask`(interval/daily/weekly/once)与 `RedClawLongCycleTask`(多轮推进)
  - 持久化在 `<workspace>/redclaw/background-runner.json`
  - 约 30s 一次 maintenance tick,到期任务经 `HeadlessAgentRunner` 走与前台聊天**同一套** `PiChatService` + 工具链执行
  - 每 tick 自动化预算 `maxAutomationPerTick`(默认 2)
- UI:`desktop/src/pages/Automation.tsx` + `desktop/src/features/redclaw/automationTasks.ts`(表单创建,`actionType` 实质只有 `redclaw_prompt` / `long_cycle`)
- IPC:`redclaw:runner-list-scheduled / add-scheduled / remove-scheduled / set-scheduled-enabled / run-scheduled-now` 及 long-cycle 对应通道
- 任务状态:仅 `enabled + lastRunAt/lastResult/lastError`,**没有独立执行历史表**

### 1.2 Chat 侧已有能力(重要:底层通道已通)

`app_cli` 工具(`desktop/electron/core/tools/appCliTool.ts`)的 `redclaw` 命名空间已实现全套任务管理动作:

- `schedule-list / schedule-add / schedule-update / schedule-remove / schedule-enable / schedule-disable / schedule-run-now`
- `long-list / long-add / long-update / long-remove / long-enable / long-disable / long-run-now`
- `work` 命名空间亦有 `schedule-add / cycle-add`(创建 WorkItem 并联动 runner)

系统提示词(`desktop/electron/prompts/library/runtime/pi/system_base.txt` 第 22、38 行)已引导模型:用户提出"定时提醒、周期巡检、每天/每周执行"时优先创建自动化工作项。

**结论:chat 创建任务不是从零开发,而是补齐"确认 → 创建 → 回显 → 管理"的体验闭环。**

### 1.3 采集链路现状

```
网页 DOM → Plugin(保存网页/保存笔记按钮)
  → Native Messaging(com.redbox.browser_control)
  → Desktop Bridge(UDS/Named Pipe,allowlist 方法)
  → knowledge.ingestXhsEntryV2 等 → 知识库/媒体库入库
```

采集链路与自动化调度目前**完全解耦**:自动化任务无法主动触发浏览器采集,只能消费已入库的数据。

### 1.4 computer-use 是什么

[Garden12138/computer-use](https://github.com/Garden12138/computer-use) 是原生"电脑操作"运行时:

- **驱动真实桌面应用**:macOS 用 Swift helper(CGEvent 键鼠 + AXUIElement 窗口 + Screen Capture 截图);Chrome 是普通桌面应用,不用 Playwright/Selenium/CDP/调试端口,**行为特征接近真人**
- 提供三种消费方式:CLI(`computer-use screenshot/click/type/hotkey/scroll/...`)、**MCP server**(`python3 -m computer_use mcp`,stdio)、agent skills(`skills/computer-use`、`skills/browser-use`)
- 浏览器配方(macOS):`browser-open-profile <name>`(独立 Chrome profile)、`browser-open-url`、`browser-save-page`
- `computer-use doctor --json` 输出平台能力与权限状态(辅助功能/录屏),用于就绪检查
- 仓库自带 `examples/xhs_search_save.sh`:Chrome 小红书搜索 → 点开笔记 → 点插件"保存网页/保存笔记"按钮,**与本项目 Plugin 的采集按钮直接对应**,即"自动采集"的完整通路已被上游验证过

限制:Windows/Linux 的浏览器配方在 v0.2 为 `unsupported`;需要用户在本机安装(Python 包 + 构建 helper)并授予系统权限。

---

## 2. 需求一:通过 Chat 创建自动化任务

### 2.1 差距分析

| 环节 | 现状 | 差距 |
|------|------|------|
| 工具能力 | `app_cli redclaw schedule-*` 全套已有 | 无 |
| 提示词引导 | 已有基本规则 | 缺"创建前参数确认、创建后回显下次运行时间"的规范 |
| 创建确认 | 工具直接执行,无确认 | 创建持久后台任务是长期副作用,应有结构化确认 |
| 结果呈现 | 纯文本回复 | 无任务卡片,用户感知弱、无法直接启停/跳转 |
| 来源追溯 | 任务无来源字段 | 自动化页无法区分手动/chat/内置任务 |

### 2.2 方案设计

#### 2.2.1 交互流程

```
用户:"每天早上 9 点帮我采集猫粮相关的爆款笔记并出一份选题建议"
  → 模型按提示词规范收集/推断参数(名称、频率、执行 prompt)
  → 调用 app_cli(redclaw schedule-add ...)
  → 工具确认层拦截 → chat 渲染"创建自动化任务"确认卡(参数一览)
  → 用户点确认 → 任务落库,nextRunAt 计算
  → 工具结果携带结构化元数据 → chat 渲染任务卡片(名称/频率/下次运行/启停开关/跳转自动化页)
```

#### 2.2.2 结构化确认(遵循 AI System Design Rule)

**不做任何用户消息文本匹配**。约束全部落在工具契约层:

- `appCliTool` 增加按动作(action)粒度的确认策略:`schedule-add / schedule-remove / long-add / long-remove` 等**产生或删除持久后台任务**的动作标记为需确认,复用现有 `chat:confirm-tool` 确认链路(renderer 已有工具确认机制)。
- 确认卡由 renderer 根据工具调用参数渲染为可读表单(任务名、频率、prompt 摘要),而非原始 JSON。
- 自动化后台上下文(headless 执行)中默认跳过确认(无人值守),仅前台 chat 会话启用。

#### 2.2.3 chat 任务卡片

- 工具结果增加结构化标记:`schedule-add` 等动作的返回值附 `uiHint: { kind: 'automation-task', taskId, ... }`(随 tool result 持久化到消息记录)。
- renderer 消息渲染层识别 `uiHint.kind === 'automation-task'`,渲染任务卡片组件(新增 `desktop/src/components/AutomationTaskCard.tsx`):
  - 展示:任务名、频率描述、下次运行时间、启用状态
  - 操作:启/停(走 `redclaw:runner-set-scheduled-enabled`)、立即运行、跳转自动化页
- 卡片操作直接走既有 IPC,不经过 AI。

#### 2.2.4 来源标记

- `RedClawScheduledTask` / `RedClawLongCycleTask` 增加字段 `source?: 'manual' | 'chat' | 'builtin'`(默认 `manual`,向后兼容旧数据)。
- `app_cli` 创建路径写入 `source: 'chat'`;自动化页创建写 `manual`;内置任务写 `builtin`(见第 3 节)。
- `Automation.tsx` 列表项显示来源徽标;`redclawTaskCompat.taskListItem` 投影透传该字段。

#### 2.2.5 提示词规范强化

在 `system_base.txt` 自动化相关段落补充(仍是能力边界描述,非关键词匹配):

- 创建前必须向用户复述:任务名、触发频率、将执行的完整 prompt;信息不足时先追问,不得臆测频率。
- 执行 prompt 的质量要求:自包含(执行时无对话上下文)、明确产出物与保存位置。
- 创建成功后必须回显下次运行时间与管理入口("可在自动化页或继续在此对话中管理")。

### 2.3 改动清单

| 文件 | 改动 |
|------|------|
| `desktop/electron/core/tools/appCliTool.ts` | schedule/long 写操作按 action 声明需确认;返回值附 `uiHint`;创建时写 `source: 'chat'` |
| `desktop/electron/core/redclawBackgroundRunner.ts` | 任务模型加 `source` 字段(读写兼容) |
| `desktop/electron/core/redclawTaskCompat.ts` | 列表投影透传 `source` |
| `desktop/electron/prompts/library/runtime/pi/system_base.txt` | 补充创建规范 3 条 |
| `desktop/src/components/AutomationTaskCard.tsx`(新增) | chat 内任务卡片 |
| chat 消息渲染入口(RedClaw/Chat 页) | 识别 `uiHint` 渲染卡片 |
| `desktop/src/pages/Automation.tsx` | 来源徽标 |

---

## 3. 需求二:内置自动化任务 —— computer-use 小红书自动采集

### 3.1 目标与原理

内置一个"小红书自动采集"任务:按配置的关键词定时打开真实 Chrome,搜索并浏览笔记,点击 RedClaw 插件注入的"保存网页/保存笔记"按钮,数据经**现有** Plugin → Native Host → 知识库链路入库。默认关闭,自动化页手动开关。

选择该路线的核心理由:

- **复用采集入库全链路**:采集解析、去重、入库、媒体下载全部走已有插件通路,desktop 端零新增采集逻辑;
- **真实浏览器 + 真人式操作**:无自动化指纹(无 CDP/WebDriver),配合保守节奏,风控暴露面最小;
- **上游已验证**:computer-use 仓库的 `examples/xhs_search_save.sh` 就是这条通路的手工验证脚本。

### 3.2 总体架构

```
Automation 页开关(默认关)
  → Background Runner 到期调度(builtin 任务)
  → HeadlessAgentRunner(现有链路,激活 xhs-auto-capture skill)
  → AI 循环:computer-use 截图 → 视觉定位 → 点击/输入(MCP 工具)
       Chrome(独立 profile,已登录小红书 + 已装 RedClaw 插件)
       点击插件"保存网页 / 保存笔记"按钮
  → Plugin → Native Messaging → Desktop Bridge → 知识库入库(现有链路)
  → AI 用 app_cli 查询知识库最新条目,校验入库成功(反馈闭环)
  → 汇总报告写入任务执行记录
```

关键点:**入库校验不依赖截图**,而是通过 `app_cli` 查询知识库最近新增条目确认,形成可靠反馈闭环。

### 3.3 内置任务模型:定义在代码,状态在配置

不把内置任务作为普通 `scheduledTasks` 记录落盘(否则升级时无法更新定义、且可能被误删),采用"**代码定义 + 用户覆盖**"模型:

```ts
// desktop/electron/core/builtinAutomationTasks.ts(新增)
export interface BuiltinAutomationDefinition {
  id: string;                        // 'builtin:xhs-auto-capture'
  name: string;                      // '小红书自动采集'
  description: string;
  defaultSchedule: { mode: 'daily'; time: string };
  buildPrompt(settings: BuiltinTaskSettings): string;   // 生成执行 prompt(激活 skill + 注入配置)
  readiness(): Promise<ReadinessReport>;                // 就绪检查(见 3.5)
  settingsSchema: BuiltinTaskSettingField[];            // 配置项声明,UI 据此渲染表单
}
```

`background-runner.json` 中新增 `builtinTasks: Record<string, BuiltinTaskState>`,仅存用户态:

```ts
interface BuiltinTaskState {
  enabled: boolean;                  // 默认 false
  schedule?: Partial<ScheduleOverride>;  // 用户改过的频率/时间
  settings: Record<string, unknown>;     // 关键词、上限等
  lastRunAt?: string;
  lastResult?: 'success' | 'error' | 'skipped';
  lastError?: string;
  nextRunAt?: string;
}
```

调度整合:`runMaintenanceTick` 中将启用的 builtin 任务与普通 scheduled 任务一起计算 due 集合,共享 `maxAutomationPerTick` 预算;`redclaw:runner-list-scheduled` 返回时合并 builtin 投影(带 `source: 'builtin'`、`removable: false`)。

**小红书自动采集任务的配置项**(`settingsSchema`):

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `keywords` | [](必填,空则拒绝启用) | 采集关键词列表,每轮轮换或随机取一 |
| `maxNotesPerRun` | 5 | 单轮最多保存笔记数 |
| `browserProfile` | `ComputerUse` | 独立 Chrome profile 名(computer-use `browser-open-profile`) |
| `pacing` | `conservative` | 操作节奏,透传 computer-use |
| `schedule` | daily 10:00 | 执行时间 |

### 3.4 computer-use 接入方式:MCP 为主,bash 兜底

**推荐 MCP 接入**(desktop 已有完整 stdio MCP 运行时 `mcpRuntime.ts` / `mcpStore.ts`):

- 在 MCP 设置中预置(或一键添加)`computer-use` server 条目:
  `{ transport: 'stdio', command: 'python3', args: ['-u', '-m', 'computer_use', '--pacing', 'conservative', 'mcp'] }`
- 优点:工具 schema 清晰(screenshot/click/type 等独立工具)、截图以图片形式回传模型、调用过程可视化。
- **需要验证/打通的点**:headless 后台执行(`HeadlessAgentRunner` → `PiChatService`)当前是否加载 MCP 工具;若仅前台 chat 加载,需在后台链路补齐 MCP 工具注入(实施 P2 的第一项工作)。

**bash 兜底**:builtin skill 中说明可用 `bash` 工具直接调 `computer-use ... --json` CLI,在 MCP 不可用时降级。CLI 输出 JSON,同样可解析。

### 3.5 就绪检查(readiness)

开启开关时与每次执行前各跑一次,任一不满足则**拒绝开启/跳过本轮**(`lastResult: 'skipped'` + 明确 `lastError`),并在 UI 给出指引:

1. **computer-use 可用**:spawn `computer-use doctor --json`(或经 MCP 调用),命令不存在 → 提示安装指引(链接仓库 README:`build-helper.sh` + `pip install -e .`);
2. **系统权限**:doctor 输出 `accessibility` / `screen_recording` 均为 true,否则提示到系统设置授权;
3. **视觉模型**:当前 AI 源/模型需支持图片输入(截图驱动的操作循环强依赖视觉),不满足则提示更换模型;
4. **插件桥接在线**:检查 Desktop Bridge 的 extension 注册状态(现有 `extension.register` / `desktop.health` 通路),插件离线则采集无法入库;
5. **配置完整**:`keywords` 非空。

自动化页对内置任务展示就绪状态面板(逐项 ✓/✗ + 修复指引),这是决定该功能"可用率"的关键 UX。

### 3.6 采集执行流程(skill 设计)

新增内置技能 `desktop/builtin-skills/xhs-auto-capture/SKILL.md`,由 builtin 任务的 prompt 强制激活。技能内容要点(操作规程,供模型遵循):

1. 先 doctor 确认能力,再 `browser-open-profile <配置的 profile>` 打开独立 Chrome;
2. 打开小红书搜索页(URL 直达 `search_result?keyword=...`,减少页面交互步数);
3. **每步操作前必须重新截图定位**(带 `--grid`),禁止凭记忆坐标盲点;
4. 列表页优先点插件"保存网页"按钮(整页采集);需要正文细节时点开笔记后点"保存笔记";
5. 每保存 1~2 条,用 `app_cli` 查询知识库最新条目核对入库,未入库则排查(插件在线?按钮位置?)而非继续盲点;
6. 达到 `maxNotesPerRun` 上限或连续 2 次操作失败即结束;
7. 遇登录失效、验证码、风控提示:**立即停止**,报告现场(附截图路径),绝不尝试绕过;
8. 结束时输出结构化小结:关键词、尝试数、成功入库数、失败原因。

首次使用引导(文档 + UI 提示):用户需在 `ComputerUse` profile 中手动登录小红书并确认 RedClaw 插件已启用——这一步涉及账号凭据,**必须人工完成**,不自动化。

### 3.7 开关与配置 UI

`Automation.tsx` 增加"内置任务"分组(置顶):

- 卡片:名称、描述、开关(默认关)、就绪状态摘要、上次运行结果、下次运行时间;
- "配置"弹层:按 `settingsSchema` 渲染表单(关键词、上限、时间等);
- "立即运行"按钮(就绪时可用),复用 `runner-run-scheduled-now` 语义;
- 不可删除,不可改 prompt(prompt 由定义生成)。

新增 IPC:`redclaw:runner-list-builtin` / `runner-set-builtin-enabled` / `runner-set-builtin-settings` / `runner-run-builtin-now` / `runner-builtin-readiness`(或合并进现有 scheduled 通道语义,实施时二选一,倾向独立通道以保持 payload 清晰)。

### 3.8 风控与安全

| 风险 | 对策 |
|------|------|
| 平台风控(小红书) | conservative pacing;单轮上限默认 5;每日仅 1 轮;操作间随机等待;独立 profile 与日常账号隔离,建议使用小号 |
| 键鼠被接管期间用户误操作/被打扰 | 执行前发系统通知("即将开始自动采集,10 秒后接管键鼠,点击取消可中止");执行期间提供全局中止入口(见 4.4) |
| 页面改版/弹窗导致定位失败 | 技能规程强制"每步先截图";连续失败即中止并报告,不重试盲点 |
| 无人值守时的越权操作 | 技能明确操作边界:仅允许在小红书域内浏览与点击保存按钮,禁止发布、评论、私信、账号设置类操作 |
| token 成本(截图循环) | 限制单轮最大工具调用步数;窗口截图(`--window-id`)代替全屏,减小图片体积 |

### 3.9 改动清单

| 文件 | 改动 |
|------|------|
| `desktop/electron/core/builtinAutomationTasks.ts`(新增) | 定义注册表 + 就绪检查 + prompt 生成 |
| `desktop/electron/core/redclawBackgroundRunner.ts` | `builtinTasks` 状态区;调度整合;执行分支(仍走 headless prompt 链路) |
| `desktop/electron/appMain.ts` | builtin 相关 IPC 注册 |
| `desktop/electron/core/mcpStore.ts` 或设置预置逻辑 | computer-use MCP server 预置条目(一键添加) |
| headless 工具链(`HeadlessAgentRunner` / `PiChatService` 工具装配) | 后台执行加载 MCP 工具(需先验证现状) |
| `desktop/builtin-skills/xhs-auto-capture/SKILL.md`(新增) | 采集操作规程技能 |
| `desktop/src/pages/Automation.tsx` | 内置任务分组卡片 + 配置弹层 + 就绪面板 |
| `desktop/src/bridge/domains/redclawBridge.ts` | builtin IPC facade |
| `Docs/USER_MANUAL.md` | 使用前提(安装 computer-use、授权、profile 登录、插件启用) |

---

## 4. 补充建议(我的想法)

### 4.1 执行历史持久化(强烈建议,P0~P1 顺手做)

现状只有 `lastRunAt/lastResult/lastError`,排查"昨天为什么没跑/跑了什么"很困难。建议新增轻量执行历史:

- `<workspace>/redclaw/automation-history.jsonl`(按行追加,定期截断保留最近 N 条);
- 记录:taskId、触发原因(scheduled/manual/catch-up)、起止时间、结果、错误、关联 chat sessionId、产出摘要;
- 自动化页任务详情展示最近 10 次执行,可跳转对应会话记录。

### 4.2 采集 → 分析 → 创作流水线(内置任务的价值放大器)

采集入库只是第一步。建议给任务模型加可选的 `onSuccessFollowUp?: { prompt: string }`:任务成功后自动投递一个一次性(once)后续任务。内置采集任务默认提供可开关的后续动作:"对本轮新入库笔记做选题分析,产出选题建议保存到 manuscripts"。这样内置任务从"采集器"升级为"每日选题流水线",且机制通用(普通任务也能链)。

### 4.3 内置任务模板化

`BuiltinAutomationDefinition` 注册表天然是模板机制的雏形。后续可低成本增加:"每日评论区洞察"(复用 `xhs-comment-insight` 技能)、"竞品账号监控"、"周报汇总"等内置模板。建议第一版就把注册表设计为数组遍历渲染,不为单任务写死 UI。

### 4.4 接管安全:全局紧急停止

computer-use 执行期间键鼠被 AI 控制,必须有不依赖键鼠焦点的中止手段:

- 注册全局快捷键(Electron `globalShortcut`,如 `Cmd+Shift+Esc`)→ 取消当前 headless 任务(现有 supervisor 已支持取消)并停止后续 computer-use 调用;
- 托盘/菜单栏常驻"停止自动化"入口;
- 执行前系统通知 + 10 秒倒计时可取消(见 3.8)。

### 4.5 空闲时执行(增强项,P3)

采集任务与用户抢键鼠体验很差。可在就绪检查中加"系统空闲判定"(macOS `ioreg HIDIdleTime`):非空闲则本轮延后(进 catch-up 队列),并允许用户在配置中关闭该判定。

### 4.6 暂不建议做的事

- **不做动作类型 DSL**(capture/publish 一等公民枚举):当前"prompt + skill + 工具"已能表达,DSL 化会显著增加 UI/引擎复杂度,等出现第 3 个强需求再考虑;
- **不随包分发 computer-use**:Python 环境 + Swift helper 构建 + 系统授权无法静默完成,v1 用"检测 + 指引"方案,后续再评估打包集成。

---

## 5. 实施排期

| 阶段 | 内容 | 预估 |
|------|------|------|
| P0 | 需求一全部(确认策略、任务卡片、source 字段、提示词规范)+ 4.1 执行历史 | 2~3 天 |
| P1 | 内置任务框架(定义注册表、状态存储、调度整合、开关/配置 UI、就绪检查、IPC) | 2~3 天 |
| P2 | computer-use 接入(MCP 预置 + headless 工具链打通验证)、`xhs-auto-capture` 技能、端到端试运行与风控参数调优 | 3~5 天 |
| P3 | 4.2 任务链 / 4.4 紧急停止 / 4.5 空闲检测(按优先级选做) | 按需 |

P2 是不确定性最高的阶段,首个里程碑定为:**手动"立即运行"一轮,完成 1 个关键词 × 3 条笔记的采集入库并输出结构化小结**;稳定后再放开定时调度。

## 6. 风险与开放问题

1. **headless 链路的 MCP 工具支持**:需实施初期验证 `PiChatService` 后台模式是否装配 MCP 工具,不支持则先打通(P2 第一项);
2. **视觉模型依赖**:操作循环强依赖支持图片输入的模型,需在就绪检查中显式校验,并在文档标注推荐模型;
3. **平台风控不可控**:即使全真人式操作,高频采集仍有账号风险,产品层面默认参数必须保守,文档明确建议小号;
4. **跨平台**:computer-use 浏览器配方 v0.2 仅 macOS;内置任务 v1 标记为 macOS-only,Windows 端隐藏或置灰;
5. **上游依赖稳定性**:computer-use 为个人仓库(v0.2),接口可能变动;MCP 工具名/参数以就绪检查实测为准,技能中避免硬编码具体坐标与工具签名细节;
6. **插件按钮语义变化**:采集依赖插件注入按钮("保存网页"/"保存笔记"文案与位置),Plugin 侧改版需同步更新技能说明。

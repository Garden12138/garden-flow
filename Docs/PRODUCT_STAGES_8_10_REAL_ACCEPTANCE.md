# 阶段 8／9／10 真实验收

日期：2026-10-13；2026-10-14 收尾。本轮真实商品主流程完成：阶段 8／9 的真实规划、33 轮编辑、实际导出与重开通过；阶段 10 五件作品均逐件获得上传和最终发布确认、单次提交并完成发布记录。两个 TikTok 版本各有可信回执，小红书两件及抖音一件的链接缺失明确保留。新包冷启动后五条发布历史、冻结快照及六个工程不变；原空间 176 个文件未变，发布和恢复期间模型及媒体生成调用为零。未运行真实分支仍按下文留档，不替换此前隔离验收结论，全部未提交开发成果保留。

## 对象与方法

- 沿用已入库伟嘉商品 `product_1791510099824_b6bb14ed`，选定规格为海洋鱼口味、300g×12、3.6kg；商品总标题中的 10kg 不作为本次规格。
- 在临时空间复制同一商品及原图、两段已有 15 秒商品测试视频。临时数据库仅复制所需模型设置，不复制原聊天历史和个人资料。原空间的工程、稿件、商品及模型设置保持原样。
- 使用此前用户已授权的 Electron IPC 驱动和已配置的 DashScope `qwen3.8-max`，向同一接口发送该商品资料、原图和本次规划／编辑上下文。视频只传元数据和截取范围，不传文件。
- 临时空间使用已授权的本机代理 `http://127.0.0.1:6738`。网络入口限制为所选文本模型；图片／视频／语音生成被阻断。真实上传和最终提交只允许用户分别明确确认的作品、账号、动作及摘要。
- 浏览器发布就绪检查使用真实 Chrome、现有发布插件和登录页面。就绪检查与上传、最终提交分别记录；五件作品的上传与最终提交均获得用户逐件具体确认。

临时运行目录：`/private/tmp/gardenflow-stage8-10-real-2026-10-13`。原空间初始抽查 19 个文件未变，随后扩充稿件目录基线至 176 个文件；等待上传时复查全部未变，包括原数据库、工程、商品、稿件与媒体目录。代理仅作用于临时实例，每次退出恢复临时设置；原空间设置不改写。等待上传期间已清理临时数据库的文本、视觉、图片、视频及语音供应商凭据，清空相关 JSON 配置中的密钥并执行 SQLite 清理；临时设置恢复关闭代理，工程与证据保留。

## 当前进度

| 分支 | 结果 |
| --- | --- |
| 小红书视频规划 | 真实模型产生 15 秒方案；人工卡显示目标、语言、规格及原图；确认创建独立工程 |
| 抖音视频规划 | 真实模型产生中文、15 秒方案；确认直接创建抖音版本 |
| TikTok 视频规划 | 默认英文／International；真实模型产生英文、15 秒方案；确认直接创建 TikTok 版本 |
| TikTok 已有片段混剪 | 两段真实来源各 0–3 秒，合计 6 秒；不做视觉猜测，不新增媒体；确认创建独立工程 |
| 小红书套图规划 | 首次文本请求响应头超时，未创建工程；串行重试成功，五页真实方案进入持久审批，在安装包冷启动后确认创建 |
| 小红书视频持续编辑 | 六轮真实自然语言消息通过；手动字幕发送前保存、文案修改、旁白文字、排序、手动及对话撤销均核对实际工程 |
| 抖音／TikTok 视频及 TikTok 混剪持续编辑 | 各六轮真实编辑通过；交错手动保存、撤销与两次实际 MP4 导出；每轮核对其余工程内容未变 |
| 小红书套图持续编辑 | 安装包内七轮真实消息通过，覆盖文字、裁切、字号、正式发布文案、增页、手动撤销、排序及对话撤销；发送前保存手动页面文案；导出保留未发送输入 |
| 成稿规格核对 | 抖音／TikTok 各追加一轮消息更正带 10kg 包装的选图及字幕；实际时间线素材归属和最终成片核对通过。套图第七轮更正第二页选图及页面文案 |
| 独立平台副本 | 从小红书工程经共享目标面板创建抖音副本；素材文件独立且字节一致，来源修订未变，导出记录清空、目标文案待核对。重复创建复用同一副本；其他工程文件未变 |
| 审批幂等 | 五个已完成审批重复确认全部成功，复用原结果；工程数量及模型调用不增加 |
| 冷启动 | 开发版生成的视频在新安装包恢复；最终五件作品与附加副本再次冷启动后，六个工程内容、修订、撤销历史及独立会话保持一致，询问投影不变，恢复模型调用为零 |

最终三平台原图视频为 1080×1920、30fps、450 帧、视频轨 15 秒；混剪为同尺寸、30fps、180 帧、视频轨 6 秒。AAC 尾部使容器时长略长于视频轨。只修改发布文案时，已导出成片记录保持原值。逐镜解码查看中文／英文字幕、安全区及替换素材；五页 PNG 均为 1440×1920，中文字体、裁切、图文分栏和多图布局可见。ZIP CRC 通过，封面为 `01-封面.png`，其余四页按顺序排列，并包含图文文案、HTML 与清单。来源视频音频为静音，不能据此宣称真实非静音混音已验收。

真实方案不能替代人工核对。初始抖音／TikTok 方案引用了带 10kg 包装的原图，与本次 3.6kg SKU 不一致；部分文案还采用了图片中的口感、年龄表述。该问题保留为模型规划质量发现，已通过工程编辑更正相应选图及本地文字。仍保留商家原图中的宣传文字，正式文案明示原图表述未重新核实及功能验收用途；初始方案不计为可直接发布的成稿。

本轮共 33 轮真实工程编辑消息：小红书视频 6 轮、抖音及 TikTok 视频各 7 轮、混剪 6 轮、套图 7 轮。文本／视觉接口共 124 次 HTTP 请求，包含规划、工具回合及重试；2 次请求响应头超时。图片、视频、语音生成调用均为零。开发版和安装包的完整模拟矩阵仍见原阶段记录；本轮真实文本不是在两个环境各自再做一遍全部矩阵。

## 发布就绪检查与修复

- 现有发布插件最初仍运行旧服务进程，缺少新版核验能力；重载后新能力生效。
- 小红书真实顶部账号区域只有昵称，原解析只接受用户 ID 或个人主页链接，导致账号无法识别，发布准备被安全阻断。已改为：保留唯一 DOM 身份支持；必要时从当前官方创作者页面读取其自身使用的 `/api/galaxy/user/info`，每次重新读取、禁止缓存身份，并核对页面昵称。接口、登录状态、返回结构或昵称不一致时仍阻断。
- 此修复新增回归；账号读取及发布核验专项 10 项通过。用户重载现有插件后，真实页面识别到“猫猫的猫”及稳定账号 ID，空白页就绪。没有改变插件权限。
- TikTok 真实页面识别到 `@gardendaemon`，上传页就绪。
- 抖音识别到账号 `27605448237`，但平台显示“你还有上次未发布的视频，是否继续编辑？”。现有草稿保护生效，未覆盖、放弃或删除该草稿。

已通过实际“准备发布”与“准备当前版本”按钮，为小红书视频、五张套图、TikTok 原图视频、TikTok 混剪及抖音视频创建五个本地任务并绑定真实账号及浏览器。用户授权前四件逐件上传供核对，未授权最终提交。TikTok 两版本已按用户选择保存七项完整设置：仅自己可见，评论、复用、Remix 均关闭，18+ 关闭，无商业披露、不标记 AI 生成；工程镜头及媒体产物不变。用户自行处理抖音旧草稿后，就绪检查确认空白上传页；抖音本次只做本地准备，仍待具体作品上传授权。

两个最初的小红书任务再次关闭安装包并冷启动后，任务 ID、内容摘要、账号与原快照保持一致，仍为 `awaiting-upload / not_submitted`，没有恢复上传或最终提交授权，完成询问不重发；恢复模型调用为零。

### 上传发现与修复

小红书套图真实上传第一张后，页面显示 `1/18`，任务被回读核验阻断，未进入最终确认。原媒体选择器把手机／封面预览及头像算作上传素材，无法可靠核对顺序。改为读取实际编号编辑卡，按顺序逐张上传并持久保存媒体锚点；旧中断任务没有锚点时，仅在同一任务、账号、空白文字及现存图片字节摘要全部吻合时续传，不覆盖其他草稿。第一张 blob 预览只证明页面已接收图片，不能作为整套上传或平台发布回执。

TikTok 准备期间多个账号读取并发操作同一菜单，导致页面状态不稳定；此尝试尚未执行文件上传。改为每个标签页串行读取，并在实际填写期间阻断会干扰焦点的状态探测。小红书上传核验另保存真实可见范围、原创声明、正文复制与立即发布状态；最终点击前再次核对同一页面指纹，设置变化或旧核验缺少设置均阻断。失败记录保留插件返回的具体页面错误。

新修复串行 `pnpm test` 487 项及 `pnpm check`（发布插件 138 项）通过。构建曾因自动审批额度未执行，恢复审批后重新构建通过（未签名 macOS arm64 包）。隔离 Chromium 实际执行插件及文件选择：三张相同图片保持顺序；第二张前中断后，从第一张字节摘要恢复并只续传剩余图片；账号或可见范围变化均不产生提交点击。夹具访问由本地 HTML 截获，不使用真实账号。四个修复文件已更新现有插件目录，权限不变；用户重载后使用新安装包完成真实复验。

真实复验：小红书同一套图任务严格核验原封面后只续传剩余四张，页面显示 `5/18`，编号顺序为封面及 2–5 页；完整标题、正文、话题、五个媒体锚点及真实账号回读通过，状态为 `awaiting-submit / not_submitted`。核验记录保存公开可见、原创声明关闭、正文复制允许、定时关闭。TikTok 同一原图视频任务通过实际按钮上传，页面显示 Uploaded、1080P、15 秒；账号、视频文件名、正文、话题及七项完整设置回读通过，同样等待最终确认。期间模型及媒体生成请求为零。

关闭安装包并冷启动后，五个任务 ID、内容摘要、原快照和确认阶段完全一致；两个上传核验记录原样恢复，完成询问投影未变化，恢复不调用模型、不上传、不提交。原空间 176 个文件再次全部核对未变。小红书视频和 TikTok 混剪仍获上传授权，但同平台当前草稿尚未处理，暂不覆盖；抖音上传及两件已上传作品的最终发布已向用户分别展示具体对象并请求确认。

### 逐件最终确认与结果保护

用户分别确认小红书套图公开发布、TikTok 原图视频仅自己可见发布，并另授权抖音视频上传。通过实际最终按钮各点击一次：套图任务返回 `completed / published / ready`，空白图片发布页恢复，作品管理显示《伟嘉海洋鱼3.6kg套图》及 `2026-10-13 23:46`；任务未返回可信作品链接，明确保留缺失。

TikTok 任务单次 Post 后按既有保守机制记录 `submit_result_unknown / unknown`，不自动重投。实际 Posts 出现新的 15 秒 Only me 作品，最初 Content under review，刷新后为 `Oct 13, 11:47 PM`，官方页面给出作品链接 `https://www.tiktok.com/@gardendaemon/video/7696179513922833670`。该观察链接尚未作为任务回执入库；已向用户展示截图及链接，请求确认对应任务且已发布后，再通过人工核实入口及受控回执读取完成绑定。未知状态保留期间不上传下一件 TikTok 混剪。

用户确认后，通过计划页原 TikTok 任务详情的人工核实按钮记录已发布，插件在同一账号空白上传页清理该任务归属；随后在唯一 Posts 页面读取回执，主进程验证账号、文案、可见范围、15 秒时长、发布日期与原任务，可信链接 `https://www.tiktok.com/@gardendaemon/video/7696179513922833670` 入库，来源为 `tiktok-studio-posts`，任务为 `completed / published / ready`。没有再次点击 Post。

用户另确认小红书及抖音视频公开发布。小红书视频首次因控件不可用被提交前检查阻断，平台按钮未点击；页面控件就绪后重新完整核验，单次提交成功，任务 `completed / published / ready`，仍未取得可信作品链接。抖音提交前核验发现媒体与默认封面身份变化，明确未点击平台按钮，保持 `blocked / not_submitted`。

### 抖音预览到达与回执匹配

抖音诊断确认最初核验只记录 `filename` 身份，默认双封面为空；实际视频预览加载后源和默认封面出现，旧确认因此失效。修复新增结构化 `videoSourceReady`，只有唯一视频具有实际源时才完成上传核验；文件名或海报不能代替实际视频。受控准备先打开本任务的视频预览，再保存真实媒体及封面基线；旧核验不自动改写或接受变化后的媒体。回归模拟文件名先出现、预览随后加载，验证保存实际源且只上传一次；原覆盖、未知结果、封面及内容变化保护保持。旧抖音验收草稿待用户具体授权清理，再由同一任务重传核对。

TikTok 混剪已在原视频完成核实后上传，真实页面 Uploaded、1080P、6 秒、Only you，文案及七项设置回读通过，等待用户单独最终确认。两件 TikTok 文案相同而时长不同，因此回执请求补充主进程保存的成片时长，用于匹配正确的 15 秒／6 秒作品；相同文案且相同时长仍拒绝猜测，缺少时长的旧请求保持原先的保守行为，不能改绑已保存回执。只有已经人工核实发布的任务才能读取回执，未知结果不会因此自动提升为已发布。

桌面 487 项及插件 139 项检查通过，新包构建通过；三个修复文件已更新现有插件目录，权限不变。用户再次重载后，继续以下真实复验。

### 五件作品单次提交与新结果

用户确认混剪仅自己可见发布，并授权放弃账号 `27605448237` 当前这一个未发布验收草稿、使用同一任务与 MP4 重传。TikTok 混剪通过实际最终按钮单次提交，任务保留 `submit_result_unknown / unknown`，不自动重发。Posts 新增 6 秒、Only me 的本次作品，审核提示随后变为 `Oct 14, 7:45 AM`，观察链接为 `https://www.tiktok.com/@gardendaemon/video/7696302869577780498`。该链接须在用户核实后经受控回执读取入库。

抖音先核对同一账号、任务、标题及正文，再通过可见“放弃”入口清理本次草稿，其他作品未操作。同一任务重新上传同一 MP4，预览控件尚未挂载时安全阻断，没有点击平台发布按钮。实际视频源随后出现；通过页面控件恢复原获授权标题及文案，再用同一任务续核验，没有再次赋值上传文件。新核验记录实际视频源和双封面身份，任务 ID、内容摘要、账号、工程及 MP4 均不变。沿用该具体作品已有的最终公开发布确认，单次提交返回 `submitted_pending_review / pending_review / ready`。内容管理显示 15 秒《伟嘉海洋鱼3.6kg验收》、`2026年10月14日 07:49`、已发布；本地待审核记录等待人工核实，未取得可信作品链接。

修复预览等待：没有已挂载控件时返回 `VIDEO_PREVIEW_NOT_READY`，在原超时内继续检查；多个控件、封面编辑弹窗及错误页面仍阻断。受控恢复与初次上传共用等待逻辑，文件名或海报仍不能代替实际视频。新增现有回归场景模拟首次没有控件、随后挂载，验证只记录实际源且只上传一次。本次真实续核验包含人工恢复原文案，不将其表述为新时序修复已完整自动复验。 最新串行 `pnpm test` 487 项、`pnpm check`（发布插件 139 项）、`pnpm build` 全部通过，Node.js 22.23.2、pnpm 10.28.2，现有锁文件未变。新 unsigned macOS arm64 包冷启动通过；两个抖音修复文件已更新现有插件目录，权限不变，下次重载生效。

五次平台提交期间模型及媒体生成请求为零。原空间 176 个文件再次全部核对未变。新包再次冷启动后，五个任务 ID、状态、冻结发布快照及既有可信回执均保持；六个工程内容、修订、撤销历史和编辑会话一致，询问不重发，恢复模型及付费媒体调用为零，也未恢复上传或提交。当时两条新结果仍待人工核实及混剪可信回执，已在下一节补齐。上传后保存工程使确认失效的真实平台分支本轮未运行，隔离回归结论保留。付费生成在具体对象确认后另验，真实非静音混剪沿用阶段 7 的既有余项，隔离结果不能代替这些分支。

### 最终人工核实与冷启动收尾

用户分别确认上述混剪及抖音视频已发布。通过计划页各原任务详情的人工核实复选框和“记录已发布”按钮完成记录，没有再上传或点击平台提交。混剪随后通过“读取作品回执”按钮取得 `https://www.tiktok.com/@gardendaemon/video/7696302869577780498`，来源 `tiktok-studio-posts`；唯一 Posts 页面按同账号、文案、Only me、6 秒及日期匹配，原 15 秒回执 `https://www.tiktok.com/@gardendaemon/video/7696179513922833670` 未改变。抖音以 `user-verified` 保存已发布核实，仍无可信链接。

五个原任务最终均为 `completed / published / ready`。再退出并冷启动新 macOS arm64 包后，五个任务 ID、内容摘要、确认阶段、冻结发布快照、人工核实来源及两个不同回执完整保留；六个工程内容、绑定、修订与撤销数量不变，完成询问投影未变化。核实和冷启动均没有模型、媒体生成、上传或提交请求。原空间 176 个文件全部未变，临时设置未变，退出后代理保持恢复状态。

本轮主流程验收完成。上传后保存工程使旧确认失效及抖音全自动复验已在下节补齐；付费媒体生成和非静音来源混剪仍未运行，继续留档。前者仅按具体页面／镜头获确认后另验，后者沿用阶段 7 的既有验收余项；两者不作为本轮默认主流程的收尾门槛。

### 补充：确认失效与抖音自动上传

2026-10-14，用户要求验证两项余项。创建一个独立抖音副本，沿用已核对的 3.6kg 选图和 15 秒时间线，使用标题《伟嘉3.6kg确认失效验收》及明示“仅上传页面核对，不发布”的正文。本地实际成片为 1080×1920、30fps、450 帧、15 秒，SHA-256 核对通过。原六个工程和五条已发布历史未改动。本轮仅增加一个测试工程、一个本地发布任务和一次页面上传，不新增最终提交。

用户重载最新插件并确认本作品上传到账号 `27605448237` 后，通过实际“上传到页面供核对”按钮单次上传。插件自动完成标题、正文、话题填写及回读，核验记录包含实际视频源和双封面身份，任务进入 `awaiting_confirmation / awaiting-submit / not_submitted`。期间没有手动补填浏览器文案或切换预览。本轮实际全自动流程通过；控件首次未挂载、随后出现的精确时序另由专项回归覆盖，没有人为注入真实平台延迟。

通过商品工作台的抖音稿件面板修改标题并保存后，同一任务立即成为 `superseded / not_submitted`，旧确认卡不再提供最终发布按钮，只显示“旧确认已失效”和重新准备入口。原上传快照保持，发布文案变化没有修改成片记录及 SHA。随后修改首镜头字幕，再使用“准备发布”入口触发正常发送前保存，旧成片被阻断，明确提示“工程已修改或旧成片版本无法核验，请重新导出后再发布”，没有自动渲染或生成。

通过工作台连续撤销字幕和文案修改，内容恢复，产生新修订；旧任务仍失效，不能重新获得旧确认。再次退出并冷启动后，六个任务及冻结快照、七个工程与绑定、撤销状态和询问投影均保持，原五条发布历史和两个 TikTok 回执未变。原空间 176 个文件全部未变。上传、编辑、撤销和恢复的模型及图片／视频／语音生成调用均为零，平台最终提交为零。

本次没有生产代码变化，沿用此前串行桌面 487 项、插件 139 项及新包构建通过的结果；追加 `node --test PublishPlugin/tests/douyinPublisher.test.mjs`，12 项专项回归通过。用户随后明确授权清理当前这一条未发布验收草稿。再次核对账号、同一任务归属及媒体／标题／正文／封面全部匹配后，通过平台“放弃”入口清理，空白发布页恢复 `ready`。本地副本和 MP4 的 SHA 保留，原五条发布历史未变，本次失效确认仍为 `superseded / not_submitted`；清理没有新增上传、最终提交或模型调用。

## 重复导出发现与修复

真实视频工程在没有内容修改时连续导出两次，渲染输入指纹相同，但重新编码的文件摘要不同，原完成事件因此增加了两次询问。实际记录为同一小红书版本的完成记录数从 2 增至 3、再增至 4，不能记为去重通过。

已为新商品视频成片保存可选 SHA-256，并仅复用当前空间、当前工程及渲染记录拥有的媒体文件。重新导出相同内容只复制已验证的成片，不重复编码、增加媒体产物或改变编辑凭据；不复用缺少校验信息的旧成片、已损坏文件、变化内容或跨工程／空间素材。配音过期仍先阻断。新记录是兼容字段，读取旧工程不批量改写。

新增回归验证媒体复用、版本凭据不变、删除外部导出文件后复用工程内媒体，以及内容变化、损坏、错误归属、跨空间、越界软链接和旧记录拒绝复用。串行 `pnpm test` 485 项、`pnpm check`（含发布插件 130 项）、`pnpm build` 通过，Node.js 22.23.2、pnpm 10.28.2，沿用锁文件；新的未签名 macOS arm64 包用于上述恢复与套图编辑。

安装包真实复验：旧成片首次导出补充 SHA-256 后，再导出两次均复用同一媒体 ID、字节摘要及完成摘要，编辑修订不变，询问数维持 5。套图重复 ZIP 导出复用全部 PNG，完成摘要和询问数量不变。导出及询问不增加任何模型请求。旧记录只在实际重新导出时补充，未批量改写。

## 证据

- [验收草稿清理结果](evidence/product-stages8-10-real/followup-draft-cleanup-result.json)、[恢复空白页](evidence/product-stages8-10-real/followup-draft-cleaned-empty-page.png)
- [两项补充验收与冷启动结果](evidence/product-stages8-10-real/followup-two-checks-results.json)、[自动上传页面](evidence/product-stages8-10-real/followup-two-checks-browser-uploaded.png)、[旧确认失效](evidence/product-stages8-10-real/followup-old-confirmation-invalid-after-copy.png)、[旧成片准备阻断](evidence/product-stages8-10-real/followup-prepare-blocked-stale-output.png)、[实际 MP4 校验](evidence/product-stages8-10-real/followup-two-checks-media-verification.json)
- [五件已发布最终冷启动](evidence/product-stages8-10-real/five-published-final-cold-verification.json)、[混剪可信回执记录](evidence/product-stages8-10-real/tiktok-remix-verified-publication.png)、[抖音人工核实记录](evidence/product-stages8-10-real/douyin-video-verified-publication.png)、[核实调用审计](evidence/product-stages8-10-real/publication-review-audit.json)、[最终代理恢复](evidence/product-stages8-10-real/proxy-after-published-review.json)
- [五件提交后新包冷启动](evidence/product-stages8-10-real/five-submitted-final-cold-verification.json)
- [混剪 Posts 结果](evidence/product-stages8-10-real/tiktok-remix-posts-proof.png)、[抖音已发布页面](evidence/product-stages8-10-real/douyin-posts-proof.png)、[抖音新上传核验摘要](evidence/product-stages8-10-real/douyin-fresh-upload-review-summary.json)、[五次提交后原空间复查](evidence/product-stages8-10-real/original-space-after-five-submissions.json)
- [新包五任务冷启动核验](evidence/product-stages8-10-real/three-published-cold-verification.json)、[原空间 176 文件最新复查](evidence/product-stages8-10-real/original-space-after-final-review-fixes.json)
- [TikTok 已验证回执](evidence/product-stages8-10-real/tiktok-original-verified-receipt.png)、[小红书视频结果](evidence/product-stages8-10-real/xiaohongshu-video-human-confirmed-submit-result.png)、[混剪核对页](evidence/product-stages8-10-real/tiktok-remix-browser-final-review.png)
- [抖音旧核验草稿](evidence/product-stages8-10-real/douyin-legacy-readback-draft.png)
- [已发布及未知结果冷启动保护](evidence/product-stages8-10-real/real-published-unknown-cold-verification.json)、[TikTok 作品管理观察](evidence/product-stages8-10-real/tiktok-original-posts-proof.png)
- [小红书视频真实核对页](evidence/product-stages8-10-real/xiaohongshu-video-browser-review.png)、[抖音真实核对页](evidence/product-stages8-10-real/douyin-video-browser-review.png)
- [真实上传后的冷启动核验](evidence/product-stages8-10-real/real-uploaded-two-cold-verification.json)、[套图上传核对卡](evidence/product-stages8-10-real/xiaohongshu-image-set-uploaded-awaiting-final.png)、[TikTok 视频上传核对卡](evidence/product-stages8-10-real/tiktok-video-uploaded-awaiting-final.png)
- [原空间 176 文件复查](evidence/product-stages8-10-real/original-space-after-upload-fixes.json)
- [实际上传进度与逐件授权范围](evidence/product-stages8-10-real/real-upload-progress.json)、[TikTok 完整设置](evidence/product-stages8-10-real/tiktok-human-selected-settings.json)、[第一张后阻断截图](evidence/product-stages8-10-real/xhs-partial-upload-before-fix.png)
- [上传修复 Chromium 本地结果](evidence/product-stages8-10-real/chromium-upload-fix-result.json)、[本地核验截图](evidence/product-stages8-10-real/chromium-upload-fix-review.png)
- [结果、目标、会话与调用摘要](evidence/product-stages8-10-real/summary.json)
- [最终 MP4／PNG 及 ZIP 核验](evidence/product-stages8-10-real/final-media-verification.json)
- [重复导出缺陷原记录](evidence/product-stages8-10-real/repeat-export-before-fix.json)、[安装包修复复验](evidence/product-stages8-10-real/repeat-export-after-fix.json)
- [最终六工程冷启动记录](evidence/product-stages8-10-real/native-second-cold-verification.json)、[独立平台副本](evidence/product-stages8-10-real/independent-platform-copy-real.json)
- [套图预览](evidence/product-stages8-10-real/final-image-contact-sheet.png)、[抖音／TikTok 最终逐镜预览](evidence/product-stages8-10-real/video-inspection-dy-tt-final.png)、[小红书与混剪预览](evidence/product-stages8-10-real/video-inspection-xhs-remix.png)
- [小红书视频准备卡](evidence/product-stages8-10-real/prepare-xhs-video.png)、[套图准备卡](evidence/product-stages8-10-real/prepare-xhs-image-set.png)
- [两个待上传任务冷启动](evidence/product-stages8-10-real/publication-task-real-cold.json)、[临时凭据清理与原空间保护检查](evidence/product-stages8-10-real/temporary-credential-cleanup.json)

证据只保留本轮对象和检查结果，不包含 API Key、原数据库、私人聊天、浏览器 Cookie 或官方页面脚本。完整临时工程与导出留在本轮运行目录，真实发布确认前以实际工程重新核验。

# 商品视频流程收尾验收

验收日期：2026-09-29。开发基线：`4566aac`。范围为商品图片编排、分镜确认、可编辑工程、旁白/BGM、MP4 入库及小红书发布。已有视频片段混剪、套图、抖音仍为后续范围；`PHASE_2_ACCEPTANCE.md` 继续专指京东评论采集。

## 实现与兼容

- 视觉预检区分 `image-decode`、`request-failed`、`invalid-response`、`token-mismatch`、`incomplete-assets`、`cancelled`。任务元数据保存模型、商品版本、图片数、素材 ID、耗时、解析结果及有效校验值；不保存密钥、响应原文、图片数据或绝对路径。校验只统一大小写、去除首尾空白；内容错误和漏图仍阻断。重试读取当前模型，重新取商品证据；语义校验失败不会自动增加调用，既有网络传输重试保留。
- 京东和小红书自动采集报告写入 `gardenflow-capture:<spaceId>:<taskId>` 专用会话；自动化页保持运行状态并提供“查看采集报告”。采集任务结果保留报告会话 ID。
- 商品资料、SKU、素材和重新采集统一推进商品版本；删除产生结构化事件。待确认审批变为 `invalidated`，对应等待任务取消。打开会话、启动恢复和点击确认均复核；目录读取失败不伪装成“商品已删除”。
- 快照复制期间锁定源目录；同空间有商品写入排队时，快照提交检查中止并清理本次尚未完成的工程，不提交视频或旁白任务。已完成工程使用自己的素材副本。
- 重新规划入口按会话和审批 ID 校验，复用原始创作要求，加载最新资料并产生新提案 ID；连续点击合并。删除商品提示重新选择。旧审批不因升级自动执行。
- 主进程根据视频路由和参考图能力注入 `aiMotion` 状态。无可用模型默认五个原图动效镜头、15 秒、1080×1920、30fps；运行时拒绝 AI 镜头提案，确认卡显示 AI 动效任务数 0。确认后配置变化时保留原图并标记可恢复失败。
- 视频服务提供显式启用开关，关闭后保留供应商配置，并在路由、分镜能力和主进程提交前阻断新的视频生成。旧配置缺少开关时保留原行为；开关的持久化、恢复及零外部调用通过 `node --test desktop/tests/videoGenerationDisabled.test.ts` 验证。
- 构建同时复制共享和 Electron 技能目录，保留 Electron 覆盖优先级，确保安装包含新版 `video-director`，无需依赖本机源码或用户技能副本。新增打包技能发现回归。
- 双轨继续使用既有契约：旁白 100%、BGM 20%；超长旁白保留素材、不裁剪、不进入播放轨，延长镜头后恢复。修改旁白脚本标记旧声音过期，保留旧声音供预览，重新生成需明确点击。

## 自动测试

| 项目 | 命令与证据 | 结果 |
| --- | --- | --- |
| 桌面全量 | `pnpm test` | 317/317 通过 |
| 类型、桥接、技能、文档、双插件 | `pnpm check` | 通过；桌面类型/桥接/技能/文档和两个插件全部通过，发布插件 51/51 |
| 安装包 | `pnpm build` | 通过（退出码 0）；macOS arm64 未签名 DMG + ZIP，`hdiutil verify` / `unzip -tq` 完整性校验通过；检查与构建串行执行 |
| 视觉与重试 | `productVideoVisualGrounding.test.ts`、`productVideoRetry.test.ts` | 覆盖严格校验、错误分类、取消、诊断脱敏、当前模型、归属/空间校验、连续点击合并、新提案 ID |
| 商品版本与审批 | `brandWorkspaceStore.test.ts`、`productVideoCloseoutIntegration.test.ts` | 覆盖 SKU 变更、删除、实时事件、漏事件复核、SQLite 重开、跨空间、快照并发写入中止、旧提案零执行 |
| 采集隔离 | `gardenflowCaptureIsolation.test.ts` | 执行生产采集分支和报告写入方法，模拟完整京东/小红书结果；跨空间/任务隔离，前台待确认消息不变，自动化结果入口保留 |
| 主进程双轨 | `productVideoCloseoutIntegration.test.ts` | 模拟 TTS HTTP，真实任务登记、SQLite 审批及工程文件；确认前/取消零提交，重复确认幂等，失败不自动重试，录音替换、文案变更、重排、撤销、重开对账、导出 |
| 发布回归 | `pnpm --dir PublishPlugin check`（包含于 `pnpm check`）及桌面发布测试 | 原状态机、版本绑定、断连恢复、未知保护、单次点击及媒体字段比较保持回归覆盖 |

最终构建在 2026-09-29 22:36 完成，包含界面提示和技能打包修复。此前中断或被替换的构建不计为最终验收；最终运行日志位于本地 `.gardenflow-stage-closeout/`。[自动验收摘要与安装包 SHA-256](evidence/product-video-closeout/validation-summary.json)。

集成夹具隔离用户数据。模型 HTTP 返回测试 WAV；不使用真实付费 TTS 或视频服务。任务图宿主使用轻量测试替身，不能据此声称全 UI 或真实模型端到端验收。

## 实际导出与音频检查

使用 `GARDENFLOW_PRODUCT_VIDEO_RENDER_QA_DIR="$PWD/.gardenflow-stage-closeout/render" node --test desktop/tests/productVideoCloseoutIntegration.test.ts` 调用生产 Remotion 导出与入库代码。五镜头原图工程经改单镜头时长、重排、改文字、重新读取工程后导出；视频生成调用为零。

输出工作区 `.gardenflow-stage-closeout/render/pure-images-dual-audio.mp4`（本地验收产物，未纳入版本控制），H.264、1080×1920、30fps，AAC 双声道 48kHz。调整后的时间线 16.5 秒，容器时长约 16.555 秒。测试旁白 440Hz、BGM 220Hz；频域检查确认两者同时存在，1.8s/4.8s 旁白间隙仍有 BGM，末尾旁白自然结束。工程内部为独立双轨，MP4 为混音后的音频流。

[导出规格、SHA-256 和音频采样](evidence/product-video-closeout/export-analysis.json)。首次沙箱导出因本地端口受限失败，在允许本地临时端口的环境完成渲染。自动分析不代替真人试听。

## 真实会话与发布证据

- 本次重新核对会话 `session_1790235694798`。工程 `video_edit_v2_1790235933266_1e7bd8c6` 当前为 **27 秒**，五镜头、五段 ready 旁白、一条 BGM；工程标题仍含“15秒”，不据标题认定实际时长。
- 最新稿件为 **第 5 版**《原料透明的成猫粮｜伟嘉海洋鱼夹心10kg》，任务 `xhs_publish_6d4d7af5-81f8-4a40-8244-095199c594cb`。只读数据库回执为 `completed / published / ready`，无错误码；这比交接文档里的未知状态更新。
- 2026-09-29 在现有安装包的最新会话看到第 5 版确认卡“发布成功，已回到空白发布页”。[界面截图](evidence/product-video-closeout/published-v5.png)、[脱敏状态回执](evidence/product-video-closeout/publication-receipt.json)。本轮没有再次点击发布，没有修改旧未知记录。
- 平台去重已核验：2026-09-29 在账号“猫猫的猫”的笔记管理搜索“原料透明的成猫粮”，结果为该 00:27 视频，发布时间 2026-09-27 20:58，页面明确显示“共1篇笔记”。[笔记管理截图](evidence/product-video-closeout/single-published-note.png)。
- 同类型空白发布页已核验：现有标签页返回 `published=true&target=video` 的发布页面后，显示“上传视频”、空上传区、“草稿箱(0)”，账号仍为“猫猫的猫”。[空白视频发布页截图](evidence/product-video-closeout/blank-video-publish-page.png)。
- 人工试听：2026-09-29 用户明确回复“已试听，正常”，确认上述 27 秒、第 5 版成片旁白完整、BGM 正常且没有互相盖住；这是用户听感确认，不是测试正弦波的推断。

## 确认卡与最新安装包界面验收

生产 `ToolConfirmDialog` 组件通过隔离浏览器夹具验证：五原图镜头/15 秒/0 AI 任务；商品更新显示失效及重新规划；删除商品禁用重新规划；触发重新规划后按钮锁定，文案明确新分镜需再次确认。界面检查发现并修复了忙碌状态误写“已确认、正在创建工程”的提示。夹具使用模拟 bridge，不操作用户商品或模型，不能替代整机端到端验收。

[纯图片确认卡](evidence/product-video-closeout/pure-image-card.png)、[商品更新失效卡](evidence/product-video-closeout/invalidated-card.png)、[重新规划状态](evidence/product-video-closeout/replanning-card.png)、[商品删除状态](evidence/product-video-closeout/deleted-card.png)。

安装包资源已核验：新版 `video-director` 与源文件逐字一致，共 18 个内置技能。当前导出的采集插件（34 文件）及小红书发布插件（10 文件）与安装包逐文件一致，详见[安装包内容](evidence/product-video-closeout/package-content.json)、[插件比对](evidence/product-video-closeout/plugin-content.json)。

新构建应用在 14:46 成功启动到工作台并列出原有商品工程；尚未完成工程内部双轨页面截图。22:30 继续验收时，应用进程仍在，但界面工具持续读取超时，已请求用户显示主窗口，未把启动成功算成旧工程完整界面验收。

2026-10-01 在阶段 3 的安装包中恢复了由该旧工程复制的独立抖音版本，实际看到 27 秒时间线、旁白 100% 和 BGM 20%，确认卡 MP4 播放至终点；完整播放发生在当日较早的一次构建。最终构建冷启动后，通过“查看来源”打开旧来源工程，读取到原 27 秒时间线、首镜头 180 帧、原字幕及旁白 100%／BGM 20%，双轨页面截图留在会话。截图工具随后返回延迟画面，独立截图附件未保存。

另外创建不发布的独立副本，在安装包通过界面改首镜头为 190 帧、修改字幕、把两个视频镜头换为原图，重开和冷启动后修改保留；五原图镜头、五段旁白和一条 BGM 实际导出入库成功。MP4 为 1080×1920、30fps、27.349333 秒，详见[安装包导出记录](evidence/douyin-stage3/packaged-export.json)和[阶段 3 验收记录](DOUYIN_STAGE3_ACCEPTANCE.md)。过程中发现并修复安装包缺少 Remotion 传递依赖的问题；修复后的全量测试为 321/321、发布插件 58/58，检查与构建串行通过。副本没有发布任务，也没有新增真人试听；用户先前的试听仅对应已发布来源成片。

随后阶段 3 的自选封面阻断和未发布草稿识别回归更新至桌面 322/322、发布插件 60/60。此前纯图片副本的实际导出证据继续绑定当时的渲染依赖修复安装包，不将后续构建或页面探测记为新增导出、试听或发布证据。

## 2026-10-02 补验过程与最终结果

2026-10-02 开始补验新建商品流程时，已创建专用验收品牌并填写商品表单，图片导入尚未完成；随后 GardenFlow 窗口捕捉持续返回 ScreenCaptureKit -3812。当时商品未保存、视频模型配置未改动，新提案及工程未创建。[界面进度与中断边界](evidence/douyin-stage3/stage2-packaged-ui-progress.json)保留该历史中断，恢复后的最终结果如下。

桌面恢复后已通过界面保存专用验收商品及五张图片。旧视频设置清空地址被必填校验拒绝，原配置未改变；为完整验收补上保留配置的显式视频生成开关。新包分镜链路的后续结果以同一进度记录为准。

- 最新安装包通过已发布抖音版本的“查看来源”打开原 27 秒工程，读取首镜头 180 帧、五段旁白 100% 和一条 BGM 20%；本地首段旁白播放至 5 秒，整体预览显示营养镜头。[真实双轨界面记录](evidence/douyin-stage3/source-dual-audio-packaged-ui.json)已保存，截图留在会话。此次没有新增人工听感结论，仍沿用用户对原第 5 版的“已试听，正常”。
- 保存专用商品资料修订后，待确认卡立即显示失效及重新规划入口，等待任务取消。冷重启仍恢复失效卡；连续点击重新规划只创建一个任务，重新加载最新商品及五张图片，严格预检通过后产生新提案 ID，并再次等待确认。通过确认卡创建新工程，旧审批保持 `invalidated`。[审批及模型诊断记录](evidence/douyin-stage3/silent-proposal-validation.json)。
- 关闭视频生成时，新确认卡实际显示五原图镜头、15 秒、1080×1920、30fps、0 AI 镜头。修复明确要求无旁白却默认产生五段 TTS 的问题：可选 `voiceoverEnabled: false` 保留字幕、关闭自动旁白，缺省兼容旧提案。新卡显示 0 段语音任务；确认及重启无生成任务。
- 新建纯图片工程通过界面改首镜头至 100 帧、修改字幕、播放预览、退出应用后重开，并导出入库。最终 MP4 为 1080×1920、30fps、15.381333 秒，完整解码通过；零项目生成任务及零视频工具结果。[实际导出证据](evidence/douyin-stage3/new-pure-image-packaged-export.json)。验收结束通过界面恢复启用视频生成，供应商配置哈希与验收前一致。

最新修复按 `pnpm test → pnpm check → pnpm build` 串行通过：330 项桌面测试、89 项发布插件回归；DMG／ZIP 完整性及 13 个包内插件文件比对通过。功能验收已补齐，历史构建、发布与试听证据保持原归属。独立 PNG 附件未另存，不将会话截图写成仓库图片文件。

如已有成功回执，继续只读核对，不为获得截图重新发布。未来真实提交仍由用户在展示当前视频、文案及目标账号的既有确认入口执行；结果未知时先核实。

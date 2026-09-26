# 商品视频双音轨与自动旁白：技术设计

## 设计规格（Electron / React 工作台）

1. **目的**：让用户在同一个商品视频工作台中明确区分屏幕文字、旁白与 BGM。确认卡先呈现将被朗读的内容和任务数量，工作台再提供逐镜头试听、替换和错误恢复。
2. **美学方向**：工业／工具台式（industrial/utilitarian），延续现有商品视频工作台，不另造页面。
3. **色彩**：沿用背景 `#F7F8FA`、时间线 `#10151C`、操作色 `#0F766E`；旁白片段用暖赭 `#C05640`，文字轨保留 `#D97706`。现有应用品牌色是约束，覆盖通用 UI 模板禁令。
4. **字体**：沿用应用的 IBM Plex Sans 与 Noto Sans SC；不引入新字体，避免同一工具台内视觉断裂。
5. **布局**：保留左素材／中间 9:16 预览／右镜头属性／底部时间线的非对称布局。右栏在“屏幕文字”下增“旁白文案和状态”，底部在文字与 BGM 之间增一条按镜头对齐的旁白轨；Lucide 图标沿用现有组件。

## 流程与边界

1. `product_video_compose` 提案中的每镜头 `overlayText` 作为旁白默认初稿，不让模型额外创造商品事实。确认卡展示每段实际会朗读的文字、当前 TTS 模型/音色、非空段数及可能的额度消耗。
2. 用户点击现有确认按钮后，主进程先创建工程和商品素材快照，再提交 2 个参考图视频任务及每个非空旁白段的 TTS 任务。语音任务独立排队，不延长现有视频工具的等待；工程链接按现有工具返回时机出现，打开后可查看旁白进度。
3. 若 TTS 路由没有可用 Endpoint/API Key，视频工程照常创建；旁白状态为 `needs-configuration`，没有语音任务提交。用户配置后，在工作台显式点击生成。
4. 用户取消确认时，视频和 TTS 都不提交。重复确认相同 `proposalId` 不重复建工程，也不重复提交已记录的旁白请求。
5. 旧商品视频工程在加载时补空旁白轨和旁白默认文案，不自动生成；仅用户点击“生成旁白”才发生新费用。

## 数据模型与主进程 API

- `ProductVideoSceneState` 增加独立字段：`narrationText`、`voiceoverStatus`（`not-required | needs-configuration | queued | generating | ready | failed | duration-conflict | stale`）、`voiceoverJobId`、`voiceoverAssetId`、`voiceoverDurationMs`、`voiceoverSource`（`tts | imported`）、`voiceoverError`、合成时使用的模型/音色。原 `generationStatus` 继续只描述 AI 视频镜头。
- 每个商品工程恰有一条 `voiceover` 轨和一条 `music` 轨；旁白片段以 `sceneId` 关联画面镜头。素材文件经 `importAssetsToVideoEditorV2Project` 复制入工程，来源记为 AI 生成或用户导入。旧工程不升大版本，以读入时的兼容迁移补齐可选字段与轨道。
- 素材导入现按内容哈希去重；附加 TTS 产物时应按导入结果/哈希定位工程素材，不仅靠原始 `sourcePath`，以免两个相同语音片段无法绑定。
- 增加强类型编辑命令 `scene.narration-text`、`voiceover.remove`；外部文件选择与 TTS 任务提交由独立 IPC 处理（逐镜头生成／重试、从素材库或本地替换），渲染进程不得整份覆盖工程 JSON。主进程校验工程、镜头、音频类型、来源路径及当前任务状态。
- TTS 复用现有 `MediaGenerationJobRegistry.submit('audio', ...)`，记录 `projectId`、`sceneId`、已确认文案哈希和稳定的逻辑请求 ID。主进程按项目串行写工程；提交前检查同场景同文案的既存 job，防止重复点击造成重复计费。工作台通过工程事件更新状态。
- 重启时只对账已提交 job：完成则导入产物并附加，失败则显示错误，运行中但无可恢复执行上下文则标为需人工重试。不得静默重新提交 TTS。

## 时长与编辑规则

- 音频导入后探测真实时长。短于镜头时长的片段保持自然结束，不循环；长于镜头时长的片段保留素材但状态为 `duration-conflict`，不加入可播放轨，避免静默截断或压到下一镜头。
- 用户缩短镜头导致已附加的旁白超长时，同样转为时长冲突；延长镜头、缩短文案并重新合成，或替换更短录音后可恢复。
- `scene.reorder`、`scene.duration`、`scene.delete` 通过时间线重排函数同步更新旁白片段的 `timelineStartMs`/`timelineEndMs`。撤销记录包括旁白轨和场景元数据。
- 改写 `narrationText` 只把已有旁白标记为 `stale`；旧声音仍可预览，但以显著提示告知文案与语音不一致。重新合成必须再次点击按钮。替换录音和移除旁白也都可撤销。

## 预览、导出与测试

- `buildVideoEditorV2RemotionComposition` 把 `voiceover` 与 `music` 的音频片段都映射为 Remotion Audio 场景。旁白默认 100%、BGM 20%，视频自身音频仍静音；Player 和 MP4 导出使用这同一 composition。
- 单元测试覆盖确认前零 TTS、取消、相同提案幂等、旧工程迁移、两个独立音轨、排序/时长/删除同步、超长音频不截断、重启对账及单段失败。
- UI 测试覆盖确认卡的文案和任务数、旁白状态、逐镜头生成／替换／撤销；端到端检查双轨预览与导出音频一致。真实 TTS 调用只在明确人工确认后执行，自动化测试使用模拟 provider。

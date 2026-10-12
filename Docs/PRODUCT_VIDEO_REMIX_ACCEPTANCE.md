# 已有视频片段混剪首版验收

日期：2026-10-12。基线：`d4f5890`，接续商品套图首版。首版支持一个已入库商品与 1–8 个自有视频来源，复用商品视频工作台、持久确认和 MP4 导出；不新增发布流程。

## 实现

- 选择 `@商品` 后点击“视频混剪”，从当前空间媒体选择或导入本地视频。结构化 `productVideoCompositionMode: existing-clips` 与 `explicitVideoClipRefs` 承载意图，沿用 `product-video-compose`／`product_video_compose`，没有新增文本关键词判断。
- 主进程读取真实时长、尺寸、帧率、音轨与 SHA-256；来源必须存在于当前空间，禁止通过符号链接读空间外文件。规划提示只注入来源元数据；技能不能宣称理解未分析的画面。来源视频不直传媒体模型，图片预检跳过；默认图片、视频、语音生成均为零，规划阶段禁止相关生成工具及命令行绕过确认。
- `media-clip` 分镜保存来源 ID、摘要、截取起止与原声音量；提交方案要求关闭自动旁白。确认卡播放真实来源，展示区间、顺序、文字、画面适配和原音。旧商品原图／AI 分镜 schema 继续兼容。
- 复用持久 SQLite 确认、商品版本复核和提案幂等。旧来源变更、删除、越界或跨空间在创建前阻断；商品变化支持带原始来源重新规划。提案 ID 不得用于另一商品或另一模式；并行创建锁也验证身份。确认后复制视频、校验摘要并保存商品快照，已有工程独立于源商品及视频。
- 默认 1080×1920、30fps。截取点按输出帧对齐且不超过视频轨道结束点；通过 ffmpeg 仅解封装视频包的 PTS／时长确定画面结束点，避免把长音轨尾部当作可剪画面；预览和导出共用 Remotion，混剪保留原音，可调至静音。完整展示使用同步截取的静音模糊背景，居中裁切使用同一前景；普通商品视频的原有静音行为保持。
- 工作台支持截取区间、原音 0–100%、文字、时长／帧数、排序、替换、删除、适配方式、撤销与 BGM；片段不使用静态图片动效。替换视频更新当前镜头来源记录，初始提案仍作为历史保留。编辑改变渲染摘要，旧 MP4 不再是可发布的当前版本。
- MP4、字幕与渲染记录沿用现有导出服务，视频入库并绑定媒体 ID。重开保留工程素材副本、时间线、文字、音量及产物记录，不自动请求付费媒体。跨空间测试发现媒体目录首次导入会共享空数组，已修复为空目录返回独立数组。

## 自动回归

`desktop/tests/productVideoRemix.test.ts` 使用本地 ffmpeg 合成 30fps／25fps 的有音轨视频，覆盖结构化模式、来源 schema、准确区间、关闭默认媒体生成、持久确认重开／幂等、原始来源删除后的独立工程、来源摘要变更、商品失效、跨空间隔离、异步空间固定、提案身份冲突、截取／音量／排序／字幕重排、越界与图片动效阻断、输出过期和撤销，并验证短画面／长音轨不能延长截取。媒体模型采用已有测试夹具，真实付费请求为零。

串行 `pnpm test`、`pnpm check`、`pnpm build --config.compression=normal` 通过。430 项桌面测试通过；全量检查含 35 个桥接域、597 个 API、21 份技能、221 个 UI 源文件、类型检查与插件测试。构建为未签名 macOS arm64 DMG／ZIP，摘要及包内代码一致性见[验证摘要](evidence/product-video-remix/validation-summary.json)。

## 实际应用验收

脚本 `desktop/scripts/product-video-remix-electron-qa.cjs` 使用临时工作区、同一合成商品及两段带颜色变化／正弦原音的视频，规划方案由持久审批夹具提供。来源导入和读取、真实预览、确认按钮、工作台截取／文字／音量修改、MP4 导出、媒体入库与冷启动恢复均走实际应用；原生文件选择器固定到临时素材。这里没有调用真实聊天或视觉模型，不能算作真实用户商品的模型规划验收。

```sh
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop" create
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop" reopen
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop" picker
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" create native
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" reopen native
node desktop/scripts/product-video-remix-electron-qa.cjs /private/tmp/gardenflow-remix-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" picker native
```

开发版使用实际 Vite 配置与源码 renderer、已构建主进程／preload；驱动工作目录与 `pnpm --dir desktop dev` 保持一致。安装包模式运行真实可执行文件，通过仅监听 localhost 的临时 inspector 注入驱动，工作目录为临时目录；技能与渲染资源从包内发现，不修改应用。

同一商品分别创建两个独立工程。验证输出为 1080×1920、30fps、60 帧（视频恰为 2 秒；AAC 封装尾部使容器显示约 2.05 秒）。0.3 秒黄画面、1.3 秒绿画面证明顺序和截取位置正确，没有使用来源开头的蓝／红画面；第一段原音 RMS 约 0.0617，第二段静音 RMS 为 0。重开后的时间线、镜头、原音和输出记录与创建时一致，媒体 ID 保持。实际 `@商品` 选择后出现混剪入口，弹窗列出当前空间视频，勾选后可继续；取消不创建提案或请求模型。

结果见[应用验收](evidence/product-video-remix/application-qa.json)、[包内一致性](evidence/product-video-remix/package-parity.json)。实拍：[来源选择](evidence/product-video-remix/native-picker-source-picker.png)、[分镜确认](evidence/product-video-remix/native-create-confirmation.png)、[重开工作台](evidence/product-video-remix/native-reopen-workbench.png)；最终画面：[片段二](evidence/product-video-remix/export-first.png)、[片段一](evidence/product-video-remix/export-second.png)。这些仅为本地合成验收素材。

## 真实商品补充验收（2026-10-12）

默认空间伟嘉海洋鱼口味 3.6kg 与两段已有 15 秒商品视频，已完成真实模型规划、审批冷启动恢复和幂等创建。开发版创建工程后，两版完成编辑、6 秒 MP4 导出与重开。实际问题促成三项修复：流式解析长 `framecrc` 输出、已有片段共用结构化视觉跳过策略、渲染内容变化时使已导出状态恢复 `ready`。新增运行时入口和长画面回归，最终全量桌面测试 433 项，串行检查、构建及包一致性校验通过。

最终画面为 1080×1920、30fps、180 帧，视频轨道准确 6 秒；两段真实来源的原音均静音，非静音保留及音量分支继续由上面的隔离音轨测试覆盖。原始视频和八个旧工程未改写，没有调用图片、视频或语音生成。详情见[商品创作真实验收](PRODUCT_CREATIVES_REAL_ACCEPTANCE.md)及[验证摘要](evidence/product-creatives-real/validation-summary.json)。

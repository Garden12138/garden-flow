# 阶段 8：目标平台前置与工程版本统一

日期：2026-10-12。代码基线为 `e734280`，保留用户更新的阶段 8–10 路线图。本阶段只交付目标平台前置、规格与工程关系、独立平台版本及对应视频发布准备；工程持续对话编辑和统一发布管理分别留在阶段 9、10。

## 实现范围

| 目标 | 创作／导出 | 发布准备 |
| --- | --- | --- |
| 小红书视频 | 9:16、1080×1920 或 16:9、1920×1080，30fps | 已有小红书服务 |
| 抖音视频 | 9:16、1080×1920、30fps | 已有抖音服务 |
| TikTok 视频 | 9:16、1080×1920、30fps | 已有 TikTok 服务 |
| 小红书套图 | 3:4、1440×1920 PNG | 界面明确提示阶段 10 补齐 |
| 抖音／TikTok 套图 | 目标面板显示待适配，禁止提交 | 待适配 |

选择 `@商品` 后，“商品创作”“商品套图”“视频混剪”共用目标选择面板，后两项预选对应形式。默认小红书、15 秒视频或 5 张含封面的套图；TikTok 默认 `en`／`International`，其他平台默认 `zh-CN`／中国。可填写创作要求，取消选择不提交模型请求。视频限制与现有引擎统一为最多八镜头、单镜头最多 30 秒、新入口总时长最多 240 秒；套图最多 20 张。

共享 `ProductCreationTarget` 保存平台、形式、编排模式、语言、市场、规格 ID／版本及解析后的规格快照。聊天入口、任务、工具提案、持久审批和工程使用同一目标。运行时与审批恢复均验证目标一致性，模型不能更改用户选择。默认新提案必须关闭自动旁白，不规划付费 AI 镜头；工作台中另行确认的媒体生成沿用既有机制。

规格配置区分平台硬限、应用支持范围和推荐值。视频字幕安全区属于应用推荐，由同一 Remotion 场景数据用于预览与成片；旧工程不添加新安全区。套图 HTML、窗口捕捉、预览尺寸、媒体信息和缓存键读取工程规格。TikTok 主进程与插件统一阻断大小达到 10,000,000,000 字节的媒体；来源为 [TikTok 官方帮助](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok?lang=nl)。其他未经核实的约束不会标为平台硬限。

## 工程、版本与兼容

目标和作品组／版本关系作为可选字段加入现有视频工程及图文文档，继续使用 `.redpost`、`.redvideo` 和视频工程 v2，没有替换原文件格式。

小红书视频确认后直接绑定 `.redvideo` 稿件，导出同步最新成片引用；抖音与 TikTok 直接创建平台工程和现有平台版本记录，不产生中间小红书工程。提案 ID 复用必须匹配商品、目标与编排模式；重复确认及绑定中断恢复复用同一工程和平台记录。

工作台显示目标和其他平台版本，提供“创建其他平台版本”。复制独立素材、按目标调整画幅，清除导出、撤销和发布绑定；默认复用已有相同目标版本，勾选“再复制一版”才新增。副本保留来源文案，必须核对目标文案后才能准备发布，TikTok 沿用既有语言建议／确认应用。编辑副本不改写来源工程。

旧工程仅依据正式平台版本记录或稿件中的显式工程引用解析目标，不根据文件名、标题或聊天文本推断。读取不改写文件；已明确绑定的旧工程在下一次保存时补充 legacy 目标，保留原画幅和字幕排版。未绑定工程可在工作台明确确认目标，绑定不改变已有渲染内容；关系冲突继续阻断发布。已有提交、未知结果及已发布记录不被编辑或目标解析覆盖。

新增 typed IPC 提供能力读取、版本列表、平台复制、旧工程绑定、副本文案核对和小红书视频发布准备。旧抖音／TikTok 创建版本接口作为兼容入口保留。发布准备验证目标平台、正式稿件关系、规格、文案核对状态、当前修订和媒体摘要，新确认摘要包含目标规格信息。

## 自动验证

- `desktop/tests/productCreationTarget.test.ts` 覆盖能力矩阵、默认语言、规格篡改、直接平台创建、恢复绑定、幂等、独立副本、过期请求、空间隔离、旧工程读写兼容、套图目标与缓存键、关系冲突和文案核对。
- 真实 `QueryRuntime` 回归验证正确目标可以进入审批，模型更换平台在执行前阻断。抖音／TikTok 主进程回归核对新增目标后的摘要变化、错误平台阻断及未知／已发布历史不变；既有图文、视频和发布回执回归继续运行。
- 旧平台副本沿正式来源链解析同一作品组，循环关系明确阻断。实际发布插件 manifest 回归覆盖三平台权限与更宽权限拒绝；修复旧桌面检查仍只接受小红书单一域名、导致已打包插件无法准备的问题。
- 发布插件新增 10GB 排他边界回归，主进程和插件使用一致限制。

串行 `pnpm test`（445 项）、`pnpm check`（含 120 项发布插件测试）和 `pnpm build --config.compression=normal` 已通过，构建为未签名 macOS arm64 DMG／ZIP。沙箱内 Unix socket 回归因 `EPERM` 失败；允许本地 socket 的完整测试及检查重跑全部通过。

## 实际应用验收

脚本 `desktop/scripts/product-target-electron-qa.cjs` 使用临时用户数据、一个隔离商品及模拟规划提案。商品选择、目标面板、真实审批按钮、工程创建、文字编辑、导出和恢复走应用实际主进程／preload／React。模拟规划与真实模型规划分别记录，不把夹具当作模型端到端通过。

```sh
node desktop/scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-stage8-qa-delivery "$PWD/desktop" create
node desktop/scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-stage8-qa-delivery "$PWD/desktop" reopen
node desktop/scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-stage8-qa-delivery "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" create native
node desktop/scripts/product-target-electron-qa.cjs /private/tmp/gardenflow-stage8-qa-delivery "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" reopen native
```

开发版与实际 macOS arm64 打包程序完成四个可创建组合及小红书横屏画幅的创建、编辑、导出和冷启动恢复，三平台视频各为一秒夹具成片，另有小红书横屏一秒成片和五张套图。默认 15 秒和 TikTok 英文在实际面板核对；不支持的套图提交按钮禁用；取消不提交请求。另从小红书横屏工程创建 TikTok 竖屏副本，工程和提案画幅均适配为 1080×1920；只修改副本，来源工程文件完全不变。

实际解码核对八段 MP4：竖屏 1080×1920、横屏 1920×1080，均为 30fps／30 帧。两套 ZIP 的十张 PNG 均为 1440×1920，CRC 检查通过，封面 `01-封面.png` 后按页面顺序排列，附图文文案与清单。中文和英文抽帧及三种套图模板目视核对字体和排版；具体结果见[产物核对记录](./evidence/product-target-stage8/outputs.json)。

最终四次应用运行均通过，实际预览容器与解码帧中的字幕字形边界均在推荐安全区内。打包程序使用的主进程、41 份 renderer JS／CSS、105 份 Remotion 文件、22 份字体及验收脚本与本地构建逐一一致，见[包内一致性](./evidence/product-target-stage8/package-parity.json)。DMG 校验为 `VALID`，ZIP CRC 和内含应用 ASAR 一致性通过，见[归档摘要](./evidence/product-target-stage8/archives.json)。

首轮抽帧发现 `AbsoluteFill` 的默认 100% 宽高使字幕底部 inset 失效，已为新规格清除固定宽高、用四边 inset 约束容器。旧工程布局保持原样。隔离脚本增加实际预览容器尺寸及底部 inset 检查，修复后重新导出和重开复验。开发版／打包程序的[创建](./evidence/product-target-stage8/native-create.json)、[重开](./evidence/product-target-stage8/native-reopen.json)记录与[目标选择界面](./evidence/product-target-stage8/native-create-unsupported.png)、[独立副本](./evidence/product-target-stage8/native-create-copy.png)留档。

验收驱动首次加入视频工具类时遇到仅支持 ESM 的依赖加载问题，已让夹具只加载参数契约与数据库。后续文字保存脚本在渲染进程失去焦点后不能可靠触发浏览器原生 blur，已改为显式 React `focusout` 事件；开发版完整重跑通过，未将脚本问题记为产品修复。

最终新隔离目录的首轮视频渲染连续遇到本地 Remotion 页面无响应。已将实际渲染页面并发限制为 2，保留仅针对本地导航的一次重试，未改变画面或声音数据。复验期间同时运行品牌同步检查引发 Vite 整页刷新，预览断言超时；最终验收改为在全部检查和构建结束后串行运行，避免脚本与源文件刷新互相干扰。

本轮实际应用夹具采用商品原图编排；已有片段混剪的目标传递与安全约束由运行时回归覆盖，阶段 7 的真实片段结论保留。没有调用真实图片、视频、语音模型，没有上传或提交真实作品。真实模型对不同平台的规划质量、真实账号上传回读和提交仍须针对具体对象另行验收；阶段 9／10 的能力不计为本阶段完成。

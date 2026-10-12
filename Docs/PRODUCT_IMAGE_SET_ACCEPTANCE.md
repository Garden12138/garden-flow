# 商品图文套图首版验收

日期：2026-10-11。基线：`d4f5890`。范围为商品图文方案、人工确认、模板编辑、图片导出、媒体入库和工程重开。默认五张含封面，固定 3:4、1440×1920 PNG；不增加发布或自由画布。

## 实现

- `product-image-set-compose` 工作流由明确元数据／选择商品的小红书图文模式路由，复用真实商品引用与视觉预检。内置 `product-image-set-director` 组织商品事实、卖点、文案和素材，`product_image_set_compose` 是提交工程方案的确认工具。代理在规划阶段不能直接提交媒体生成或绕过确认创建稿件。
- SQLite 持久审批不因等待超时取消。确认前及重开复核商品版本和归属，变更／删除使旧方案失效；重新规划读取当前商品，重新产生提案。重复确认只创建一个工程。成功后绑定创作会话并登记小红书稿件产物。
- `.redpost/note.json` 的可选 `productImageSet` 保存商品快照、工程素材副本、统一配色、页面和生成／渲染记录。确认后的工程独立于源商品。普通图文与视频不迁移；旧文档继续兼容。
- 三种受控模板：封面大图、图文分栏、多图细节。支持改标题／文案、选择或导入图片、裁切焦点、配色／字号、增删及重排内容页；唯一封面固定第一张。发布文案作为稿件内容保存，当前没有发布入口。
- 预览与导出共用模板和打包 Noto Sans SC 字体；导出隐藏窗口显式加载标题／正文字体，等待图片及整帧重绘完成，检测文字溢出、解码失败和渲染超时，错误指出具体页面。图片为 1440×1920 PNG。实际验收曾发现离屏捕捉早于正文绘制；已改为消费 `invalidate` 后的完整 `paint` 帧，连续 18 次捕捉检查正文像素及相同内容的 PNG 摘要。
- AI 分支确认本页模型、真实参考图及计费提示，每次一页一张；模型配置变更要求重新确认，不支持参考图时直接阻断。复用媒体模型适配器与持久媒体任务，密钥不保存到任务。请求历史阻止旧请求 ID 重放，失败可手动新请求重试；编辑中的过期结果保留为工程素材，中断请求不自动重投。
- 主进程通过运行时 schema 校验工程、页面、版本、素材与空间，缺失版本的预览／渲染／生成／导入／导出请求在执行前阻断。异步任务固定到发起空间；路径别名使用同一保存锁及请求去重键。编辑不会被旧生成／渲染结果覆盖，商品快照、素材及执行记录不能通过普通保存篡改。
- 内容摘要包含模板版本、页面、配色和素材摘要。导出只重渲染受影响页；相同内容重复导出复用当前 PNG。最新图片入库并绑定稳定槽位。缺失图片、过期页及导出期间的版本变化均阻断整套完成。
- 支持单页 PNG、图片目录与 ZIP。ZIP 按封面和页面顺序存放图片，包含 `content.md`、`manifest.json` 和预览 HTML。归档文件预先取得 stats，避免异步读取改乱顺序；中文文件名设置 UTF-8 标志。

## 自动验证

新增 `desktop/tests/productImageSet.test.ts`，通过 `pnpm test` 或在 desktop 目录执行 `node --test tests/productImageSet.test.ts`。覆盖结构化路由、审批重开与幂等、商品版本失效／删除、跨商品／空间和符号链接隔离、旧文档兼容、受保护字段、修改与输出过期、丢失图片重渲染、损坏素材、ZIP 顺序、零默认付费媒体调用、AI 单页提交／失败／请求去重／过期结果／中断恢复。AI 服务边界使用模拟返回，不产生真实费用。

`productVideoRetry.test.ts` 补充套图视觉重试，验证恢复原始请求、当前商品和新提案，并保持套图路由。既有商品视频、旁白、普通小红书稿件和插件测试继续运行。

最终串行 `pnpm test`、`pnpm check`、`pnpm build` 的计数与产物校验记录在[验证摘要](evidence/product-image-set/validation-summary.json)。Unix socket 集成测试需要允许本地临时 socket；首次沙箱拒绝不计为通过，完整命令在允许本地 socket 的环境重跑。

## 实际应用与渲染

验收脚本为 `desktop/scripts/product-image-set-electron-qa.cjs`。使用临时工作区、合成商品和持久方案夹具，不修改日常商品／会话／模型配置。确认、稿件编辑、渲染和导出走应用实际主进程、preload 与 renderer；文件选择器固定到测试目录。规划／视觉模型证据由夹具提供，这部分不等同于真实聊天模型端到端验收。

开发版使用项目 Vite 配置加载源码 renderer，以隔离驱动启动已构建的主进程／preload；禁用 Vite 自行启动 Electron：

```sh
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-qa "$PWD/desktop" create
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-qa "$PWD/desktop" reopen
```

macOS arm64 安装包模式，运行真实打包可执行文件，并通过仅监听 localhost 的临时 inspector 注入验收驱动；应用文件不改写。工作目录为临时目录，新增技能必须从包内发现，不依赖源码目录：

```sh
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" create native
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" reopen native
```

同一合成商品在开发版和安装包分别确认工程、通过工作台修改标题、导出单页 PNG／目录／ZIP，再退出并重开。检查三种模板、中文字体、长文阻断、裁切、多图、全部 PNG 尺寸与正文区域像素、文件顺序和产物复用。冷启动比对每页文字及全部媒体产物 ID。截图与结果见[验证摘要](evidence/product-image-set/validation-summary.json)。

最终四次应用验收均通过，两个独立工程使用同一商品。开发版及安装包重开均保持五个媒体 ID 和 PNG 摘要不变；四个 ZIP 的 CRC、UTF-8 文件名、封面／内容页顺序及无缺页清单已核验。详见[应用结果](evidence/product-image-set/application-qa.json)、[渲染稳定性](evidence/product-image-set/render-stability.json)及[包内文件一致性](evidence/product-image-set/package-parity.json)。

实拍界面：[方案确认](evidence/product-image-set/native-create-confirmation.png)、[安装包重开工作台](evidence/product-image-set/native-reopen-workbench.png)。最终模板 PNG：[封面](evidence/product-image-set/cover.png)、[图文分栏](evidence/product-image-set/split.png)、[裁切](evidence/product-image-set/crop.png)、[多图细节](evidence/product-image-set/grid.png)。这些商品图均为合成验收素材。

真实付费 AI 图片没有调用：须在用户核对模型、参考图和选定页面后单独验收。当前模拟服务测试覆盖提交、失败恢复和去重；原图套图的实际图片与 ZIP 导出已独立检查。

## 继续开发后的审查补充

复现并修复服务直接调用期间的空间切换、后台刷新覆盖新输入文字，以及生成失败后仍用旧版本重试的问题。另补齐同一工程版本的模型配置刷新，避免设置变更后工作台继续展示旧模型。套图服务现在统一固定发起空间，工作台按编辑及刷新序列过滤过期返回，失败后读取最新状态再允许用户手动确认新请求。连续点击处理按钮也在提交前同步去重。

新增空间切换测试实际暂停第一页渲染，再切换空间，确认后续五页、媒体槽位和 ZIP 都留在发起空间。预览、导入与中断恢复也覆盖读取期间切换空间。额外复核已有媒体路径保护：链接到其他空间的 PNG 不能作为当前产物复用，导出重新渲染对应页。

实际工作台交互回归使用真实 Electron、React 与 preload，暂时替换读取、模型配置和生成 IPC 的返回，验证未保存文字、乱序刷新、同一工程版本的配置刷新、失败状态、最新版本和立即单页重试。测试只提供模拟结果，不提交图片模型请求，也不改变持久工程。可独立运行：

```sh
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-ui-qa "$PWD/desktop" ui-regression
node desktop/scripts/product-image-set-electron-qa.cjs /private/tmp/gardenflow-image-set-ui-qa "$PWD/desktop/release/mac-arm64/GardenFlow.app/Contents/Resources/app.asar" ui-regression native
```

补充回归已在开发版和实际打包程序中通过，每种模式仅有两次模拟生成请求，真实付费请求为零，持久工程保持不变。结果见[继续审查回归](evidence/product-image-set/review-regression.json)。最终全量桌面测试为 424 项，套图测试为 14 项；`pnpm check`、最终源码复核和 `pnpm build` 均通过。修复版本重新完成四次创建／重开验收、PNG 和 ZIP 核验，安装包摘要已更新；ZIP 中的 `app.asar` 与实际受测应用逐字节一致。

验收驱动显式显示窗口并关闭后台节流后再捕捉界面，避免提前取得未完成绘制的截图。补充实拍：[刷新保留刚输入的标题](evidence/product-image-set/native-ui-regression-dirty-refresh.png)、[模拟失败后的最新版本](evidence/product-image-set/native-ui-regression-failed-retry.png)。模型名与失败信息均为夹具内容。

## 真实商品补充验收（2026-10-12）

默认空间伟嘉海洋鱼口味 3.6kg 商品已完成真实 12 图视觉预检、模型规划、审批冷启动恢复、幂等创建，以及开发版／安装版的编辑、单页 PNG、目录、ZIP 导出与工程重开。五张 PNG 均为 1440×1920，封面修改仅重渲染该页，长文字溢出正确阻断；原商品及旧稿件未改写。最终全量桌面测试 433 项，串行检查、构建及包一致性校验通过。真实 AI 单页生成仍未提交，详见[商品创作真实验收](PRODUCT_CREATIVES_REAL_ACCEPTANCE.md)及[验证摘要](evidence/product-creatives-real/validation-summary.json)。

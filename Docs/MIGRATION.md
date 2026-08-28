# RedClaw → GardenFlow 迁移记录

## 基线

- 迁移日期：2026-08-28。
- 来源：本机 `redclaw` 项目，相对于本仓库的实际路径为 `../../gitlab/redclaw`。
- 源分支：`feature/newapi-gateway-and-automation-upgrade`。
- 源提交：`cd8455f093e6653852ac03986f602f60662f64e2`（采集去重翻页、复用 Bojin 标签，并修好 embedding）。
- 目标仓库：`Garden12138/garden-flow`，保留已有 `main` 分支、初始提交和 `origin`。

## 迁移范围

迁入源仓库当前工作树中已跟踪的 1,375 个文件，包括桌面端、扩展、内置技能、文档、图片、锁文件和授权声明。复制后逐文件校验 SHA-256，再进行下列初始化调整。

不复制源 `.git`、`node_modules/`、生成的运行时、构建目录及用户工作空间。源仓库误跟踪的 `.DS_Store` 和 `.pnpm-store/v10/projects/` 缓存链接也未迁入。源目录保持不变。

## 初始化调整

- 根包声明为私有包 `garden-flow`，仓库地址指向 GardenFlow。
- 提供根目录 `setup`、`dev`、`check`、`test`、`build`、`build:plugin` 命令，继续使用独立的桌面端与扩展项目。
- 为根依赖补充 pnpm 锁文件；模块依赖版本沿用源锁文件，不进行依赖升级。
- 桌面端增加运行现有 `tests/*.test.ts` 的统一入口。
- 根忽略规则覆盖依赖、缓存、构建产物、本地环境变量与签名私钥。
- 更新项目首页、开发指引和部署入口，原许可证与第三方声明保持不变。
- 将 7 份模块文档中可在本仓库定位的 47 个本机绝对路径链接改为相对路径；修正根脚本文档中指向未包含脚本的说明。

## 本次验收

环境：macOS arm64、Node.js 22.23.2、pnpm 10.28.2。

| 检查 | 结果 |
| --- | --- |
| `pnpm run setup` | 根目录、扩展和桌面依赖按锁文件安装成功，Electron、FFmpeg 与 SQLite 原生模块已准备 |
| `pnpm check` | 通过；桌面 UI 与 bridge 检查覆盖 36 个 domain、614 个 API path，类型检查通过；扩展构建、类型检查、24 项 Node.js 测试及操作 ID/桥接/诊断脚本检查通过 |
| `pnpm test` | 186 项通过，0 失败，0 跳过 |
| `pnpm --dir desktop prepare:private-runtime` | 按预期使用开源降级实现 |
| `pnpm --dir desktop prepare:plugin-runtime` | 扩展构建、校验和运行时同步通过 |
| `pnpm --dir desktop exec vite build` | renderer、Electron 主进程和 preload 均构建成功 |
| 迁移完整性 | 1,375 个源文件全部保留；业务源码、两个模块的 pnpm 锁文件及 LICENSE 内容未变 |
| 仓库隔离 | 源工作区干净，目标 HEAD 和 Git 配置未变；生成目录及本地环境文件正确忽略 |

桥接测试需要临时本地 Socket，沙箱内首次执行受 `EPERM` 限制，授权后重跑通过。构建保留源项目的包体大小警告；没有执行完整安装包打包、应用 UI、真实 AI 请求或浏览器采集验收。迁移未创建 Git 提交或推送远端。

## 保持不变与后续边界

本次是源码迁移，不包含应用层品牌改造、源 Git 历史导入、用户工作空间迁移或发布。

为保持协议和数据兼容，桌面包名、Bojin / RedClaw 界面名称、应用 ID、浏览器扩展 ID、Native Host 名称与历史数据目录均沿用源项目。源项目的发布仓库、自动更新地址、macOS 签名身份和部分服务默认值也尚未替换；正式发布 GardenFlow 安装包前应独立审查并调整。

私有登录/会员代码不在源快照中，继续使用已有降级逻辑。需要真实 API、用户工作空间或已登录浏览器的业务验收，应在明确配置后单独执行；不要把历史文档中的“已验证”当作本次迁移的验收结果。

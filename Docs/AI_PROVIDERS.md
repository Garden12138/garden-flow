# AI 供应商配置

## 原则

GardenFlow 使用 BYOK（Bring Your Own Key）模式，不包含共享 API Key、默认云端网关或官方模型余额。全局 AI 路由只有：

- `disabled`：不执行需要模型的任务；新安装默认值。
- `custom`：使用用户保存并启用的供应商与模型。

文本、图片、视频、音频和 Embedding 可以使用不同路由。

## 文本与多模态

| 供应商 | 协议 | Endpoint | Key | 模型 |
| --- | --- | --- | --- | --- |
| OpenAI | OpenAI | 官方地址可自动补全；代理需显式填写 | 必填 | 必填 |
| Anthropic | Anthropic Native | 官方地址可自动补全；代理需显式填写 | 必填 | 必填 |
| Gemini | Gemini Native | 官方地址可自动补全；代理需显式填写 | 必填 | 必填 |
| 本地服务 | OpenAI-compatible | 必填，例如 `http://127.0.0.1:11434/v1` | 可空 | 必填 |
| 自定义 | 所选协议 | 必填 | 通常必填 | 必填 |

供应商名称只是配置标签，实际路由以 provider ID、协议、Endpoint 和模型的结构化记录为准。

## 图片

图片路由单独保存 provider、Endpoint、Key、模型和 provider template。模型需要与所选 template 对应；聊天模型并不自动具备图片生成能力。

在「设置 → AI 服务 → 供应商」添加 **Qwen Image Studio（内网）**，填写实际 Endpoint（例如 `http://image-server:8001/v1`）与图片服务密钥 `IMAGE_API_KEY`。默认模型是 `qwen-image-2.1-turbo`。在「能力路由 → 图片生成」选择该供应商并保存。

生成工作台默认输出 768×768 PNG，支持文生图和单张原图编辑。Agent 的 `image_generate` 可同时传入一张 `referenceImages` 和一张同尺寸 `mask`。通过工具请求单张 1024×1024 时，客户端先检查服务健康接口，仅在服务开放该尺寸时使用。

## 视频

支持以下显式预设：

| 预设 | 上游 | 说明 |
| --- | --- | --- |
| `aliyun-bailian` | 阿里云百炼原生异步视频 API | 根据模型暴露文生、图生、首尾帧等能力 |
| `minimax` | MiniMax 原生视频 API | 根据模型暴露参考图、续写或音频能力 |
| `minimax-h3-local` | 内网 MiniMax-H3 Native V2 | 文生视频、单首帧和首尾帧，固定输出 5 秒、608×352 |
| `new-api-aliyun` | 用户自建 new-api，阿里云上游 | 必须显式选择，不根据 URL 猜测 |
| `new-api-minimax` | 用户自建 new-api，MiniMax 上游 | 必须显式选择，不根据模型名猜测 |
| `custom` | OpenAI-compatible 或自定义实现 | 以用户配置和服务端能力为准 |

所有视频路由都要求 Endpoint、Key 和模型。保存后 GardenFlow 会恢复完整配置与激活顺序；缺少任何字段时返回配置错误，不切换到隐藏默认值。

在「设置 → AI 服务 → 视频供应商」添加并启用 **MiniMax-H3 Native V2（内网）**，填写实际 Endpoint（例如 `http://video-server:8089`）与视频服务密钥 `H3_MINIMAX_API_KEY`。该预设使用固定模型 `MiniMax-H3`。首帧和尾帧使用本地 PNG、JPEG 或 WebP 图片。生成完成后，客户端用限时链接下载 MP4 并保存到媒体库。

## 音频与 Embedding

音频路由保存合成或转录所需的供应商、模型和 Endpoint。Embedding 用于语义检索，未配置时不影响本地全文搜索，但向量索引与相似度能力不可用。

## 排障顺序

1. 确认路由为 `custom` 且目标供应商启用。
2. 确认当前任务实际选择的 provider ID 和模型。
3. 检查 Endpoint 是否包含服务要求的版本路径。
4. 检查 Key 权限、账户额度和地区限制。
5. 核对模型是否支持工具调用、视觉输入或目标媒体类型。
6. 用设置页连接检查或供应商官方最小请求验证。

不要在 Issue、截图或诊断附件中粘贴 Key。GardenFlow 导出诊断时会自动脱敏，但提交前仍需人工检查。


## xcli（本机 CLI 生图）

安装 xcli v2，建议放到 `~/.local/bin/xcli`。在终端登录 Codex、Antigravity 或 Cursor CLI 中的至少一个，然后运行 `xcli agents` 确认状态。生图使用所选 CLI 的登录和额度。[下载 xcli v2](https://github.com/Garden12138/xcli/releases)

1. 在设置中点击「添加 xcli」，新建「xcli（本机 CLI 生图）」供应商。
2. 「xcli 可执行文件」可保留为 `xcli`，按 `XCLI_PATH`、`PATH`、`~/.local/bin/xcli` 的顺序查找。也可以填写绝对路径，文件名须为 `xcli`。配置无需 API Key。
3. 在「生图 CLI」选择「自动（推荐）」或固定一个 CLI，然后点击「检查 CLI 状态」。GardenFlow 会先保存设置，再检查可用 CLI。检查不消耗生图额度。
4. 在「创作 → 生成工具」的「图片模型」中选择 `xcli · 自动（推荐）` 或指定 CLI。也可以在「能力路由 → 图片生成」中把 xcli 设为默认来源。

支持文生图、参考图生成、图生图编辑和封面生图，最多可使用 4 张参考图。图片和封面分别进入媒体库和封面库。一次生成多张时，每个 xcli 子任务的第一张有效图片分别入库。每张通常需要 1～5 分钟。比例和尺寸作为生成要求传给 CLI，实际结果可能不同。xcli 不支持遮罩编辑、对话模型或 Windows。私密项目暂不支持 xcli，因为 xcli 和各 CLI 会在项目目录外保存提示词副本。

如果错误信息包含任务 ID，在终端运行 `xcli result <任务 ID>` 查看详情。自动模式由 xcli 处理回退，遇到额度不足、认证失败或服务不可用等可切换错误时，会尝试其他可用的 CLI。通用 `failed` 会结束该任务。生成工具收到 xcli 的终态失败后显示原错误和任务 ID，停止本次交付物恢复。

Antigravity 报 `plan model not specified` 时，可用只读的 `agy models` 检查模型列表。GardenFlow 会按应用内的网络代理设置启动 CLI。终端通过代理运行成功时，也要核对桌面应用的代理设置。

在「创作 → 生成工具」发起 xcli 生图或封面生成时，如果代理未启用，GardenFlow 会弹窗询问。已有代理地址会预填，也可以在弹窗里填写。选择「启用并继续」会保存并启用 GardenFlow 的全局网络代理，然后提交本次生成。选择「继续直连」会直接提交，选择「取消」会保留提示词。

开发者可运行 `pnpm --dir desktop test`。其中 xcli 测试使用临时假脚本，不消耗额度。

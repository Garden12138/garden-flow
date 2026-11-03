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


## xcli Model Gateway

在设置中新增 `xcli Model Gateway` 供应商，填写已启动网关的本机 IP、实际端口和 `/v1` 路径，以及为 GardenFlow 签发的独立应用 Token。默认示例为 `http://127.0.0.1:18741/v1`，可更改端口。点击“检查模型目录”仅读取授权目录，不发起模型推理。显示的 local/remote/unknown 是网关配置声明；本机传输不代表本机推理。

为对话与图片分别选择模型别名，例如 `xcli/text-default` 与 `xcli/image-default`。图片路由使用 `openai-images`。xcli 分支核验能力后只提交一次请求，保留尺寸、数量和所有参考图；不删除参数、不调整尺寸、不在编辑失败后转为文生图。只接收 base64 图片，不下载返回 URL。单图最多 20 MiB、16,777,216 像素，总请求最多 32 MiB，最多四张参考图和四个结果。暂未提供 mask 控件。

Pi Agent 在发送上下文前要求目录中已验证的 Tool Calling 和流式文本能力。文本模型没有图片输入能力时，不能因为别名未知而自动启用 Vision。使用独立 Token 的模型权限与云端授权控制可调用上游；如网关要求额外逐请求同意，本客户端尚未提供该确认头，会收到明确拒绝。

生成结果继续通过媒体库保存。真实模型效果、Vision、参考图编辑、封面入库和 Pi 工具流仍须在选定上游后执行应用验收。可先使用本机假上游运行离线测试：`pnpm --dir desktop test`，类型检查：`pnpm --dir desktop check:types`。

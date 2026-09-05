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

## 视频

支持以下显式预设：

| 预设 | 上游 | 说明 |
| --- | --- | --- |
| `aliyun-bailian` | 阿里云百炼原生异步视频 API | 根据模型暴露文生、图生、首尾帧等能力 |
| `minimax` | MiniMax 原生视频 API | 根据模型暴露参考图、续写或音频能力 |
| `new-api-aliyun` | 用户自建 new-api，阿里云上游 | 必须显式选择，不根据 URL 猜测 |
| `new-api-minimax` | 用户自建 new-api，MiniMax 上游 | 必须显式选择，不根据模型名猜测 |
| `custom` | OpenAI-compatible 或自定义实现 | 以用户配置和服务端能力为准 |

所有视频路由都要求 Endpoint、Key 和模型。保存后 GardenFlow 会恢复完整配置与激活顺序；缺少任何字段时返回配置错误，不切换到隐藏默认值。

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

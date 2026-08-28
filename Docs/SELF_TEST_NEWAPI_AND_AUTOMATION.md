# 自测步骤：new-api 私有网关 + 自动化模块升级

覆盖分支 `feature/newapi-gateway-and-automation-upgrade` 的两个功能：

- 功能 A：Bojin 官方源切换为私有化 new-api 网关（方案见 `Docs/NEW_API_GATEWAY_MIGRATION_PLAN.md`）
- 功能 B：自动化模块支持对话创建任务 + 内置小红书自动采集（方案见 `Docs/AUTOMATION_UPGRADE_PLAN.md`；采集已改为插件 `research.run` + `capture.save`，不再走 computer-use 键鼠）

每一节都标了状态：

- **【已验证】** — 已在开发机上离线跑通并附实际结果，你不需要重复，只在回归时重跑。
- **【待你验证】** — 依赖内网网关、真实账号或应用 UI 交互，必须人工做。
- **【已确认不支持】** — 内网实测失败，根因在网关/上游适配，当前配置下不必再测同一路径。

---

## 状态总览

| 章节 | 内容 | 状态 | 为什么 |
|---|---|---|---|
| 1.1 | 类型检查 / 单测 / parity | 【已验证】 | 纯本地命令 |
| 1.2 | 文件编码与 lint | 【已验证】 | 纯本地检查 |
| 1.3 | 技能复制与加载链路 | 【已验证】 | 可离线构建 + 直接调加载器 |
| 1.4 | IPC 通道三层对齐 | 【已验证】 | 静态交叉比对 |
| 2.1 | `GET /models` | 【已验证】 | 恰好 10 个 `bojin-*`（含两个视频别名） |
| 2.2 | 聊天 `bojin-max` | 【已验证】 | `/chat/completions` 正常回复 |
| 2.3 | 向量 `bojin-text-embedding` | 【已验证】 | embedding 维度 **1024**（3.8 重建用） |
| 2.4 | 图片 `bojin-imgae-3.0` | 【已验证】 | `/images/generations` 返回可达 `url` |
| 2.5 | TTS `bojin-speech` | 【已确认不支持】 | new-api + 百炼渠道无 OpenAI speech 转换 |
| 2.6 | ASR `bojin-asr-plus` | 【已确认不支持】 | new-api + 百炼渠道无 OpenAI transcriptions 转换 |
| 2.7 | 文生视频 `bojin-video-H3` | 【已确认不支持】 | 上游要求 MiniMax V2，new-api hailuo 走 V1 |
| 2.8 | 参考图生视频 `bojin-video-1.1-r2v` | 【已验证】 | 可达 HTTPS 可出片；data URL / GitHub Raw / 官方 jsDelivr 不行 |
| 2.9 | 视频任务轮询 | 【已验证】 | 包裹格式，`data.status=SUCCESS` + `data.result_url` |
| 3.9 r2v | 应用内参考图生视频 + GitHub 图床 | 【已验证】 | 2026-08-25 对话提交出片；默认公开地址走 `cdn.jsdmirror.com` |
| 3 | 应用内功能 A 其余项 | 【待你验证】 | 3.6 受 2.5/2.6 阻塞，3.9 H3 受 2.7 阻塞 |
| 4.1 | 只看页面 / 旧数据 / 跨平台外观 | 【待你验证】 | 打开自动化页即可，不改数据 |
| 4.2 | UI 配置 / 就绪检查 / 手动建任务 | 【已验证】 | 2026-08-25：配置、就绪检查、手动创建徽标通过 |
| 4.3 | 确认范围负向（不弹窗） | 【待你验证】 | 聊天里触发既有工具，不建定时任务 |
| 4.4 | 对话创建任务 | 【已验证】 | 2026-08-25：主路径走 `work schedule-add`，确认后落库 |
| 4.5 | 内置采集（插件编排） | 【已验证】 | 2026-08-28：页内搜索 + capture.save；配额只计新入库 |
| 4.5.3 | Bojin 标签 / 调试复用 | 【已验证】 | 2026-08-28：新任务复用已有搜索标签和同一个 Bojin 分组 |
| 4.5.4 | 新笔记 embedding（不补旧） | 【已验证】 | 百炼 compatible-mode/v1 + `qwen3.7-text-embedding`；不补以前失败的旧笔记 |
| 技能激活 | 内置技能加载 | 【已验证】 | 见 1.3；4.5 跑采集时顺带看日志即可 |

**已知阻塞 / 前置：**

1. ~~网关 `http://192.168.10.117:3000` 从开发机不可达~~ — 内网环境已可测；若换机器仍超时，需在内网执行第 2、3 节。
2. ~~开发机上 `computer-use` 解释器不一致，挡住 4.5 真采集~~ — **已过时**。内置「小红书自动采集」已改为桌面编排 + RedClaw 插件 `research.run` / `capture.save`，**不再依赖 computer-use 键鼠或独立 Chrome Profile**。对话创建的普通定时任务（如「猫粮爆款笔记采集与选题建议」）仍可能自己去调 computer-use，与内置采集无关，本轮不测。
3. **TTS / ASR 经私有网关不可用（2026-08-24 内网实测）**：当前 `bojin-speech` / `bojin-asr-plus` 上游渠道仍为**阿里百炼**。new-api 对 OpenAI `POST /v1/audio/speech` 与 `POST /v1/audio/transcriptions` 均返回 `convert_request_failed` / `not implemented`（百炼兼容模式无对应 audio 端点，网关也未实现协议转换）。处置：应用内语音合成 / 转录改走 **DashScope / 百炼直连**；网关侧 2.5、2.6 与应用内 3.6（走私有网关别名时）标跳过，不必当客户端 bug 反复排查。
4. **`bojin-video-H3` 经私有网关不可用（2026-08-24 内网实测）**：上游返回 `hailuo api error: invalid params, 该模型请使用 /v2/video_generation 接口`。与方案 §6.9.5 一致。处置：3.9 的 H3 项跳过，改 MiniMax 直连兜底。
5. **参考图必须是阿里云能下载的公网 HTTPS**（2026-08-25 应用内实测）：本地文件 / data URL 打 r2v 会变成 `InvalidParameter` / `Model not exist`。GitHub Raw 与官方 jsDelivr（`cdn.jsdelivr.net`）阿里云常拉不下来。客户端已加 GitHub 图床，默认公开地址为 **jsDelivr 国内镜像** `cdn.jsdmirror.com`；仓库需公开。刚上传后偶发 `Model not exist` 会自动重试创建。

### 网关能力实测对照（2026-08-24，渠道维持百炼 + MiniMax H3）

| 能力 | 模型 / 端点 | 经 new-api | 结论 |
|---|---|---|---|
| 模型列表 | `GET /v1/models` | ✅ | 10 个 `bojin-*` 齐 |
| 聊天 | `bojin-max` → `/chat/completions` | ✅ | 正常中文回复 |
| 向量 | `bojin-text-embedding` → `/embeddings` | ✅ | 维度 **1024** |
| 图片 | `bojin-imgae-3.0` → `/images/generations` | ✅ | `data[0].url` 可达 OSS |
| TTS | `bojin-speech` → `/audio/speech` | ❌ | 百炼无 speech 转换 |
| ASR | `bojin-asr-plus` → `/audio/transcriptions` | ❌ | 百炼无 transcriptions 转换 |
| 参考图生视频 | `bojin-video-1.1-r2v` → `/video/generations` | ✅ | 阿里可达 URL 可出片；本地图需经 GitHub 图床转国内镜像 |
| 文生视频 H3 | `bojin-video-H3` → `/video/generations` | ❌ | 必须走 MiniMax V2 |

---

## 0. 环境准备

```bash
cd /Volumes/acasis2t/macminim4pro/gitlab/redclaw
git checkout feature/newapi-gateway-and-automation-upgrade

cd desktop
pnpm install          # 仓库同时存在 pnpm-lock.yaml 与 package-lock.json，脚本内部用 pnpm
pnpm dev              # 启动渲染层 + Electron
```

准备好一个内网网关令牌（`sk-` 开头），第 2、3 节都要用。

功能 B 的内置采集现在走已登录浏览器里的 RedClaw 插件，macOS / Windows / Linux 都可以开（不再置灰）。前置是：Bojin 在跑、插件已加载并连上桌面、浏览器里已登录小红书。改过插件源码后必须在 `chrome://extensions` 里点一次刷新。

---

## 1. 已完成的离线验证【已验证】

这一节全部已经跑过并通过，列出来是为了让你知道哪些不用再测，以及回归时怎么重跑。

### 1.1 类型检查 / 单测 / parity

```bash
cd desktop
pnpm check:types                              # tsc --noEmit
node --test tests/*.test.ts                   # 全量单测
node --test tests/modelCapabilities.test.ts tests/automationTasks.test.ts tests/videoGenerationCapabilities.test.ts
pnpm test:image-hosting                       # GitHub 图床 URL / 上传适配
pnpm test:image-provider                      # 网关 images 空 b64_json 回退 url
pnpm check:parity                             # UI / bridge 一致性 + tsc
```

**实际结果（2026-08 初测）**：`tsc` 无输出、退出码 0；当时全量单测 `# pass 121 # fail 0`；三个新增/改动测试文件合计 `# pass 23 # fail 0`；`UI source parity check passed`、`Bridge compatibility check passed: 35 formal domains and 613 formal API paths covered`。图床与图片适配：`pnpm test:image-hosting`、`pnpm test:image-provider` 均应 0 fail。

采集链路后续补测（2026-08-28）【已验证】：

```bash
cd desktop
node --test tests/xhsStructuredCapture.test.ts tests/modelCapabilities.test.ts

cd ../Plugin
node --test scripts/test-site-research-runtime.mjs
```

桌面侧覆盖搜索配额、noteId 去重、重复/更新不占新入库、结果页翻页；插件侧覆盖 `pickReusableResearchTab`（已有搜索标签不新建、claim 冲突才回退创建）。`qwen3.7-text-embedding` 按 embedding 能力识别，不再被当成聊天模型。

注意 `tsconfig.json` 只 include `electron / shared / private`，**`src/` 不在类型检查范围内**，所以渲染层的问题静态检查发现不了，只能靠第 3、4 节手工验证。

### 1.2 文件编码与 lint

本次改动的 36 个文件全部可 UTF-8 解码且无 BOM；新增的 6 个核心文件（`privateGateway.ts`、`builtinAutomationTasks.ts`、`automationTask.ts`、`AutomationTaskCard.tsx`、`BuiltinAutomationSection.tsx`、`redclawBridge.ts`）无 lint 告警。

### 1.3 技能复制与加载链路

这项原本标记为"需实机确认"，现在已经证实可用，**不用再测**。

- `npx vite build` 后 `dist-electron/builtin-skills/xhs-auto-capture/SKILL.md` 生成，`diff -r` 与源目录完全一致。
- 直接调用 `skillLoader.loadSkillsFromDir` 分别加载源目录和运行时目录，两边都能发现 `xhs-auto-capture`，且与既有的 `redbox-video-director`、`skill-creator` 并列。
- frontmatter 解析正确：`whenToUse` 存在、`allowedTools = ["app_cli","bash"]`、`sourceScope = builtin`、body 无 frontmatter 残留。
- 一个本来会静默踩坑的地方：`skillLoader` 的忽略清单里含 `**/dist-electron/**`，而生产环境技能恰好就在该目录下。实测不受影响，因为 glob 的 cwd 是技能目录本身，相对路径里不含 `dist-electron` 段。

### 1.4 IPC 通道三层对齐

新增的 6 个通道在主进程注册与 bridge facade 调用两侧完全一致：

```
redclaw:runner-list-builtin
redclaw:runner-builtin-readiness
redclaw:runner-set-builtin-enabled
redclaw:runner-set-builtin-settings
redclaw:runner-run-builtin-now
redclaw:runner-install-builtin-mcp
```

`preload.ts` 用的是通用 `invoke(channel, payload)` 透传，没有白名单需要同步维护。

---

## 2. 网关侧 curl 冒烟

**必须在能访问 `192.168.10.117` 的内网环境执行。** 不启动应用即可跑。这一节如果失败，第 3 节的对应功能不必再试。

```bash
BASE=http://192.168.10.117:3000/v1
KEY=sk-你的令牌
```

| # | 命令 | 预期 | 2026-08-24 |
|---|---|---|---|
| 2.1 | `curl -s $BASE/models -H "Authorization: Bearer $KEY" \| jq '.data[].id'` | 恰好 10 个 `bojin-*` 模型 | 【已验证】见下方清单 |
| 2.2 | `curl -s $BASE/chat/completions ... bojin-max ...` | 正常回复 | 【已验证】 |
| 2.3 | `curl -s $BASE/embeddings ... bojin-text-embedding ...` | 返回维度数字（记下来，3.8 要用） | 【已验证】维度 1024 |
| 2.4 | `curl -s $BASE/images/generations ... bojin-imgae-3.0 ...` | 返回 `url` 或 `b64_json` | 【已验证】`url` |
| 2.5 | `curl -s $BASE/audio/speech ... bojin-speech ... --output /tmp/tts.mp3` | ~~音频文件~~ | 【已确认不支持】 |
| 2.6 | `curl -s $BASE/audio/transcriptions ... bojin-asr-plus -F file=@真实.wav` | ~~转写文本~~ | 【已确认不支持】 |

#### 2.1 实测结论（2026-08-24）【已验证】

`GET /v1/models` 最终返回恰好 10 个对外别名（中间曾缺视频模型，补渠道后齐）：

```
bojin-asr-plus
bojin-imgae-2.0
bojin-imgae-3.0
bojin-max
bojin-omni-plus
bojin-plus
bojin-speech
bojin-text-embedding
bojin-video-1.1-r2v
bojin-video-H3
```

列表里出现 `bojin-speech` / `bojin-asr-plus` **只表示别名已挂上**，不代表 `/audio/*` 能打通（见 2.5 / 2.6）。

#### 2.2 实测结论（2026-08-24）【已验证】

```bash
curl -s $BASE/chat/completions -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"bojin-max","messages":[{"role":"user","content":"你好"}]}' \
  | jq '.choices[0].message.content'
# → "你好！很高兴见到你。有什么我可以帮你的吗？"
```

OpenAI chat completions 形态正常。

#### 2.3 实测结论（2026-08-24）【已验证】

```bash
curl -s $BASE/embeddings -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"bojin-text-embedding","input":"测试文本"}' \
  | jq '.data[0].embedding | length'
# → 1024
```

**3.8 向量索引重建用这个维度**：从旧 embedding 切到 `bojin-text-embedding` 后按 **1024** 全量重建。

#### 2.4 实测结论（2026-08-24）【已验证】

`bojin-imgae-3.0` 文生图走 `/images/generations` 成功。响应是 OpenAI 形态 + 百炼 `metadata`：

- `data[0].url`：DashScope OSS 加速地址（可达）
- `data[0].b64_json`：空字符串（走 URL，不走 base64）
- `metadata.output.choices[0].message.content[0].image`：与 `data[0].url` 同值
- `usage`：`output_width/height=1024`，`output_image_count=1`

客户端读 `data[0].url` 即可。图生图 `/images/edits` 仍待应用内 3.5 验证。

#### 2.5 / 2.6 实测结论（2026-08-24，渠道=百炼，不改渠道）

协议形态仍可参考 New API 文档（[创建Speech](https://docs.newapi.pro/zh/docs/api/ai-model/audio/openai/createspeech)、[CreateTranscription](https://docs.newapi.pro/zh/docs/api/ai-model/audio/openai/createtranscription)），但 **当前百炼渠道下两条都失败**：

```bash
# 2.5 TTS — 写入的「mp3」实际是 JSON 错误体
curl -s "$BASE/audio/speech" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"bojin-speech","input":"这是一段测试语音","voice":"alloy"}' \
  --output /tmp/tts.mp3 && file /tmp/tts.mp3
# → /tmp/tts.mp3: JSON data
# → {"error":{"message":"not implemented ...","type":"new_api_error","code":"convert_request_failed"}}

# 2.6 ASR — 使用真实 wav（勿用上面的假 mp3）
curl -s "$BASE/audio/transcriptions" \
  -H "Authorization: Bearer $KEY" \
  -F model=bojin-asr-plus \
  -F file=@/path/to/real.wav | jq .
# → 同样 {"error":{"message":"not implemented ...","code":"convert_request_failed"}}
```

**原因**：方案原假设 `bojin-speech` 上游为 MiniMax TTS；现网仍挂百炼。百炼 OpenAI 兼容模式不提供 `/audio/speech`，TTS 需走 DashScope 原生接口；new-api 未实现 OpenAI audio → 百炼 的转换，故 TTS/ASR 均 `not implemented`。

**处置**：2.5 / 2.6 标跳过；应用内 `voiceTts` / `transcription` 勿依赖官方源 `bojin-speech` / `bojin-asr-plus`，改百炼或其它直连源。若日后渠道改为 MiniMax（或 new-api 补齐百炼 audio 适配），再重跑本两节。

**视频（端点是单数 `video`，本节最重要的三条）**

```bash
# 2.7 文生视频：验证 bojin-video-H3 的 V1/V2 兼容性风险
curl -s $BASE/video/generations -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"bojin-video-H3","prompt":"戴墨镜的狗在街道滑滑板，3D 卡通","duration":6,"metadata":{"resolution":"1080P"}}'

# 2.8 参考图生视频：顶层不传 image，参考图放 metadata.input.media
curl -s $BASE/video/generations -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"bojin-video-1.1-r2v","prompt":"参考图人物在咖啡厅对镜头微笑","duration":10,"metadata":{"input":{"media":[{"type":"reference_image","url":"https://可达地址/ref.png"}]},"parameters":{"resolution":"1080P"}}}'

# 2.9 轮询任务
curl -s $BASE/video/generations/task_xxxxxxxx -H "Authorization: Bearer $KEY" | jq
```

#### 2.7 实测结论（2026-08-24）【已确认不支持】

按清单打 `bojin-video-H3` 文生视频，网关原样返回上游错误：

```json
{
  "code": "2013",
  "message": "hailuo api error: invalid params, 该模型请使用 /v2/video_generation 接口",
  "data": null
}
```

与方案已知风险一致：`MiniMax-H3` 是 MiniMax V2 独有模型，new-api hailuo 适配器走 V1。**跳过 3.9 的 H3 相关项**，改用 MiniMax 直连服务商兜底（项目里的 `minimax` 分支本身就是 V2 协议，零代码改动）。

2.8 要分别用 **data URL** 和**可达 URL** 各试一次，确认网关是否接受 data URL。客户端遇到 data URL 会打 warning 日志方便定位；若上游只认可达 URL，需要补素材中转。

2.9 记下响应形态是包裹格式（`data.result_url` / `data.fail_reason`）还是扁平格式（`status` / `url`）——客户端两种都兼容，但要确认实际走哪条。

#### 2.8 / 2.9 实测结论（2026-08-24）【已验证】

`bojin-video-1.1-r2v` + **可达 HTTPS** 参考图整条链路已通（任务 `task_yIptoEIJGpkZgOJaCQ7O1WShjEp3sTJR`）：

- **提交**：扁平对象，`id` / `task_id` 相同，`status: queued`，`model: bojin-video-1.1-r2v`
- **轮询**：包裹格式 `code: success` + `data`；进行中 `data.status=IN_PROGRESS`、`progress=30%`；成功 `data.status=SUCCESS`、`progress=100%`
- **成片 URL**：`data.result_url`（同值在 `data.data.output.video_url`）；上游模型 `happyhorse-1.1-r2v`
- **耗时**：约 2 分钟（queued → 30% → 100%）

中间踩过、不必当新 bug：

| 现象 | 说明 |
|---|---|
| 无参考图打 r2v → `Model not exist` | r2v 必须带 `metadata.input.media` 参考图 |
| `happyhorse-1.1-r2v` 原名 → `model_not_found` / 无可用渠道 | 对外只认别名 `bojin-video-1.1-r2v` |
| 早期 `AccessDenied` / `does not support asynchronous calls` | 渠道或上游账号权限未就绪，修好后同一请求即可 queued |

**data URL / 本地图（2026-08-25 已确认不支持）**：直接把 data URL 或本地路径打进 `metadata.input.media`，阿里 r2v 会报 `InvalidParameter` / `Model not exist`。不要再测同一条；应用内改为上传 GitHub 图床后再提交公开 URL。

对照同一张公开图，阿里云能否下载取决于主机：

| 公开地址 | 创建任务 | 说明 |
|---|---|---|
| 阿里文档静态资源 `help-static-aliyun-doc.aliyuncs.com` | ✅ queued → 出片 | 2.8 最初打通用的地址 |
| `cdn.jsdmirror.com/gh/owner/repo@branch/path` | ✅ queued → 出片 | GitHub 图床默认 |
| `cdn.jsdelivr.net/gh/owner/repo@branch/path` | ❌ 400 `Model not exist` | 官方 jsDelivr，阿里云当无效参考图 |
| `raw.githubusercontent.com/...` | ❌ 下载失败或 `Model not exist` | GitHub Raw，国内/阿里云常不可达 |

刚上传到镜像后，偶发同一请求先 400、过一两分钟又能 queued；客户端对 `Model not exist` / `fail_to_fetch_task` 会重试创建（最多 3 次）。

---

## 3. 应用内验证：功能 A（new-api 私有网关）【部分已验证】

### 3.1 全新配置

1. 打开「设置 → AI 供应商」。
2. 官方源可见，标注为「私有网关（new-api）」。
3. 展开官方源：Endpoint 为只读的 `http://192.168.10.117:3000/v1`；令牌输入框可填。
4. 填入令牌 → 点「获取模型」。

**预期**：返回 10 个 `bojin-*` 模型；未填令牌时聊天模型下拉禁用并提示「请先填写网关令牌」。

### 3.2 各 scope 模型下拉

| scope | 应该出现 | 不应出现 |
|---|---|---|
| 聊天 / 漫游 / 团队 / 知识库 / RedClaw | `bojin-max`、`bojin-plus` | `bojin-omni-plus` |
| 图片 | `bojin-imgae-2.0`、`bojin-imgae-3.0` | 其它 |
| 转录 | `bojin-asr-plus` | 其它 |
| 向量 | `bojin-text-embedding` | 其它 |
| 语音合成 | `bojin-speech` | 其它 |
| 视频理解 | `bojin-omni-plus` | 其它 |
| 声音克隆 | 默认 disabled | — |

`bojin-omni-plus` **不出现在聊天列表**是刻意设计（它是 omni 模型，走视频理解 scope）。

### 3.3 主聊天

新建会话，发一条带图片附件、会触发工具调用的消息。

**预期**：流式输出正常，工具调用正常，请求打到 `{base}/chat/completions`。

### 3.4 知识库问答 / 漫游 / 长任务

各跑一条，确认扁平字段（`api_endpoint` 等）已随路由源刷新，不再指向 api.ziz.hk。

### 3.5 图片生成

自由创作里跑一次文生图和一次图生图。

**预期**：分别走 `/images/generations` 和 `/images/edits`，正常出图。网关侧文生图（2.4）已通，读 `data[0].url`；图生图 `/images/edits` 仍需应用内补测。

### 3.6 语音合成 / 转录【受 2.5 / 2.6 阻塞 — 走私有网关别名时跳过】

若 `voiceTts` / `transcription` 仍指向官方源 `bojin-speech` / `bojin-asr-plus`：**预期失败**（与网关 curl 相同的 `convert_request_failed`），不要当客户端回归失败。

验证语音能力时，把对应路由改到 **DashScope / 百炼直连**（或其它已支持的 TTS/ASR 源）再各跑一次，确认出音频、出文本。

### 3.7 老库升级（本节最关键的回归）

用一份**升级前**的工作空间（官方源 baseURL 还是 `api.ziz.hk`、模型清单里是 `redbox-*`）打开应用 → 进设置页。

**预期**：baseURL 自动变为内网网关；不含任何网关别名的旧模型清单被整体回填为 10 个 `bojin-*`，旧默认模型被清掉；填入令牌后全链路可用。

**反向验证**：如果你自己维护过官方源的模型清单（清单里已有网关别名），**应该原样保留**，不被覆盖。

### 3.8 向量索引重建

embedding 从旧模型切到 `bojin-text-embedding` 后维度会变（网关实测新维度为 **1024**，见 2.3）。**本轮不要求**给以前没建成功的旧笔记补索引。向量设置改成百炼直连时：Endpoint 必须带 `/compatible-mode/v1`，模型选 `qwen3.7-text-embedding`；保存后新入库笔记应出现 `Indexed … (n chunks)`。改完设置不必重启应用（`EmbeddingService` 每次会重读配置）。

### 3.9 视频服务商（依赖 2.7 / 2.8 的结论）

网关侧已定：`bojin-video-1.1-r2v` 可达 URL 可出片；`bojin-video-H3` 经网关不可用。应用内按这个结论测：

1. 「新增服务商」里选 `new-api` 预设，确认自动填好 endpoint 和两个视频模型。
2. 生成入口的模型下拉出现 `bojin-video-1.1-r2v` 和 `bojin-video-H3`。
3. 设置 → 图床 / OSS：启用 GitHub，填 `owner/repo`、分支、Token、路径前缀；公开访问方式默认「jsDelivr 国内镜像」。仓库必须公开。点「测试上传」应返回 `cdn.jsdmirror.com` 地址。
4. `bojin-video-1.1-r2v`：只有「参考图」模式可选，参考图限 1–5 张，时长 3–15s，无参考音频入口。
5. `bojin-video-H3`：UI 仍可出现文生 / 参考图 / 首尾帧；**经网关提交预期失败**（见 2.7）。不要当客户端回归失败；改 MiniMax 直连再测 H3。
6. 用 r2v + 本地参考图提交一次生成，观察任务进入轮询，完成后视频落入媒体库。日志应有 `[VideoGeneration] reference images hosted`，地址为 `cdn.jsdmirror.com`，随后 `new-api task created` / `SUCCESS`。刚上传偶发 `Model not exist` 时日志会出现 `new-api create retry`。

#### 3.9 r2v + 图床实测结论（2026-08-25）【已验证】

对话里 `video generate` + 本地参考图，经 GitHub 图床上传后走 `bojin-video-1.1-r2v` 已出片。中间踩过、不必当新 bug：

| 现象 | 说明 |
|---|---|
| 未配图床 / data URL | 创建失败 `Model not exist` |
| 图床成功但仍用 GitHub Raw | 任务能建出，轮询 `FAILURE`：`Failed to download raw.githubusercontent.com` |
| 默认官方 jsDelivr | 创建即 400 `Model not exist` |
| 改默认国内镜像后偶发 400 | 同一 URL 稍后可 queued；已加重试 |

### 3.10 异常与回归

- 拔掉网关网络后各功能报错提示明确、应用不崩溃。
- 已配置的 DashScope / MiniMax **直连**视频服务商行为不变（provider 分流按 endpoint 判定，不看模型名）。

---

## 4. 应用内验证：功能 B（自动化模块升级）

按**从小到大**测，上一层不过先别进下一层：

- 第 2 层过不了，先别做第 5 层。
- 第 3 层如果已经大面积弹窗，先停，不要继续第 4 层。
- 技能激活已在 1.3 离线证实可用，**不用专门测**；第 5 层跑「立即运行」时顺带看日志没有技能未找到的 warn 即可。实现上做了降级——技能找不到只记 warn 不中断，核心操作约束已内联进执行 prompt，所以即使技能没加载上任务也能跑，但行为约束会弱化，日志里出现 warn 要当回事。

### 4.1 只看，不改数据【待你验证】

打开自动化页，先确认页面能站住：

1. 用**升级前**的工作空间打开自动化页（当前库如果没有旧任务，记「本机无旧任务」并跳过本条）。
   **预期**：已有任务全部正常显示，`source` 字段缺失时默认按「手动创建」处理，不报错、不丢任务。
2. 顶部出现「内置任务」分组，「小红书自动采集」**默认关闭**，徽标为「内置」。
3. 内置任务开关**不该置灰**（采集已改为插件编排，不再限 macOS）。没装 RedClaw 插件或插件没连上桌面时，就绪检查会红，但开关外观仍可点；开不起来是门禁，不是置灰。

### 4.2 只点 UI，不发聊天、不跑采集【已验证】

这一层只点界面，不发聊天、不跑采集。不需要 computer-use。

1. 点内置任务「配置」，填写：采集关键词（必填，逗号分隔）、单轮最多保存笔记数（默认 5，范围 1–20）、采集节奏（默认保守）、每天执行时间（默认 10:00）。**没有** Chrome Profile / computer-use MCP 字段，找不到是预期。
2. 点「检查就绪状态」，核对这 3 项：

   | 检查项 | 通过条件 |
   |---|---|
   | 采集关键词 | 至少 1 个 |
   | 浏览器插件桥接 | 至少 1 个 RedClaw 插件实例已连接 |
   | 浏览器登录态 | 插件未上报 `BROWSER_LOGIN_REQUIRED` / `BROWSER_SECURITY_CHALLENGE` |

3. 任一项未通过时，开关应**无法开启**，并给出对应修复指引。
4. 自动化页表单新建一条普通任务 → 徽标应为「手动创建」；能编辑、暂停。**先别删**，后面还要用。

#### 4.2 实测结论（2026-08-25）【已验证】

配置页、就绪检查、手动任务「自测-手动创建1」（徽标「手动创建」、可暂停）已通过。当时就绪项还含 computer-use，现已删掉，回归时按上面 3 项核对即可。

### 4.3 聊天小动作，不建定时任务【待你验证】

这次补齐了 PiChatService 侧此前被静默放行的工具确认链路——原实现里 `chat:confirm-tool` 只路由到旧版 `AgentExecutor`，PiChatService 路径下所有 confirm 都被静默通过。补桥接的同时用结构化标记把阻塞范围收敛了，需要确认收敛生效。

这一层只测**负向**（不该弹的不要弹）。在聊天里各触发几次：

- **不应该**弹确认：普通 `bash`、`settings` 读写、`mcp call`、知识库查询等既有调用

确认没有出现大面积弹窗。这是波及面最广、最容易误伤的地方。若已经大面积弹窗，先停，不要继续 4.4。

应该弹确认的动作放到 4.4，跟对话建任务一起看。

### 4.4 对话创建任务【已验证】

在聊天里发：

```text
每天早上 9 点帮我采集猫粮相关的爆款笔记并出一份选题建议
```

**预期流程**：

1. AI 先复述任务名、触发频率、将要执行的完整 prompt，信息不足会追问；
2. 弹出**确认卡**（`redclaw schedule-add / schedule-remove / long-add / long-remove`、`work schedule-add / cycle-add` 被显式声明为需要人工确认），展示任务名 / 频率 / prompt 摘要；
3. 点确认后才真正落库，并回显下次运行时间；
4. 聊天里出现任务卡片，可直接暂停 / 立即运行 / 跳转自动化页；
5. 自动化页该任务带「对话创建」来源徽标，并能编辑 / 启停（两侧是同一份数据）。

**负向用例**：

- 点「取消」→ 任务**不应**落库，自动化页看不到；
- 确认卡挂着不动超过 3 分钟 → 自动取消（阈值是实现时定的，觉得不合适可以调）；
- 刷新 / 切页面后回到该会话，任务卡片应从持久化链路重新渲染出来（不只是实时事件）。

测的时候记一下模型走的是 `redclaw schedule-add` 还是 `work schedule-add`。漂亮确认卡和聊天任务卡是按 `redclaw` 这条路径做的；如果走 `work`，可能只有通用确认、没有任务卡。这不一定是失败，记实际路径即可。

#### 4.4 实测结论（2026-08-25）【已验证】

主路径通过，实际走 `work schedule-add`：通用「确认执行 App CLI」卡 → 确认后落库，每天 09:00，自动化页「猫粮爆款笔记采集与选题建议」徽标为「对话创建」。没有专用任务卡，按文档不算失败。负向（取消不落库、刷新后卡片）当时跳过。这条是普通定时 prompt，**不是**内置采集，本轮不再用它验收入库。

### 4.5 门禁与真采集【已验证】

内置「小红书自动采集」由桌面编排、插件执行，**不截图、不接管键鼠**：

```
research.run search/preview → 页内搜索框 DOM 提交，收集卡片
research.run open_item      → 结果页内点击打开笔记（不直开 URL）
capture.save                → 与侧栏「保存笔记」相同：save-xhs → ingestXhsEntryV2
research.run close_item     → 关掉浮层，回到结果页
```

**前置准备**：

1. Chrome 已登录小红书，RedClaw / Bojin 插件已启用，原生消息通道连通（就绪检查「浏览器插件桥接」为绿）。
2. 改过 `Plugin/` 源码后，到 `chrome://extensions` **刷新扩展**，否则桌面仍在打旧插件。
3. 配置至少一个关键词（如 `猫粮`），`maxNotesPerRun` 建议先填 3。

**4.5.1 就绪门禁【待你验证回归】**

开启内置任务后，故意拆掉一项前置（关掉插件或清空关键词），再点「立即运行」。

**预期**：本轮跳过并记录原因，而不是硬跑失败。

**4.5.2 真采集【已验证】**

就绪 3 项通过后，开启开关 → 点「立即运行」。看结构化小结，不要看键鼠演示：

| 要看的 | 预期 |
|---|---|
| 搜索 | 在已登录浏览器的小红书页内搜，不新开 Google NTP、不走地址栏拼搜索 URL |
| 打开笔记 | 结果页内点击卡片；同一 `noteId` 只打开一次 |
| 入库 | 走插件「保存笔记」；知识库出现新条目 |
| 配额 | 只计**新入库**；已有笔记（含仅更新）记重复，不占条数 |
| 不够条 | 同一结果页继续滚动翻页，不另开搜索标签凑数 |
| 登录墙 / 验证码 | 结构化停止，不绕过 |
| 小结 | 关键词、尝试数、新入库、重复、失败原因 |

#### 4.5.2 实测结论（2026-08-28）【已验证】

手动跑一轮「猫粮」：尝试 6、新入库 3、重复 2、失败 1（`item_open_timeout`）。同一标题没有入库两次。更新旧笔记会显示「已存在（已更新，不计入新入库）」。

**4.5.3 Bojin 标签 / 调试复用【已验证】**

同一浏览器里连续点两次「立即运行」（或隔几分钟再跑一轮）：

| 要看的 | 预期 |
|---|---|
| 搜索标签 | 复用已有「… - 小红书搜索」标签，不每轮新建一个 |
| 分组 | 仍是**同一个**紫色 Bojin 分组，不并排出多个同名组 |
| 调试条 | Chrome 顶栏「Bojin 已开始调试此浏览器」可保持；已挂上的调试器应复用，不应每轮对新标签再 attach 一次 |
| 笔记详情 | 不会把正在看的 `/explore/{id}` 详情页拿去当搜索页 |

回归前可先手动关掉多出来的重复搜索标签，只留一个。改插件后必须先刷新扩展。

#### 4.5.3 实测结论（2026-08-28）【已验证】

复用逻辑已落地：无 `tabId` 时先 `listTabs` 挑可复用的小红书搜索/首页；agent 可接管僵尸 session 的 lease；新标签并入已有 Bojin 组。用户确认新任务不再每次新建监控。

**4.5.4 新笔记 embedding（不补旧）【已验证】**

设置 → 向量：百炼 Endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen3.7-text-embedding`。本轮**不**给以前没建成功的旧笔记补索引。

新入库笔记日志应出现 `Indexed … (n chunks)`，不要再出现打到 `/embeddings` 的 `404 page not found`（那是 Endpoint 缺 `/v1`）。保存设置后不必重启应用。

#### 4.5.4 实测结论（2026-08-28）【已验证】

中转 `api.gptsapi.net` 缺 `/v1` 会 404；改百炼后模型名曾被当成聊天模型，已修。10:54 日志 `Indexed … (1 chunks)`。旧笔记不补建。

## 5. 已知风险速查

跑测时遇到下面这些，属于已记录的风险，不必当作新 bug 排查：

| 现象 | 说明 | 处置 |
|---|---|---|
| **`bojin-speech` / `bojin-asr-plus` 返回 `not implemented` / `convert_request_failed`** | **已实测**：上游渠道为百炼时，new-api 无法把 OpenAI `/audio/speech`、`/audio/transcriptions` 转成百炼协议；百炼兼容模式本身也无 speech 端点 | **跳过网关 TTS/ASR**；应用内改百炼/DashScope 直连。若坚持走私有网关，需换 MiniMax 等已适配渠道，或等 new-api 补齐百炼 audio |
| **`bojin-video-H3` 报「请使用 /v2/video_generation」** | **已实测**（`code: 2013`）：MiniMax-H3 是 V2 独有，new-api hailuo 走 V1 | 跳过网关 H3；改用 MiniMax 直连服务商兜底 |
| 参考图生视频失败且参考图是本地文件 / data URL | 阿里 r2v 只接受它能下载的 HTTPS | 启用 GitHub 图床（默认 `cdn.jsdmirror.com`）；不要用 GitHub Raw 或官方 jsDelivr |
| 图床已上传仍报 `Failed to download raw.githubusercontent.com` | 阿里云拉不下 GitHub Raw | 公开访问方式改成国内镜像，或让客户端重写 Raw → jsdmirror |
| 图床走 `cdn.jsdelivr.net` 报 `Model not exist` | 官方 jsDelivr 对阿里云等于无效参考图 | 改用 `cdn.jsdmirror.com` |
| 轮询解析不到视频 URL | new-api 版本差异，`result_url` 需 ≥ v0.11.0 | 客户端已做三级兜底；确认网关版本 |
| TTS 音色异常 | `voice=alloy` 在 MiniMax 上游无对应音色（仅当 TTS 渠道改为 MiniMax 后才相关） | 网关渠道参数覆盖固定 voice，或在 voiceTts 路由里选音色 |
| 向量检索结果异常 | embedding 换模型后维度变了 | **本轮不补旧笔记**；只确认新入库能 Indexed。若要坚持旧索引可用，再全量重建 |
| embedding `404 page not found` | Endpoint 缺 `/v1`（例如中转打到 `/embeddings` 而不是 `/v1/embeddings`） | 百炼填 `…/compatible-mode/v1`；保存后即时重读配置，不必重启 |
| 设置里选不到 `qwen3.7-text-embedding` | 名字里的 `qwen3` 曾被当成聊天模型 | 已按 embedding 名称优先识别；回归时向量下拉应能选到 |
| 每次采集都新开「Bojin」搜索标签 / 新分组 | 旧插件每次 `tabs.create` + 新建 tab group | 刷新扩展；关掉多余搜索标签后再跑，应复用 |
| 同一笔记入库两次 / 更新被当成新笔记 | 曾按完整 URL 去重，且 `allowUpdate` 返回 updated 而非 duplicate | 已按 noteId 去重，配额只计新入库；回归看小结里的重复数 |
| computer-use 就绪检查字段读不到 | 仅当任务仍走 computer-use 键鼠时相关；**内置采集已不走这条** | 内置任务忽略此项 |
| 点「立即运行」浏览器停在 Google 新标签页 + DevTools | 旧 computer-use `Cmd+L` 抢焦点问题；**内置采集已不走 `computer_browser_open_url`** | 若仍出现，先确认跑的是内置任务而不是对话创建的普通 prompt；插件未刷新也会表现成旧行为 |

## 6. 尚未实现的项

方案第 4 节的这几项可选增强本次没做，测试时不用找：执行历史持久化、采集后处理任务链、全局紧急停止、空闲检测。

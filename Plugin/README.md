# GardenFlow 浏览器扩展

`Plugin/` 是 GardenFlow 的 Manifest V3 采集与浏览器控制扩展，支持 Chrome、Edge 和 Brave。它负责用户触发的网页采集、结构化小红书内容保存、页面检查和受控浏览器操作。

## 构建

```bash
pnpm --dir Plugin install --frozen-lockfile
pnpm --dir Plugin build
pnpm --dir Plugin check
```

产物位于 `Plugin/dist/extension/`。在浏览器扩展管理页开启开发者模式，选择“加载已解压的扩展程序”并指向该目录。

## 与桌面端连接

1. 启动 GardenFlow。
2. 打开“设置 → 浏览器插件”。
3. 点击“准备浏览器插件”。
4. 重启浏览器，打开扩展侧栏并检查连接状态。

桌面应用安装当前 Native Messaging Host `com.gardenflow.browser_control`。Host 通过 Unix Domain Socket 或 Windows Named Pipe 连接本机 Desktop Bridge，不监听 TCP 端口。

## 采集能力

- 小红书列表、笔记详情、图片、视频元数据和评论的结构化采集；
- 京东、淘宝／天猫当前商品和已选规格预览，图片本地化、评论采样、来源快照与复采更新；
- 配合桌面端的京东、淘宝及天猫关键词／批量／定时采集任务；
- 通用网页正文提取和可读性清洗；
- 图片与 YouTube 页面保存入口；
- typed browser capabilities，用于打开、检查、点击、输入和结束受控标签页；
- operation ID 去重与连接恢复。

京东采集兼容旧版和新版商品组件，按商品区域提取名称、品牌、店铺、当前规格、价格及参数，并区分主图和详情图。详情内容尚未加载时，先在京东展开商品详情，再点“重新识别”。旧资料库条目会显示商品预览；重新采集后可读取对应的新版商品快照。

淘宝／天猫自动任务从首页的搜索框提交关键词，只读取可见真实商品卡片，再用与侧栏一致的 `capture.save` 保存商品。默认评论采当前评价列表 5 条，可选择真实标签、每标签 1–50 条；商品来源按实际详情页识别。任务检查详情商品编号，遇到登录、验证或限流立即停止；评论受限时保留已读商品。详见[使用手册的自动化说明](../Docs/USER_MANUAL.md#7-自动化)。

任务搜索标签的自动清理仍有授权衔接缺口。检查报告后手动关闭遗留的本次任务标签，保留原有页面；不要将采集保存成功等同于标签清理完成。

天猫详情支持 `detail.tmall.com` 和天猫超市的 `chaoshi.detail.tmall.com`。同编号跳到天猫超市时继续按 `tmall` 保存；普通天猫与天猫超市的同一编号复采追加原商品快照，淘宝来源仍独立。搜索卡片、侧栏识别、采集及桌面入库均需更新后生效。来源域名与商品编号仍严格校验，图片仍仅允许平台图片服务。

编号不一致的候选拒绝保存并跳过，桌面端在原有尝试预算内继续补足目标。插件返回 `BROWSER_PRODUCT_IDENTITY_MISMATCH`，错误仅记录搜索编号、实际编号和页面域名／路径，不包含完整导航参数。连续两个其他错误停轮时展示真实原因；已保存但新增目标未满的任务显示“部分完成”，详情见采集报告。需同时更新并重启桌面端、重新加载采集插件，才能使用新的分类和任务状态。

保存淘宝／天猫商品时，对尚未读取的价格、参数和详情增加最多 6 秒的等待及有限滚动，兼容详情页内部滚动容器。评价区域或“查看全部评价”入口尚未加载时，再用独立的最多 6 秒预算查找入口；仍缺失的字段和评论会明确提示，批量报告标为“采集不完整”。“店铺活动”等孤立界面标题不再保存为商品描述。更新插件并在 Chrome 扩展页重新加载后，复采会为原商品追加快照；已有缺失快照不会自动补齐。

自动采集打开详情时使用搜索卡片提供的完整 `navigationUrl`，保留 `mi_id`、`pvid`、`scm`、`spm`、`utparam`、`xxc` 等原有参数和片段，不再用仅含商品编号和 SKU 的地址替代。规范化 `sourceUrl` 继续用于去重和来源记录；导航地址须与它的域名、商品编号及已声明 SKU 一致。相同商品的多个卡片链接优先保留参数更完整的原始链接。导航上下文不作为价格或商品事实。此次修复同时涉及桌面端和采集插件，开发版需重启并重新加载插件，安装版使用最新包及配套插件。

扩展不申请 `cookies` 权限，不读取 `document.cookie`。页面内容仅在用户手动采集或开启并配置自动采集任务后发送给本机 GardenFlow。

## 诊断与隐私

扩展错误记录保存在 `chrome.storage.local`：

- 最多 40 条；
- 同类错误有冷却和计数合并；
- Cookie、Token、Key、网页正文、HTML、媒体 payload、URL 细节与本机路径会被脱敏；
- 不自动上传，也没有反馈服务器；
- 只有点击侧栏“导出诊断”才生成本地 JSON 文件。

## 命令

| 命令 | 用途 |
| --- | --- |
| `pnpm --dir Plugin check` | 构建、校验、类型检查和回归测试 |
| `pnpm --dir Plugin test:marketplace-search` | 淘宝／天猫搜索、采集身份与任务页面清理回归 |
| `pnpm --dir Plugin test:taobao-product` | 淘宝／天猫详情、规格、价格和评论采样回归 |
| `pnpm --dir Plugin test:jd-product` | 京东新旧布局、字段回退、图片去重及保存入口回归 |
| `pnpm --dir desktop exec node --test tests/brandWorkspaceStore.test.ts` | 商品快照持久化、部分重采集及用户编辑保护回归 |
| `pnpm --dir Plugin diagnose:browser-control` | 检查扩展、Host 与 Desktop Bridge 状态 |
| `pnpm --dir Plugin smoke:browser-control` | 执行本机浏览器控制冒烟测试 |
| `pnpm --dir Plugin mcp:server` | 启动 stdio MCP server |

## 安全约定

- 新 capability 必须定义名称、输入 schema、权限边界和错误结构。
- 任何页面脚本输入都视为不可信数据。
- 不在 console、Native Host stdout 或诊断中记录采集 payload。
- 不添加硬编码远端诊断、网关或内部地址。
- 修改 Native Messaging 或 browser control 后运行 `pnpm test` 与 `pnpm --dir Plugin check`。

通用采集设计见 [generic-web-capture-architecture.md](./docs/generic-web-capture-architecture.md)。

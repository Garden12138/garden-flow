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
- 通用网页正文提取和可读性清洗；
- 图片与 YouTube 页面保存入口；
- typed browser capabilities，用于打开、检查、点击、输入和结束受控标签页；
- operation ID 去重与连接恢复。

扩展不申请 `cookies` 权限，不读取 `document.cookie`。页面内容只在用户明确采集时发送给本机 GardenFlow。

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

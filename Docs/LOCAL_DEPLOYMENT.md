# 本地开发与部署

## 环境

- Node.js 22
- pnpm 10.28.2（建议通过 Corepack 管理）
- Git
- 当前平台的原生模块构建工具

macOS：

```bash
xcode-select --install
corepack enable
```

Windows 建议安装 Visual Studio Build Tools 的 Desktop development with C++ 工作负载。Linux 需准备 Electron 与原生模块所需的常见编译和图形库。

## 安装与启动

```bash
git clone https://github.com/Garden12138/garden-flow.git
cd garden-flow
pnpm run setup
pnpm dev
```

`setup` 使用 frozen lockfile 安装根目录、`Plugin/`、`PublishPlugin/` 和 `desktop/` 依赖。`dev` 同步品牌文件、准备扩展和 Native Host、同步 prompt library，然后启动 Vite 与 Electron。

如果只调试 renderer：

```bash
pnpm --dir desktop exec vite build
pnpm --dir desktop preview
```

浏览器预览无法使用 Electron IPC，完整功能应在桌面开发进程中验证。

## 首次配置

首次启动创建当前 GardenFlow userData、`gardenflow.db` 和默认空间。应用不会连接默认 AI 网关。打开“设置 → AI 服务”：

1. 添加 OpenAI、Anthropic、Gemini、本地或自定义供应商。
2. 填写 Endpoint、API Key 和模型；本地供应商允许空 Key。
3. 保存并选择文本路由。
4. 按需配置图片、视频、音频和 Embedding 路由。
5. 使用设置页的连接检查，再进入工作台运行一次最小任务。

示例本地 OpenAI-compatible Endpoint：

```text
http://127.0.0.1:11434/v1
```

不要把真实 Key 写入 `.env` 示例、截图、Issue 或提交记录。

## 浏览器扩展

```bash
pnpm build:plugin
```

在 Chromium 扩展管理页加载：

- `Plugin/dist/extension/`：采集与浏览器控制；
- `PublishPlugin/dist/extension/`：发布辅助。

回到 GardenFlow 的浏览器插件设置，点击“准备浏览器插件”。应用会为当前 `com.gardenflow.browser_control` Host 写入对应浏览器 manifest。

## 调试

- renderer：Vite DevTools 与浏览器控制台。
- main：启动终端输出；设置页可启用本地详细日志。
- SQLite：先退出应用，再用只读工具检查 `gardenflow.db`。
- 浏览器连接：`pnpm --dir Plugin diagnose:browser-control`。

`GARDENFLOW_HOLD_AUTOMATION=1 pnpm dev` 可在调试数据或 UI 时暂停后台自动化。

## 数据备份

退出应用后同时备份：

1. 当前 GardenFlow userData 中的 `gardenflow.db`；
2. 用户选择的 workspace，包括 `.gardenflow`；
3. 需要保留的本地媒体与自定义 Skill。

恢复时保持原有目录结构和文件权限。不要在应用运行时复制正在写入的 SQLite 文件。

## 质量检查

```bash
pnpm check
pnpm test
pnpm build
```

完整验收清单见 [TESTING.md](./TESTING.md)，安装包说明见 [PACKAGING.md](./PACKAGING.md)。

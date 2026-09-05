# Contributing to GardenFlow

感谢你帮助 GardenFlow 变得更可靠、更易用。仓库接受缺陷修复、测试、文档、性能改进和与产品方向一致的新能力。

## 开始之前

1. 阅读 [README](./README.md)、[架构](./Docs/ARCHITECTURE.md) 和[许可证](./LICENSE)。
2. 搜索已有 Issue，避免重复讨论。
3. 大型功能先创建功能建议，说明用户问题、范围、数据影响和 UI 草图。
4. 安全漏洞不要创建公开 Issue，请按 [SECURITY.md](./SECURITY.md) 报告。

提交贡献即表示你有权提供这些内容，并同意贡献按本仓库的非商业源码开放许可证分发。第三方代码必须保留其许可证与 attribution。

## 开发环境

使用 Node.js 22 和 pnpm 10.28.2：

```bash
corepack enable
pnpm run setup
pnpm dev
```

不要提交 API Key、Cookie、Token、个人绝对路径、真实联系人、私密 workspace 或生成目录。

## 代码约定

- TypeScript/TSX 使用 4 空格、分号和单引号，并遵循相邻文件风格。
- 页面组件位于 `desktop/src/pages/`，组件名使用 PascalCase。
- IPC 必须同时更新主进程 handler、领域 bridge、类型和测试。
- 文件系统输入必须规范化并限制在允许根目录。
- AI 路由使用结构化 metadata、mode 和工具 contract；不要用消息关键词猜测用户意图。
- 数据库 schema 变更必须幂等并有测试。
- 不引入隐藏网关、共享密钥、账号权益或自动遥测。

## 提交前验证

```bash
pnpm check
pnpm test
pnpm --dir desktop exec vite build
```

涉及桌面 UI 时，请在真实 Electron 运行时完成对应页面漫游。涉及截图时遵循 [测试文档](./Docs/TESTING.md) 的脱敏规则。

## Pull Request

PR 描述应包含：

- 用户问题和解决方案；
- 影响的目录与公共接口；
- 测试命令和结果；
- 数据、隐私或网络行为变化；
- UI 变更前后截图；
- 未完成事项或已知限制。

保持 PR 聚焦，不混入格式化整个仓库或无关重构。不要改写共享分支历史。

# [Docs] 补充 Skills 使用指南和最小示例

草稿；建议标签：`documentation`、`help wanted`。

## 问题

Skills 加载、发现和激活已有实现，但缺少一个普通贡献者可以验证的最小示例与能力边界说明。

## 实现入口

- [skillLoader.ts](../../desktop/electron/core/skillLoader.ts)：目录发现、frontmatter 和字段解析。
- [skillManager.ts](../../desktop/electron/core/skillManager.ts)：发现顺序、覆盖和启停状态。
- [skillTool.ts](../../desktop/electron/core/tools/skillTool.ts)：技能激活工具。
- [内置技能检查脚本](../../desktop/scripts/check-builtin-skills.mjs)：现有验证方式。

## 交付

新增使用文档与一个“核对介绍稿来源”的纯文本技能示例。写清用户目录、项目目录、现有发现顺序、如何确认加载、如何激活与移除；不依赖密钥、不写入用户资料、不访问外网。引用代码中实际支持的字段，不照搬其他产品的字段约定。

## 验收

在临时项目目录加入示例，验证发现、激活后内容可用、移除后不再发现；覆盖缺少文件、无效 frontmatter 的诊断说明。记录当前实际入口，不能以旧 UI 组件代替可用操作。运行 `pnpm check:docs`；若改动内置技能，再运行 `pnpm --dir desktop check:skills`。

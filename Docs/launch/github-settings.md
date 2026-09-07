# GitHub 展示配置

仓库：[Garden12138/garden-flow](https://github.com/Garden12138/garden-flow)

## 当前状态

| 配置 | 状态 |
| --- | --- |
| Description | 已核对并保留当前版本 |
| 15 个 Topics | 已应用并通过 GraphQL 回读确认 |
| Discussions | 已启用；欢迎帖仍是草稿 |
| v0.0.1 Release 说明 | 已更新，并加入本次真实媒体验证与已知显示问题 |
| Social Preview | 已上传自定义图片；GraphQL `usesCustomOpenGraphImage` 回读为 `true` |

## About

保留现有 Description：

> Local-first AI workspace that turns research into content — collect, organize, ideate, write, generate media and automate.

Topics：`ai`、`llm`、`local-first`、`ai-agent`、`ai-writing`、`content-creation`、`creator-tools`、`knowledge-base`、`rag`、`multimodal`、`mcp`、`electron`、`typescript`、`browser-extension`、`xiaohongshu`。

Homepage 暂不设置；本轮不建设官网。

## Discussions

Discussions 已启用。当前 GitHub 自动创建了 Announcements、General、Ideas、Polls、Q&A、Show and tell 六个空分类；公开 API 不提供分类改名或删除能力。通过仓库设置页整理时只保留以下三个使用入口：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| 公告 | Announcement | 版本、教程与维护者更新 |
| 使用问答 | Question / Answer | 首次体验、模型和插件配置 |
| 作品分享 | Open-ended discussion | 展示工作流、公开产物和使用心得 |

缺陷和具体功能请求继续使用现有 Issues。欢迎帖使用[草稿](./welcome-discussion.md)，不自动发布。已有讨论不得因调整分类而被删除。

## Social Preview

制作 1280 × 640、低于 1 MB 的图片，包含品牌、定位和未经改写的真实界面。设置位置：仓库 Settings → General → Social preview → Edit → Upload an image。

当前自定义预览已上传，源文件为 [`images/social-preview.png`](../../images/social-preview.png)，1280×640、低于 1 MB；可编辑源为 [`branding/social-preview.svg`](../../branding/social-preview.svg)。

## 发布前链接检查

README、教程和图片需要先合并到默认分支。保持 Release 已上线的安装包下载链接，不让发行说明依赖尚未合并的文件。完整教程上线后再补充其外链。

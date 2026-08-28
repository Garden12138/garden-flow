---
name: xhs-auto-capture
description: 小红书自动采集操作规程。桌面编排插件页内搜索、站内点击打开笔记，再调用与侧栏「保存笔记」相同的 capture.save（save-xhs）入库，全程结构化、无视觉坐标。
when_to_use: 由内置自动化任务「小红书自动采集」在后台执行时加载；用户询问该任务原理时也可加载。
allowed-tools: app_cli
---

# 小红书自动采集操作规程

本任务由**运行时结构化执行**，不依赖模型操作键鼠、不截图猜坐标。执行链路：

```
桌面 Bojin ── Desktop Bridge ── native host ── RedClaw 插件（已登录浏览器）
   │                                              │
   │  research.run search/preview                 │  页内搜索框提交，收集卡片
   │  research.run open_item                      │  结果页内点击打开笔记
   │  capture.save（同「保存笔记」）               │  save-xhs → ingestXhsEntryV2
   │  research.run close_item                     │  关闭浮层/详情，回到结果页
   │◀──────────── 结构化结果（entryId / duplicate）─┘
```

## 每轮流程

1. 检查插件桥接：必须有已连接的 RedClaw 插件实例（即人已打开并登录小红书、启用插件的那个浏览器）。
2. `research.run { operation: 'search', depth: 'preview' }`：插件在小红书入口页用**页面里的搜索框**提交搜索（DOM 提交，非地址栏），滚动收集笔记卡片。卡片数会大于本轮配额，方便遇到重复后续翻。
3. 逐条打开并保存，直到**新入库**达到 `maxNotesPerRun`，或结果页翻尽：
   - `research.run { executionMode: 'open_item' }` 在结果页内点击打开笔记（不直开 URL）；
   - `capture.save` 触发与侧栏红色「保存笔记」相同的 `save-xhs` 采集，写入知识库（`ingestXhsEntryV2`）；
   - 知识库已有（含仅更新旧笔记）不计入配额，关掉后继续找下一条；未凑满时在同一结果页继续滚动翻页；
   - `research.run { executionMode: 'close_item' }` 关闭笔记，回到搜索结果。
4. 结束输出结构化小结：关键词、尝试数、新入库数、重复数、失败明细。

## 停止与安全边界

- 插件在 DOM 里检测到登录表单 / 安全验证时，会结构化上报 `login_required` / `security_verification_required`，任务**如实停止**，绝不尝试绕过。
- 只读采集：不发布、不评论、不点赞、不收藏、不私信、不修改账号设置。
- 完成判定以**知识库真实新增的 entryId** 为准；全部重复视为流程跑通但无新增。

## 排查

- readiness 显示「浏览器插件桥接」失败：打开采集浏览器并确认插件已启用、原生消息通道连通。
- 搜索结果为空：确认关键词有效；小红书页面结构变化时需要更新插件的站点提取器。
- 打开了笔记但知识库没有新条目：确认插件已更新到包含 `capture.save` 的版本，并重新加载扩展。
- 入库结果可用 `app_cli(command="knowledge list --source redbook --limit 5")` 复核。

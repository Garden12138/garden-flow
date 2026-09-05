# Renderer features

`features/` 按产品能力组织可复用的页面逻辑，例如应用壳、采集、知识、媒体生成、设置与结构化稿件。跨进程调用统一通过 `desktop/src/bridge/`，共享数据契约放在 `desktop/shared/`。

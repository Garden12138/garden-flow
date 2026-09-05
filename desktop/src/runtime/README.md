# Renderer runtime

renderer runtime 消费主进程发出的结构化会话事件，负责顺序校验、状态归并、页面订阅和运行恢复。协议真相由 shared contract 与主进程 runtime 定义；消费层不根据消息文本猜测任务类型，也不承担页面 UI 编排。

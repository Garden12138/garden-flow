# Shared contracts

此目录包含 Electron main、renderer 和 Node.js 测试共同使用的纯数据 contract，例如当前品牌身份、本地资源 URL、模型 profile 和媒体供应商能力。

共享模块不得依赖 DOM 或 Electron 实例，不保存环境别名，也不转换其他产品的存储键、协议或目录。

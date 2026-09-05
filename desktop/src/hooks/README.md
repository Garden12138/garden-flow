# Hooks

这里放跨页面复用的 renderer hooks。页面独有状态应留在页面或对应 `features/` 模块；涉及 Electron 能力时通过 typed bridge 调用，不直接导入主进程代码。

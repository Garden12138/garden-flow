# Renderer bridge

`desktop/src/bridge/` 是 renderer 访问 Electron 主进程的唯一入口。

- `core.ts`：发送、监听、超时和返回值规范化。
- `ipcRenderer.ts`：组合所有当前领域 bridge 并安装 `window.ipcRenderer`。
- `domains/`：按 spaces、knowledge、chat、generation、runtime、settings 等业务域定义 typed facade。
- `types.ts`：bridge 内部公共类型。
- `fallbacks.ts`：只保留明确的 Host 不可用错误，不制造伪数据或伪成功结果。

新增或修改调用时同步更新：

1. `desktop/electron/appMain.ts` 中的 IPC handler；
2. 对应 `domains/*Bridge.ts`；
3. `desktop/src/types.d.ts`；
4. parity 检查与行为测试。

缺失 handler 应被视为实现错误。不要用空数组、匿名账号或隐藏默认配置掩盖能力缺失。

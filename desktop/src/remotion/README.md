# `src/remotion/`

本目录是 Remotion 的 React 入口，负责定义渲染根组件和 composition 组装。

## Entry Points

- [index.ts](index.ts)
- [Root.tsx](Root.tsx)

## Relationship

- 渲染入口由 `index.ts` 注册，composition 在 `Root.tsx` 组装。
- 编辑器侧协议在 `src/components/manuscripts/remotion/`
- 稿件编辑器状态在 `src/components/manuscripts/ManuscriptEditorHost.tsx`

## Rules

- Composition 输入应来自稳定协议，不直接绑页面内部临时状态。
- 路径、素材、比例和导出模式变化要同步验证 CLI 渲染脚本。

export type DragDropEvent =
  | { type: 'enter'; paths: string[]; position?: { x: number; y: number } }
  | { type: 'over'; position?: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position?: { x: number; y: number } }
  | { type: 'leave' };

type DragDropListener = (event: { payload: DragDropEvent }) => void;

const currentWindow = {
  async setTheme(_theme: 'light' | 'dark' | null): Promise<void> {
    // Electron applies the renderer theme through CSS variables. No native
    // window theme bridge is needed for this compatibility layer.
  },
  async onDragDropEvent(_listener: DragDropListener): Promise<() => void> {
    // Electron uses the renderer's HTML5 drag/drop handlers.
    return () => {};
  },
};

export function getCurrentWindow() {
  return currentWindow;
}

// Bridge exposed by electron/preload.cjs. Absent in the browser build.
interface Window {
  stratumDesktop?: {
    isDesktop: true;
    invoke: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>;
    info: () => Promise<{ dbFile: string; version: string; pdf: boolean }>;
    onOpenFile: (callback: (file: { name: string; bytes: Uint8Array }) => void) => () => void;
  };
}

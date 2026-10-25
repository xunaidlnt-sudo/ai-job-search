// Bridge exposed by electron/preload.cjs. Absent in the browser build.
interface Window {
  stratumDesktop?: {
    isDesktop: true;
    onOpenFile: (callback: (file: { name: string; bytes: Uint8Array }) => void) => () => void;
  };
}

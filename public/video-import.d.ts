export {};
declare global {
  var SpritedVideo: {
    open(options: { onImport: (frames: { src: string; time: number; duration: number }[], name: string, signal: AbortSignal) => Promise<void> }): void;
  };
}

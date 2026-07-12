// The typed API the preload script exposes on the renderer's window.
import type { GenesisApi } from '../preload/ipc.js';

declare global {
  interface Window {
    genesis: GenesisApi;
  }
}

export {};

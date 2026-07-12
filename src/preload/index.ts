// Preload: exposes a minimal, typed API on window.genesis via contextBridge. No Node APIs
// leak to the renderer; only the command sender and snapshot subscription cross the bridge.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GenesisApi, type SimCommand, type Snapshot } from './ipc.js';

const api: GenesisApi = {
  send(command: SimCommand): Promise<void> {
    return ipcRenderer.invoke(IPC.command, command) as Promise<void>;
  },
  onSnapshot(handler: (s: Snapshot) => void): () => void {
    const listener = (_e: unknown, s: Snapshot): void => handler(s);
    ipcRenderer.on(IPC.snapshot, listener);
    return () => ipcRenderer.removeListener(IPC.snapshot, listener);
  },
};

contextBridge.exposeInMainWorld('genesis', api);

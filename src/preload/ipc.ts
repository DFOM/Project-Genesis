// The IPC contract between renderer and main. Kept in the preload layer (the bridge). The
// renderer imports these types + the Snapshot type; it never reaches engine logic, the
// store, or the orchestrator directly.
import type { Snapshot } from '../engine/snapshot.js';

export type { Snapshot };

// Commands the renderer sends to the main process to drive the sim (Play/Pause/Step/etc).
export type SimCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; ticksPerSecond: number }
  | { type: 'reset' }
  | { type: 'fork'; atTick: number };

export const IPC = {
  command: 'genesis:command', // renderer → main (invoke)
  snapshot: 'genesis:snapshot', // main → renderer (event)
} as const;

// The API surface exposed on window.genesis by the preload script.
export interface GenesisApi {
  send(command: SimCommand): Promise<void>;
  onSnapshot(handler: (s: Snapshot) => void): () => void; // returns an unsubscribe fn
}

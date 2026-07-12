// Public engine surface for the referee / orchestrator / store / ui. (Agents do NOT import
// this — they import only ./contract, enforced by lint + dependency-cruiser.)
export * from './contract.js';
export * from './types.js';
export * from './events.js';
export { seedRng, nextRng, randInt, shuffle, type RngState } from './rng.js';
export { applyEvent } from './reducer.js';
export { buildWorld } from './genesis.js';
export { perceive, inDistress, totalHeld } from './perceive.js';
export { serialize } from './serialize.js';
export { snapshot, type Snapshot, type SnapshotNode, type SnapshotAgent } from './snapshot.js';
export * as config from './config.js';

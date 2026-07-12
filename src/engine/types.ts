// Engine-internal world state. NOT importable by agents (they get only `Perception`).
// Every scalar is an integer for cross-machine-safe canonical hashing.
import type { Action, ItemType } from './contract.js';
import type { RngState } from './rng.js';

export type Terrain = 'plain' | 'hill' | 'water' | 'field';

export type Inventory = Record<ItemType, number>;

// A dropped-item stack resting on a tile (per-tile, keyed by item). Absent items = 0.
export type Ground = Partial<Record<ItemType, number>>;

export interface Vec {
  x: number;
  y: number;
}

export interface Agent {
  id: string;
  pos: Vec;
  inventory: Inventory;
  satiation: number;
  hydration: number;
  energy: number;
  health: number;
  alive: boolean;
  // How long (ticks) each need has been at 0 — used to pick the death cause. Not perceived.
  starvingTicks: number;
  dehydratingTicks: number;
}

export interface ResourceNode {
  pos: Vec;
  item: ItemType;
  stock: number;
  max: number;
  regen: number;
}

export interface World {
  tick: number;
  size: number;
  terrain: Terrain[]; // size*size, row-major
  nodes: ResourceNode[]; // canonical order: sorted by (y, x)
  ground: Ground[]; // size*size, row-major — dropped items
  agents: Agent[]; // canonical order: sorted by id
  rng: RngState;
}

export interface RunConfig {
  seed: number;
  agentCount: number;
}

export function idx(size: number, x: number, y: number): number {
  return y * size + x;
}

// A proposed action tagged with its actor. Agents return bare Action[]; the orchestrator
// attaches the agent id before handing proposals to the referee.
export interface ProposedAction {
  agentId: string;
  action: Action;
}

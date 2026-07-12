// Named constants for the world + simulation. Tuning lives here so a balance change is
// one edit and can never touch determinism logic. All values are INTEGERS.

export const WORLD_SIZE = 64; // 64×64 tiles

export const PERCEPTION_RADIUS = 5; // an agent sees its tile + this many tiles in each direction

export const INVENTORY_CAPACITY = 20; // max total items an agent can hold

// ── Map bands (rows) ─────────────────────────────────────────────────────────
// Deliberately non-uniform, and grain (food) vs water (drink) are SEPARATED so no tile
// is self-sufficient. They share a productive seam near y=GRAIN..WATER border: an agent
// there can, within PERCEPTION_RADIUS, alternately see grain and water and survive by
// shuttling. Agents far from the seam die — that is the intended partial die-off.
export const ORE_BAND_MAX_Y = 21; // y < 21  → north: ore (hills)
export const GRAIN_BAND_MAX_Y = 43; // 21 ≤ y < 43 and x ≥ GRAIN_MIN_X → grain (fields)
export const GRAIN_MIN_X = 32; // grain only in the eastern half of its band
// y ≥ 43 → south: water (lakes + shore nodes)

export const ORE_NODES = 26;
export const GRAIN_NODES = 40;
export const WATER_NODES = 40;
export const WATER_TILES = 60; // impassable lake tiles scattered in the south; nodes sit on their shores

export const NODE_START_STOCK = 8;
export const NODE_MAX_STOCK = 12;
export const NODE_REGEN_PER_TICK = 1; // integer regen; capped at NODE_MAX_STOCK

// ── Agents ───────────────────────────────────────────────────────────────────
export const AGENT_COUNT = 30;

export const SATIATION_MAX = 100;
export const HYDRATION_MAX = 100;
export const ENERGY_MAX = 100;
export const HEALTH_MAX = 100;

export const SATIATION_START = 55;
export const HYDRATION_START = 55;
export const ENERGY_START = 100;
export const HEALTH_START = 100;

// ── Metabolism (per tick) ────────────────────────────────────────────────────
export const SATIATION_DECAY = 1;
export const HYDRATION_DECAY = 1;
export const EAT_GAIN = 35; // grain → satiation
export const DRINK_GAIN = 35; // water → hydration
export const MOVE_ENERGY_COST = 1; // MOVE burns energy; at 0, MOVE is rejected
export const REST_ENERGY_GAIN = 12; // REST restores energy
export const HEALTH_DRAIN = 2; // per tick while satiation OR hydration is 0
export const HEALTH_REGEN = 1; // per tick while both needs are > 0

export const GATHER_QTY = 2; // items pulled per GATHER

export const MAX_GENESIS_ATTEMPTS = 100; // bounded reachability retry — throws on exhaustion

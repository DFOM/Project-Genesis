// Named constants for the world + simulation. Tuning lives here so a balance change is
// one edit and can never touch determinism logic. All values are INTEGERS.

export const WORLD_SIZE = 64; // 64×64 tiles

export const PERCEPTION_RADIUS = 8; // an agent sees its tile + this many tiles in each direction

export const INVENTORY_CAPACITY = 40; // max total items — survivors keep spare room (slack) beyond survival

// ── Map bands (rows) ─────────────────────────────────────────────────────────
// Deliberately non-uniform, and grain (food) vs water (drink) are SEPARATED so no tile
// is self-sufficient. They share a productive seam near y=GRAIN..WATER border: an agent
// there can, within PERCEPTION_RADIUS, alternately see grain and water and survive by
// shuttling. Agents far from the seam die — that is the intended partial die-off.
export const ORE_BAND_MAX_Y = 14; // y < 14  → north: ore (hills)
export const GRAIN_BAND_MAX_Y = 38; // 14 ≤ y < 38 and x ≥ GRAIN_MIN_X → grain (fields)
export const GRAIN_MIN_X = 24; // grain only in the eastern portion (x ≥ 24) of its band
// y ≥ 38 → south: water (lakes + shore nodes). The grain↔water seam at y≈38 (for x ≥ 32) is
// the long habitable border; agents there shuttle between the two regions.

export const ORE_NODES = 26;
export const GRAIN_NODES = 120;
export const WATER_NODES = 120;
export const WATER_TILES = 60; // impassable lake tiles scattered in the south; nodes sit on their shores

export const NODE_START_STOCK = 40;
export const NODE_MAX_STOCK = 60;
export const NODE_REGEN_PER_TICK = 4; // integer regen; capped at NODE_MAX_STOCK

// ── Agents ───────────────────────────────────────────────────────────────────
export const AGENT_COUNT = 30;

export const SATIATION_MAX = 375;
export const HYDRATION_MAX = 375;
export const ENERGY_MAX = 100;
export const HEALTH_MAX = 100;

export const SATIATION_START = 325; // ~325 ticks of slack to find the FIRST food while exploring
export const HYDRATION_START = 325;
export const ENERGY_START = 100;
export const HEALTH_START = 100;

// ── Metabolism (per tick) ────────────────────────────────────────────────────
export const SATIATION_DECAY = 1;
export const HYDRATION_DECAY = 1;
export const EAT_GAIN = 150; // grain → satiation (a meal buys ~150 ticks)
export const DRINK_GAIN = 150; // water → hydration
export const MOVE_ENERGY_COST = 1; // MOVE burns energy; at 0, MOVE is rejected (travel stays costly)
export const REST_ENERGY_GAIN = 15; // REST restores energy
export const HEALTH_DRAIN = 2; // per tick while satiation OR hydration is 0
export const HEALTH_REGEN = 2; // per tick while both needs are > 0

export const GATHER_QTY = 3; // items pulled per GATHER

export const MAX_GENESIS_ATTEMPTS = 100; // bounded reachability retry — throws on exhaustion

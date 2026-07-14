// Named constants for the world + simulation. Tuning lives here so a balance change is
// one edit and can never touch determinism logic. All values are INTEGERS.

// A SMALL world (32×32): at PERCEPTION_RADIUS 8 an agent sees a 17×17 window — ~28% of the
// map — so agents constantly encounter one another (a precondition for society), and every
// region is reachable from every spawn within a reservoir, so birthplace is not destiny.
export const WORLD_SIZE = 32; // 32×32 tiles

export const PERCEPTION_RADIUS = 8; // an agent sees its tile + this many tiles in each direction

export const INVENTORY_CAPACITY = 40; // max total items — survivors keep spare room (slack) beyond survival

// ── Map bands (rows), scaled to the 32×32 world ──────────────────────────────
// Asymmetry preserved: grain east, water south, ore north (and still useless). No tile is
// self-sufficient; grain and water share a seam near y=GRAIN_BAND_MAX_Y.
export const ORE_BAND_MAX_Y = 7; // y < 7  → north: ore (hills)
export const GRAIN_BAND_MAX_Y = 16; // 7 ≤ y < 16 and x ≥ GRAIN_MIN_X → grain (fields)
export const GRAIN_MIN_X = 16; // grain only in the eastern half (x ≥ 16)
// y ≥ 16 → south: water (lakes + shore nodes).

// ── Resources: FEW, RICH, CLUSTERED patches (not scattered) ──────────────────
// Contest comes from CONVERGENCE: a handful of grain patches in the east and water sources
// in the south force many agents onto the same node, so they must queue/claim/share/shove.
// Evenly-scattered nodes would let everyone find their own and nobody would ever compete.
export const ORE_NODES = 5; // scattered in the north; inert (money candidate for Phase 6)
export const GRAIN_PATCHES = 4; // number of grain patches (clusters) in the east
export const WATER_PATCHES = 4; // number of water sources in the south
export const NODES_PER_PATCH = 2; // rich nodes packed into each patch
export const LAKE_HALF = 1; // half-size of the impassable lake blob at each water patch

// Rich stock + slow regen: a patch holds a lot but refills slowly, so convergence drains it
// and arrivals find it empty ('nothing to gather here') until it recovers.
export const NODE_START_STOCK = 20;
export const NODE_MAX_STOCK = 30;
export const NODE_REGEN_PER_TICK = 2; // integer regen; capped at NODE_MAX_STOCK. Fast enough that
// a drained patch recovers (negative feedback → stable population), slow enough to still deplete.

// ── Agents ───────────────────────────────────────────────────────────────────
export const AGENT_COUNT = 30;

export const SATIATION_MAX = 375;
export const HYDRATION_MAX = 375;
export const ENERGY_MAX = 100;
export const HEALTH_MAX = 100;

// Starting satiation/hydration are STAGGERED per agent across [MIN, MAX] (drawn in genesis),
// so agents reach their first feeding crisis at different ticks instead of stampeding the
// few patches all at once. This desynchronises mortality — deaths spread across the run
// rather than a single cull — and keeps peak demand within what the patches can serve.
export const SATIATION_START_MIN = 90;
export const SATIATION_START = 325; // the MAX of the stagger range; big reservoir = slack
export const HYDRATION_START_MIN = 90;
export const HYDRATION_START = 325;
export const ENERGY_START = 100;
export const HEALTH_START = 100;

// ── Metabolism (per tick) ────────────────────────────────────────────────────
export const SATIATION_DECAY = 1;
export const HYDRATION_DECAY = 1;
export const EAT_GAIN = 8; // grain → satiation. Lower than reservoir-size on purpose: the big
export const DRINK_GAIN = 8; // MAX/START give exploration slack, but a unit of food restores
// little, so a survivor must eat/gather OFTEN — that recurring demand is what pressures nodes.
export const MOVE_ENERGY_COST = 1; // MOVE burns energy; at 0, MOVE is rejected (travel stays costly)
export const REST_ENERGY_GAIN = 15; // REST restores energy
export const HEALTH_DRAIN = 2; // per tick while satiation OR hydration is 0
export const HEALTH_REGEN = 2; // per tick while both needs are > 0

export const GATHER_QTY = 3; // items pulled per GATHER

export const MAX_GENESIS_ATTEMPTS = 100; // bounded reachability retry — throws on exhaustion

// ── Memory (Phase 2) ─────────────────────────────────────────────────────────
// Per-agent bounded memory, evicted by salience that DECAYS with age (see engine/memory.ts).
export const MEMORY_CAPACITY = 20; // entries retained per agent
export const TIER_WEIGHT = 500; // points per salience tier
export const DECAY_WEIGHT = 100; // logarithmic age decay: floor(DECAY_WEIGHT * log2(1 + age))
export const COALESCE_LOOKBACK = 5; // coalesce a repeat into a matching entry within the last N,
// so a single interleaved 'appeared' can't split a run of identical rejections into two stutters

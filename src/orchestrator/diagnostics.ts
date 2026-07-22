// Instrumentation to answer "why do agents die?" — supply vs demand, node depletion, contest
// rate, rejection histogram, and per-death forensics. It runs an OBSERVED copy of the sim
// loop (its own perceive→propose→step), so it can inspect proposals, events, and world state
// every tick without touching the pure engine. Used by `sim:diagnose` and `test:scarcity`.
import { applyEvent, normalizeMindResult, perceive, config as C } from '../engine/index.js';
import type { Event, ItemType, Mind, Perception, ProposedAction, World } from '../engine/index.js';
import { step } from '../referee/index.js';
import { heuristicBot } from '../agents/index.js';
import type { EventStore } from '../store/index.js';
import { makeConfig } from './harness.js';

export interface DeathRecord {
  tick: number;
  x: number;
  y: number;
  cause: 'starvation' | 'dehydration';
  distNearestGrain: number;
  distNearestWater: number;
  nearestRelevantDist: number; // to the resource the agent lacked (grain if starved, water if dehydrated)
  nearestRelevantStock: number; // that node's stock at death — 0 ⇒ depleted
  classification: 'search-failure' | 'competition';
}

// One row per agent per run — the unit of analysis once models attach in Phase 4 (every
// question — "do Claude agents survive longer? hoard more? witness more deaths?" — is a
// GROUP BY on this). `model`/`provider` are the Phase-4 slots (null under heuristic bots).
export interface AgentRecord {
  seed: number;
  id: string;
  spawnX: number;
  spawnY: number;
  alive: boolean;
  deathTick: number | null;
  deathCause: 'starvation' | 'dehydration' | null;
  finalSatiation: number;
  finalHydration: number;
  finalEnergy: number;
  finalHealth: number;
  totalGathered: number;
  totalEaten: number;
  totalDrank: number;
  rejections: number;
  deathsWitnessed: number;
  model: string | null;
  provider: string | null;
}

// The dramatic beats of a run (not the full ~55k-event log) → events/<seed>.jsonl.
export type NotableEvent =
  | { tick: number; type: 'death'; who: string; cause: string; x: number; y: number }
  | { tick: number; type: 'distress'; who: string; need: 'satiation' | 'hydration'; x: number; y: number }
  | { tick: number; type: 'contested_last_unit'; x: number; y: number }
  | { tick: number; type: 'node_depleted'; x: number; y: number; item: string };

export interface DiagnosticReport {
  seed: number;
  ticks: number;
  alive: number;
  dead: number;
  // supply vs demand (per resource, per tick)
  grainRegenCapacity: number; // regen rate × node count (max the world can produce)
  waterRegenCapacity: number;
  grainRegenDelivered: number; // actually emitted REGEN, respecting caps (avg/tick)
  waterRegenDelivered: number;
  grainConsumedPerTick: number; // ATE units / tick
  waterConsumedPerTick: number;
  grainSupplyDemandRatio: number; // capacity : consumption
  waterSupplyDemandRatio: number;
  // node depletion (grain + water nodes only; ore is inert)
  nodeZeroFraction: number; // fraction of (node,tick) trough samples at stock 0
  nodeLowFraction: number; // fraction of trough samples below GATHER_QTY (can't serve a full gather)
  nodeStockMedian: number;
  nodeStockMax: number;
  // society-formation precondition: how crowded is perception?
  meanVisibleAgents: number; // avg number of OTHER agents in a living agent's perception, per tick
  // contest
  contestedGatherTicks: number; // ticks with ≥2 agents proposing GATHER on the same node
  lastUnitDecisions: number; // same tick, same node: someone GATHERED and someone got 'nothing to gather here'
  // rejections
  rejections: Record<string, number>;
  // deaths
  deaths: DeathRecord[];
  searchFailureDeaths: number;
  competitionDeaths: number;
  // per-agent unit of analysis + the run's notable events
  agents: AgentRecord[];
  notableEvents: NotableEvent[];
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Phase 3 — diagnose is now generic over WHO is thinking, so the LLM arm and the bot arm are
// measured by the SAME instrument. A second metrics path would drift, and then "minds beat bots"
// would be a comparison between two rulers rather than two populations.
//
// Bots pass nothing and get the Phase-1 behaviour exactly (`mindFor` defaults to heuristicBot,
// and a synchronous mind resolves without ever yielding — so seeds stay byte-identical).
export interface DiagnoseOptions {
  agentCount?: number;
  mindFor?: (agentId: string) => Mind; // default: heuristicBot
  beforeTick?: (perceptions: readonly Perception[]) => void; // lets a caller set think-gating
  shouldStop?: () => boolean; // budget pause — checked before each tick
  store?: EventStore; // when present, events are appended (the LLM arm wants its log + sidecar)
  runId?: string;
  // Fires with EXACTLY the same event batches that go to the store, in order: once for GENESIS,
  // once per completed tick. This is the hook incremental persistence uses (RunWriter) so a run
  // that stops early still has a complete log on disk up to the last finished tick.
  onEvents?: (events: readonly Event[]) => void;
}

export async function diagnose(seed: number, ticks: number, opts: DiagnoseOptions = {}): Promise<DiagnosticReport> {
  const config = { ...makeConfig(seed), ...(opts.agentCount !== undefined ? { agentCount: opts.agentCount } : {}) };
  const genesis: Event = { type: 'GENESIS', config };
  let world: World = applyEvent(null, genesis);
  const runId = opts.runId ?? `diag-${seed}`;
  if (opts.store) opts.store.append(runId, 0, [genesis]);
  opts.onEvents?.([genesis]); // persist GENESIS first — replay needs it to reconstruct anything
  const mindFor = opts.mindFor ?? heuristicBot;
  const minds = new Map(world.agents.map((a) => [a.id, mindFor(a.id)]));

  // Fixed node positions (nodes never move); used for death-distance forensics.
  const grainPos = world.nodes.filter((n) => n.item === 'grain').map((n) => ({ x: n.pos.x, y: n.pos.y }));
  const waterPos = world.nodes.filter((n) => n.item === 'water').map((n) => ({ x: n.pos.x, y: n.pos.y }));
  const grainCount = grainPos.length;
  const waterCount = waterPos.length;

  let grainConsumed = 0;
  let waterConsumed = 0;
  let visibleAgentsSum = 0;
  let perceptionCount = 0;
  let grainDelivered = 0;
  let waterDelivered = 0;
  let contestedGatherTicks = 0;
  let lastUnitDecisions = 0;
  const rejections: Record<string, number> = {};
  const deaths: DeathRecord[] = [];
  const notableEvents: NotableEvent[] = [];
  const zeroNodes = new Set<string>(); // nodes currently at zero-trough (for depletion onset)

  // Per-agent records, seeded with spawn tiles from the initial world.
  const agentRecs = new Map<string, AgentRecord>();
  for (const a of world.agents) {
    agentRecs.set(a.id, {
      seed,
      id: a.id,
      spawnX: a.pos.x,
      spawnY: a.pos.y,
      alive: true,
      deathTick: null,
      deathCause: null,
      finalSatiation: 0,
      finalHydration: 0,
      finalEnergy: 0,
      finalHealth: 0,
      totalGathered: 0,
      totalEaten: 0,
      totalDrank: 0,
      rejections: 0,
      deathsWitnessed: 0,
      model: null,
      provider: null,
    });
  }

  // node-stock histogram over grain+water nodes, sampled at the TROUGH (after this tick's
  // gathers, before regen) — that is the stock an arriving agent actually faces. Sampling
  // after regen would hide intra-tick depletion (regen refills +1 every tick).
  const histSize = C.NODE_MAX_STOCK + 1;
  const stockHist = new Uint32Array(histSize);
  let nodeSamples = 0;
  let nodeLowSamples = 0; // trough < GATHER_QTY (can't serve a full gather)
  const gwNodeKeys = world.nodes.filter((n) => n.item !== 'ore').map((n) => `${n.pos.x},${n.pos.y}`);
  const liveStock = new Map<string, number>();
  for (const n of world.nodes) if (n.item !== 'ore') liveStock.set(`${n.pos.x},${n.pos.y}`, n.stock);

  const nearestDist = (x: number, y: number, positions: { x: number; y: number }[]): number => {
    let best = Infinity;
    for (const p of positions) {
      const d = manhattan(x, y, p.x, p.y);
      if (d < best) best = d;
    }
    return best;
  };

  let ticksCompleted = 0;
  for (let t = 0; t < ticks; t++) {
    // Budget pause (LLM arm only; bots never set this). A paused run is still data: its event log
    // is a complete, replayable history up to the pause.
    if (opts.shouldStop?.()) break;

    // 1) Collect proposals (mirrors the orchestrator), tracking GATHER proposals per node tile.
    const proposals: ProposedAction[] = [];
    const gatherByTile = new Map<string, number>();
    const living = world.agents.filter((a) => a.alive);
    const perceptions = living.map((a) => perceive(world, a.id));
    // Hook for think-gating: the caller sees every living agent's perception and decides who
    // thinks this tick, before any mind is asked.
    opts.beforeTick?.(perceptions);
    for (let i = 0; i < living.length; i++) {
      const a = living[i]!;
      const p = perceptions[i]!;
      visibleAgentsSum += p.agents.length;
      perceptionCount++;
      const { actions, reasoning } = normalizeMindResult(await Promise.resolve(minds.get(a.id)!.propose(p)));
      actions.forEach((action, k) => {
        proposals.push(k === 0 && reasoning !== undefined ? { agentId: a.id, action, reasoning } : { agentId: a.id, action });
        if (action.type === 'GATHER') {
          const key = `${a.pos.x},${a.pos.y}`;
          gatherByTile.set(key, (gatherByTile.get(key) ?? 0) + 1);
        }
      });
    }
    // A tick is "contested" if ≥2 agents proposed GATHER while standing on the same node.
    let contestedThisTick = false;
    for (const [key, n] of gatherByTile) {
      if (n < 2) continue;
      const [x, y] = key.split(',').map(Number) as [number, number];
      if (world.nodes.some((nd) => nd.pos.x === x && nd.pos.y === y)) contestedThisTick = true;
    }
    if (contestedThisTick) contestedGatherTicks++;

    // 2) Advance one tick.
    const result = step(world, proposals);
    world = result.world;
    const events = result.events;
    ticksCompleted++;
    if (opts.store) opts.store.append(runId, world.tick, events);
    opts.onEvents?.(events); // durable before the next tick begins — early stop leaves a complete log

    // 3) Tally from events.
    const gatheredTiles = new Set<string>();
    const emptyRejectTiles = new Set<string>();
    for (const e of events) {
      switch (e.type) {
        case 'ATE':
          grainConsumed++;
          agentRecs.get(e.agentId)!.totalEaten++;
          break;
        case 'DRANK':
          waterConsumed++;
          agentRecs.get(e.agentId)!.totalDrank++;
          break;
        case 'REGEN': {
          const node = world.nodes.find((n) => n.pos.x === e.tile.x && n.pos.y === e.tile.y);
          if (node?.item === 'grain') grainDelivered += e.amount;
          else if (node?.item === 'water') waterDelivered += e.amount;
          break;
        }
        case 'GATHERED':
          gatheredTiles.add(`${e.tile.x},${e.tile.y}`);
          agentRecs.get(e.agentId)!.totalGathered += e.qty;
          break;
        case 'METABOLIZED':
          for (const d of e.deltas) {
            if (d.starvingTicksAfter === 1 || d.dehydratingTicksAfter === 1) {
              const a = world.agents.find((x) => x.id === d.agentId)!;
              if (d.starvingTicksAfter === 1) notableEvents.push({ tick: t + 1, type: 'distress', who: d.agentId, need: 'satiation', x: a.pos.x, y: a.pos.y });
              if (d.dehydratingTicksAfter === 1) notableEvents.push({ tick: t + 1, type: 'distress', who: d.agentId, need: 'hydration', x: a.pos.x, y: a.pos.y });
            }
          }
          break;
        case 'ACTION_REJECTED': {
          rejections[e.reason] = (rejections[e.reason] ?? 0) + 1;
          agentRecs.get(e.agentId)!.rejections++;
          if (e.action.type === 'GATHER' && e.reason === 'nothing to gather here') {
            const a = world.agents.find((x) => x.id === e.agentId);
            if (a) emptyRejectTiles.add(`${a.pos.x},${a.pos.y}`);
          }
          break;
        }
        case 'AGENT_DIED': {
          const a = world.agents.find((x) => x.id === e.agentId)!;
          const item: ItemType = e.cause === 'starvation' ? 'grain' : 'water';
          const relNodes = world.nodes.filter((n) => n.item === item);
          let nearestRelDist = Infinity;
          let nearestRelStock = 0;
          for (const n of relNodes) {
            const d = manhattan(a.pos.x, a.pos.y, n.pos.x, n.pos.y);
            if (d < nearestRelDist) {
              nearestRelDist = d;
              nearestRelStock = n.stock;
            }
          }
          // Search failure: the needed resource was beyond perception (never found it).
          // Competition: a node was within perception but depleted when the agent needed it.
          const classification = nearestRelDist > C.PERCEPTION_RADIUS ? 'search-failure' : 'competition';
          deaths.push({
            tick: t + 1,
            x: a.pos.x,
            y: a.pos.y,
            cause: e.cause,
            distNearestGrain: nearestDist(a.pos.x, a.pos.y, grainPos),
            distNearestWater: nearestDist(a.pos.x, a.pos.y, waterPos),
            nearestRelevantDist: nearestRelDist,
            nearestRelevantStock: nearestRelStock,
            classification,
          });
          const rec = agentRecs.get(e.agentId)!;
          rec.deathTick = t + 1;
          rec.deathCause = e.cause;
          notableEvents.push({ tick: t + 1, type: 'death', who: e.agentId, cause: e.cause, x: a.pos.x, y: a.pos.y });
          // Who saw it: alive agents within perception radius of the death tile.
          for (const other of world.agents) {
            if (other.id === e.agentId || !other.alive) continue;
            if (Math.abs(other.pos.x - a.pos.x) <= C.PERCEPTION_RADIUS && Math.abs(other.pos.y - a.pos.y) <= C.PERCEPTION_RADIUS) {
              agentRecs.get(other.id)!.deathsWitnessed++;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    // A "last-unit decision": same tick & tile, one agent GATHERED and another was told
    // 'nothing to gather here' — the seeded shuffle picked the winner of the last unit.
    for (const tile of emptyRejectTiles)
      if (gatheredTiles.has(tile)) {
        lastUnitDecisions++;
        const [cx, cy] = tile.split(',').map(Number) as [number, number];
        notableEvents.push({ tick: t + 1, type: 'contested_last_unit', x: cx, y: cy });
      }

    // 4) Sample node-stock TROUGH: apply this tick's gathers, snapshot, then apply regen.
    //    (Within a tick the referee emits all GATHERED before any REGEN.)
    for (const e of events) {
      if (e.type === 'GATHERED' && e.source === 'node') {
        const k = `${e.tile.x},${e.tile.y}`;
        liveStock.set(k, liveStock.get(k)! - e.qty);
      }
    }
    for (const k of gwNodeKeys) {
      const s = liveStock.get(k)!;
      stockHist[Math.max(0, Math.min(s, histSize - 1))]!++;
      nodeSamples++;
      if (s < C.GATHER_QTY) nodeLowSamples++;
      // node_depleted fires once, on the transition to a zero trough (not every tick it's dry).
      if (s === 0) {
        if (!zeroNodes.has(k)) {
          zeroNodes.add(k);
          const [nx, ny] = k.split(',').map(Number) as [number, number];
          const node = world.nodes.find((nd) => nd.pos.x === nx && nd.pos.y === ny)!;
          notableEvents.push({ tick: t + 1, type: 'node_depleted', x: nx, y: ny, item: node.item });
        }
      } else {
        zeroNodes.delete(k);
      }
    }
    for (const e of events) {
      if (e.type === 'REGEN') {
        const k = `${e.tile.x},${e.tile.y}`;
        liveStock.set(k, liveStock.get(k)! + e.amount);
      }
    }
  }

  // Node-stock median & max from the histogram.
  let median = 0;
  let seen = 0;
  const half = nodeSamples / 2;
  let maxStock = 0;
  for (let s = 0; s < histSize; s++) {
    if (stockHist[s]! > 0) maxStock = s;
    seen += stockHist[s]!;
    if (median === 0 && seen >= half) median = s;
  }
  const zeroFraction = nodeSamples > 0 ? stockHist[0]! / nodeSamples : 0;

  // Rates divide by the ticks actually RUN, not the ticks requested: a budget-paused LLM run that
  // stopped at 300 of 1,200 must not report its consumption as a quarter of the truth.
  const denom = Math.max(1, ticksCompleted);
  const grainConsumedPerTick = grainConsumed / denom;
  const waterConsumedPerTick = waterConsumed / denom;

  // Finalize per-agent records from the final world.
  for (const a of world.agents) {
    const rec = agentRecs.get(a.id)!;
    rec.alive = a.alive;
    rec.finalSatiation = a.satiation;
    rec.finalHydration = a.hydration;
    rec.finalEnergy = a.energy;
    rec.finalHealth = a.health;
  }

  return {
    seed,
    ticks: ticksCompleted,
    alive: world.agents.filter((a) => a.alive).length,
    dead: world.agents.filter((a) => !a.alive).length,
    grainRegenCapacity: grainCount * C.NODE_REGEN_PER_TICK,
    waterRegenCapacity: waterCount * C.NODE_REGEN_PER_TICK,
    grainRegenDelivered: grainDelivered / denom,
    waterRegenDelivered: waterDelivered / denom,
    grainConsumedPerTick,
    waterConsumedPerTick,
    grainSupplyDemandRatio: grainConsumedPerTick > 0 ? (grainCount * C.NODE_REGEN_PER_TICK) / grainConsumedPerTick : Infinity,
    waterSupplyDemandRatio: waterConsumedPerTick > 0 ? (waterCount * C.NODE_REGEN_PER_TICK) / waterConsumedPerTick : Infinity,
    nodeZeroFraction: zeroFraction,
    nodeLowFraction: nodeSamples > 0 ? nodeLowSamples / nodeSamples : 0,
    nodeStockMedian: median,
    nodeStockMax: maxStock,
    meanVisibleAgents: perceptionCount > 0 ? visibleAgentsSum / perceptionCount : 0,
    contestedGatherTicks,
    lastUnitDecisions,
    rejections,
    deaths,
    searchFailureDeaths: deaths.filter((d) => d.classification === 'search-failure').length,
    competitionDeaths: deaths.filter((d) => d.classification === 'competition').length,
    agents: [...agentRecs.values()],
    notableEvents,
  };
}

export function formatReport(r: DiagnosticReport): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`GENESIS diagnostics — seed ${r.seed}, ${r.ticks} ticks`);
  lines.push(`  survivors: ${r.alive} alive / ${r.dead} dead`);
  lines.push('');
  lines.push('SUPPLY vs DEMAND (per tick, per resource)');
  lines.push(`  grain: regen capacity ${r.grainRegenCapacity.toFixed(1)} (delivered ${r.grainRegenDelivered.toFixed(2)}) vs consumed ${r.grainConsumedPerTick.toFixed(3)}  →  ${r.grainSupplyDemandRatio.toFixed(0)}:1`);
  lines.push(`  water: regen capacity ${r.waterRegenCapacity.toFixed(1)} (delivered ${r.waterRegenDelivered.toFixed(2)}) vs consumed ${r.waterConsumedPerTick.toFixed(3)}  →  ${r.waterSupplyDemandRatio.toFixed(0)}:1`);
  lines.push('');
  lines.push('NODE DEPLETION (grain + water nodes, trough per tick)');
  lines.push(`  node-ticks at zero stock: ${pct(r.nodeZeroFraction)}`);
  lines.push(`  node-ticks below a full gather (< ${C.GATHER_QTY}): ${pct(r.nodeLowFraction)}`);
  lines.push(`  trough stock median: ${r.nodeStockMedian}   max observed: ${r.nodeStockMax}`);
  lines.push('');
  lines.push('AGENT VISIBILITY');
  lines.push(`  mean other agents in perception, per agent per tick: ${r.meanVisibleAgents.toFixed(2)}`);
  lines.push('');
  lines.push('CONTEST');
  lines.push(`  ticks with ≥2 agents gathering the same node: ${r.contestedGatherTicks}`);
  lines.push(`  last-unit decisions (shuffle picked the winner): ${r.lastUnitDecisions}`);
  lines.push('');
  lines.push('REJECTIONS');
  for (const [reason, n] of Object.entries(r.rejections).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${reason}: ${n}`);
  }
  lines.push('');
  lines.push('DEATH FORENSICS');
  lines.push(`  ${r.searchFailureDeaths} search-failure  /  ${r.competitionDeaths} competition  (of ${r.deaths.length})`);
  // death-tick distribution (per 500-tick bucket) — reveals a single cull vs deaths across the run
  if (r.deaths.length > 0) {
    const bucket = 500;
    const buckets = new Map<number, number>();
    for (const d of r.deaths) buckets.set(Math.floor((d.tick - 1) / bucket), (buckets.get(Math.floor((d.tick - 1) / bucket)) ?? 0) + 1);
    const spans: string[] = [];
    for (const b of [...buckets.keys()].sort((a, z) => a - z)) spans.push(`${b * bucket}-${(b + 1) * bucket}: ${buckets.get(b)}`);
    lines.push(`  death-tick distribution [${spans.join('  ')}]`);
  }
  for (const d of r.deaths) {
    lines.push(
      `  tick ${String(d.tick).padStart(4)}  (${String(d.x).padStart(2)},${String(d.y).padStart(2)})  ${d.cause.padEnd(11)}  ` +
        `nearest grain ${String(d.distNearestGrain).padStart(3)}  water ${String(d.distNearestWater).padStart(3)}  ` +
        `[needed dist ${d.nearestRelevantDist === Infinity ? '∞' : d.nearestRelevantDist}, stock ${d.nearestRelevantStock}]  → ${d.classification}`,
    );
  }
  return lines.join('\n');
}

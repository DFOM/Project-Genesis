// Read a mind. Dumps one agent's REASONED events as plain text, beside what the world did about
// them — the thing the whole REASONED-in-the-log design exists to make possible.
//
//   npm run sim:reasoning -- --dir research/smoke-…            # picks the agent nearest the seam
//   npm run sim:reasoning -- --dir research/smoke-… --agent agent-03
//   npm run sim:reasoning -- --dir research/smoke-… --from 20 --to 30
//
// "NEAR THE SEAM" is the interesting place, not a random agent. The map puts grain in the east
// (7 ≤ y < 16, x ≥ 16) and water in the south (y ≥ 16), so they meet along y≈16 — the one band
// where an agent can reach both needs. Reaching it is the whole survival problem the heuristic
// bot solves by construction (run-and-tumble + a carried buffer). Whether a MIND finds it, and
// what it says while doing so, is the Phase-3 question. So by default we dump the agent that got
// closest to that seam.
//
// It reads only the JSONL written by sim:smoke. No API key, no network, no spend.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyEvent } from '../engine/index.js';
import type { Event, World } from '../engine/index.js';

const SEAM_Y = 16; // GRAIN_BAND_MAX_Y — where the grain band meets the water band
const SEAM_MIN_X = 16; // grain only exists in the eastern half

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function die(msg: string): never {
  process.stderr.write(`\n${msg}\n\n`);
  process.exit(1);
}

// Distance to the seam band: how far from being able to reach both grain and water.
function seamDistance(x: number, y: number): number {
  return Math.abs(y - SEAM_Y) + Math.max(0, SEAM_MIN_X - x);
}

function main(): void {
  const dir = argVal('dir') ?? die('--dir <research/smoke-…> is required');
  let events: Event[];
  try {
    events = readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Event);
  } catch {
    const dirs = (() => {
      try {
        return readdirSync('research').filter((d) => d.startsWith('smoke-'));
      } catch {
        return [];
      }
    })();
    die(`no events.jsonl in '${dir}'.${dirs.length ? `\nAvailable smoke runs:\n  ${dirs.map((d) => `research/${d}`).join('\n  ')}` : '\nRun `npm run sim:smoke` first (it spends money).'}`);
  }

  // Track every agent's closest approach to the seam by replaying the log.
  let world: World | null = null;
  const best = new Map<string, { d: number; x: number; y: number; tick: number }>();
  for (const e of events) {
    world = applyEvent(world, e);
    if (e.type !== 'MOVED') continue;
    const d = seamDistance(e.to.x, e.to.y);
    const cur = best.get(e.agentId);
    if (!cur || d < cur.d) best.set(e.agentId, { d, x: e.to.x, y: e.to.y, tick: world.tick });
  }
  if (world === null) die('empty event log');
  // Agents that never moved still have a spawn position worth ranking.
  for (const a of world.agents) if (!best.has(a.id)) best.set(a.id, { d: seamDistance(a.pos.x, a.pos.y), x: a.pos.x, y: a.pos.y, tick: 0 });

  const ranked = [...best.entries()].sort((a, b) => a[1].d - b[1].d || a[0].localeCompare(b[0]));
  const agentId = argVal('agent') ?? ranked[0]![0];
  const from = Number(argVal('from') ?? '0');
  const to = Number(argVal('to') ?? String(Number.MAX_SAFE_INTEGER));

  console.log(`SEAM PROXIMITY (grain band meets water band at y≈${SEAM_Y}, x≥${SEAM_MIN_X})`);
  for (const [id, b] of ranked) {
    const a = world.agents.find((x) => x.id === id)!;
    console.log(`  ${id}  closest (${b.x},${b.y})  distance ${b.d}  ${a.alive ? 'alive' : 'DIED'}${id === agentId ? '   ← dumping this one' : ''}`);
  }
  console.log('');
  console.log(`${'='.repeat(78)}\nWHAT ${agentId} THOUGHT — verbatim, beside what the world did about it\n${'='.repeat(78)}\n`);

  // Walk the log. Because the referee emits REASONED immediately before the events that reasoning
  // produced, "thought then consequence" is just a linear read — no join, no correlation.
  let tick = 0;
  let shown = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'TICK_COMPLETED') tick = e.tick;
    if (e.type !== 'REASONED' || e.agentId !== agentId) continue;
    if (tick < from || tick > to) continue;
    shown++;
    console.log(`── tick ${tick} ${'─'.repeat(60)}`);
    console.log(e.rawResponse.trim());
    // Everything this agent caused, up to its next thought.
    const outcomes: string[] = [];
    for (let j = i + 1; j < events.length; j++) {
      const o = events[j]!;
      if (o.type === 'REASONED' && o.agentId === agentId) break;
      if (o.type === 'TICK_COMPLETED') break;
      if (!('agentId' in o) || (o as { agentId: string }).agentId !== agentId) continue;
      if (o.type === 'ACTION_REJECTED') outcomes.push(`  → REJECTED ${o.action.type}: "${o.reason}"`);
      else if (o.type === 'MOVED') outcomes.push(`  → moved to (${o.to.x},${o.to.y})`);
      else if (o.type === 'GATHERED') outcomes.push(`  → gathered ${o.qty} ${o.item} at (${o.tile.x},${o.tile.y})`);
      else if (o.type === 'ATE') outcomes.push(`  → ate, satiation now ${o.satiationAfter}`);
      else if (o.type === 'DRANK') outcomes.push(`  → drank, hydration now ${o.hydrationAfter}`);
      else if (o.type === 'DROPPED') outcomes.push(`  → dropped ${o.qty} ${o.item}`);
      else if (o.type === 'RESTED') outcomes.push(`  → rested, energy now ${o.energyAfter}`);
      else if (o.type === 'AGENT_DIED') outcomes.push(`  → DIED of ${o.cause}`);
    }
    console.log(outcomes.length ? outcomes.join('\n') : '  → (no effect)');
    console.log('');
  }
  if (shown === 0) console.log(`(no REASONED events for ${agentId} in ticks ${from}..${to})`);
}

main();

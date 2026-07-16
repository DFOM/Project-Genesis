// The universe, as seen from inside an agent's head. This file is the highest-leverage code in
// Phase 3: if 6 minds fail to beat a 50-line bot, the answer is almost certainly in here, not in
// the model. DESIGN §9 says so explicitly — "if they don't, the perception format is bad — fix
// it here, not later."
//
// Two halves, split by cost:
//   • buildSystemPrompt() — persona + verbs + the numeric scale. STABLE for a whole run, sent
//     once and then served from the prompt cache. Everything invariant belongs here; anything
//     that changes per tick would blow the cache on every call.
//   • renderPerception()  — this tick, and nothing else.
//
// THREE RULES THIS FILE MUST NOT BREAK
//
// 1. BLIND (EXPERIMENT-CONTROL §2.1). No model or provider name reaches an agent, ever. Without
//    this we would be measuring "how do models treat a thing labelled GPT" instead of "how do
//    models behave" — a different and much smaller question. There is a leak test.
// 2. NO STRATEGY. We do not tell it to eat when hungry, to carry a buffer, or to head east for
//    grain. The bot knows those things because we coded them; the model has to work them out.
//    Coaching here would make "minds beat bots" true by construction and worthless.
// 3. INVARIANT #8. Every condition the referee can reject on must be visible. The referee can
//    reject 'too exhausted', 'inventory full', 'blocked terrain', 'item not in inventory',
//    'nothing to gather here', 'only grain is edible' — so energy, capacity, passability, the
//    inventory, tile contents and the item rules are all stated. An LLM cannot learn from a rule
//    it cannot see.
// NOTE: the scale comes from the CONTRACT, not from engine/config. Agents may not import config
// — it holds the map's layout (grain is east, ore is north), and an agent that could read it
// would know where the food is without exploring. `SCALE` is the curated, leak-free subset.
import { SCALE as C, type MemoryEntry, type Perception } from '../../engine/contract.js';

// ── system prompt (once per run, then cached) ────────────────────────────────

export type PersonaMode = 'none' | 'minimal';

// `none` is the cleanest baseline: no self, no story, no goals we planted. EXPERIMENT-CONTROL
// lists persona as an independent variable; Phase 3 ships the two cheapest rungs and Phase 4+
// can add 'rich'.
function personaText(mode: PersonaMode): string {
  if (mode === 'none') return 'You are a person in a world.';
  return 'You are a person in a world. You would like to keep living.';
}

export function buildSystemPrompt(persona: PersonaMode = 'none'): string {
  return `${personaText(persona)}

Each turn you receive what you can see and remember, and you choose ONE action.

THE NUMBERS
- satiation: 0..${C.satiationMax}. HIGH means well fed. 0 means you are starving.
- hydration: 0..${C.hydrationMax}. HIGH means well watered. 0 means you are dehydrating.
- energy:    0..${C.energyMax}. Moving spends it. Resting restores it. At 0 you cannot move.
- health:    0..${C.healthMax}. It drains while satiation or hydration is 0, and recovers while
  both are above 0. At 0 you die, permanently.
Satiation and hydration each fall by ${C.satiationDecay} every turn, whatever you do.

WHAT YOU CAN CARRY
- You can hold ${C.inventoryCapacity} items in total, of any mix.
- Eating one grain raises satiation by ${C.eatGain}. Drinking one water raises hydration by ${C.drinkGain}.
- One GATHER picks up ${C.gatherQty} items.

THE ITEMS
- grain: the only thing you can eat.
- water: the only thing you can drink.
- ore: you can carry it. It has no known use.

YOUR ACTIONS — choose exactly one per turn
- {"action":{"type":"MOVE","dir":"N"|"S"|"E"|"W"}}  move one tile. Costs ${C.moveEnergyCost} energy.
    Rejected if: the tile is not passable, it is off the map, or your energy is 0.
- {"action":{"type":"GATHER"}}  take from a resource node or a dropped pile on YOUR OWN tile.
    Rejected if: there is nothing on your tile to take, or you are already carrying ${C.inventoryCapacity} items.
- {"action":{"type":"EAT","item":"grain"}}  Rejected if: the item is not edible, or you do not have it.
- {"action":{"type":"DRINK","item":"water"}}  Rejected if: the item is not drinkable, or you do not have it.
- {"action":{"type":"DROP","item":"grain"|"water"|"ore","qty":1}}  put items on your tile, where anyone can take them.
    Rejected if: you do not have that many.
- {"action":{"type":"REST"}}  restore ${C.restEnergyGain} energy.

A rejected action wastes your turn: the turn passes, you do nothing, and you get hungrier and
thirstier anyway. Your memory records what was rejected and why.

You see only your immediate surroundings — ${C.perceptionRadius} tiles in each direction — plus your own
inventory and your own memory. You cannot see the wider map, and you cannot see what anyone else
is carrying or how they are doing, beyond whether they appear to be in distress.

Reply with ONE JSON object: {"action": ...}. Nothing else.`;
}

// ── per-tick user message ────────────────────────────────────────────────────

// Compact, structured, token-cheap. Prose would cost 3-4× for the same facts (DESIGN §7: "a
// compact struct, not prose. Tokens are the budget.").
function renderMemory(m: readonly MemoryEntry[]): string {
  if (m.length === 0) return '  (nothing yet)';
  return m
    .map((e) => {
      const span = e.count > 1 ? ` ×${e.count}` : '';
      const when = e.count > 1 ? `t${e.firstTick}-${e.lastTick}` : `t${e.lastTick}`;
      switch (e.kind) {
        case 'gathered':
          return `  ${when} you gathered ${e.qty} ${e.item}${span}`;
        case 'ate':
          return `  ${when} you ate ${e.item}${span}`;
        case 'drank':
          return `  ${when} you drank ${e.item}${span}`;
        case 'dropped':
          return `  ${when} you dropped ${e.qty} ${e.item}${span}`;
        case 'rested':
          return `  ${when} you rested${span}`;
        // THE FEEDBACK LOOP. This line is why an illegal proposal is signal and not an error: the
        // referee rejected it, memory coalesced it into a place-bound lesson, and here it is in
        // the next prompt. The model that tried to eat ore, or gathered at a dead node 40 times,
        // reads its own mistake back and can act differently. Remove this and the referee becomes
        // a wall the model can never learn the shape of.
        case 'rejected':
          return `  ${when} REJECTED ${e.action.type} at (${e.tile.x},${e.tile.y}) — "${e.reason}"${span}`;
        case 'starving':
          return `  ${when} you were STARVING${span}`;
        case 'dehydrating':
          return `  ${when} you were DEHYDRATING${span}`;
        case 'witnessed_gathered':
          return `  ${when} ${e.who} took ${e.item} at (${e.tile.x},${e.tile.y})${span}${e.lastUnitCount > 0 ? ` — took the last of it ×${e.lastUnitCount}` : ''}`;
        case 'witnessed_dropped':
          return `  ${when} ${e.who} dropped ${e.qty} ${e.item} at (${e.tile.x},${e.tile.y})${span}`;
        case 'witnessed_died':
          return `  ${when} you saw ${e.count} die at (${e.tile.x},${e.tile.y}) — most recently ${e.who.join(', ')}`;
        case 'witnessed_distress':
          return `  ${when} ${e.who} looked to be in distress${span}`;
        case 'appeared':
          return `  ${when} ${e.who} came into view${span}`;
        case 'departed':
          return `  ${when} ${e.who} went out of view${span}`;
        default: {
          const _exhaustive: never = e;
          throw new Error(`unrendered memory entry ${JSON.stringify(_exhaustive)}`);
        }
      }
    })
    .join('\n');
}

export function renderPerception(p: Perception): string {
  const s = p.self;
  const L: string[] = [];
  L.push(`TURN ${p.tick}`);
  L.push('');
  L.push('YOU');
  L.push(`  at (${s.pos.x},${s.pos.y})`);
  L.push(`  satiation ${s.satiation}/${C.satiationMax}   hydration ${s.hydration}/${C.hydrationMax}   energy ${s.energy}/${C.energyMax}   health ${s.health}/${C.healthMax}`);
  L.push(`  carrying: grain ${s.inventory.grain}, water ${s.inventory.water}, ore ${s.inventory.ore}  (${s.inventory.grain + s.inventory.water + s.inventory.ore}/${s.capacity} used)`);
  L.push('');

  // Only tiles that MATTER: a full 17×17 dump is ~289 lines of mostly empty plain, which is pure
  // token cost. We list what is takeable and what is impassable, and say the rest is walkable —
  // the same information, a fraction of the tokens.
  const here = p.tiles.find((t) => t.x === s.pos.x && t.y === s.pos.y);
  const withStuff = p.tiles.filter((t) => (t.resource && t.resource.stock > 0) || (t.ground && Object.keys(t.ground).length > 0));
  const blocked = p.tiles.filter((t) => !t.passable);
  L.push('YOUR TILE');
  L.push(`  ${here ? describeTile(here) : 'unknown'}`);
  L.push('');
  L.push(`WHAT YOU CAN SEE (within ${C.perceptionRadius} tiles; everything not listed is empty walkable ground)`);
  if (withStuff.length === 0) L.push('  nothing to take anywhere in sight');
  else for (const t of withStuff) L.push(`  (${t.x},${t.y}) ${describeTile(t)}`);
  if (blocked.length > 0) {
    const shown = blocked.slice(0, 12).map((t) => `(${t.x},${t.y})`).join(' ');
    L.push(`  impassable water: ${shown}${blocked.length > 12 ? ` … and ${blocked.length - 12} more` : ''}`);
  }
  L.push('');
  L.push('OTHERS IN SIGHT');
  if (p.agents.length === 0) L.push('  nobody');
  else for (const a of p.agents) L.push(`  ${a.id} at (${a.pos.x},${a.pos.y})${a.distress ? ' — in distress' : ''}`);
  L.push('');
  L.push('YOUR MEMORY');
  L.push(renderMemory(p.memory));
  return L.join('\n');
}

function describeTile(t: { terrain: string; passable: boolean; resource?: { item: string; stock: number }; ground?: Partial<Record<string, number>> }): string {
  const bits: string[] = [t.terrain];
  if (!t.passable) bits.push('impassable');
  if (t.resource && t.resource.stock > 0) bits.push(`${t.resource.item} node (${t.resource.stock} left)`);
  const g = t.ground ? Object.entries(t.ground).filter(([, n]) => (n ?? 0) > 0) : [];
  if (g.length > 0) bits.push(`on the ground: ${g.map(([k, n]) => `${n} ${k}`).join(', ')}`);
  return bits.join(', ');
}

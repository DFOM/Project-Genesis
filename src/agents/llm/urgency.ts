// Who thinks this tick, and what the others do instead.
//
// THE CONFOUND, STATED PLAINLY. Gating saves money by letting only the most urgent agents call
// the model; everyone else falls back to a hardcoded reflex. But a reflex action is a HEURISTIC
// BOT action. So in a gated run, some fraction of every agent's behaviour is bot behaviour, and
// comparing that against the bot baseline compares "bot" against "part-model, part-bot" — a
// contest rigged by construction, in a direction we cannot even sign.
//
// Therefore:
//   • The paired success-criterion run MUST use thinkPolicy 'every-tick'. Not a recommendation:
//     `runLlm` records `modelActionFraction`, and a run below 1.0 is not eligible for the claim.
//   • Gating exists for CHEAP EXPLORATION — shaking the pipeline out, watching a world run, not
//     for anything that ends up in a comparison.
// Every run reports its own provenance so no number is ever ambiguous about who authored it.
// Scale via the CONTRACT, never engine/config — see prompt.ts and contract.ts SCALE.
import { SCALE as C, type Action, type Perception } from '../../engine/contract.js';

export type ThinkPolicy = 'every-tick' | 'urgency-gated';

// How badly does this agent need to make a real decision right now? Higher = more urgent.
// Pure function of Perception — no world access, same bounded view the agent itself gets.
export function urgency(p: Perception): number {
  const s = p.self;
  let u = 0;
  // Needs: the closer to 0, the more urgent. Normalized so both needs weigh the same.
  u += (1 - s.satiation / C.satiationMax) * 100;
  u += (1 - s.hydration / C.hydrationMax) * 100;
  // Actively dying dominates everything else.
  if (s.satiation === 0 || s.hydration === 0) u += 500;
  u += (1 - s.health / C.healthMax) * 200;
  // Novelty/society: someone new in view, or someone visibly in trouble, is worth a thought —
  // this is the hook Phase 5+ needs (a tick where another agent speaks to you is not routine).
  if (p.agents.some((a) => a.distress)) u += 50;
  u += Math.min(p.agents.length, 5) * 5;
  return u;
}

// What a non-thinking agent does. Deliberately MINIMAL — consume what you hold if a need is low,
// otherwise rest. It is not the heuristic bot: no navigation, no gathering, no buffer strategy.
// A richer reflex would be a better survival policy and a worse experiment, because it would
// smuggle more of our hand-written competence into a run labelled "the model's".
export function reflex(p: Perception): Action {
  const s = p.self;
  const LOW = Math.floor(C.satiationMax * 0.15);
  if (s.hydration < LOW && s.inventory.water >= 1) return { type: 'DRINK', item: 'water' };
  if (s.satiation < LOW && s.inventory.grain >= 1) return { type: 'EAT', item: 'grain' };
  return { type: 'REST' };
}

// Pick who thinks. Deterministic: sorts by urgency, ties broken by agent id, never by iteration
// order — so a gated mock run is still byte-reproducible.
export function selectThinkers(perceptions: readonly Perception[], policy: ThinkPolicy, topK: number): Set<string> {
  if (policy === 'every-tick') return new Set(perceptions.map((p) => p.self.id));
  const ranked = [...perceptions].sort((a, b) => {
    const d = urgency(b) - urgency(a);
    return d !== 0 ? d : a.self.id.localeCompare(b.self.id);
  });
  return new Set(ranked.slice(0, topK).map((p) => p.self.id));
}

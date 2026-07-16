// The adapter. An LLM wearing the same `Mind` interface the heuristic bot wears.
//
// It receives a bounded Perception and returns proposals. It never sees World, never mutates
// anything, and gets no privileges the bot doesn't have. The referee judges what it proposes
// exactly as it judges a bot's proposal — including rejecting it, which is the point.
//
// Per call: render → complete → parse → (proposal, reasoning) + one audit record.
//
//   reasoning  → rides with the proposal into the referee → REASONED event, adjacent to outcome
//   record     → RecordSink → store sidecar (heavy: prompt, usage, cost)
//   joined by  → callRef, a pure function of (tick, agentId, callIndex)
import type { Mind, MindResult, Perception, Proposal } from '../../engine/contract.js';
import type { CostMeter } from './budget.js';
import { parseProposal } from './parse.js';
import { buildSystemPrompt, renderPerception, type PersonaMode } from './prompt.js';
import { ACTION_SCHEMA, type LlmProvider } from './provider.js';
import { makeCallRef, type RecordSink } from './record.js';
import { reflex } from './urgency.js';

const MAX_TOKENS = 512; // an action is a few dozen tokens; this is headroom, not a budget

export interface LlmMindOptions {
  provider: LlmProvider;
  meter: CostMeter;
  sink: RecordSink;
  persona?: PersonaMode;
  // Returns true if this agent should call the model this tick. The orchestrator owns the
  // decision (it can see every agent's urgency); the mind just obeys and reports.
  shouldThink: (p: Perception) => boolean;
  // Counts who authored each action, so a run can state its own provenance and a gated run can
  // be disqualified from the paired claim rather than quietly poisoning it.
  tally?: { model: number; reflex: number };
}

export function llmMind(id: string, opts: LlmMindOptions): Mind {
  const system = buildSystemPrompt(opts.persona ?? 'none'); // built ONCE — stable ⇒ cacheable
  let callIndex = 0;

  return {
    id,
    async propose(p: Perception): Promise<MindResult> {
      // Not this agent's turn to think: no call, no tokens, no reasoning to record.
      if (!opts.shouldThink(p)) {
        if (opts.tally) opts.tally.reflex += 1;
        return [reflex(p)];
      }
      // Out of money: the meter has tripped, so stop calling. The run loop is also watching and
      // will pause; falling back here means the in-flight tick still completes cleanly rather
      // than dying half-collected.
      if (opts.meter.exceeded()) {
        if (opts.tally) opts.tally.reflex += 1;
        return [reflex(p)];
      }

      const user = renderPerception(p);
      const callRef = makeCallRef(p.tick, id, callIndex++);
      const started = Date.now(); // orchestrator-side timing only — never enters engine state

      const res = await opts.provider.complete({ system, user, maxTokens: MAX_TOKENS, schema: ACTION_SCHEMA });
      const proposal: Proposal = parseProposal(res.text, res.stopReason);
      const cost = opts.meter.add(res.model, res.usage);

      opts.sink({
        callRef,
        tick: p.tick,
        agentId: id,
        provider: opts.provider.name,
        model: res.model,
        prompt: `${system}\n\n---\n\n${user}`,
        response: res.text,
        usage: res.usage,
        costUSD: cost,
        latencyMs: Date.now() - started,
        stopReason: res.stopReason,
        parseOk: proposal.type !== 'INVALID',
      });

      if (opts.tally) opts.tally.model += 1;
      // The raw response goes into the log verbatim — including when it was junk. A malformed
      // answer is exactly the case where "what did it actually say?" matters most.
      return { actions: [proposal], reasoning: { rawResponse: res.text, callRef } };
    },
  };
}

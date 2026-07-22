// Text → Proposal. Nothing here throws: every failure becomes the INVALID anti-verb, which the
// referee rejects like any other illegal proposal, which lands in memory, which the model reads
// next turn. Malformed output is a thing that happened, not an exception.
//
// The `reason` strings below are a CLOSED, STABLE vocabulary — deliberately a category, never
// the offending text. Memory coalesces rejections by (reason, tile), so a reason containing the
// raw response would produce a brand-new memory entry every single time and the buffer would
// fill with garbage instead of compressing into one lesson ("REJECTED INVALID ×12 — not valid
// JSON"). The raw text is not lost: it is in the REASONED event, verbatim, right beside this
// rejection.
import type { Action, Dir, InvalidProposal, ItemType, Proposal } from '../../engine/contract.js';

export const INVALID_REASONS = {
  empty: 'empty response',
  notJson: 'not valid JSON',
  noAction: 'no action field',
  unknownType: 'unknown action type',
  badField: 'action fields are wrong',
  refused: 'model refused to answer',
  truncated: 'response cut off (too long)',
  // Transport failure after retries are exhausted (429/5xx/connection). The call never returned a
  // usable response, so llmMind synthesises an INVALID with this stable category — the agent's turn
  // is wasted and recorded like any other rejection, and the run rolls on. Categorical (not the raw
  // error text) so it coalesces in memory by (reason, tile) like every other INVALID.
  providerError: 'provider unavailable',
} as const;

const DIRS = new Set<string>(['N', 'S', 'E', 'W']);
const ITEMS = new Set<string>(['ore', 'water', 'grain']);

function invalid(reason: string): InvalidProposal {
  return { type: 'INVALID', reason };
}

// Models sometimes wrap JSON in prose or a ```json fence even under a schema. Recovering the
// object is not "being lenient about the rules" — the RULES are the referee's, and it still
// judges whatever we extract. This only avoids failing an agent's whole turn over a code fence.
function extractJson(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence?.[1]?.trim() ?? t;
  if (body.startsWith('{')) return body;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

function toAction(raw: unknown): Action | InvalidProposal {
  if (typeof raw !== 'object' || raw === null) return invalid(INVALID_REASONS.noAction);
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'MOVE':
      return typeof a.dir === 'string' && DIRS.has(a.dir) ? { type: 'MOVE', dir: a.dir as Dir } : invalid(INVALID_REASONS.badField);
    case 'GATHER':
      return { type: 'GATHER' };
    case 'REST':
      return { type: 'REST' };
    case 'EAT':
      return typeof a.item === 'string' && ITEMS.has(a.item) ? { type: 'EAT', item: a.item as ItemType } : invalid(INVALID_REASONS.badField);
    case 'DRINK':
      return typeof a.item === 'string' && ITEMS.has(a.item) ? { type: 'DRINK', item: a.item as ItemType } : invalid(INVALID_REASONS.badField);
    case 'DROP': {
      const qty = a.qty;
      if (typeof a.item !== 'string' || !ITEMS.has(a.item)) return invalid(INVALID_REASONS.badField);
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) return invalid(INVALID_REASONS.badField);
      return { type: 'DROP', item: a.item as ItemType, qty };
    }
    default:
      return invalid(INVALID_REASONS.unknownType);
  }
}

// Always returns exactly ONE proposal: the engine allows one action per agent per tick, and a
// mind that offers several has misunderstood the turn. We take the first and let the referee
// reject nothing — rather than proposing extras it would reject as 'one action per tick', which
// would teach the model a rule about our plumbing instead of about the world.
export function parseProposal(text: string, stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'other'): Proposal {
  if (stopReason === 'refusal') return invalid(INVALID_REASONS.refused);
  if (stopReason === 'max_tokens') return invalid(INVALID_REASONS.truncated);
  const body = extractJson(text);
  if (body === null) return invalid(text.trim() === '' ? INVALID_REASONS.empty : INVALID_REASONS.notJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return invalid(INVALID_REASONS.notJson);
  }
  if (typeof parsed !== 'object' || parsed === null) return invalid(INVALID_REASONS.notJson);
  const obj = parsed as Record<string, unknown>;
  // Accept {"action":{…}} (the schema) or a bare {"type":…} — same information, and refusing the
  // latter would fail a turn on a formatting nicety the referee doesn't care about.
  const actionRaw = 'action' in obj ? obj.action : 'type' in obj ? obj : undefined;
  if (actionRaw === undefined) return invalid(INVALID_REASONS.noAction);
  return toAction(actionRaw);
}

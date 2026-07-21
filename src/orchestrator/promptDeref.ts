// Dereference a prompt hash back into the prompt itself.
//
//   npm run sim:prompt -- --dir research/… --callref 412:agent-06:0
//   npm run sim:prompt -- --dir research/… --verify            # check EVERY call in the run
//
// llm.jsonl stores each prompt as a content hash rather than 2.7 KB of recomputable text. This
// rebuilds it from the event log and CHECKS THE HASH. If it matches, the reconstruction is proven
// faithful — not merely plausible. If it does not, you are told, loudly, rather than handed a
// convincing forgery.
//
// How the reconstruction works, and why the tick arithmetic matters:
//
//   tick t: perceive(world) → prompt → propose → step() → TICK_COMPLETED{tick: t+1}
//
// The prompt for callRef `t:agent:i` was rendered while `world.tick === t`, i.e. BEFORE that
// tick's own events existed. So replay stops the instant the world reaches tick t — after
// TICK_COMPLETED{tick: t}, or after GENESIS when t is 0. Fold one event too many and you would
// reconstruct a prompt containing the consequences of the very action it was about to propose.
//
// No API key, no network, no spend.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEvent, perceive } from '../engine/index.js';
import type { Event, World } from '../engine/index.js';
import { renderPerception } from '../agents/llm/index.js';
import { hashPrompt, PROMPT_SEPARATOR, type PersistedLlmCall } from './persist.js';

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);

function die(msg: string): never {
  process.stderr.write(`\n${msg}\n\n`);
  process.exit(1);
}

export function loadRun(dir: string): { events: Event[]; calls: PersistedLlmCall[]; system: string } {
  const rd = (f: string): string => {
    try {
      return readFileSync(join(dir, f), 'utf8');
    } catch {
      return die(`missing ${f} in '${dir}'. Runs made before per-run persistence landed do not have it — those reasoning traces are gone.`);
    }
  };
  return {
    events: rd('events.jsonl').trim().split('\n').map((l) => JSON.parse(l) as Event),
    calls: rd('llm.jsonl').trim().split('\n').map((l) => JSON.parse(l) as PersistedLlmCall),
    system: rd('system-prompt.txt').replace(/\n$/, ''),
  };
}

// Replay to the state the world was in AT THE START of `tick` — the moment the prompt was rendered.
export function worldAtTick(events: readonly Event[], tick: number): World {
  let world: World | null = null;
  for (const e of events) {
    world = applyEvent(world, e);
    if (world.tick === tick) return world; // GENESIS gives tick 0; TICK_COMPLETED{t} gives tick t
  }
  if (world === null) die('empty event log');
  return die(`the log never reaches tick ${tick} (it ends at ${world.tick})`);
}

// Rebuild one call's prompt from the log. Returns the prompt and whether it matches the stored hash.
export function rebuildPrompt(events: readonly Event[], system: string, call: PersistedLlmCall): { prompt: string; ok: boolean; hash: string } {
  return promptFrom(worldAtTick(events, call.tick), system, call);
}

function promptFrom(world: World, system: string, call: PersistedLlmCall): { prompt: string; ok: boolean; hash: string } {
  const prompt = system + PROMPT_SEPARATOR + renderPerception(perceive(world, call.agentId));
  const hash = hashPrompt(prompt);
  return { prompt, ok: hash === call.promptHash, hash };
}

// Verify EVERY call in a run, in a SINGLE forward pass over the log.
//
// The obvious implementation — call rebuildPrompt per call — re-folds the whole event log for
// each one: 7,200 calls × ~7,200 events ≈ 52M reducer applications per run, ~3 billion across the
// matrix. An audit nobody can afford to run is not an audit, and this is the command that decides
// whether $1,920 of data is real. So: bucket the calls by tick, fold once, and check each tick's
// calls at the moment the world reaches that tick — O(events + calls).
export function verifyAll(events: readonly Event[], system: string, calls: readonly PersistedLlmCall[]): { ok: number; bad: PersistedLlmCall[] } {
  const byTick = new Map<number, PersistedLlmCall[]>();
  for (const c of calls) {
    const arr = byTick.get(c.tick);
    if (arr) arr.push(c);
    else byTick.set(c.tick, [c]);
  }
  let ok = 0;
  const bad: PersistedLlmCall[] = [];
  let world: World | null = null;
  for (const e of events) {
    world = applyEvent(world, e);
    const due = byTick.get(world.tick);
    if (due === undefined) continue;
    // Checked the instant the world reaches this tick — i.e. before the tick's own events are
    // folded, which is exactly when the prompt was rendered.
    for (const c of due) {
      if (promptFrom(world, system, c).ok) ok++;
      else bad.push(c);
    }
    byTick.delete(world.tick);
  }
  for (const arr of byTick.values()) bad.push(...arr); // ticks the log never reached
  return { ok, bad };
}

function main(): void {
  const dir = argVal('dir') ?? die('--dir <research/…> is required');
  const { events, calls, system } = loadRun(dir);

  // --verify: check every call in the run. This is the audit — it either proves the whole run's
  // prompts are recoverable, or names the ones that are not.
  if (hasFlag('verify')) {
    const { ok, bad } = verifyAll(events, system, calls);
    console.log(`VERIFY ${dir}`);
    console.log(`  ${ok}/${calls.length} prompts rebuilt from the event log and hash-matched`);
    if (bad.length === 0) {
      console.log('  ✓ every paid prompt in this run is recoverable, and provably the original');
    } else {
      console.log(`  ✗ ${bad.length} MISMATCHED — the code that renders prompts has changed since this run.`);
      console.log('    Check out the run\'s git SHA (config.json) and re-verify.');
      for (const c of bad.slice(0, 5)) console.log(`      ${c.callRef}`);
    }
    process.exit(bad.length === 0 ? 0 : 1);
  }

  const ref = argVal('callref') ?? die('--callref <tick:agentId:n> is required (or --verify to check every call)');
  const call = calls.find((c) => c.callRef === ref) ?? die(`no call '${ref}' in this run. Example: ${calls[0]?.callRef ?? '(none)'}`);
  const { prompt, ok, hash } = rebuildPrompt(events, system, call);

  console.log(`callRef ${call.callRef}   tick ${call.tick}   ${call.agentId}   ${call.provider}/${call.model}`);
  console.log(`stored hash  ${call.promptHash}`);
  console.log(`rebuilt hash ${hash}`);
  console.log(ok ? `✓ MATCH — this is the exact prompt that was sent (${call.promptBytes} bytes, rebuilt from the log)` : '✗ MISMATCH — prompt.ts/perceive.ts changed since this run; check out its git SHA');
  console.log(`\n${'='.repeat(78)}\nPROMPT AS SENT\n${'='.repeat(78)}\n`);
  console.log(prompt);
  console.log(`\n${'='.repeat(78)}\nRESPONSE AS RECEIVED (stored verbatim, not rebuilt)\n${'='.repeat(78)}\n`);
  console.log(call.response);
  console.log(`\nusage: ${call.usage.inputTokens} in / ${call.usage.outputTokens} out / ${call.usage.cacheReadTokens} cache-read   cost $${call.costUSD.toFixed(6)}   ${call.latencyMs}ms   parseOk=${call.parseOk}`);
  if (!ok) process.exit(1);
}

if (process.argv[1]?.includes('promptDeref')) main();

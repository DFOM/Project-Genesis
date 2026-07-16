// Keys. Invariant #6: they live in the OS keychain — never in SQLite, never in the event log,
// never in a config file, never in a log line.
//
// A seam with two implementations, because the app and the test/headless paths have genuinely
// different trust models:
//   • envKeyProvider      — headless runs, CI, the research runner. Reads ANTHROPIC_API_KEY from
//                           the environment. The key never touches disk in this repo.
//   • safeStorageKeyProvider — the Electron app (Phase 4 wires the roster UI to it). Electron's
//                           safeStorage encrypts against the OS keychain.
//
// The key crosses exactly one boundary: into the SDK client constructor. It is never returned to
// the engine, never put in an LlmCallRecord, never printed. `describe()` exists so a run can say
// WHERE its key came from without saying WHAT it is.
export interface KeyProvider {
  readonly source: string;
  get(): string;
}

export class MissingKey extends Error {}

export function envKeyProvider(varName = 'ANTHROPIC_API_KEY'): KeyProvider {
  return {
    source: `env:${varName}`,
    get(): string {
      const k = process.env[varName];
      if (!k || k.trim() === '') {
        throw new MissingKey(`no API key in $${varName}. Set it in your shell for a live run; tests and dry runs use MockProvider and need no key.`);
      }
      return k;
    },
  };
}

// A key already decrypted by the Electron main process via safeStorage. The renderer never sees
// it; main constructs the provider. Phase 4 owns the roster UI that stores it.
export function literalKeyProvider(key: string, source = 'keychain:safeStorage'): KeyProvider {
  return { source, get: () => key };
}

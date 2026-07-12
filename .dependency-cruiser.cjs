// Authoritative module-boundary enforcement for GENESIS (npm run lint:boundaries).
// The engine is a pure leaf; agents see only the contract; nobody forms a cycle.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles break the layered architecture.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'engine-is-a-pure-leaf',
      severity: 'error',
      comment: 'src/engine may not import any other layer (CLAUDE.md invariant + purity).',
      from: { path: '^src/engine' },
      to: { path: '^src/(referee|agents|store|orchestrator|ui|main|preload)' },
    },
    {
      name: 'engine-stays-portable',
      severity: 'error',
      comment: 'src/engine may not import electron/react/sqlite.',
      from: { path: '^src/engine' },
      to: { path: 'node_modules/(electron|react|react-dom|better-sqlite3)' },
    },
    {
      name: 'referee-imports-engine-only',
      severity: 'error',
      comment: 'referee may import engine only.',
      from: { path: '^src/referee' },
      to: { path: '^src/(agents|store|orchestrator|ui|main|preload)' },
    },
    {
      name: 'agents-see-only-the-contract',
      severity: 'error',
      comment: 'Bots may import ONLY src/engine/contract — never World internals or other layers.',
      from: { path: '^src/agents' },
      to: {
        path: '^src/(referee|store|orchestrator|ui|main|preload)|^src/engine/(?!contract)',
      },
    },
    {
      name: 'store-imports-engine-only',
      severity: 'error',
      comment: 'store persists engine events; it must not reach agents/referee/ui.',
      from: { path: '^src/store' },
      to: { path: '^src/(agents|referee|ui|main|preload)' },
    },
    {
      name: 'ui-never-reaches-engine-logic',
      severity: 'error',
      comment: 'renderer talks over IPC; it may import engine snapshot TYPES only, never other layers.',
      from: { path: '^src/ui' },
      to: { path: '^src/(referee|store|orchestrator|agents)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js'] },
  },
};

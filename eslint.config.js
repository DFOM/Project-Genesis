// ESLint flat config. Enforces the GENESIS module boundaries and the engine determinism
// guards from CLAUDE.md: the engine is a pure leaf (no agents/ui/referee/store/... imports,
// no electron/react/sqlite), and there is ZERO Math.random / Date.now / clock read under
// src/engine and src/referee.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Bans on non-deterministic sources of entropy/time. Applied to engine + referee.
const determinismGuard = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Non-deterministic. Use the seeded world.rng.' },
    { object: 'Date', property: 'now', message: 'No clock reads in the pure engine.' },
    { object: 'performance', property: 'now', message: 'No clock reads in the pure engine.' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'No clock reads in the pure engine. Ticks come from world state.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "NewExpression[callee.name='Date']", message: 'No clock reads in the pure engine.' },
  ],
};

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.js', '*.config.ts', '.dependency-cruiser.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error', // no `any` (CLAUDE.md stack rule)
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // --- src/engine: the pure leaf. Imports nothing internal, nothing platform-y. ---
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      ...determinismGuard,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/agents/**', '**/ui/**', '**/referee/**', '**/store/**', '**/orchestrator/**', '**/main/**', '**/preload/**'], message: 'engine is a pure leaf: it may not import other layers.' },
            { group: ['electron', 'react', 'react-dom', 'better-sqlite3'], message: 'engine must stay portable: no electron/react/sqlite.' },
          ],
        },
      ],
    },
  },

  // --- src/referee: rules. May import engine only; still deterministic. ---
  {
    files: ['src/referee/**/*.ts'],
    rules: {
      ...determinismGuard,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/agents/**', '**/ui/**', '**/store/**', '**/orchestrator/**', '**/main/**', '**/preload/**'], message: 'referee may import engine only.' },
            { group: ['electron', 'react', 'react-dom', 'better-sqlite3'], message: 'referee must stay portable.' },
          ],
        },
      ],
    },
  },

  // --- src/agents: bots. May import ONLY the engine contract barrel. Never world/referee/store.
  // (dependency-cruiser enforces the positive "engine/contract only" rule authoritatively;
  //  here we hard-ban every engine internal that would leak World, plus the other layers.) ---
  {
    files: ['src/agents/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/engine/types', '**/engine/reducer', '**/engine/genesis', '**/engine/perceive', '**/engine/serialize', '**/engine/rng', '**/engine/events', '**/engine/config', '**/engine/index'], message: 'agents may import ONLY engine/contract — never World internals.' },
            { group: ['**/referee/**', '**/store/**', '**/orchestrator/**', '**/ui/**', '**/main/**', '**/preload/**'], message: 'agents see only Perception; no other layer.' },
            { group: ['electron', 'react', 'react-dom', 'better-sqlite3'], message: 'agents are pure decision functions.' },
          ],
        },
      ],
    },
  },

  // Tests and non-source may use anything.
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);

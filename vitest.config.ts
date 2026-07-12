import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The 5,000-tick determinism run is not a fast unit test.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

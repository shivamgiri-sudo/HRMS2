import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "src/**/__tests__/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // This backend suite is intentionally broad: it includes hundreds of DB,
    // route, static contract, and worker tests. On Windows, the default file
    // parallelism can fan out into dozens of fork workers; when an outer tool
    // times out or the run is interrupted, those workers can be orphaned and
    // make the next verification look like it is hanging. Run files serially so
    // `npm test` is deterministic and exits cleanly on this project.
    fileParallelism: false,
    // Vitest defaults to 5s per test. That is tuned for unit tests, and this suite has 13
    // guards that WALK THE WHOLE SOURCE TREE — schema-column-refs parses all 1,434 .ts files
    // under src/, ist-midnight-hour greps every source file, route-contract enumerates the
    // Express router. Measured 2.5s to 9.3s each depending on cache warmth and machine load,
    // so they straddle the 5s line and fail intermittently.
    //
    // The failure is worse than a plain flake because the message lies: a timeout surfaces
    // under the test's own name, so `ist-midnight-hour` reports "no source file formats an
    // hour with hour12:false" and `schema-column-refs` reports "New broken column
    // reference(s)" — sending whoever reads it hunting a bug that does not exist. A guard
    // that cries wolf is one people learn to ignore, which costs more than the guard is worth.
    //
    // 30s, not 60s: a timeout only consumes wall-clock on a test that is ALREADY failing, so
    // this is free for the 5,738 that pass, while a genuine hang still fails in a reasonable
    // time rather than stalling CI.
    testTimeout: 30_000,
    env: loadEnv("test", process.cwd(), ""),
    envFile: ".env.test",
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
}));

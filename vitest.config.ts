import react from "@vitejs/plugin-react-swc";
import path from "path";

// Not `import { defineConfig } from "vitest/config"`: vitest itself is only
// installed under backend/node_modules (see the note in package.json's "test"
// script), so that subpath is unresolvable when this file is evaluated from the
// repo root. A vitest config is just a plain object with a `test` key —
// defineConfig is optional type sugar, not a runtime requirement.

/**
 * Frontend unit tests. Deliberately separate from vite.config.ts rather than a
 * `test` block merged into it: vite.config.ts has no `test.include`, so running
 * vitest against it falls back to vitest's own default glob, which has no
 * exclusion for .worktrees/ or backend/ and picked up duplicate copies of every
 * backend test from three different worktree checkouts — 378s just to import.
 *
 * No file in src/ touches the DOM. The one test that looked like it might
 * (process-pnl-page.contract.test.tsx) only asserts a string appears in source
 * text; every component test renders via react-dom/server's
 * renderToStaticMarkup. So this runs under environment: "node", matching
 * backend/vitest.config.ts, rather than paying for jsdom.
 */
export default {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    /*
     * 5s (the default) is too short for the contract tests that walk the whole src/ tree —
     * api-route-existence, auth-user-role-idiom and workforce-access-surface each read several
     * hundred files. They pass in ~8s apiece and were failing purely on the clock, which makes
     * the suite look broken and trains people to ignore it.
     */
    testTimeout: 60000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".worktrees", "backend", ".codex-tmp"],
  },
};

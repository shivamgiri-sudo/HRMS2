import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "env.ts",
);

/**
 * A real environment variable must beat the .env file.
 *
 * env.ts used to load every candidate .env with `override: true`, inverting the
 * normal precedence for every module that imports it — which is nearly all of
 * the backend. That made it IMPOSSIBLE to point a backend script at a test
 * database:
 *
 *     DB_HOST=127.0.0.1 DB_PORT=3399 npx tsx scripts/migrate-fresh-test.ts
 *
 * connected to whatever backend/.env named instead. In this checkout that is the
 * production host, and the script whose own header reads "NEVER run against the
 * production database" had no way to be pointed anywhere else.
 *
 * It only surfaced because production is unreachable from this network and the
 * connection timed out. On the office LAN it would have connected and run 400+
 * migrations against production.
 *
 * This is a source-level assertion rather than a runtime one because env.ts
 * reads the filesystem at import time and caches into a module singleton, so a
 * runtime test cannot re-import it with different files without leaking state
 * into every other suite in the process.
 */

describe("environment precedence", () => {
  const source = fs.readFileSync(CONFIG, "utf8");

  it("never loads a .env file with override enabled", () => {
    // The exact regression. `override: true` anywhere in this file means an
    // explicitly-set variable can be silently replaced by a file on disk.
    expect(
      /override\s*:\s*true/.test(source),
      "env.ts loads a .env file with override: true, so a real environment " +
        "variable can no longer point this backend at a test database.",
    ).toBe(false);
  });

  it("still loads .env, so nothing regresses for a normal run", () => {
    // Turning override off must not turn LOADING off: .env still supplies
    // everything the environment does not.
    expect(/dotenv\.config\(/.test(source)).toBe(true);
    expect(/override\s*:\s*false/.test(source)).toBe(true);
  });
});

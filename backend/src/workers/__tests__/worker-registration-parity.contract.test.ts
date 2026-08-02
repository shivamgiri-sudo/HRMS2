import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

/**
 * Every scheduled job is reachable from two entry points: server.ts (the API,
 * which skips them when WORKERS_PROCESS=external) and workers/all-workers.ts
 * (the dedicated process). Production had WORKERS_PROCESS unset on both pm2
 * apps, so the API ran 20 workers alongside the worker process — every job
 * executing twice, which is why sla-breach alerted the same person seconds
 * apart and why the DB circuit breaker kept tripping.
 *
 * The flag is the fix, but it is only safe while all-workers.ts is a superset:
 * anything registered in server.ts alone silently stops the moment the guard is
 * turned on. That is precisely how ats-reminders came to never run.
 */
describe("worker registration parity", () => {
  const server = read("src/server.ts");
  const workers = read("src/workers/all-workers.ts");

  // Starters invoked inside server.ts's WORKERS_EXTERNAL-guarded block.
  const serverStarters = new Set(
    [...server.matchAll(/\b((?:start|init)[A-Z][A-Za-z]+)\(/g)]
      .map((m) => m[1])
      .filter((n) => n !== "startServer")
  );

  it("all-workers.ts registers everything server.ts starts", () => {
    const missing = [...serverStarters].filter((fn) => !workers.includes(fn));
    expect(
      missing,
      `Registered in server.ts but not all-workers.ts. With WORKERS_PROCESS=external ` +
        `these run NOWHERE:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("server.ts still gates worker startup behind WORKERS_PROCESS", () => {
    // Without this the API runs every worker a second time.
    expect(server).toContain('process.env.WORKERS_PROCESS === "external"');
    expect(server).toContain("WORKERS_EXTERNAL");
  });

  it("the five moved from server.ts are present by name", () => {
    for (const name of [
      "ats-reminders",
      "attendance-reconciliation",
      "dashboard-snapshot",
      "privacy-retention",
      "business-action-sync",
    ]) {
      expect(workers, `${name} missing from the WORKERS array`).toContain(`name: "${name}"`);
    }
  });
});

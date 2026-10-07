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

  /**
   * Starters the API process owns in EVERY topology, so all-workers.ts must not
   * carry them. The cache warmers fill in-memory caches that the API's own
   * request handlers read — warmed in the workers process they would load the DB
   * for a cache nobody serves from. Meta lead sync was deliberately placed on the
   * API's WORKERS_PROCESS=external path (49f96b644); a second copy in the workers
   * process would run the lead outreach twice.
   *
   * Being listed here is not an exemption from running: each must be started by
   * server.ts somewhere OUTSIDE its `if (!WORKERS_EXTERNAL)` blocks, asserted below.
   */
  const API_PROCESS_OWNED = [
    "startFeedHealthCacheWarmer",
    "startOnfidoCacheWarmer",
    "startOpsSummaryWarmer",
    // Warms the API process's in-memory P&L allocation summary cache (canonical-pnl.service.ts).
    "startPnlSummaryWarmer",
    "startMetaLeadSyncScheduler",
    // Scheduled MIS emails (e93e050e1): gated by its own MIS_EMAIL_SCHEDULER_ENABLED,
    // started outside the guards, and toggled by mis-scheduler-enable.yml, which
    // restarts hrms2-backend only. Both pm2 apps read the same backend/.env, so a
    // copy in all-workers.ts would start a second ticker in hrms2-workers.
    "startMisEmailScheduler",
  ];

  // server.ts with every `if (!WORKERS_EXTERNAL) { ... }` block cut out: what is
  // left is the code that still runs when the API has WORKERS_PROCESS=external.
  const serverWhenExternal = (() => {
    const guard = "if (!WORKERS_EXTERNAL) {";
    let out = server;
    for (let at = out.indexOf(guard); at !== -1; at = out.indexOf(guard)) {
      let depth = 0;
      let end = at + guard.length - 1;
      for (; end < out.length; end++) {
        if (out[end] === "{") depth++;
        else if (out[end] === "}" && --depth === 0) break;
      }
      out = out.slice(0, at) + out.slice(end + 1);
    }
    return out;
  })();

  it("all-workers.ts registers everything server.ts starts", () => {
    const missing = [...serverStarters].filter(
      (fn) => !API_PROCESS_OWNED.includes(fn) && !workers.includes(fn)
    );
    expect(
      missing,
      `Registered in server.ts but not all-workers.ts. With WORKERS_PROCESS=external ` +
        `these run NOWHERE:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("API-owned starters run in the API under WORKERS_PROCESS=external and nowhere else", () => {
    expect(serverWhenExternal).not.toContain("if (!WORKERS_EXTERNAL)");
    for (const fn of API_PROCESS_OWNED) {
      expect(serverStarters.has(fn), `${fn} is no longer started by server.ts — drop it from API_PROCESS_OWNED`).toBe(true);
      expect(
        serverWhenExternal,
        `${fn} is only started inside a !WORKERS_EXTERNAL block, so it runs NOWHERE in production`
      ).toMatch(new RegExp(`\\b${fn}\\(`));
      expect(workers, `${fn} is API-owned; registering it in all-workers.ts runs it twice`).not.toContain(fn);
    }
    // The guarded-only case this list must never hide.
    expect(serverWhenExternal).not.toMatch(/\bstartExitAutoAdvanceScheduler\(/);
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

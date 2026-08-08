/**
 * Every scheduled job runs in exactly ONE place.
 *
 * worker-registration-parity guards one direction — anything in server.ts must
 * also be in all-workers.ts, or it stops running when WORKERS_PROCESS=external.
 * It cannot see the two failures found on 2026-08-08, because both live outside
 * the pair of files it reads.
 *
 * 1. DOUBLE EXECUTION. official-email, integration and daily-games were started
 *    at server.ts top level, outside BOTH env.ENABLE_SCHEDULERS and the
 *    WORKERS_EXTERNAL guard, while all-workers.ts also registered all three. In
 *    production both processes ran them — the same defect the parity test's own
 *    comment blames for sla-breach "alerting the same person seconds apart".
 *
 * 2. NO EXECUTION IN THE WORKER PROCESS. social-feed and mcnmeet were started at
 *    app.ts MODULE SCOPE, so they ran on any import of the app, in the API only,
 *    in no registry and behind no switch. mcnmeet mails meeting reminders every
 *    5 minutes with an initial run 30s after boot.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

describe("worker single execution", () => {
  const app = read("src/app.ts");
  const server = read("src/server.ts");
  const workers = read("src/workers/all-workers.ts");

  it("app.ts starts no schedulers at module scope", () => {
    // Module scope means column 1 — inside a function it would be indented.
    const moduleScopeStarts = [...app.matchAll(/^(start[A-Za-z]*(?:Cron|Worker|Scheduler))\(/gm)]
      .map((m) => m[1]);

    expect(
      moduleScopeStarts,
      `Started on import of app.ts, so they run wherever the app is imported and ` +
        `appear in no worker registry:\n  ${moduleScopeStarts.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no starter registered in all-workers.ts is also called unguarded in server.ts", () => {
    const registered = [...workers.matchAll(/\b(start[A-Za-z]+)\b/g)].map((m) => m[1]);

    // Everything before the WORKERS_EXTERNAL guard runs in the API unconditionally.
    const guardAt = server.indexOf("!WORKERS_EXTERNAL");
    expect(guardAt, "server.ts no longer guards worker startup").toBeGreaterThan(-1);
    const beforeGuard = server.slice(0, guardAt);

    const doubled = [...new Set(registered)].filter((fn) =>
      new RegExp(`^\\s*${fn}\\(`, "m").test(beforeGuard),
    );

    expect(
      doubled,
      `Registered in all-workers.ts AND called before server.ts's WORKERS_EXTERNAL ` +
        `guard — these execute twice in production:\n  ${doubled.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the two crons moved off app.ts are registered as workers", () => {
    for (const name of ["social-feed", "mcnmeet"]) {
      expect(workers, `${name} missing from the WORKERS array`).toContain(`name: "${name}"`);
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * all-workers.ts starts workers one after another and awaits each start(). A start() that awaits a long
 * first run therefore holds back every worker listed after it. apr-vicidial-sync used to await its
 * multi-minute startup sync; the three report workers sit after it, so with deploys restarting the
 * process every few minutes the emailed-report queue was never served (2026-10-07).
 */
describe("worker startup does not block the sequential starter", () => {
  const src = readFileSync(resolve(__dirname, "../apr-vicidial-sync.worker.ts"), "utf8");
  const start = src.slice(src.indexOf("export async function startAprVicidialSyncWorker"));

  it("runs the startup APR sync in the background", () => {
    const body = start.slice(0, start.indexOf("export function stopAprVicidialSyncWorker"));
    expect(body).toMatch(/void runAprSync\(\)/);
    expect(body).not.toMatch(/await runAprSync\(\)/);
  });
});

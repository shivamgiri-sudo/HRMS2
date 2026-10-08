/**
 * Where the UAT job runner is registered.
 *
 * WHY THIS TEST EXISTS
 *   This repository runs two processes: the API (server.ts) and the worker runner
 *   (all-workers.ts). A worker registered in only one of them silently never runs in the
 *   other — and because nothing errors, the symptom is a feature that appears deployed and
 *   does nothing. That exact shape killed the biometric payroll feed for weeks, and five
 *   other workers were found registered in server.ts alone.
 *
 *   Source-text assertions rather than imports: importing all-workers.ts would start every
 *   scheduler in the repository inside the test process. Reading the file is the cheap,
 *   side-effect-free way to assert the wiring.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendSrc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const allWorkers = readFileSync(join(backendSrc, "workers", "all-workers.ts"), "utf8");
const server = readFileSync(join(backendSrc, "server.ts"), "utf8");

describe("uat-job-runner registration", () => {
  it("is registered in all-workers.ts", () => {
    expect(allWorkers).toContain("startUatJobRunner");
    expect(allWorkers).toMatch(/name:\s*"uat-job-runner"/);
  });

  it("appears exactly once in the WORKERS array", () => {
    // A duplicate entry would start two pollers in one process, each claiming jobs — which
    // works, but doubles the poll rate and makes the lease owner ambiguous in the console.
    const entries = allWorkers.match(/name:\s*"uat-job-runner"/g) ?? [];
    expect(entries).toHaveLength(1);
  });

  it("is absent from server.ts", () => {
    // Both processes run in production. Registering in both would poll the same queue twice.
    expect(server).not.toContain("startUatJobRunner");
    expect(server).not.toContain("uat-job-runner");
  });

  it("registers its handlers before starting the runner", () => {
    // A claimed job whose type has no handler goes straight to `dead`. Registering after the
    // runner starts would kill the first tick's work — permanently, since dead is terminal.
    const line = allWorkers
      .split("\n")
      .find((l) => l.includes("startUatJobRunner()") && l.includes("start:"));
    expect(line, "expected a WORKERS entry that starts the runner").toBeDefined();
    expect(line!.indexOf("registerUatJobHandlers()")).toBeGreaterThanOrEqual(0);
    expect(line!.indexOf("registerUatJobHandlers()")).toBeLessThan(
      line!.indexOf("startUatJobRunner()")
    );
  });

  it("is stopped on shutdown", () => {
    // A poller left running holds the interval and delays a clean exit.
    expect(allWorkers).toContain("stopUatJobRunner()");
  });
});

describe("the runner claims work safely", () => {
  const runner = readFileSync(
    join(backendSrc, "modules", "uat-pipeline", "uat-job-runner.ts"),
    "utf8"
  );

  it("claims with an UPDATE, not a SELECT-then-UPDATE", () => {
    // SELECT first would let two workers read the same row before either wrote — the classic
    // double dispatch, which here means paying twice for one LLM call.
    expect(runner).toMatch(/UPDATE uat_job[\s\S]*?SET state = 'leased'/);
    expect(runner).toMatch(/ORDER BY run_after\s*\n\s*LIMIT 1/);
  });

  it("reclaims expired leases in the same statement as the claim", () => {
    // Crash recovery by the clock, with no separate sweeper that would itself have to
    // survive the crash.
    expect(runner).toMatch(/state = 'leased' AND leased_until < NOW\(\)/);
  });

  it("has a dead state and does not retry forever", () => {
    expect(runner).toContain("state='dead'");
    expect(runner).toMatch(/attempts >= job\.maxAttempts/);
  });

  it("enqueues idempotently", () => {
    expect(runner).toMatch(/INSERT IGNORE INTO uat_job/);
    expect(runner).toContain("idempotency_key");
  });
});

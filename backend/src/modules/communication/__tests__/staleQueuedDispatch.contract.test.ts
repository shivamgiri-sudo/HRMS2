/**
 * Dispatches abandoned in 'queued' must be reported, and must NOT be resent.
 *
 * dispatchService writes a dispatch_log row as 'queued', calls the provider, then
 * updates it to 'sent' or 'failed'. Nothing in the codebase scans for 'queued' — so a
 * process that dies between the insert and the update leaves the row at 'queued'
 * forever: never sent, never retried, and invisible, because nobody queries a status
 * that is meant to be transient.
 *
 * Live evidence: 21 rows sit at 'queued' from 2026-08-07 03:31, all e-sign
 * notifications, orphaned when the workers process was stopped mid-dispatch to end the
 * mail storm. Those were better unsent — but the same gap silently drops a payroll or
 * F&F notification, where silence is the wrong outcome.
 *
 * The important half of this test is the negative one. The row is written BEFORE the
 * provider call, so a stale 'queued' cannot distinguish "never sent" from "sent, but
 * the process died before recording it". Auto-retrying would double-send to real
 * people, and for a financial notification that is worse than the original loss.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../cleanup.cron.ts"), "utf8");
// The explanation above the implementation discusses resending in order to rule it out;
// stripping comments keeps that prose from satisfying the assertions below.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("stale queued dispatches", () => {
  it("looks for rows left in queued past a threshold", () => {
    expect(code).toContain("status = 'queued'");
    expect(code).toMatch(/created_at < NOW\(\) - INTERVAL \? HOUR/);
  });

  it("reports them loudly enough to be actioned", () => {
    expect(code).toMatch(/console\.warn/);
    // The count alone is not actionable; the oldest timestamp says whether this is a
    // one-off crash or an ongoing leak.
    expect(code).toContain("MIN(created_at)");
  });

  it("does NOT resend or requeue them", () => {
    const fn = code.slice(code.indexOf("export async function reportStaleQueuedDispatches"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const forbidden of ["UPDATE dispatch_log", "INSERT INTO dispatch_log", "DELETE FROM dispatch_log", "send("]) {
      expect(body, `${forbidden} would risk delivering a message twice`).not.toContain(forbidden);
    }
  });

  it("counts critical dispatches separately, since those are the ones worth chasing", () => {
    expect(code).toContain("is_critical = 1");
  });

  it("cannot break the pruning it runs alongside", () => {
    // Cleanup's job is deleting old rows; a failure in this addition must not stop it.
    const runner = code.slice(code.indexOf("export async function runCommunicationCleanup"));
    const call = runner.slice(runner.indexOf("reportStaleQueuedDispatches"));
    expect(runner).toContain("try {");
    expect(call.slice(0, 200)).toContain("catch");
  });
});

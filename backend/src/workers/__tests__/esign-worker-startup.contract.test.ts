/**
 * The eSign worker must actually run, and must not blast on boot.
 *
 * Both failure modes have now happened in production, three hours apart:
 *
 *   1. ORIGINAL — a cycle ran immediately at startup while cooldowns lived in
 *      process memory. Every restart began with an empty cooldown and re-sent
 *      everything: 1,818 messages over three days, email and SMS, to 10 contacts
 *      from three pending documents.
 *   2. MY FIRST FIX — removing the startup cycle entirely. Wrong. Several
 *      sessions deploy to this box (seven restarts in five hours on 2026-08-08),
 *      and a 4-hour interval that resets on every boot never elapses. The worker
 *      sat with worker_config.last_run_at NULL and zero rows in
 *      esign_notification_cooldown for five hours after being enabled. Curing a
 *      mail storm by making the mail silent is not a fix.
 *
 * The resolution is that the DURABLE cooldown, not the absence of a startup run,
 * is what makes booting safe — it caps a reminder at one per document per 24h
 * however often the process starts. The startup run is restored but delayed past
 * the window a crash-loop lives in.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, "../esign-compliance.worker.ts"),
  "utf8",
);
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("esign-compliance worker startup", () => {
  it("DOES schedule a first run at boot — it must not wait a full interval", () => {
    // Regression 2: with no startup timer, a box that restarts more often than
    // the interval never runs the worker at all.
    expect(codeOnly).toMatch(/setTimeout\(/);
    expect(codeOnly).toContain("STARTUP_DELAY_MS");
  });

  it("does NOT run a cycle synchronously at startup", () => {
    // Regression 1: `await processEsignCompliance()` as the first statement of
    // start() is what made every restart a fresh blast. The check is positional
    // rather than textual — the calls inside the setTimeout and setInterval
    // callbacks are the correct ones, so simply grepping for the call name
    // flags working code.
    const start = codeOnly.slice(codeOnly.indexOf("export async function startEsignComplianceWorker"));
    const body = start.slice(0, start.indexOf("\n}"));

    const firstCall = body.indexOf("processEsignCompliance(");
    const firstSchedule = Math.min(
      ...[body.indexOf("setTimeout("), body.indexOf("setInterval(")].filter((i) => i > -1),
    );

    expect(firstCall, "the worker never invokes a cycle").toBeGreaterThan(-1);
    expect(
      firstCall,
      "a cycle is invoked before anything schedules it — that is the immediate startup blast",
    ).toBeGreaterThan(firstSchedule);
  });

  it("delays the first run past a crash-loop's lifetime", () => {
    const m = source.match(/const STARTUP_DELAY_MS = ([^;]+);/);
    expect(m, "STARTUP_DELAY_MS not defined").not.toBeNull();
    // pm2 here: restart_delay 5000, max_restarts 10 — a loop is over inside a
    // minute. Anything under that would let a crash-loop mail candidates.
    const value = Number(eval(m![1]));
    expect(value).toBeGreaterThanOrEqual(60 * 1000);
  });

  it("cancels the pending first run on shutdown", () => {
    const stop = codeOnly.slice(codeOnly.indexOf("export function stopEsignComplianceWorker"));
    expect(stop).toContain("clearTimeout");
    expect(stop).toContain("clearInterval");
  });

  it("still keeps the recurring interval", () => {
    expect(codeOnly).toMatch(/setInterval\([\s\S]{0,120}CHECK_INTERVAL_MS/);
  });

  it("the safety that permits a startup run is the DURABLE cooldown", () => {
    // If cooldowns ever go back into memory, a startup run becomes a storm again.
    expect(codeOnly).toContain("esign_notification_cooldown");
    expect(codeOnly).not.toMatch(/new Map<string, number>\(\)/);
  });

  it("claims the cooldown BEFORE dispatching, not after", () => {
    // An unrecorded successful send repeats on the next cycle.
    const claimAt = codeOnly.indexOf('markSent(item.employee_id, item.checklist_id, "reminder")');
    const sendAt = codeOnly.indexOf('eventCode: "esign_reminder"');
    expect(claimAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(claimAt, "cooldown must be claimed before the dispatch").toBeLessThan(sendAt);
  });
});

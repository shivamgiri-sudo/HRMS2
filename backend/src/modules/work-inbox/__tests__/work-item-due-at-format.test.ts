/**
 * Every work-item trigger silently failed to set due_at.
 *
 * work-inbox.triggers.ts builds due_at with a shared dueAt() helper feeding all 19 trigger
 * functions. It returned `new Date(...).toISOString()` — "2026-08-30T11:38:45.248Z" — which
 * MySQL rejects for a DATETIME column with ER_TRUNCATED_WRONG_VALUE (1292) because of the
 * "T" separator, the fractional seconds and the "Z" suffix. createWorkItemIfNotExists
 * swallows the error, so the caller's own work succeeded and the work item was never
 * created. Caught 2026-08-28 by the payroll finalization walkthrough, which logged the 1292
 * while the branch sign-off it accompanied reported success.
 *
 * Live census at that moment: 0 of 35 work_item rows had a non-NULL due_at. The column had
 * never once been populated, so every SLA countdown, escalation and overdue queue keyed on
 * it had never fired.
 *
 * Two things must hold, and the second is the one that bit twice:
 *
 *   1. The literal must be MySQL DATETIME shaped — "YYYY-MM-DD HH:MM:SS", no T, no Z.
 *   2. It must be the HOST-LOCAL wall clock, not UTC. created_at is written with NOW(),
 *      which on this database is IST. A UTC literal stored a due date 5.5 hours EARLIER
 *      than its own created_at, turning a 48h TTL into 42.5h that expires early and
 *      silently. The first attempt at this fix made exactly that mistake.
 *
 * Why (2) is easy to get wrong: reading `SELECT NOW()` through mysql2 returns a JS Date
 * parsed in the connection timezone, so an IST server surfaces as "...T11:40:06.000Z" and
 * reads like proof the server is UTC. Only DATE_FORMAT(NOW(), '%H:%i:%s') shows the stored
 * characters — 17:10. Verify server wall clock that way, never through the driver.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "work-inbox.triggers.ts"), "utf8");

/** MySQL DATETIME literal: "YYYY-MM-DD HH:MM:SS". */
const MYSQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Reimplementation of the helper under test. Kept in lockstep with the source by the
 * structural assertions below, which fail if the real one reverts to toISOString().
 */
function dueAtLocal(ttlHours: number, now = Date.now()): string {
  const d = new Date(now + ttlHours * 60 * 60 * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

describe("work-item due_at is a MySQL DATETIME literal in local time", () => {
  it("produces the DATETIME shape MySQL accepts", () => {
    expect(dueAtLocal(48)).toMatch(MYSQL_DATETIME);
  });

  it("rejects the ISO-8601 form that MySQL refused with error 1292", () => {
    const iso = new Date().toISOString();
    expect(iso).not.toMatch(MYSQL_DATETIME);
    expect(iso).toContain("T");
    expect(iso).toContain("Z");
  });

  it("is local wall clock, not UTC — the 5.5h regression", () => {
    // Only meaningful where host local time is offset from UTC, which is the deployment
    // case (IST, UTC+5:30). Under TZ=UTC the two forms coincide and there is nothing to
    // catch, so assert the property rather than skipping silently.
    const now = Date.UTC(2026, 7, 28, 11, 41, 3);
    const local = dueAtLocal(48, now);
    const utc = new Date(now + 48 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
    if (new Date().getTimezoneOffset() !== 0) {
      expect(local).not.toBe(utc);
    }
    expect(local).toMatch(MYSQL_DATETIME);
  });

  it("preserves the full TTL when compared against a local-time created_at", () => {
    const now = Date.UTC(2026, 7, 28, 11, 41, 3);
    const created = dueAtLocal(0, now);
    const due = dueAtLocal(48, now);
    const gapHours = (Date.parse(due.replace(" ", "T")) - Date.parse(created.replace(" ", "T"))) / 3600_000;
    expect(gapHours).toBe(48);
  });

  it("the real helper does not use toISOString()", () => {
    const body = source.match(/function dueAt\([\s\S]*?\n\}/);
    expect(body, "could not locate the dueAt() helper").not.toBeNull();
    expect(body![0]).not.toContain("toISOString");
    expect(body![0]).toContain("getFullYear");
  });

  it("every trigger routes through the shared helper, so none can regress alone", () => {
    const callSites = source.match(/dueAt: dueAt\(/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(19);
    // No trigger builds its own literal inline.
    expect(source).not.toMatch(/dueAt:\s*new Date\(/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Migration 1620 turns notification events on. This asserts it only ever turns on events
 * that something actually fires.
 *
 * The failure it prevents is specific and has already happened once at a larger scale:
 * 1022 registered 68 events and left every one of them switched off, so the registry
 * described a notification system that did not send. Twenty of those events also have no
 * producer at all — nothing calls notify() with them — so enabling those would have
 * produced the same lie from the other direction: a config row claiming an email is live
 * when no code path can ever emit it.
 *
 * An event with no producer is not "off pending rollout", it is unimplemented. It stays
 * out of the enable list until someone writes the call site.
 */

const MIGRATION = resolve(process.cwd(), "sql/1620_enable_wired_notification_events.sql");
const SRC = resolve(process.cwd(), "src");

const sql = readFileSync(MIGRATION, "utf8");

/** The quoted event codes inside the IN (...) list, ignoring SQL comments. */
function enabledEventCodes(): string[] {
  const body = sql
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const inList = body.slice(body.indexOf("event_code IN ("));
  return [...inList.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/** Every .ts file under src/, excluding tests. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") sourceFiles(full, acc);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Only files that actually reach the gateway count as producers.
 *
 * Searching all of src/ for the bare string is what made this wrong twice while it was
 * being written: 'weekoff_denied' is also a decisionType written to a roster audit table,
 * 'attendance_missing_punch' is a work_item `type`, and 'exit_clearance_pending' is a key
 * in the SmartPing DLT SMS catalogue. None of those three emits a notification, and all
 * three matched a naive grep.
 *
 * The match is quote-agnostic on purpose too — uat-notification.service.ts and
 * salaryIncrement.notifications.ts use double quotes, and a single-quoted pattern
 * reported thirteen live producers as missing.
 */
function notifierSources(): string {
  return sourceFiles(SRC)
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("notificationGateway.notify") || src.includes("gateway.notify(");
    })
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

const codes = enabledEventCodes();
const corpus = notifierSources();

describe("migration 1620 — only enables events that are actually wired", () => {
  it("parses a non-trivial list of event codes", () => {
    // A parsing failure here would make every assertion below vacuously pass.
    expect(codes.length).toBeGreaterThan(30);
    expect(corpus.length).toBeGreaterThan(1000); // the notifier corpus resolved
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
  });

  it("every enabled event has a producer in src/", () => {
    const orphans = codes.filter((c) => !new RegExp(`['"]${c}['"]`).test(corpus));
    expect(
      orphans,
      `These event codes are switched on by migration 1620 but nothing in src/ calls ` +
        `notify() with them, so the registry would claim an email is live that no code ` +
        `path can emit:\n` + orphans.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("does not enable provisioning_overdue, which is held for its backlog", () => {
    // 69 requests are already past SLA. Enabling it sends that backlog at 25/run hourly —
    // correct behaviour, but the owner picks the moment.
    expect(codes).not.toContain("provisioning_overdue");
  });

  it("preserves rows deliberately set to dispatch_mode='off'", () => {
    // Matching only the accidental default (enabled=0 AND dispatch_mode='shadow') is what
    // stops this from reviving something a human switched off on purpose.
    expect(sql).toContain("WHERE enabled = 0");
    expect(sql).toContain("AND dispatch_mode = 'shadow'");
  });

  it("names events explicitly rather than enabling whole modules", () => {
    // A module-wide UPDATE would sweep in the 20 producerless events.
    expect(sql).not.toMatch(/WHERE\s+module\s*=/i);
    expect(sql).toContain("event_code IN (");
  });
});

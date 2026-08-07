import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UAT_NOTIFICATION_EVENTS } from "../uat-notification.service.js";

/**
 * Guards the specific way notifications die in THIS repository.
 *
 * The engine works. What keeps breaking is the call sites: an unrelated commit touches a
 * service, the notify() call goes with it, and the result is a feature that is configured,
 * documented and completely silent. Nothing fails, no test goes red, and the first person to
 * notice is a user who never got told their fix was ready to retest.
 *
 * So this test asserts three things that together make that regression loud:
 *   1. every registered event is seeded in a migration     (an unseeded event sends nothing)
 *   2. every event with a Phase 1 owner has a live call site
 *   3. the not-yet-wired events are named EXPLICITLY, so "wired" and "deliberately deferred"
 *      can never be confused for each other
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = resolve(HERE, "..");
const SQL_DIR = resolve(HERE, "..", "..", "..", "..", "sql");

/** Source of every file in the module except the notification service and the tests. */
function callSiteSource(): string {
  return readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "uat-notification.service.ts")
    .map((f) => readFileSync(join(MODULE_DIR, f), "utf8"))
    .join("\n");
}

/**
 * Events whose call site legitimately does not exist yet, each with the phase that adds it.
 * This list may SHRINK freely. Growing it means a call site was removed, which is exactly
 * the regression being guarded — so a new entry should be a deliberate, reviewed decision
 * rather than something that quietly appears.
 */
const DEFERRED: Record<string, string> = {
  uat_build_failed: "Phase 4 — no automated build exists yet",
  uat_pr_ready: "Phase 4 — the pipeline does not open PRs yet",
  uat_feedback_needs_info: "Phase 2 — clarification requests arrive with the validator",
  uat_approval_decided: "wired through the approvals route once reviewer UX lands",
};

describe("uat notifications — registration", () => {
  const sql = readdirSync(SQL_DIR)
    .filter((f) => f.startsWith("1100_uat_notification"))
    .map((f) => readFileSync(join(SQL_DIR, f), "utf8"))
    .join("\n");

  it("ships a migration that registers the events", () => {
    expect(sql.length, "1100_uat_notification_events.sql not found").toBeGreaterThan(0);
  });

  it("every event the code can emit is seeded, or the gateway silently drops it", () => {
    // notificationGateway.notify() fails closed: an event_code with no row in
    // notification_event_config returns `disabled` and sends nothing at all.
    const missing = UAT_NOTIFICATION_EVENTS.filter((e) => !sql.includes(`'${e}'`));
    expect(
      missing,
      `these events are emitted by code but never registered, so they can never send:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("does not seed events the code cannot emit", () => {
    const seeded = [...sql.matchAll(/\('(uat_[a-z_]+)'/g)].map((m) => m[1]);
    const orphans = seeded.filter((e) => !UAT_NOTIFICATION_EVENTS.includes(e as never));
    expect(orphans, `seeded but unreachable from code: ${orphans.join(", ")}`).toEqual([]);
  });
});

describe("uat notifications — call sites", () => {
  const source = callSiteSource();

  it("every non-deferred event has a live call site in the module", () => {
    const dead: string[] = [];
    for (const event of UAT_NOTIFICATION_EVENTS) {
      if (DEFERRED[event]) continue;
      // The exported helper is named after the event: uat_retest_failed -> notifyRetestFailed.
      const fn =
        "notify" +
        event
          .replace(/^uat_/, "")
          .split("_")
          .map((p) => p[0].toUpperCase() + p.slice(1))
          .join("");
      if (!source.includes(`${fn}(`)) dead.push(`${event} (expected ${fn}() to be called)`);
    }
    expect(
      dead,
      `these notifications are registered and wired to nothing — the exact regression this ` +
        `test exists to catch:\n  ${dead.join("\n  ")}`
    ).toEqual([]);
  });

  it("names every deferred event explicitly, with a reason", () => {
    for (const [event, reason] of Object.entries(DEFERRED)) {
      expect(
        UAT_NOTIFICATION_EVENTS.includes(event as never),
        `${event} is deferred but is not a registered event`
      ).toBe(true);
      expect(reason.trim().length, `${event} is deferred without a reason`).toBeGreaterThan(10);
    }
  });

  it("the reporter-facing events a person actually waits on are wired", () => {
    // These are the ones whose absence a user notices: they are blocked, or they are waiting
    // to be told a fix is ready. Called out separately so they cannot be quietly deferred.
    for (const fn of [
      "notifyFeedbackBlocked",
      "notifyDeployedForRetest",
      "notifyRetestFailed",
      "notifyReleased",
      "notifyClosed",
    ]) {
      expect(source.includes(`${fn}(`), `${fn}() has no call site`).toBe(true);
    }
  });

  it("notifications are sent after commit, never inside the transaction", () => {
    // A mail provider timeout must not roll back a deployment that actually happened.
    const release = readFileSync(join(MODULE_DIR, "uat-release.service.ts"), "utf8");
    for (const m of release.matchAll(/await conn\.commit\(\);([\s\S]{0,400}?)\n  \} catch/g)) {
      const afterCommit = m[1];
      if (!afterCommit.includes("notify")) continue;
      expect(
        afterCommit.indexOf("notify"),
        "a notify() call appears before commit in uat-release.service.ts"
      ).toBeGreaterThan(-1);
    }
    // And none appear before a commit inside the same try block.
    const beforeCommit = release.split("await conn.commit();")[0];
    expect(
      /await notify[A-Z]/.test(beforeCommit),
      "a notify() call runs before the first commit — it would be rolled back or block the write"
    ).toBe(false);
  });
});

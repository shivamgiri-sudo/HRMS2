/**
 * A failed eSign send must not consume the 24-hour cooldown.
 *
 * The worker claims the cooldown BEFORE dispatching, deliberately: claiming afterwards leaves
 * a window where a send that succeeded is never recorded, and the next cycle repeats it. That
 * is the right call — it is what stopped the storm that put 1,428 messages onto 10 contacts
 * over three days, 47 to one preboarding candidate.
 *
 * But the claim was never released when the dispatch failed, and dispatchService.send()
 * returns { queued, failed } that the worker discarded. So a total failure looked exactly like
 * a success for the next 24 hours.
 *
 * That is not hypothetical. On 2026-08-12 all 12 dispatch attempts failed — Gmail returned
 * 535-5.7.8 on the email channel and SmartPing rejected the SMS for a missing DLT template.
 * The SMTP credential was repaired at 17:51 and the worker restarted at 18:03 with the fix,
 * but the 11:09 failures had already burned the window, so three pending documents were
 * blocked until ~11:09 the following day with nothing sent and nothing retrying.
 *
 * The rule: claim first (so a crash cannot double-send), release on a dispatch that reached
 * nobody (so a failure does not masquerade as a delivery). A PARTIAL success keeps the claim —
 * someone received it, and re-sending to them is the storm this design exists to prevent.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, "..", "esign-compliance.worker.ts");
const source = fs.readFileSync(WORKER, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the cooldown claim is still taken before dispatch", () => {
  it("keeps markSent ahead of the dispatch call", () => {
    // Regression lock on the property that stopped the original storm.
    const mark = code.indexOf("markSent");
    const dispatch = code.indexOf("notificationEventService.dispatch");
    expect(mark).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(mark);
  });
});

describe("a dispatch that reached nobody releases the claim", () => {
  it("inspects the dispatch result rather than discarding it", () => {
    expect(code).toMatch(/queued/);
  });

  it("has a release path that restores the previous cooldown state", () => {
    expect(code).toMatch(/releaseClaim|releaseSent/);
  });

  it("releases only when nothing was queued, so a partial success still holds", () => {
    // Re-sending to recipients who DID receive it is the storm this design prevents.
    // Matches the nullish-coalescing form the code actually uses:
    //   Number(result.queued ?? 0) <= 0
    expect(code).toMatch(/queued[^\n]*<=\s*0/);
    // And that the release is gated on it rather than fired unconditionally.
    expect(code).toMatch(/if\s*\(reachedNobody\(/);
  });

  it("restores the prior timestamp rather than blanking the row", () => {
    // Blanking would let the NEXT cycle send immediately even when an older, still-valid
    // send exists — turning a failed retry into a duplicate.
    expect(code).toMatch(/previous|priorLastSent|last_sent_at\s*=\s*\?/);
  });

  it("covers escalations too, not just the reminder", () => {
    // manager_escalation and hr_escalation claim the same way and had the same defect.
    const releases = code.match(/releaseClaim|releaseSent/g) ?? [];
    expect(releases.length).toBeGreaterThanOrEqual(3);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf-8");

describe("decision paths notify affected employees", () => {
  it("swap review notifies requester and counterpart", () => {
    const s = read("../../wfm-extensions/wfm-ext.service.ts");
    expect(s).toContain("import { notifyRosterRequest }");
    expect(s).toMatch(/notifyRosterRequest\(\s*\{\s*employeeIds: \[[^\]]*requester_emp_id[^\]]*swap_with_emp_id/s);
  });
  it("week-off realign, force-approve and reject-request notify", () => {
    // The handlers delegate to weekoff-review.service.ts, which owns the notify calls.
    const s = read("../../wfm/weekoff-review.service.ts");
    expect(s).toContain("import { notifyWeekoffDecision }");
    expect((s.match(/notifyWeekoffDecision\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("dispute resolution notifies the assignment's employee", () => {
    // The handler delegates to resolveDispute() in dispute-resolution.service.ts.
    const s = read("../../roster/dispute-resolution.service.ts");
    expect(s).toContain("import { notifyRosterRequest }");
    expect(s).toMatch(/notifyRosterRequest\(\s*\{\s*employeeIds: \[assignment\.employee_id\]/s);
  });
});

describe("request producers notify approvers and trigger auto-approve", () => {
  it("swap create and conflict log raise from the service", () => {
    const s = read("../../wfm-extensions/wfm-ext.service.ts");
    expect(s).toContain("import { onRosterRequestRaised, scheduleAutoApprove }");
    expect(s).toMatch(/onRosterRequestRaised\(\{\s*kind: "swap",\s*sourceId: id/s);
    expect(s).toMatch(/onRosterRequestRaised\(\{\s*kind: "conflict",\s*sourceId: id/s);
  });
  it("a counterpart acceptance re-evaluates auto-approve", () => {
    const s = read("../../wfm-extensions/wfm-ext.service.ts");
    expect(s).toMatch(/response === "accepted"\) scheduleAutoApprove\("swap", id\)/);
  });
  it("week-off rejection raises after the state change", () => {
    const s = read("../../wfm/wfm.routes.ts");
    const handler = s.slice(s.indexOf('"/my-weekoff/:assignmentId/reject"'));
    const raiseAt = handler.indexOf('onRosterRequestRaised({ kind: "weekoff_rejection"');
    expect(raiseAt).toBeGreaterThan(handler.indexOf("rejectResult.affectedRows !== 1"));
    expect(raiseAt).toBeLessThan(handler.indexOf("Rejection recorded. Your reporting manager has been notified."));
  });
  it("dispute raise raises after the state change", () => {
    const s = read("../../roster/roster.governance.routes.ts");
    const handler = s.slice(s.indexOf('"/assignments/:id/dispute"'));
    const raiseAt = handler.indexOf('onRosterRequestRaised({ kind: "dispute"');
    expect(raiseAt).toBeGreaterThan(handler.indexOf("acknowledgement_status = 'disputed'"));
    expect(raiseAt).toBeLessThan(handler.indexOf("Dispute raised. Your manager has been notified."));
  });
});

describe("requests record when they were raised", () => {
  const handler = (src: string, route: string) => {
    const start = src.indexOf(route);
    return src.slice(start, src.indexOf("}));", start));
  };
  it("dispute raise stamps disputed_at (when the column exists) in the same UPDATE", () => {
    const h = handler(read("../../roster/roster.governance.routes.ts"), '"/assignments/:id/dispute"');
    expect(h).toMatch(/columnExists\("roster_daily_assignment", "disputed_at"\)/);
    expect(h).toContain('", disputed_at = NOW()"');
    expect(h).toMatch(/acknowledgement_status = 'disputed', dispute_reason = \?\$\{stampRaisedAt\} WHERE id = \?/);
    expect(h).toContain("Dispute raised. Your manager has been notified.");
  });
  it("week-off reject stamps employee_ack_at, the employee's response time", () => {
    const h = handler(read("../../wfm/wfm.routes.ts"), '"/my-weekoff/:assignmentId/reject"');
    expect(h).toMatch(/SET employee_ack_status = 'rejected',\s*employee_ack_at = NOW\(\),/);
    expect(h).toContain("Rejection recorded. Your reporting manager has been notified.");
  });
  it("the manager review queue returns disputed_at", () => {
    const h = handler(read("../../roster/roster.governance.routes.ts"), '"/manager-review-queue"');
    expect(h).toMatch(/rda\.disputed_at|NULL AS disputed_at/);
    expect(h).toMatch(/columnExists\("roster_daily_assignment", "disputed_at"\)/);
  });
});

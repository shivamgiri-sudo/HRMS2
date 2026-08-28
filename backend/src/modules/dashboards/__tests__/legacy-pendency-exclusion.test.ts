import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Legacy pendency audit, 2026-08-28.
 *
 * Role dashboards were reporting work queues nobody could work, because rows migrated
 * from db_bill landed in mas_hrms with a status the legacy system had already moved
 * past. Verified against both live databases on 2026-08-28:
 *
 *   - leave_request: 586 rows read "pending". 551 carry a legacy_leave_id, and matching
 *     each against db_bill.leave_management showed 547 were already decided there — 514
 *     with Status = "Not Approved" and 33 blanked but still carrying a
 *     DisApprovedReason. 548 of the 718 "Not Approved" source rows carry such a reason,
 *     so the value means rejected, not "awaiting approval". Every one of the 586 has a
 *     to_date in the past; not one was actionable.
 *
 *   - candidate_bgv_check: the BGV tile counted CHECK rows (280) rather than people
 *     (109), and included 50 seeded test records and legacy_employee rows.
 *
 *   - ats_onboarding_bridge: 507 pending, of which 27 already had an employee_id or
 *     converted_at (the person joined; nobody advanced the bridge), 6 belonged to
 *     rejected/no-show candidates and 15 to test/legacy_employee records.
 *
 * These are source-level guards. The queries they pin cannot be executed here without
 * the live schema, and mocking db.execute would only assert the mock — so each test
 * asserts the predicate is present in the SQL that ships.
 */

const metricSource = readFileSync(resolve(__dirname, "../dashboard-metric.service.ts"), "utf-8");
const drilldownSource = readFileSync(resolve(__dirname, "../dashboard-drilldown.service.ts"), "utf-8");
const managementSource = readFileSync(
  resolve(__dirname, "../../management/management.service.ts"),
  "utf-8",
);

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const ORG_SCOPE = {
  level: "ORG_ALL" as const,
  branchIds: [] as string[],
  processIds: [] as string[],
  employeeIds: [] as string[],
  userId: "u1",
  role: "super_admin",
};

describe("leave approvals exclude the db_bill backlog", () => {
  it("counts only natively-filed requests as pending, in both serving layers", () => {
    // getLeaveApprovalMetrics
    expect(metricSource).toMatch(
      /lr\.status = 'pending' AND lr\.legacy_leave_id IS NULL THEN 1 ELSE 0 END\) AS pending/,
    );
    // management.service.ts's workforce-dashboard tile reads the same thing under a
    // different name; the two disagreeing is what this whole audit started from.
    expect(managementSource).toMatch(
      /LOWER\(lr\.status\) = 'pending'\s*\n\s*AND lr\.legacy_leave_id IS NULL/,
    );
  });

  it("still reports the excluded backlog rather than hiding it", () => {
    expect(metricSource).toContain("AS legacyBacklog");
    expect(metricSource).toContain("AS pendingAllSources");
    expect(managementSource).toContain("AS legacy_leave_backlog");
  });

  it("binds the scope parameters once per interpolation of the scope fragment", () => {
    // The backlog subquery added a second interpolation of empScopeJoinWhere, so its
    // placeholders are bound twice. Passing scopeParams once would shift every binding
    // and make the branch filter read the process id — silently, since both are char(36).
    const block = managementSource.slice(
      managementSource.indexOf("AS pending_leave_approvals"),
      managementSource.indexOf("AS critical_performance_alerts") + 400,
    );
    expect(block).toContain("[...scopeParams, ...scopeParams]");
  });

  it("keeps the drilldown drawer on the same population as the tile", () => {
    const drill = drilldownSource.slice(drilldownSource.indexOf("async function drillLeaveApprovals"));
    expect(drill).toMatch(/lr\.status = 'pending'\s*\n\s*AND lr\.legacy_leave_id IS NULL/);
  });
});

describe("BGV pendency is counted in candidates, not checks", () => {
  const bgvBody = () =>
    metricSource.slice(
      metricSource.indexOf("export async function getBgvMetrics"),
      metricSource.indexOf("export async function getNameMismatchMetrics"),
    );

  it("rolls checks up per candidate before counting", () => {
    const bgv = bgvBody();
    expect(bgv).toContain("GROUP BY bgv.candidate_id");
    expect(bgv).toContain("COUNT(*) AS candidates");
    // The old check-row count stays available so the change is reconcilable.
    expect(bgv).toContain("AS checksPending");
  });

  it("partitions candidates so the buckets sum to the total", () => {
    const bgv = bgvBody();
    // Precedence breached > flagged > pending > cleared. Without the guards a candidate
    // with one failed and three queued checks would be counted in two buckets at once.
    expect(bgv).toContain("WHEN c.breached = 0 AND c.flagged > 0 THEN 1");
    expect(bgv).toContain("WHEN c.breached = 0 AND c.flagged = 0 AND c.outstanding > 0 THEN 1");
    expect(bgv).toContain("WHEN c.breached = 0 AND c.flagged = 0 AND c.outstanding = 0 THEN 1");
  });

  it("emits one row per candidate in the drilldown too", () => {
    const start = drilldownSource.indexOf("async function drillBgv");
    const drill = drilldownSource.slice(start, start + 2500);
    expect(drill).toContain("GROUP BY bgv.candidate_id");
    expect(drill).toContain("AS pendingChecks");
  });

  it("returns null on failure rather than a reassuring zero", async () => {
    const { getBgvMetrics } = await import("../dashboard-metric.service.js");
    execute.mockReset();
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE"));
    const result = await getBgvMetrics(ORG_SCOPE);
    expect(result.value).toBeNull();
    expect(result.status).toBe("unknown");
  });
});

describe("candidate-keyed metrics exclude legacy and test records", () => {
  it("applies record_type = candidate to onboarding, BGV, name match and OTP", () => {
    // One shared constant, so a new candidate-keyed metric cannot quietly opt out by
    // hand-rolling its own predicate.
    expect(metricSource).toContain(
      'const GENUINE_CANDIDATE_SQL = excludeEmployeeShapedCandidatesSql("cand")',
    );
    for (const marker of [
      "export async function getOnboardingMetrics",
      "export async function getBgvMetrics",
      "export async function getNameMismatchMetrics",
    ]) {
      const start = metricSource.indexOf(marker);
      expect(start, `${marker} not found`).toBeGreaterThan(-1);
      const body = metricSource.slice(start, start + 6000);
      expect(body, `${marker} does not exclude non-candidate records`).toContain(
        "${GENUINE_CANDIDATE_SQL}",
      );
    }
  });

  it("keeps an onboarding bridge out of pending once the person has joined", () => {
    const onb = metricSource.slice(
      metricSource.indexOf("export async function getOnboardingMetrics"),
      metricSource.indexOf("export async function getAttendanceMetrics"),
    );
    expect(onb).toContain("b.employee_id IS NULL");
    expect(onb).toContain("b.converted_at IS NULL");
    // and reports each reason it held a row back
    expect(onb).toContain("AS pendingAlreadyJoined");
    expect(onb).toContain("AS pendingClosedCandidate");
    expect(onb).toContain("AS pendingNonCandidate");
    expect(onb).toContain("AS pendingRaw");
  });

  it("filters the drilldowns to the same population", () => {
    expect(drilldownSource).toContain(
      'const GENUINE_CANDIDATE_SQL = excludeEmployeeShapedCandidatesSql("cand")',
    );
    const start = drilldownSource.indexOf("async function drillOnboarding");
    const onbDrill = drilldownSource.slice(start, start + 2500);
    expect(onbDrill).toContain("pendingActionableSql");
  });
});

describe("the db_bill status mappers no longer manufacture the wrong state", () => {
  const handlerSource = readFileSync(
    resolve(__dirname, "../../../workers/domains/leave-sync-handler.ts"),
    "utf-8",
  );

  it("tests rejection before approval, so 'Not Approved' cannot match 'approve'", () => {
    const start = handlerSource.indexOf("private mapStatus");
    const body = handlerSource.slice(start, start + 2200);
    const rejectAt = body.indexOf("return 'rejected'");
    const approveAt = body.indexOf("return 'approved'");
    expect(rejectAt).toBeGreaterThan(-1);
    expect(approveAt).toBeGreaterThan(-1);
    // Order is the whole fix: "not approved".includes("approve") is true, so an
    // approved-first mapper imported 77 rejected leaves as approved, where they count
    // toward leave balances.
    expect(rejectAt).toBeLessThan(approveAt);
    expect(body).toContain("not approve");
  });
});

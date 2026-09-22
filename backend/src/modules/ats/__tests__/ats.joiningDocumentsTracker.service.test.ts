import { describe, it, expect, vi, beforeEach } from "vitest";
import { NON_REACTIVATABLE_STATUSES } from "../../exit/exitEmploymentStatus.js";

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: {
    query: (...args: unknown[]) => queryMock(...args),
    execute: (...args: unknown[]) => executeMock(...args),
  },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));

describe("getJoiningDocumentsTracker", () => {
  beforeEach(() => {
    queryMock.mockReset();
    executeMock.mockReset();
  });

  it("excludes every NON_REACTIVATABLE_STATUSES value, not just resigned/terminated", async () => {
    queryMock.mockResolvedValueOnce([[]]); // main row query, empty page
    executeMock.mockResolvedValueOnce([[{}]]); // queryTrackerSummary aggregate — one row of nulls is fine

    const { getJoiningDocumentsTracker } = await import("../ats.joiningDocumentsTracker.service.js");
    await getJoiningDocumentsTracker("actor-1", { page: 1, limit: 50 });

    const [sql] = queryMock.mock.calls[0];
    for (const status of NON_REACTIVATABLE_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).not.toContain("NOT IN ('resigned', 'terminated')");
  });

  it("computes id_creation_sla_breached from days_since_id_created and sums it into the summary", async () => {
    queryMock.mockResolvedValueOnce([[{
      id: "e1", employee_code: "MAS1", full_name: "A B",
      branch_id: "b1", process_id: null, date_of_joining: "2026-09-01",
      onboarding_submitted_at: null, salary_assigned_at: null,
      joining_document_status: "pending", joining_document_completion_pct: 0,
      active_status: 1, branch_name: "HQ", process_name: null, lob_name: null,
      key_documents_raw: null, total_documents: 0, verified_count: 0,
      needs_correction_count: 0, overdue_count: 0,
      esign_completed_count: null, esign_pending_count: null,
      last_document_update: null, assigned_hr_name: null,
      days_since_id_created: 5,
      total_matching: 1,
    }]]);
    executeMock.mockResolvedValueOnce([[{
      total_employees: 1, completed_count: 0, in_progress_count: 0, pending_count: 1,
      overdue_count: 0, needs_correction: 0, id_creation_overdue_count: 1,
    }]]);

    const { getJoiningDocumentsTracker } = await import("../ats.joiningDocumentsTracker.service.js");
    const result = await getJoiningDocumentsTracker("actor-1", { page: 1, limit: 50 });

    expect(result.rows[0].days_since_id_created).toBe(5);
    expect(result.rows[0].id_creation_sla_breached).toBe(true);
    expect(result.summary.id_creation_overdue_count).toBe(1);
  });
});

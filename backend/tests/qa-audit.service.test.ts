import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const connExecute = vi.fn();
const beginTransaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const release = vi.fn();

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    getConnection: async () => ({
      execute: (...a: unknown[]) => connExecute(...a),
      beginTransaction, commit, rollback, release,
    }),
  },
}));

const { submitQaAudit, QaAuditError } = await import("../src/modules/quality-dashboard/qa-audit.service.js");

/**
 * The property this file exists to defend: the SERVER computes the score.
 *
 * A client submits per-parameter marks and nothing else. Accepting a submitted
 * total would let a browser decide its own quality result, and the entire point
 * of an audit is that the person being audited cannot set their own mark.
 */

const ACTIVE_FORM = [[{ process_id: "proc-1", version_no: 2, status: "active" }], []];
const PARAMS = [[
  { id: "p1", max_score: 10, is_fatal: 0 },
  { id: "p2", max_score: 10, is_fatal: 1 },
], []];

function mockForm() {
  execute.mockResolvedValueOnce(ACTIVE_FORM).mockResolvedValueOnce(PARAMS);
}

const base = {
  formId: "form-1",
  employeeId: "emp-1",
  auditDate: "2026-07-15",
  auditorUserId: "auditor-1",
};

beforeEach(() => {
  execute.mockReset(); connExecute.mockReset();
  beginTransaction.mockReset(); commit.mockReset(); rollback.mockReset(); release.mockReset();
  connExecute.mockResolvedValue([{ affectedRows: 1 }, []]);
  // mysql2's connection methods return promises, and the service chains
  // .catch() onto rollback(). Stubs returning undefined would fail for a reason
  // that has nothing to do with the behaviour under test.
  beginTransaction.mockResolvedValue(undefined);
  commit.mockResolvedValue(undefined);
  rollback.mockResolvedValue(undefined);
  release.mockReturnValue(undefined);
});

describe("the server computes the score", () => {
  it("derives the total from the stored parameters, ignoring anything a client sends", async () => {
    mockForm();
    const result = await submitQaAudit({
      ...base,
      scores: [{ formParameterId: "p1", score: 8 }, { formParameterId: "p2", score: 10 }],
      // A hostile or stale client might send these; they are not in the input
      // type and must have no effect even if present at runtime.
      ...( { totalScore: 999, qualityPercentage: 100 } as Record<string, unknown> ),
    } as never);

    expect(result.totalScore).toBe(18);
    expect(result.maxScore).toBe(20);
    expect(result.qualityPercentage).toBe(90);
  });

  it("takes parameter weights from the form, not the request", async () => {
    // p1 is worth 10 on the form. A client claiming otherwise cannot change it.
    mockForm();
    const result = await submitQaAudit({
      ...base,
      scores: [{ formParameterId: "p1", score: 5 }],
    });
    expect(result.maxScore).toBe(10);
    expect(result.qualityPercentage).toBe(50);
  });

  it("ignores marks for parameters that are not on the form", async () => {
    mockForm();
    const result = await submitQaAudit({
      ...base,
      scores: [{ formParameterId: "p1", score: 10 }, { formParameterId: "ghost", score: 100 }],
    });
    expect(result.totalScore).toBe(10);
    expect(result.maxScore).toBe(10);
  });

  it("computes the fatal flag itself", async () => {
    mockForm();
    const result = await submitQaAudit({
      ...base,
      scores: [{ formParameterId: "p1", score: 10 }, { formParameterId: "p2", score: 0 }],
    });
    expect(result.fatalTriggered).toBe(true);
    expect(result.qualityPercentage).toBe(0);
  });
});

describe("marks that cannot be right are rejected, not clamped", () => {
  it("refuses a score above the parameter maximum", async () => {
    // Silently clamping would hide an integration bug and quietly inflate a
    // total that somebody will later rely on.
    mockForm();
    await expect(
      submitQaAudit({ ...base, scores: [{ formParameterId: "p1", score: 50 }] }),
    ).rejects.toThrow(/exceeds the maximum/);
  });

  it("refuses a negative score", async () => {
    mockForm();
    await expect(
      submitQaAudit({ ...base, scores: [{ formParameterId: "p1", score: -5 }] }),
    ).rejects.toThrow(/cannot be negative/);
  });
});

describe("only an agreed form can produce a score", () => {
  it("refuses a draft form", async () => {
    execute.mockResolvedValueOnce([[{ process_id: "p", version_no: 1, status: "draft" }], []]);
    await expect(submitQaAudit({ ...base, scores: [] })).rejects.toThrow(/draft/);
  });

  it("refuses a retired form", async () => {
    // A retired form no longer reflects how the process is measured.
    execute.mockResolvedValueOnce([[{ process_id: "p", version_no: 1, status: "retired" }], []]);
    await expect(submitQaAudit({ ...base, scores: [] })).rejects.toThrow(/retired/);
  });

  it("refuses a form with no active parameters", async () => {
    execute.mockResolvedValueOnce(ACTIVE_FORM).mockResolvedValueOnce([[], []]);
    await expect(submitQaAudit({ ...base, scores: [] })).rejects.toThrow(/no active parameters/);
  });

  it("reports a missing form as 404 rather than a generic failure", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(submitQaAudit({ ...base, scores: [] })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("persistence", () => {
  it("records the form version it scored against", async () => {
    // Revising the form next month must not change what this audit measured.
    mockForm();
    await submitQaAudit({ ...base, scores: [{ formParameterId: "p1", score: 5 }] });
    const header = connExecute.mock.calls.find(([sql]) => /INSERT INTO qa_audit\b/.test(String(sql)));
    expect(header?.[1]).toContain(2);
  });

  it("rolls back rather than leaving a header without its parameter rows", async () => {
    // A half-written audit is worse than none: the header would carry a score
    // its parameter rows do not justify, and nothing would say so.
    mockForm();
    connExecute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockImplementationOnce(() => Promise.reject(new Error("deadlock")));

    await expect(
      submitQaAudit({ ...base, scores: [{ formParameterId: "p1", score: 5 }] }),
    ).rejects.toThrow("deadlock");
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("can be saved as a draft without being submitted", async () => {
    mockForm();
    const result = await submitQaAudit({
      ...base, submit: false, scores: [{ formParameterId: "p1", score: 5 }],
    });
    expect(result.status).toBe("draft");
  });
});

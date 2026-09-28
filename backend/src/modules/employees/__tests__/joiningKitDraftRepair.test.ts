/**
 * Repair of joining-kit documents that have a checklist row but no file
 * (the `draft_missing` block seen live on MAS63558 and three others).
 * DB and the fill engine are mocked: nothing here touches a real database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execute = vi.fn();
const generateChecklistDraft = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../universalDigitalFormFill.service.js", () => ({ generateChecklistDraft }));

const {
  regenerateMissingKitDrafts, generateDraftWithTimeout,
  DRAFT_GENERATION_TIMEOUT_MS, DraftGenerationTimeoutError,
} = await import("../joiningKitDraftRepair.service.js");
const { KIT_DOCUMENT_CODES, TERMINAL_STATUSES } = await import("../joiningKitAssembly.service.js");

let selectRows: Array<{ id: string; document_code: string }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  selectRows = [];
  execute.mockImplementation(async (sql: string) =>
    /FROM employee_joining_document_checklist c/.test(sql) ? [selectRows] : [[]]);
  generateChecklistDraft.mockResolvedValue({ file_id: "f" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const selectCall = () => execute.mock.calls.find(([sql]) => /FROM employee_joining_document_checklist c/.test(sql))!;
const auditCalls = () => execute.mock.calls.filter(([sql]) => /employee_joining_document_audit_log/.test(sql));

describe("generateDraftWithTimeout", () => {
  it("rejects with a timeout error when generation hangs, and clears its timer", async () => {
    vi.useFakeTimers();
    generateChecklistDraft.mockReturnValue(new Promise(() => undefined));
    const p = generateDraftWithTimeout("c1", "u1");
    const assertion = expect(p).rejects.toBeInstanceOf(DraftGenerationTimeoutError);
    await vi.advanceTimersByTimeAsync(DRAFT_GENERATION_TIMEOUT_MS + 1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not raise an unhandled rejection when the abandoned generation fails later", async () => {
    vi.useFakeTimers();
    let rejectLate: (e: Error) => void = () => undefined;
    generateChecklistDraft.mockReturnValue(new Promise((_, rej) => { rejectLate = rej; }));
    const p = generateDraftWithTimeout("c1", null, 1000);
    const assertion = expect(p).rejects.toBeInstanceOf(DraftGenerationTimeoutError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    rejectLate(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(10);
  });

  it("resolves normally and passes the actor through", async () => {
    await generateDraftWithTimeout("c9", "actor-1");
    expect(generateChecklistDraft).toHaveBeenCalledWith("c9", "actor-1");
  });
});

describe("regenerateMissingKitDrafts", () => {
  it("selects only file-less, unsigned, non-terminal esign kit documents", async () => {
    await regenerateMissingKitDrafts("emp-sel", "u1");
    const [sql, params] = selectCall();
    expect(sql).toMatch(/c\.action_type = 'esign'/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*file_role IN \('generated', 'hr_uploaded'\)/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*file_role IN \('signed', 'kit_signed'\)/);
    expect(sql).toMatch(/f\.deleted_at IS NULL/);
    expect(sql).toMatch(/c\.status, ''\) NOT IN/);
    expect(sql).toMatch(/c\.fill_status, ''\) NOT IN/);
    expect(params).toEqual(["emp-sel", ...KIT_DOCUMENT_CODES, ...TERMINAL_STATUSES, ...TERMINAL_STATUSES]);
  });

  it("never selects non-kit documents such as the EPF forms", async () => {
    await regenerateMissingKitDrafts("emp-epf", null);
    const [, params] = selectCall();
    expect(params).not.toContain("EPF_DECLARATION");
  });

  it("holds the employment contract back until the payroll head has approved", async () => {
    await regenerateMissingKitDrafts("emp-contract", null);
    const [sql] = selectCall();
    expect(sql).toMatch(/document_code <> 'EMPLOYMENT_CONTRACT' OR EXISTS[\s\S]*employee_payroll_head_review[\s\S]*status = 'approved'/);
  });

  it("generates each returned row sequentially and reports the result", async () => {
    selectRows = [
      { id: "c-it", document_code: "IT_COMPLIANCE" },
      { id: "c-pi", document_code: "PI_PROCESSING_CONSENT" },
      { id: "c-zt", document_code: "ZERO_TOLERANCE_ACK" },
    ];
    let running = 0; let maxRunning = 0;
    generateChecklistDraft.mockImplementation(async () => {
      running += 1; maxRunning = Math.max(maxRunning, running);
      await Promise.resolve(); running -= 1;
    });
    const result = await regenerateMissingKitDrafts("emp-seq", "u1");
    expect(result).toEqual({ attempted: 3, generated: 3, failed: [] });
    expect(generateChecklistDraft.mock.calls.map((c) => c[0])).toEqual(["c-it", "c-pi", "c-zt"]);
    expect(maxRunning).toBe(1);
  });

  it("records a failing document and carries on with the next", async () => {
    selectRows = [
      { id: "c-it", document_code: "IT_COMPLIANCE" },
      { id: "c-pi", document_code: "PI_PROCESSING_CONSENT" },
    ];
    generateChecklistDraft.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({});
    const result = await regenerateMissingKitDrafts("emp-fail", "u1");
    expect(result).toEqual({ attempted: 2, generated: 1, failed: [{ code: "IT_COMPLIANCE", reason: "boom" }] });
  });

  it("times out a hung document, records it, and continues", async () => {
    vi.useFakeTimers();
    selectRows = [
      { id: "c-it", document_code: "IT_COMPLIANCE" },
      { id: "c-pi", document_code: "PI_PROCESSING_CONSENT" },
    ];
    generateChecklistDraft.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce({});
    const p = regenerateMissingKitDrafts("emp-hang", "u1");
    await vi.advanceTimersByTimeAsync(DRAFT_GENERATION_TIMEOUT_MS + 1);
    const result = await p;
    expect(result.attempted).toBe(2);
    expect(result.generated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("IT_COMPLIANCE");
    expect(result.failed[0].reason).toMatch(/timed out/);
  });

  it("is idempotent: nothing selected means nothing generated and nothing audited", async () => {
    const result = await regenerateMissingKitDrafts("emp-none", "u1");
    expect(result).toEqual({ attempted: 0, generated: 0, failed: [] });
    expect(generateChecklistDraft).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it("audits a repair with the actor", async () => {
    selectRows = [{ id: "c-it", document_code: "IT_COMPLIANCE" }];
    await regenerateMissingKitDrafts("emp-audit", "hr-user-7");
    const [[sql, params]] = auditCalls();
    expect(sql).toMatch(/KIT_DRAFTS_REGENERATED/);
    expect(params).toContain("hr-user-7");
    expect(params).toContain("emp-audit");
    expect(params).toContain("hr");
  });

  it("still returns the result when the audit write fails", async () => {
    selectRows = [{ id: "c-it", document_code: "IT_COMPLIANCE" }];
    execute.mockImplementation(async (sql: string) => {
      if (/audit_log/.test(sql)) throw new Error("audit down");
      return /FROM employee_joining_document_checklist c/.test(sql) ? [selectRows] : [[]];
    });
    const result = await regenerateMissingKitDrafts("emp-audit-fail", null);
    expect(result.generated).toBe(1);
  });

  it("shares one in-flight run per employee", async () => {
    selectRows = [{ id: "c-it", document_code: "IT_COMPLIANCE" }];
    const [a, b] = await Promise.all([
      regenerateMissingKitDrafts("emp-race", "u1"),
      regenerateMissingKitDrafts("emp-race", "u2"),
    ]);
    expect(a).toBe(b);
    expect(generateChecklistDraft).toHaveBeenCalledTimes(1);
  });
});

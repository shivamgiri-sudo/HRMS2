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

const { createForm, activateForm } = await import("../src/modules/quality-dashboard/qa-form.service.js");

/**
 * Without a writer for qa_audit_form the whole QA module is inert:
 * GET /audit-forms returns "no active form" for all 131 processes forever and no
 * audit can be filed against anything.
 *
 * Forms are versioned rather than edited because an audit records the version it
 * scored against. Editing a live form in place would silently change what past
 * audits claim to have measured — the same defect kpi_master_config had before
 * effective dating.
 */

const OK = [{ affectedRows: 1 }, []] as unknown;

beforeEach(() => {
  execute.mockReset(); connExecute.mockReset();
  beginTransaction.mockReset(); commit.mockReset(); rollback.mockReset(); release.mockReset();
  connExecute.mockResolvedValue(OK);
  beginTransaction.mockResolvedValue(undefined);
  commit.mockResolvedValue(undefined);
  rollback.mockResolvedValue(undefined);
  release.mockReturnValue(undefined);
});

const param = { parameterText: "Greeting used", maxScore: 10 };

describe("creating a form", () => {
  it("creates it as a draft, never immediately active", async () => {
    // A form nobody approved must not start scoring people.
    execute.mockResolvedValueOnce([[{ next: 1 }], []]);
    await createForm({ processId: "p1", formName: "Inbound QA", effectiveFrom: "2026-08-01", parameters: [param] });

    const header = connExecute.mock.calls.find(([s]) => /INSERT INTO qa_audit_form\b/.test(String(s)));
    expect(String(header?.[0])).toMatch(/'draft'/);
  });

  it("versions rather than overwriting", async () => {
    execute.mockResolvedValueOnce([[{ next: 4 }], []]);
    const result = await createForm({
      processId: "p1", formName: "Inbound QA", effectiveFrom: "2026-08-01", parameters: [param],
    });
    expect(result.versionNo).toBe(4);
  });

  it("refuses a form with no parameters", async () => {
    await expect(
      createForm({ processId: "p1", formName: "Empty", effectiveFrom: "2026-08-01", parameters: [] }),
    ).rejects.toThrow(/at least one parameter/);
    expect(connExecute).not.toHaveBeenCalled();
  });

  it("refuses a parameter with a zero maximum", async () => {
    // It contributes nothing to the denominator and can never be failed, so it
    // silently does nothing while looking like it works.
    await expect(
      createForm({
        processId: "p1", formName: "F", effectiveFrom: "2026-08-01",
        parameters: [{ parameterText: "Nothing", maxScore: 0 }],
      }),
    ).rejects.toThrow(/maximum score above zero/);
  });

  it("refuses a parameter with no text", async () => {
    await expect(
      createForm({
        processId: "p1", formName: "F", effectiveFrom: "2026-08-01",
        parameters: [{ parameterText: "   ", maxScore: 5 }],
      }),
    ).rejects.toThrow(/needs text/);
  });

  it("rolls back rather than leaving a header with no parameters", async () => {
    // Such a form passes the "form exists" check and then fails every audit
    // filed against it.
    execute.mockResolvedValueOnce([[{ next: 1 }], []]);
    connExecute
      .mockResolvedValueOnce(OK)
      .mockImplementationOnce(() => Promise.reject(new Error("deadlock")));

    await expect(
      createForm({ processId: "p1", formName: "F", effectiveFrom: "2026-08-01", parameters: [param] }),
    ).rejects.toThrow("deadlock");
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("activating a form", () => {
  const draft = [[{ id: "f2", process_id: "p1", version_no: 2, status: "draft" }], []];
  const hasParams = [[{ n: 3 }], []];

  it("retires the form it replaces, so only one is active per process", async () => {
    // Two active forms make "the active form" ambiguous, and the reader picks
    // the highest version — so a second would quietly shadow the first.
    execute
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(hasParams)
      .mockResolvedValueOnce([[{ id: "f1" }], []]);

    const result = await activateForm("f2", "user-1");
    expect(result).toMatchObject({ activatedVersion: 2, retiredFormId: "f1" });

    const sqls = connExecute.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /status = 'retired'/.test(s))).toBe(true);
    expect(sqls.some((s) => /status = 'active'/.test(s))).toBe(true);
  });

  it("activates cleanly when the process has no current form", async () => {
    execute.mockResolvedValueOnce(draft).mockResolvedValueOnce(hasParams).mockResolvedValueOnce([[], []]);
    const result = await activateForm("f2");
    expect(result.retiredFormId).toBeNull();
  });

  it("refuses a form with no parameters", async () => {
    execute.mockResolvedValueOnce(draft).mockResolvedValueOnce([[{ n: 0 }], []]);
    await expect(activateForm("f2")).rejects.toThrow(/no active parameters/);
  });

  it("refuses to reactivate a retired form", async () => {
    // That would resurrect criteria somebody deliberately withdrew.
    execute.mockResolvedValueOnce([[{ id: "f0", process_id: "p1", version_no: 1, status: "retired" }], []]);
    await expect(activateForm("f0")).rejects.toThrow(/cannot be reactivated/);
  });

  it("refuses an already-active form rather than silently doing nothing", async () => {
    execute.mockResolvedValueOnce([[{ id: "f1", process_id: "p1", version_no: 1, status: "active" }], []]);
    await expect(activateForm("f1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reports a missing form as 404", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(activateForm("nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rolls back rather than retiring the old without activating the new", async () => {
    // That would leave the process with no way to be audited at all.
    execute
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(hasParams)
      .mockResolvedValueOnce([[{ id: "f1" }], []]);
    connExecute
      .mockResolvedValueOnce(OK)
      .mockImplementationOnce(() => Promise.reject(new Error("lock wait timeout")));

    await expect(activateForm("f2")).rejects.toThrow("lock wait timeout");
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

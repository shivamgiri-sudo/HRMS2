import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { resolveProcessAtDate, resolveProcessForAgentCode } = await import(
  "../src/modules/kpi/attribution.service.js"
);

/**
 * The upstream quality feed stopped populating Campaign in May 2026 — every row
 * since is NULL — so a quality score carries no process of its own. Its `User`
 * column is the HRMS employee code, and all 48 scored agents in July matched an
 * employee, so attribution runs through the person.
 *
 * kpi_daily_actual.process_id_at_event sits at 2.9% populated and 0% on quality
 * rows, while 92.9% of KPI-carrying employees are in fact resolvable. The column
 * was unwritten, not unusable.
 *
 * What these pin is that the resolver never presents a guess as a measurement.
 */

beforeEach(() => execute.mockReset());

const lobHit = [[{ process_id: "proc-historic" }], []];
const empHit = [[{ process_id: "proc-current" }], []];
const noRows = [[], []];

describe("process attribution as at a date", () => {
  it("prefers an effective-dated assignment covering the event date", async () => {
    execute.mockResolvedValueOnce(lobHit);
    const r = await resolveProcessAtDate("emp-1", "2026-03-15");
    expect(r).toEqual({ processId: "proc-historic", source: "lob_assignment", dateAccurate: true });
  });

  it("only counts approved assignments, never drafts", async () => {
    // The enum is ('draft','approved','inactive') — there is no 'active'. A
    // draft assignment must not attribute a real score.
    execute.mockResolvedValueOnce(noRows).mockResolvedValueOnce(noRows);
    await resolveProcessAtDate("emp-1", "2026-03-15");
    expect(execute.mock.calls[0][0]).toMatch(/status = 'approved'/);
    expect(execute.mock.calls[0][0]).not.toMatch(/status = 'active'/);
  });

  it("bounds the assignment window on both sides", async () => {
    execute.mockResolvedValueOnce(noRows).mockResolvedValueOnce(noRows);
    await resolveProcessAtDate("emp-1", "2026-03-15");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/effective_from <= \?/);
    expect(sql).toMatch(/effective_to IS NULL OR ela\.effective_to >= \?/);
    expect(params).toEqual(["emp-1", "2026-03-15", "2026-03-15"]);
  });

  it("falls back to the current process but refuses to call it date-accurate", async () => {
    // This is the distinction that matters. Where someone sits today is only
    // where they sat on the event date if they never moved.
    execute.mockResolvedValueOnce(noRows).mockResolvedValueOnce(empHit);
    const r = await resolveProcessAtDate("emp-1", "2026-03-15");
    expect(r).toEqual({ processId: "proc-current", source: "employee_current", dateAccurate: false });
  });

  it("reports unresolved rather than inventing a process", async () => {
    execute.mockResolvedValueOnce(noRows).mockResolvedValueOnce(noRows);
    const r = await resolveProcessAtDate("emp-1", "2026-03-15");
    expect(r).toEqual({ processId: null, source: "unresolved", dateAccurate: false });
  });

  it("resolves a split allocation by largest share, then most recent", async () => {
    // A 60/40 split has to resolve to something; taking whichever row the
    // database happened to return first is not a decision.
    execute.mockResolvedValueOnce(lobHit);
    await resolveProcessAtDate("emp-1", "2026-03-15");
    expect(execute.mock.calls[0][0]).toMatch(/ORDER BY ela\.allocation_pct DESC, ela\.effective_from DESC/);
  });
});

describe("attributing an upstream quality row by agent code", () => {
  it("maps the agent code to an employee and through to a process", async () => {
    execute.mockResolvedValueOnce([[{ id: "emp-9" }], []]).mockResolvedValueOnce(lobHit);
    const r = await resolveProcessForAgentCode("MAS57576", "2026-07-15");
    expect(r.employeeId).toBe("emp-9");
    expect(r.processId).toBe("proc-historic");
  });

  it("trims the incoming code", async () => {
    execute.mockResolvedValueOnce(noRows);
    await resolveProcessForAgentCode("  MAS57576 ", "2026-07-15");
    expect(execute.mock.calls[0][1]).toEqual(["MAS57576"]);
  });

  it("treats an ambiguous code as unresolved instead of picking one", async () => {
    // Two employees sharing a code is a mapping defect. Choosing one would
    // attribute somebody's quality score to the wrong person.
    execute.mockResolvedValueOnce([[{ id: "emp-1" }, { id: "emp-2" }], []]);
    const r = await resolveProcessForAgentCode("MAS57576", "2026-07-15");
    expect(r.source).toBe("unresolved");
    expect(r.employeeId).toBeNull();
  });

  it("reports unresolved when the agent code matches nobody", async () => {
    execute.mockResolvedValueOnce(noRows);
    const r = await resolveProcessForAgentCode("QA-E2E-NOBODY", "2026-07-15");
    expect(r).toMatchObject({ source: "unresolved", processId: null, employeeId: null });
  });
});

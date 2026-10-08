import { describe, it, expect, vi } from "vitest";
import { loadConductSection } from "../dossier.conduct.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);
const empty = {
  "FROM employee_warning": [],
  "FROM pip_record": [],
  "FROM performance_alert": [{ n: 0 }],
  "FROM coaching_session": [{ n: 0 }],
  "FROM employee_rehire_control": [],
  "abscond": [{ n: 0 }],
  "FROM employment_stint": [{ n: 0 }],
  "FROM employee_reactivation_requests": [{ n: 0 }],
};

describe("loadConductSection", () => {
  it("counts only ACTIVE warnings and flags final warnings", async () => {
    const ex = executor({
      ...empty,
      "FROM employee_warning": [
        { id: "w1", warning_date: "2026-05-01", category: "attendance", severity: "written", status: "active", description: "late" },
        { id: "w2", warning_date: "2026-06-01", category: "conduct", severity: "final", status: "active", description: "x" },
        { id: "w3", warning_date: "2026-01-01", category: "conduct", severity: "verbal", status: "withdrawn", description: "y" },
      ],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.activeWarnings).toBe(2);
    expect(s.finalWarnings).toBe(1);
    expect(s.warnings).toHaveLength(3);
  });

  it("treats active and extended PIPs as open", async () => {
    const ex = executor({
      ...empty,
      "FROM pip_record": [
        { id: "p1", start_date: "2026-02-01", end_date: "2026-04-01", status: "completed", outcome: "improved", reason: "AHT" },
        { id: "p2", start_date: "2026-06-01", end_date: null, status: "extended", outcome: null, reason: "QA" },
      ],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.openPip).toBe(true);
    expect(s.pips).toHaveLength(2);
  });

  it("no open PIP when all are closed", async () => {
    const ex = executor({
      ...empty,
      "FROM pip_record": [{ id: "p1", start_date: "2026-02-01", end_date: "2026-04-01", status: "terminated", outcome: "terminated", reason: "x" }],
    });
    expect((await loadConductSection(ex as never, w)).openPip).toBe(false);
  });

  it("reads the HR disciplinary flag from employee_rehire_control", async () => {
    const ex = executor({
      ...empty,
      "FROM employee_rehire_control": [{ disciplinary_flag: 1, disciplinary_reason: "Fraud found later", disciplinary_flag_date: "2026-09-01", block_lifted_at: null }],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.disciplinaryFlag).toEqual({ flagged: true, reason: "Fraud found later", date: "2026-09-01", lifted: false });
  });

  it("no row in employee_rehire_control means not flagged", async () => {
    const s = await loadConductSection(executor(empty) as never, w);
    expect(s.disciplinaryFlag.flagged).toBe(false);
  });

  it("reports prior absconding exits, rejoins and rejoin requests", async () => {
    const ex = executor({
      ...empty,
      "abscond": [{ n: 1 }],
      "FROM employment_stint": [{ n: 2 }],
      "FROM employee_reactivation_requests": [{ n: 3 }],
      "FROM performance_alert": [{ n: 4 }],
      "FROM coaching_session": [{ n: 5 }],
    });
    const s = await loadConductSection(ex as never, w);
    expect(s.priorAbscondingExits).toBe(1);
    expect(s.priorRejoins).toBe(2);
    expect(s.priorRejoinRequests).toBe(3);
    expect(s.unacknowledgedAlerts).toBe(4);
    expect(s.completedCoachingSessions).toBe(5);
  });
});

describe("loadConductSection excluding the request's own rejoin", () => {
  it("excludes the stint (and the approved request) that this request produced, binding the request id", async () => {
    const ex = executor({ ...empty, "FROM employment_stint": [{ n: 1 }], "FROM employee_reactivation_requests": [{ n: 1 }] });
    const s = await loadConductSection(ex as never, w, { excludeRejoinRequestId: "r9" });
    const stint = ex.execute.mock.calls.find(([sql]) => String(sql).includes("FROM employment_stint"))!;
    expect(String(stint[0])).toMatch(/stint_no > 1/);
    expect(String(stint[0])).toMatch(/rejoin_request_id IS NULL OR rejoin_request_id <> \?/);
    expect((stint as unknown[])[1]).toEqual(["e1", "r9"]);
    const reqs = ex.execute.mock.calls.find(([sql]) => String(sql).includes("FROM employee_reactivation_requests"))!;
    expect(String(reqs[0])).toMatch(/id <> \?/);
    expect((reqs as unknown[])[1]).toEqual(["e1", "r9"]);
    // An earlier rejoin is still counted.
    expect(s.priorRejoins).toBe(1);
    expect(s.priorRejoinRequests).toBe(1);
  });

  it("without the option the counts are unchanged (all stints after the first)", async () => {
    const ex = executor({ ...empty, "FROM employment_stint": [{ n: 2 }] });
    const s = await loadConductSection(ex as never, w);
    const stint = ex.execute.mock.calls.find(([sql]) => String(sql).includes("FROM employment_stint"))!;
    expect(String(stint[0])).not.toMatch(/rejoin_request_id/);
    expect((stint as unknown[])[1]).toEqual(["e1"]);
    expect(s.priorRejoins).toBe(2);
  });
});

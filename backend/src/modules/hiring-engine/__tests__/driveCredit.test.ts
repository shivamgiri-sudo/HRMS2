import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { creditedOutcome, driveCreditSql, type CreditFacts } from "../he-drive-credit.js";
import { STAGE_FLAGS_SQL, STAGE_FROM_SQL } from "../he-requisition-sources.service.js";
import { getSourcesForRequisitions } from "../he-sources-window.service.js";

const DRIVE = "2026-10-06";
const base: CreditFacts = {
  driveDate: DRIVE, matchState: "arrived", matchUpdatedAt: "2026-10-06 11:00:00", leadStatus: "arrived", leadStatusAt: null,
  atsStage: null, stageLog: [], joiningDate: null,
};
const facts = (o: Partial<CreditFacts>): CreditFacts => ({ ...base, ...o });

describe("creditedOutcome (drive credit rule)", () => {
  it("credits an ATS selection logged on the drive day to a person who arrived", () => {
    expect(creditedOutcome(facts({ atsStage: "Offered", stageLog: [{ toStage: "offered", at: "2026-10-06 00:00:00" }] }))).toEqual({ selected: true, joined: false });
  });

  it("never credits a selection logged before the drive date, even one second before", () => {
    expect(creditedOutcome(facts({ atsStage: "Offered", stageLog: [{ toStage: "Offered", at: "2026-10-05 23:59:59" }] }))).toEqual({ selected: false, joined: false });
  });

  it("never credits a selected stage without a timestamp (no stage log row)", () => {
    expect(creditedOutcome(facts({ atsStage: "offered" }))).toEqual({ selected: false, joined: false });
  });

  it.each(["suggested", "invited", "confirmed", "no_show", "declined", "slot_released", null])("never credits a person whose match is %s (arrival not proven)", (state) => {
    const f = facts({ matchState: state, atsStage: "payroll_validated", stageLog: [{ toStage: "selected", at: "2026-10-07 10:00:00" }], joiningDate: "2026-10-09", leadStatus: "joined", leadStatusAt: "2026-10-09 09:00:00" });
    expect(creditedOutcome(f)).toEqual({ selected: false, joined: false });
  });

  it("never credits a match that is not on a drive", () => {
    expect(creditedOutcome(facts({ driveDate: null, atsStage: "selected", stageLog: [{ toStage: "selected", at: "2026-10-07 10:00:00" }] }))).toEqual({ selected: false, joined: false });
  });

  it("needs the current stage to still be a selected stage (a later drop-out is not credited)", () => {
    expect(creditedOutcome(facts({ atsStage: "Round 1- HR Screening", stageLog: [{ toStage: "selected", at: "2026-10-07 10:00:00" }] }))).toEqual({ selected: false, joined: false });
  });

  it("credits a selected he_match changed on or after the drive date", () => {
    expect(creditedOutcome(facts({ matchState: "selected", matchUpdatedAt: "2026-10-06 18:00:00" }))).toEqual({ selected: true, joined: false });
    expect(creditedOutcome(facts({ matchState: "selected", matchUpdatedAt: "2026-10-01 18:00:00" }))).toEqual({ selected: false, joined: false });
  });

  it("credits a join from the onboarding joining date or a joined stage log row on or after the drive date, and a join is also a selection", () => {
    expect(creditedOutcome(facts({ atsStage: "payroll_validated", joiningDate: "2026-10-06" }))).toEqual({ selected: true, joined: true });
    expect(creditedOutcome(facts({ atsStage: "Joined", stageLog: [{ toStage: "joined", at: "2026-10-08 10:00:00" }] }))).toEqual({ selected: true, joined: true });
    expect(creditedOutcome(facts({ atsStage: "payroll_validated", joiningDate: "2026-09-01" }))).toEqual({ selected: false, joined: false });
  });

  it("credits a he_lead join only when its status time is on or after the drive date", () => {
    expect(creditedOutcome(facts({ leadStatus: "joined", leadStatusAt: "2026-10-10 09:00:00" }))).toEqual({ selected: true, joined: true });
    expect(creditedOutcome(facts({ leadStatus: "joined", leadStatusAt: "2026-09-10 09:00:00" }))).toEqual({ selected: false, joined: false });
    expect(creditedOutcome(facts({ leadStatus: "joined", leadStatusAt: null }))).toEqual({ selected: false, joined: false });
  });

  it("credits an old selection followed by a re-selection after the drive", () => {
    const log = [{ toStage: "offered", at: "2026-08-01 10:00:00" }, { toStage: "offer_approved", at: "2026-10-07 10:00:00" }];
    expect(creditedOutcome(facts({ atsStage: "offer_approved", stageLog: log }))).toEqual({ selected: true, joined: false });
  });
});

describe("driveCreditSql", () => {
  const sql = driveCreditSql({ m: "m", d: "d", hl: "hl", ac: "ac" });

  it("gates both flags on proven arrival at the drive", () => {
    expect(sql.joined.startsWith("(m.state IN ('arrived','selected') AND ")).toBe(true);
    expect(sql.selected).toContain(sql.joined);
    expect(sql.selected).toContain("(m.state IN ('arrived','selected') AND (");
  });

  it("times every event against the drive date, never by stage name alone", () => {
    expect(sql.joined).toContain("hl.status = 'joined' AND hl.status_at >= d.drive_date");
    expect(sql.joined).toContain("sl.candidate_id = ac.id AND LOWER(sl.to_stage) IN ('joined','payroll_validated') AND sl.stage_date >= d.drive_date");
    expect(sql.joined).toContain("ob.candidate_id = ac.id AND ob.joining_date >= d.drive_date");
    expect(sql.selected).toContain("m.state = 'selected' AND m.updated_at >= d.drive_date");
    expect(sql.selected).toContain("LOWER(sl.to_stage) IN ('selected','offered','offer','offer_approved','onboarded','converted','joined','payroll_validated') AND sl.stage_date >= d.drive_date");
    for (const s of [sql.joined, sql.selected]) for (const m of s.matchAll(/LOWER\(ac\.current_stage\) IN \([^)]*\)/g)) expect(s.slice(m.index! + m[0].length).trimStart()).toMatch(/^AND /);
  });

  it("reaches the stage log and onboarding bridge by candidate id only (keyed EXISTS, never a scan)", () => {
    for (const s of [sql.joined, sql.selected]) {
      for (const m of s.matchAll(/FROM (ats_candidate_stage_log|ats_onboarding_bridge) (\w+) WHERE (\w+)\.candidate_id = ac\.id/g)) expect(m[2]).toBe(m[3]);
      expect(s.match(/FROM ats_candidate_stage_log/g)?.length).toBe(s.match(/EXISTS \(SELECT 1 FROM ats_candidate_stage_log sl WHERE sl\.candidate_id = ac\.id/g)?.length);
    }
  });

  it("uses the given aliases", () => {
    const other = driveCreditSql({ m: "x", d: "md", hl: "l", ac: "c" });
    expect(other.selected).toContain("x.state IN ('arrived','selected')");
    expect(other.selected).toContain("md.drive_date");
    expect(other.selected).toContain("sl.candidate_id = c.id");
    expect(other.selected).not.toMatch(/\b(m|d|hl|ac)\./);
  });
});

describe("sources read models use the drive credit rule", () => {
  beforeEach(() => { vi.clearAllMocks(); execute.mockResolvedValue([[]]); });

  it("reaches the person's drive by he_match.drive_id (primary key) and flags selected / joined with the shared rule", () => {
    const rule = driveCreditSql({ m: "m", d: "md", hl: "hl", ac: "ac" });
    expect(STAGE_FROM_SQL).toContain("LEFT JOIN he_drive md ON md.id = m.drive_id AND md.requisition_id = m.requisition_id");
    expect(STAGE_FLAGS_SQL).toContain(`CASE WHEN ${rule.joined} THEN 1 ELSE 0 END AS joined`);
    expect(STAGE_FLAGS_SQL).toContain(`CASE WHEN ${rule.selected} THEN 1 ELSE 0 END AS selected`);
    expect(STAGE_FLAGS_SQL).not.toMatch(/WHEN hl\.status = 'joined' OR/);
  });

  it("the window read model sends the same rule", async () => {
    await getSourcesForRequisitions(["r1"], { from: "2026-10-01", to: "2026-10-14" });
    const stages = execute.mock.calls.map((c) => String(c[0])).find((q) => q.includes("FROM qualified_followup qf"))!;
    expect(stages).toContain(STAGE_FLAGS_SQL);
    expect(stages).toContain(STAGE_FROM_SQL);
  });
});

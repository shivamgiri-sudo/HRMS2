import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs ops script
import { evaluate, refuseWriteMode, AGENT_TIME_COLUMNS, ACCOUNT_FILE_NEW_COLUMNS, OUTCOME_COLUMNS, ROSTER_COLUMNS } from "../../../../scripts/sbi-card-verify.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const healthy = () => ({
  agentTimeColumns: [...AGENT_TIME_COLUMNS], accountColumns: ["id", "account_no", ...ACCOUNT_FILE_NEW_COLUMNS], uniqueKeys: ["PRIMARY", "uq_sbi_card_account_file_flow"],
  migrationRow: { filename: "migrations/2075_sbi_collections_ops_and_apr.sql", success: 1 },
  templates: { SBI_CARD_APR: { active: 1, optional: ["ID"] }, SBI_CARD_ACCOUNT_FILE: { active: 1, optional: ["Flow"] } },
  process: { id: "p" }, counts: { account: 10, agentTime: 0 }, flows: { NEW: 10 },
});

describe("sbi-card-verify (read-only ops check)", () => {
  it("passes a fully migrated database", () => expect(evaluate(healthy()).ok).toBe(true));
  it("fails when the migration has not run", () => {
    const f = { ...healthy(), agentTimeColumns: null, migrationRow: null, uniqueKeys: ["PRIMARY", "uq_sbi_card_account_file"], accountColumns: ["id", "account_no"] };
    const r = evaluate(f);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c: { status: string }) => c.status === "FAIL").length).toBeGreaterThanOrEqual(4);
  });
  it("fails on an unknown flow value and on the old key still being present", () => {
    expect(evaluate({ ...healthy(), flows: { NEW: 1, WEIRD: 2 } }).ok).toBe(false);
    expect(evaluate({ ...healthy(), uniqueKeys: ["uq_sbi_card_account_file", "uq_sbi_card_account_file_flow"] }).ok).toBe(false);
  });
  it("checks the outcome table, its migration row and its template once they are part of the facts", () => {
    const withOutcome = { ...healthy(), outcomeColumns: [...OUTCOME_COLUMNS], outcomeMigrationRow: { filename: "migrations/2076_sbi_card_outcome.sql", success: 1 },
      templates: { ...healthy().templates, SBI_CARD_OUTCOME: { active: 1, optional: ["Segment"] } }, counts: { account: 10, agentTime: 0, outcome: 0 } };
    expect(evaluate(withOutcome).ok).toBe(true);
    const broken = evaluate({ ...withOutcome, outcomeColumns: null, outcomeMigrationRow: null, templates: { ...withOutcome.templates, SBI_CARD_OUTCOME: null } });
    expect(broken.ok).toBe(false);
    expect(broken.checks.filter((c: { status: string }) => c.status === "FAIL").length).toBeGreaterThanOrEqual(3);
  });
  it("checks the roster table, its migration row and its template once they are part of the facts", () => {
    const withRoster = { ...healthy(), rosterColumns: [...ROSTER_COLUMNS], rosterMigrationRow: { filename: "migrations/2077_sbi_card_roster.sql", success: 1 },
      templates: { ...healthy().templates, SBI_CARD_ROSTER: { active: 1, optional: ["TEAM"] } }, counts: { account: 10, agentTime: 0, roster: 0 } };
    expect(evaluate(withRoster).ok).toBe(true);
    const broken = evaluate({ ...withRoster, rosterColumns: null, rosterMigrationRow: null, templates: { ...withRoster.templates, SBI_CARD_ROSTER: null } });
    expect(broken.ok).toBe(false);
    expect(broken.checks.filter((c: { status: string }) => c.status === "FAIL").length).toBeGreaterThanOrEqual(3);
  });
  it("has no apply mode", () => {
    expect(refuseWriteMode(["apply"])).toMatch(/read-only/);
    expect(refuseWriteMode([])).toBeNull();
  });
  it("expects exactly the columns the migration adds", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../sql/migrations/2075_sbi_collections_ops_and_apr.sql"), "utf8");
    for (const c of [...AGENT_TIME_COLUMNS.filter((x: string) => !["id", "created_at", "updated_at"].includes(x)), ...ACCOUNT_FILE_NEW_COLUMNS]) expect(sql).toContain(c);
  });
  it("expects exactly the outcome columns migration 2076 creates", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../sql/migrations/2076_sbi_card_outcome.sql"), "utf8");
    for (const c of OUTCOME_COLUMNS.filter((x: string) => !["id", "created_at", "updated_at"].includes(x))) expect(sql).toContain(c);
  });
  it("expects exactly the roster columns migration 2077 creates", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../sql/migrations/2077_sbi_card_roster.sql"), "utf8");
    for (const c of ROSTER_COLUMNS.filter((x: string) => !["id", "created_at", "updated_at"].includes(x))) expect(sql).toContain(c);
  });
});

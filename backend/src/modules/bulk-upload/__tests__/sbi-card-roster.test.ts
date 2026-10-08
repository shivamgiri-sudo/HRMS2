import { describe, it, expect } from "vitest";
import { rosterSpec } from "../sbi-card-bulk.service.js";
import { applyPlan, buildColumnPlan } from "../report-column-plan.js";
import { SBI_ROSTER_COLUMNS } from "../sbi-card-roster-columns.js";
import { canonicalizeRow } from "../dalmia-import-helpers.js";

const ctx = { processId: "p", batchId: "b", userId: "u" };
function load(rows: Array<Record<string, unknown>>) {
  const plan = buildColumnPlan(rows, SBI_ROSTER_COLUMNS, rosterSpec.planOptions);
  if (plan.fatal) return { fatal: plan.fatal } as const;
  return { plan, out: rows.map((r, i) => rosterSpec.mapRow(canonicalizeRow(applyPlan(r, plan), rosterSpec.headers), i + 1, ctx)) } as const;
}
const vals = (r: unknown) => { if (!r || typeof r !== "object" || !("values" in r)) throw new Error(JSON.stringify(r)); return (r as { values: unknown[] }).values; };
const rows = [
  { "DIALER ID": 1026, "Employee ID": 600008659, Name: "Riya Kumari", GH: 600008659, TEAM: "HIGHBAL", "TEAM LEADER": "Sourabh Kumar", MODE: null },
  { "DIALER ID": 1042, "Employee ID": 600175084, Name: "Preeti Kumari", GH: 600175084, TEAM: "lowbal", "TEAM LEADER": 0, MODE: "" },
  { "DIALER ID": 1054, "Employee ID": 600121160, Name: "Khushi Singh", GH: 600121160, TEAM: "HIGHBAL", "TEAM LEADER": "Sonu", MODE: "" },
];

describe("roster importer", () => {
  it("keys on the dialer id and keeps one value per column", () => {
    const r = load(rows); if ("fatal" in r) throw new Error(r.fatal);
    const v = vals(r.out[0]);
    expect(v.length).toBe(rosterSpec.columns.length - 2);
    expect(v.slice(0, 7)).toEqual(["1026", "600008659", "Riya Kumari", "600008659", "HIGHBAL", "Sourabh Kumar", null]);
  });
  it("upper-cases the team and treats a leader of 0 as no leader (a failed lookup in the workbook)", () => {
    const r = load(rows); if ("fatal" in r) throw new Error(r.fatal);
    const v = vals(r.out[1]);
    expect([v[4], v[5]]).toEqual(["LOWBAL", null]);
  });
  it("needs a dialer id, skips blank spacer rows, and says so", () => {
    const r = load([...rows, { "DIALER ID": "", Name: "No Id", TEAM: "HIGHBAL" }, { "DIALER ID": "", Name: "", TEAM: "" }]); if ("fatal" in r) throw new Error(r.fatal);
    expect(JSON.stringify(r.out[3])).toMatch(/DIALER ID/);
    expect(r.out[4]).toEqual({ skip: true });
  });
  it("understands other spellings in any order", () => {
    const re = rows.map((x) => ({ "Team Lead": x["TEAM LEADER"], "Agent Name": x.Name, "Agent ID": x["DIALER ID"], Process: x.TEAM, "Emp ID": x["Employee ID"] }));
    const a = load(re); const b = load(re.map((x) => Object.fromEntries(Object.entries(x).reverse())));
    if ("fatal" in a || "fatal" in b) throw new Error("unexpected fatal");
    expect(vals(a.out[0]).slice(0, 7)).toEqual(["1026", "600008659", "Riya Kumari", null, "HIGHBAL", "Sourabh Kumar", null]);
    expect(vals(b.out[0])).toEqual(vals(a.out[0]));
  });
  it("fails closed on a file with no dialer id", () => {
    const r = load([{ foo: 1, Name: "x" }, { foo: 2, Name: "y" }]);
    expect("fatal" in r && r.fatal).toMatch(/Required column|does not look like/);
  });
});

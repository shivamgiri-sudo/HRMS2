import { describe, it, expect } from "vitest";
import { outcomeSpec, parsePctCells } from "../sbi-card-bulk.service.js";
import { applyPlan, buildColumnPlan } from "../report-column-plan.js";
import { SBI_OUTCOME_COLUMNS } from "../sbi-card-outcome-columns.js";
import { canonicalizeRow } from "../dalmia-import-helpers.js";

const ctx = { processId: "p", batchId: "b", userId: "u" };
/** The whole path the runner takes: build the column plan from the rows, apply it, then map. */
function load(rows: Array<Record<string, unknown>>) {
  const plan = buildColumnPlan(rows, SBI_OUTCOME_COLUMNS, outcomeSpec.planOptions);
  if (plan.fatal) return { fatal: plan.fatal } as const;
  return { plan, out: rows.map((r, i) => outcomeSpec.mapRow(canonicalizeRow(applyPlan(r, plan), outcomeSpec.headers), i + 1, ctx)) } as const;
}
const vals = (r: unknown) => { if (!r || typeof r !== "object" || !("values" in r)) throw new Error(JSON.stringify(r)); return (r as { values: unknown[] }).values; };
const notesOf = (r: unknown) => ((r as { notes?: string[] }).notes ?? []).join(" | ");

const counts = { "Report Date": "2026-09-28", Segment: "CD3_HB", "Opening Accounts": "2353", "Resolved Accounts": "824", "Normalised Accounts": "424", "Rollback Accounts": "235" };

describe("outcome importer", () => {
  it("keeps one value per column, with date and segment as identity", () => {
    const r = load([counts]); if ("fatal" in r) throw new Error(r.fatal);
    const v = vals(r.out[0]);
    expect(v.length).toBe(outcomeSpec.columns.length - 2);
    expect(v.slice(0, 7)).toEqual(["2026-09-28", "CD3_HB", 2353, null, 824, 424, 235]);
  });
  it("accepts percentages only, as SBI would state them", () => {
    const r = load([{ "Report Date": "2026-09-28", "Resolution %": "35%", "Normalisation %": "18%", "Rollback %": "10%" }, { "Report Date": "2026-09-27", "Resolution %": "34%", "Normalisation %": "17%", "Rollback %": "9%" }]);
    if ("fatal" in r) throw new Error(r.fatal);
    expect(vals(r.out[0]).slice(-6, -3)).toEqual([35, 18, 10]);   // then data_source, source_reference, created_by
  });
  it("defaults a blank segment to CD3_HB and still needs a date", () => {
    const r = load([{ ...counts, Segment: "" }, { ...counts, "Report Date": "" }]); if ("fatal" in r) throw new Error(r.fatal);
    expect(vals(r.out[0])[1]).toBe("CD3_HB");
    expect(JSON.stringify(r.out[1])).toMatch(/Report Date/);
  });
  it("tells the user what is missing instead of storing an empty row", () => {
    const r = load([{ "Report Date": "2026-09-28", Segment: "CD3_HB", "Opening Accounts": "2353", "Opening Amount": "9000000" }, counts, counts]); if ("fatal" in r) throw new Error(r.fatal);
    expect(JSON.stringify(r.out[0])).toMatch(/Opening Accounts with at least one/);
  });
  it("rejects a percentage outside 0-100", () => {
    const r = load([{ "Report Date": "2026-09-28", "Resolution %": "135%", "Normalisation %": "18%", "Rollback %": "10%" }, counts, counts]); if ("fatal" in r) throw new Error(r.fatal);
    expect(JSON.stringify(r.out[0])).toMatch(/outside 0-100/);
  });
  it("warns when the outcomes add up to more than the opening book", () => {
    const r = load([{ ...counts, "Resolved Accounts": "2000" }, counts, counts]); if ("fatal" in r) throw new Error(r.fatal);
    expect(notesOf(r.out[0])).toMatch(/more than Opening Accounts/);
    expect(notesOf(r.out[1])).toBe("");
  });
  it("is indifferent to column order and understands other spellings", () => {
    const renamed = { "As On": "2026-09-28", Portfolio: "CD3_HB", "Opening Count": "2353", Resolved: "824", Normalized: "424", "Rolled Back": "235" };
    const rev = Object.fromEntries(Object.entries(renamed).reverse());
    const a = load([renamed, renamed, renamed]); const b = load([rev, rev, rev]);
    if ("fatal" in a || "fatal" in b) throw new Error("unexpected fatal");
    expect(vals(a.out[0])).toEqual(vals(load([counts, counts, counts]).out![0]));
    expect(vals(b.out[0])).toEqual(vals(a.out[0]));
    expect(a.plan.report.mapped.some((m) => m.canonical === "Normalised Accounts" && m.source === "Normalized")).toBe(true);
  });
  it("fails closed on a file that is not this report", () => {
    const r = load([{ foo: 1, bar: 2 }, { foo: 3, bar: 4 }]);
    expect("fatal" in r && r.fatal).toMatch(/does not look like the expected report/);
  });
  it("skips blank spacer rows", () => {
    const r = load([counts, { "Report Date": "", Segment: "", "Opening Accounts": "" }, counts]); if ("fatal" in r) throw new Error(r.fatal);
    expect(r.out[1]).toEqual({ skip: true });
  });
});

describe("percentage cells", () => {
  it("reads 35%, 35 and Excel's 0.35 the same way", () => {
    expect(parsePctCells(["35%", "18", "10%"]).values).toEqual([35, 18, 10]);
    expect(parsePctCells([0.35, 0.18, 0.1])).toEqual({ values: [35, 18, 10], scaledFromFraction: true });
  });
  it("does not scale a real 0.8% sitting next to a 35%", () => {
    expect(parsePctCells(["35%", "0.8%", "10%"]).values).toEqual([35, 0.8, 10]);
    expect(parsePctCells([35, 0.8, 10]).scaledFromFraction).toBe(false);
  });
  it("returns null for blanks and junk", () => expect(parsePctCells(["", "-", "#DIV/0!", "abc"]).values).toEqual([null, null, null, null]));
});

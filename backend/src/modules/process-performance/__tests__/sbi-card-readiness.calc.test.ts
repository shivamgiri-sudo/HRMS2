import { describe, it, expect } from "vitest";
import { buildReadiness, tableKey, EXPECTED_CALL_TABLES } from "../sbi-card-readiness.calc.js";

const FRESH = ["FAT_S_HB", "FAT_S_HB1", "HB", "HB1", "STAB_HB", "STAB_HB1", "PTP_HB", "PTP_HB1", "CTC_HB1"].map((s) => `MAS_AHM_CD3_${s}_28092026`);
const full = { accountNew: 900, accountManual: 120, apr: 19, dialerMis: 30, agentMis: 120 };

describe("call table keys", () => {
  it("reads the client's fresh table names into program + tier, and matches all nine", () => {
    expect(FRESH.map(tableKey).sort()).toEqual(EXPECTED_CALL_TABLES.map((t) => t.key).sort());
    expect(tableKey("MAS_AHM_CD3_HB_28092026")).toBe("CD3|Base|HB");
    expect(tableKey("AL_MUM_CD3_FAT_S_HB_19082026")).toBe("CD3|FAT_S|HB");
  });
});

describe("table names for people", () => {
  it("drops the internal separators and a Standard tier", async () => {
    const { prettyTableKey } = await import("../sbi-card-readiness.calc.js");
    expect([prettyTableKey("CD2|JO|Standard"), prettyTableKey("CD1|PTP|Low"), prettyTableKey("CD3|CTC|HB1")]).toEqual(["CD2 JO", "CD1 PTP (Low)", "CD3 CTC (HB1)"]);
  });
});

describe("daily readiness", () => {
  const base = { from: "2026-09-01", to: "2026-09-30", asOf: "2026-09-30" };
  it("is quiet on a complete day with every fresh call table", () => {
    const r = buildReadiness({ ...base, counts: { "2026-09-30": full }, tablesByDay: { "2026-09-30": FRESH } });
    expect(r.latest!.complete).toBe(true);
    expect(r.latest!.tables!.missing).toEqual([]);
    expect(r.alerts.every((a) => a.level === "info")).toBe(true);
  });
  it("raises a critical alert naming the missing feed and the BCP", () => {
    const r = buildReadiness({ ...base, counts: { "2026-09-30": { ...full, accountManual: 0 } }, tablesByDay: { "2026-09-30": FRESH } });
    expect(r.latest!.dailyMissing).toEqual(["accountManual"]);
    expect(r.alerts[0]).toMatchObject({ level: "critical" });
    expect(r.alerts[0]!.text).toMatch(/MANUAL flow.*BCP/);
  });
  it("names the call tables that did not arrive", () => {
    const r = buildReadiness({ ...base, counts: { "2026-09-30": full }, tablesByDay: { "2026-09-30": FRESH.filter((t) => !/CTC|STAB_HB1/.test(t)) } });
    expect(r.latest!.tables!.missing.sort()).toEqual(["CTC_HB1", "STAB_HB1"]);
    expect(r.alerts[0]!.text).toMatch(/2 of 9 fresh CD3 HB call tables/);
  });
  it("lists other tables separately and ages each source against the as-of day", () => {
    const r = buildReadiness({ ...base, counts: { "2026-09-25": { ...full, dialerMis: 0 }, "2026-09-28": { apr: 19 } }, tablesByDay: { "2026-09-25": [...FRESH, "EL_DEL_CD2_JO_"] } });
    expect(r.days.find((d) => d.date === "2026-09-25")!.tables!.other).toEqual(["CD2 JO"]);
    const f = Object.fromEntries(r.freshness.map((x) => [x.key, x]));
    expect(f.apr).toMatchObject({ lastDate: "2026-09-28", ageDays: 2, status: "stale" });
    expect(f.dialerMis.status).toBe("never");
    expect(f.outcome.status).toBe("never");                      // optional sources are never flagged stale
    expect(r.alerts.some((a) => a.level === "warning" && /Agent time \(APR\)/.test(a.text))).toBe(true);
  });
  it("checks the call tables on the latest day that HAS an export, even when a later day has only an APR", () => {
    const r = buildReadiness({ ...base, counts: { "2026-09-25": full, "2026-09-28": { apr: 19 } }, tablesByDay: { "2026-09-25": FRESH.slice(0, 3) } });
    expect(r.latest!.date).toBe("2026-09-28");
    expect(r.latest!.tables).toBeNull();
    expect(r.tablesDay!.date).toBe("2026-09-25");
    expect(r.alerts.some((a) => a.level === "critical" && /2026-09-25: 6 of 9 fresh CD3 HB call tables/.test(a.text))).toBe(true);
    expect(r.alerts.some((a) => /2026-09-28: missing/.test(a.text))).toBe(true);
  });
  it("handles an empty range", () => {
    const r = buildReadiness({ ...base, counts: {}, tablesByDay: {} });
    expect(r.days).toEqual([]);
    expect(r.alerts[0]).toMatchObject({ level: "info" });
  });
  it("ignores days outside the range", () => {
    const r = buildReadiness({ ...base, counts: { "2026-08-31": full, "2026-09-10": full }, tablesByDay: {} });
    expect(r.days.map((d) => d.date)).toEqual(["2026-09-10"]);
  });
});

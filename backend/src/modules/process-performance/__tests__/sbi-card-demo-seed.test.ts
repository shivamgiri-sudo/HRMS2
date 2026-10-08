import { describe, it, expect } from "vitest";
import { generate, toInserts, demoDates, DEMO_TAG, DEMO_REF } from "../../../../scripts/sbi-card-demo-seed.js";

const dates = demoDates(new Date("2026-10-03T00:00:00Z"));
const ins = toInserts(generate(dates), "proc-1");

describe("sbi-card demo seed", () => {
  it("covers seven days ending on the given day", () => {
    expect(dates).toHaveLength(7);
    expect(dates[6]).toBe("2026-10-03");
  });
  it("is accepted by every real importer mapper", () => {
    for (const [t, i] of Object.entries(ins)) { expect(i.errors, t).toEqual([]); expect(i.values.length, t).toBeGreaterThan(0); }
  });
  it("tags every row so remove can find exactly these rows", () => {
    for (const [t, i] of Object.entries(ins)) {
      const ds = i.columns.indexOf("data_source"); const ref = i.columns.indexOf("source_reference");
      expect(ds, t).toBeGreaterThan(-1);
      for (const v of i.values) { expect(v[ds]).toBe(DEMO_TAG); expect(v[ref]).toBe(DEMO_REF); }
    }
  });
  it("never produces a phone number", () => {
    const i = ins.sbi_card_account_file; const m = i.columns.indexOf("mobile_no");
    expect(i.values.every((v) => v[m] === null)).toBe(true);
  });
  it("uses keys that cannot collide with real files", () => {
    const acc = ins.sbi_card_account_file; const a = acc.columns.indexOf("account_no");
    expect(acc.values.every((v) => String(v[a]).startsWith("99"))).toBe(true);
    const camp = ins.sbi_card_dialer_mis; const c = camp.columns.indexOf("campaign");
    expect(camp.values.every((v) => String(v[c]).startsWith("DEMO"))).toBe(true);
  });
  it("is reproducible", () => {
    const again = toInserts(generate(dates), "proc-1");
    expect(again.sbi_card_account_file.values.length).toBe(ins.sbi_card_account_file.values.length);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  blendPackages, splitDays, daysInclusive, resolveIncrementPackage, isIncrementSplitEnabled, toPackageParts, INCREMENT_SPLIT_FLAG_KEY,
  type PackageParts,
} from "../increment-package-split.js";

const pkg = (over: Partial<PackageParts>): PackageParts => ({
  basic: 0, hra: 0, conveyance: 0, special_allowance: 0, bonus: 0, portfolio: 0, medical_allowance: 0, lta: 0, other_allowance: 0, pli: 0, gross: 0, ...over,
});
const OLD = pkg({ basic: 7800, hra: 1559, conveyance: 1600, bonus: 650, gross: 11609 });
const NEW = pkg({ basic: 9400, hra: 1561, conveyance: 1600, bonus: 783, gross: 13344 });

describe("day arithmetic", () => {
  it("counts inclusive days", () => {
    expect(daysInclusive("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInclusive("2026-09-20", "2026-09-30")).toBe(11);
    expect(daysInclusive("2026-09-30", "2026-09-01")).toBe(0);
  });
  it("splits a mid-month effective date: 20 Sep = 19 days old, 11 days new", () => {
    expect(splitDays("2026-09-01", "2026-09-30", "2026-09-20")).toEqual({ daysOld: 19, daysNew: 11 });
  });
  it("an effective date on or before the window start is all new", () => {
    expect(splitDays("2026-09-01", "2026-09-30", "2026-09-01")).toEqual({ daysOld: 0, daysNew: 30 });
    expect(splitDays("2026-09-01", "2026-09-30", "2026-08-15")).toEqual({ daysOld: 0, daysNew: 30 });
  });
  it("uses the paid window: a joiner on the 25th with an increment on the 28th is 3 days old, 3 new", () => {
    expect(splitDays("2026-09-25", "2026-09-30", "2026-09-28")).toEqual({ daysOld: 3, daysNew: 3 });
  });
  it("an effective date after the window is all old", () => {
    expect(splitDays("2026-09-01", "2026-09-30", "2026-10-05")).toEqual({ daysOld: 30, daysNew: 0 });
  });
});

describe("blendPackages", () => {
  it("weights each component by days", () => {
    const b = blendPackages(OLD, NEW, 19, 11);
    expect(b.gross).toBeCloseTo((11609 * 19 + 13344 * 11) / 30, 2);
    expect(b.basic).toBeCloseTo((7800 * 19 + 9400 * 11) / 30, 2);
    // components still add up to the blended gross, within rounding of the five parts
    const parts = b.basic + b.hra + b.conveyance + b.bonus;
    expect(Math.abs(parts - b.gross)).toBeLessThan(0.05);
  });
  it("returns the new package when no day is old, the old when no day is new", () => {
    expect(blendPackages(OLD, NEW, 0, 30)).toEqual(NEW);
    expect(blendPackages(OLD, NEW, 30, 0)).toEqual(OLD);
  });
});

function execFor(opts: { increment?: Record<string, unknown> | null; catalog?: Record<string, unknown>[] }) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (String(sql).includes("salary_increment_request")) return [opts.increment ? [opts.increment] : []];
      if (String(sql).includes("salary_package_master")) return [opts.catalog ?? []];
      return [[]];
    }),
  } as any;
}
const CATALOG_ROW = { basic: 9400, hra: 1561, conveyance: 1600, special_allowance: 0, bonus: 783, portfolio: 0, medical: 0, lta: 0, other_allowance: 0, pli: 0, gross: 13344, epf_employee: 1128, esic_employee: 100, admin_charges: 94, net_in_hand: 12116 };
const INC = { id: "inc-1", proposed_ctc: 15000 * 12, effective_from: "2026-09-20" };
const WINDOW = { windowStart: "2026-09-01", windowEnd: "2026-09-30" };

describe("resolveIncrementPackage", () => {
  it("blends the old package with the catalog package for the approved CTC by calendar days", async () => {
    const r = await resolveIncrementPackage(execFor({ increment: INC, catalog: [CATALOG_ROW] }), {
      employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW,
    });
    expect(r).not.toBeNull();
    expect(r!.daysOld).toBe(19);
    expect(r!.daysNew).toBe(11);
    expect(r!.package.gross).toBeCloseTo((11609 * 19 + 13344 * 11) / 30, 2);
  });

  it("prices the whole month at the new package when the increment predates the month", async () => {
    const r = await resolveIncrementPackage(execFor({ increment: { ...INC, effective_from: "2026-08-10" }, catalog: [CATALOG_ROW] }), {
      employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW,
    });
    expect(r!.package.gross).toBe(13344);
    expect(r!.daysOld).toBe(0);
  });

  it("does nothing when the package row is dated on or after the increment (it is the later truth)", async () => {
    const r = await resolveIncrementPackage(execFor({ increment: INC, catalog: [CATALOG_ROW] }), {
      employeeId: "e1", current: OLD, currentEffectiveDate: "2026-09-20", ...WINDOW,
    });
    expect(r).toBeNull();
  });

  it("does nothing without an approved, implemented increment", async () => {
    expect(await resolveIncrementPackage(execFor({ increment: null, catalog: [CATALOG_ROW] }), { employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW })).toBeNull();
  });

  it("does nothing when the approved CTC matches no catalog package, or several different ones", async () => {
    expect(await resolveIncrementPackage(execFor({ increment: INC, catalog: [] }), { employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW })).toBeNull();
    const other = { ...CATALOG_ROW, gross: 13000, basic: 9000 };
    expect(await resolveIncrementPackage(execFor({ increment: INC, catalog: [CATALOG_ROW, other] }), { employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW })).toBeNull();
  });

  it("treats several identical catalog copies as one package", async () => {
    const r = await resolveIncrementPackage(execFor({ increment: INC, catalog: [CATALOG_ROW, { ...CATALOG_ROW }] }), { employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW });
    expect(r).not.toBeNull();
  });

  it("only considers increments that are approved and implemented and not after the window", async () => {
    const ex = execFor({ increment: INC, catalog: [CATALOG_ROW] });
    await resolveIncrementPackage(ex, { employeeId: "e1", current: OLD, currentEffectiveDate: "2026-04-22", ...WINDOW });
    const sql = String(ex.execute.mock.calls[0][0]);
    expect(sql).toMatch(/status = 'implemented'/);
    expect(sql).toMatch(/approved_at IS NOT NULL/);
    expect(sql).toMatch(/source = 'hrms'/); // never a legacy migration row
    expect(sql).toMatch(/effective_from <= \?/);
    expect(ex.execute.mock.calls[0][1]).toEqual(["e1", "2026-09-30"]);
  });
});

describe("flag", () => {
  const exec = (rows: unknown[] | Error) => ({ execute: vi.fn(async () => { if (rows instanceof Error) throw rows; return [rows]; }) }) as any;
  it("is off by default, on only for the exact string true, and off on any error", async () => {
    expect(await isIncrementSplitEnabled(exec([]))).toBe(false);
    expect(await isIncrementSplitEnabled(exec([{ config_value: "false" }]))).toBe(false);
    expect(await isIncrementSplitEnabled(exec([{ config_value: "TRUE" }]))).toBe(true);
    expect(await isIncrementSplitEnabled(exec(new Error("boom")))).toBe(false);
    expect(INCREMENT_SPLIT_FLAG_KEY).toBe("increment_package_split_enabled");
  });
});

describe("toPackageParts", () => {
  it("coerces strings and missing columns to numbers", () => {
    expect(toPackageParts({ basic: "100.50", gross: "200" }).basic).toBe(100.5);
    expect(toPackageParts({}).gross).toBe(0);
  });
});

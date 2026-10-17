/**
 * Owner decision 2026-10-17: "Yes complete without Education it is not applicable."
 * Education can still be recorded on the BGV report, but it never holds the verdict,
 * never counts toward the score, and is never listed as pending. Every other
 * required category (identity, bank, address, employment for non-freshers,
 * criminal where applicable) is unchanged.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[]]) } }));

const svc = await import("../bgv-verification.service.js");
const { pendingItems, isBgvDone } = await import("../bgv-pending-items.js");

const best = (o: Record<string, string>) => new Map(Object.entries(o));

describe("deriveOverallStatus — education not applicable", () => {
  const allClear = { aadhaar: "verified", pan: "verified", bank: "verified", address: "verified" };

  it("is clear with no education check at all", () => {
    expect(svc.deriveOverallStatus(best(allClear), false, false, false)).toBe("clear");
  });

  it("is clear even when an education check is recorded as failed", () => {
    expect(svc.deriveOverallStatus(best({ ...allClear, education: "failed" }), false, false, false)).toBe("clear");
  });

  it("still requires address, bank and identity", () => {
    const { address: _a, ...noAddress } = allClear;
    expect(svc.deriveOverallStatus(best(noAddress), false, false, false)).toBe("in_progress");
    const { bank: _b, ...noBank } = allClear;
    expect(svc.deriveOverallStatus(best(noBank), false, false, false)).toBe("in_progress");
    const { pan: _p, ...noPan } = allClear;
    expect(svc.deriveOverallStatus(best(noPan), false, false, false)).toBe("in_progress");
    expect(svc.deriveOverallStatus(best({ ...allClear, bank: "failed" }), false, false, false)).toBe("refer");
  });

  it("still requires employment for a non-fresher and criminal where applicable", () => {
    expect(svc.deriveOverallStatus(best(allClear), false, true, false)).toBe("in_progress");
    expect(svc.deriveOverallStatus(best({ ...allClear, employment: "verified" }), false, true, false)).toBe("clear");
    expect(svc.deriveOverallStatus(best(allClear), false, false, true)).toBe("in_progress");
  });

  it("DigiLocker still covers Aadhaar and PAN", () => {
    expect(svc.deriveOverallStatus(best({ digilocker: "verified", bank: "verified", address: "verified" }), true, false, false)).toBe("clear");
  });
});

describe("score denominator", () => {
  it("base is 70 (aadhaar 25 + pan 20 + bank 15 + address 10), education excluded", () => {
    expect(svc.BGV_BASE_DENOMINATOR).toBe(70);
    expect(svc.BGV_NOT_APPLICABLE_CATEGORIES).toContain("education");
    expect(svc.BGV_BASE_REQUIRED_CATEGORIES).not.toContain("education");
    expect(svc.deriveApplicableChecksFromRow(undefined).denominator).toBe(70);
    expect(svc.deriveApplicableChecksFromRow({ working_experience: "Experienced", experience_year: 3 } as never).denominator).toBe(80);
  });

  it("computeAndSaveScore gives 100 and 'clear' with every applicable check clear and no education", async () => {
    const { db } = await import("../../../db/mysql.js");
    const exec = db.execute as unknown as ReturnType<typeof vi.fn>;
    const writes: unknown[][] = [];
    exec.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM candidate_bgv_check")) {
        return [[
          { check_type: "digilocker", status: "verified" },
          { check_type: "bank", status: "verified" },
        ]];
      }
      if (sql.includes("FROM candidate_bgv_report")) {
        return [[{ locked: 0, overall_status: "in_progress", address_status: "passed", education_status: "not_run" }]];
      }
      if (sql.startsWith("INSERT INTO candidate_bgv_report")) writes.push(params);
      return [[]];
    });
    const r = await svc.computeAndSaveScore("cand-1");
    expect(r).toEqual({ score: 100, overallStatus: "clear" });
    expect(writes[0]).toEqual(["cand-1", 100, "clear"]);
  });
});

describe("pending items and isBgvDone", () => {
  const base = { includeEmployment: false, includeCriminal: false, addressAttempt: null as string | null };
  const checks = [{ check_type: "digilocker", status: "verified" }, { check_type: "bank", status: "verified" }];

  it("never lists education, whether not run or failed", () => {
    expect(pendingItems({ ...base, checks, report: { education: "not_run", address: "passed" } })).toEqual([]);
    expect(pendingItems({ ...base, checks: [...checks, { check_type: "education_doc", status: "failed" }], report: { address: "passed" } })).toEqual([]);
  });

  it("done: stored clear, or nothing outstanding unless negative / locked", () => {
    expect(isBgvDone("clear", 0, undefined)).toBe(true);
    expect(isBgvDone("in_progress", 0, [])).toBe(true);
    expect(isBgvDone("refer", 0, [])).toBe(true);
    expect(isBgvDone("negative", 0, [])).toBe(false);
    expect(isBgvDone("in_progress", 1, [])).toBe(false);
    expect(isBgvDone("in_progress", 0, undefined)).toBe(false);
    const open = pendingItems({ ...base, checks, report: { address: "not_run" } });
    expect(isBgvDone("in_progress", 0, open)).toBe(false);
  });
});

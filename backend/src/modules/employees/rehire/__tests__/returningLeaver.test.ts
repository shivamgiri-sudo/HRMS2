import { describe, it, expect, vi } from "vitest";
import { findReturningLeaverForCandidate, decideLeaverOutcome, checkReturningLeaver } from "../returningLeaver.js";
import type { RehireVerdict } from "../rehireEligibility.js";

function exec(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const leaver = { employeeId: "e1", employeeCode: "MAS001", fullName: "Asha Rao", employmentStatus: "resigned" };
const verdict = (reasons: { code: string; severity: "blocked" | "review" }[], fresh = false): RehireVerdict => ({
  status: reasons.some((r) => r.severity === "blocked") ? "blocked" : reasons.length ? "review" : "eligible",
  reasons: reasons.map((r) => ({ ...r, message: r.code })),
  requiresFreshOnboarding: fresh,
  requiresAbscondingAck: false,
});

describe("findReturningLeaverForCandidate", () => {
  it("returns null when the candidate has no PAN or Aadhaar", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: null, aadhar_number: "" }] });
    expect(await findReturningLeaverForCandidate(e as never, "c1")).toBeNull();
  });

  it("matches only LEAVERS: inactive and a terminal status, never a person who did not join", async () => {
    const e = exec({
      "FROM ats_candidate": [{ pan_number: "abcde1234f", aadhar_number: "1234 5678 9012" }],
      "FROM employees e": [{ id: "e1", employee_code: "MAS001", full_name: "Asha Rao", employment_status: "resigned" }],
    });
    const out = await findReturningLeaverForCandidate(e as never, "c1");
    expect(out).toEqual(leaver);
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("FROM employees e"))!;
    const sql = String(q[0]);
    expect(sql).toMatch(/e\.active_status\s*=\s*0/);
    expect(sql).toMatch(/'resigned'/);
    expect(sql).not.toMatch(/'not_joined'/);
    expect(q[1]).toContain("ABCDE1234F"); // PAN normalised to upper case
    expect(q[1]).toContain("123456789012"); // Aadhaar normalised to digits
  });

  it("returns null when nothing matches", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    expect(await findReturningLeaverForCandidate(e as never, "c1")).toBeNull();
  });

  it("only compares identifiers that are present", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    await findReturningLeaverForCandidate(e as never, "c1");
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("FROM employees e"))!;
    expect(String(q[0])).not.toMatch(/aadhaar/i);
  });
});

describe("decideLeaverOutcome", () => {
  it("conduct-blocked leavers are blocked even through ATS", () => {
    for (const code of ["TERMINATED", "MISCONDUCT", "PERFORMANCE_ACTION", "DISCIPLINARY_FLAG", "REPEAT_ABSCONDING", "LEGACY_TERMINATED"]) {
      const o = decideLeaverOutcome(leaver, verdict([{ code, severity: "blocked" }]));
      expect(o.action).toBe("block_not_allowed");
    }
  });

  it("a conduct block wins over a long gap", () => {
    const o = decideLeaverOutcome(leaver, verdict([{ code: "TERMINATED", severity: "blocked" }, { code: "GAP_EXCEEDS_30", severity: "blocked" }], true));
    expect(o.action).toBe("block_not_allowed");
  });

  it("a long gap with a clean record may be fresh-onboarded, with a warning that names the old code", () => {
    const o = decideLeaverOutcome(leaver, verdict([{ code: "GAP_EXCEEDS_30", severity: "blocked" }], true));
    expect(o.action).toBe("allow_fresh_onboarding");
    expect((o as any).warning).toContain("MAS001");
  });

  it("a short gap means a rejoin request, with the employee code in the message", () => {
    const o = decideLeaverOutcome(leaver, verdict([]));
    expect(o.action).toBe("block_rejoin_required");
    expect((o as any).reason).toContain("MAS001");
  });

  it("review-only reasons (absconding, open clearance) still need a rejoin request, not a new record", () => {
    expect(decideLeaverOutcome(leaver, verdict([{ code: "ABSCONDING", severity: "review" }])).action).toBe("block_rejoin_required");
  });

  it("an inconsistent date (rejoin before exit) is sent to HR as a rejoin, not allowed through", () => {
    expect(decideLeaverOutcome(leaver, verdict([{ code: "REJOIN_BEFORE_EXIT", severity: "blocked" }])).action).toBe("block_rejoin_required");
  });
});

describe("checkReturningLeaver", () => {
  it("is a no-op ('none') when the candidate matches no leaver", async () => {
    const e = exec({ "FROM ats_candidate": [{ pan_number: "ABCDE1234F", aadhar_number: null }], "FROM employees e": [] });
    const r = await checkReturningLeaver(e as never, "c1", "2026-10-10");
    expect(r.outcome.action).toBe("none");
  });

  it("fails OPEN with a warning when the lookup itself errors", async () => {
    const e = exec({ "FROM ats_candidate": new Error("db gone") });
    const r = await checkReturningLeaver(e as never, "c1", "2026-10-10");
    expect(r.outcome.action).toBe("none");
    expect(r.warning).toMatch(/could not check/i);
  });
});

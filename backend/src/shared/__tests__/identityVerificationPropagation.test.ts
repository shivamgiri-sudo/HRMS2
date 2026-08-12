import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import {
  propagateIdentityVerification,
  verificationColumnFor,
} from "../identityVerificationPropagation.js";

const BRIDGE_HIT = [[{ employee_id: "emp-1" }], []];
const BRIDGE_MISS = [[], []];
const UPDATED = [{ affectedRows: 1 }, []];
const NOT_UPDATED = [{ affectedRows: 0 }, []];

beforeEach(() => { execute.mockReset(); });

describe("verificationColumnFor", () => {
  it("maps the identity checks that assert a specific document", () => {
    expect(verificationColumnFor("pan")).toBe("pan_verified_on");
    expect(verificationColumnFor("aadhaar")).toBe("aadhaar_verified_on");
    expect(verificationColumnFor("aadhaar_offline")).toBe("aadhaar_verified_on");
    expect(verificationColumnFor("PAN")).toBe("pan_verified_on");
  });

  it("does NOT treat digilocker as proof that Aadhaar was verified", () => {
    // DigiLocker is a document source that may carry several documents. Mapping it to Aadhaar
    // would claim the provider asserted something it did not.
    expect(verificationColumnFor("digilocker")).toBeNull();
  });

  it("ignores checks that are not identity documents", () => {
    for (const t of ["bank", "photo_match", "name_match", "criminal", "", "  "]) {
      expect(verificationColumnFor(t)).toBeNull();
    }
  });
});

describe("propagateIdentityVerification", () => {
  it("stamps the employee with the provider's timestamp, not now()", async () => {
    const providerTime = new Date("2026-03-04T09:15:00Z");
    execute.mockResolvedValueOnce(BRIDGE_HIT).mockResolvedValueOnce(UPDATED);

    const r = await propagateIdentityVerification("cand-1", "pan", providerTime);

    expect(r).toEqual({ column: "pan_verified_on", employeeId: "emp-1", updated: true });
    const [sql, params] = execute.mock.calls[1];
    expect(String(sql)).toMatch(/UPDATE employees SET pan_verified_on = \?/);
    expect(params[0]).toEqual(providerTime);      // the real event's time, never Date.now()
    expect(params[1]).toBe("emp-1");
  });

  it("never overwrites a verification date that already exists", async () => {
    // The guard is in SQL so a re-run cannot rewrite when a document was FIRST verified.
    execute.mockResolvedValueOnce(BRIDGE_HIT).mockResolvedValueOnce(NOT_UPDATED);
    const r = await propagateIdentityVerification("cand-1", "pan", new Date());
    expect(String(execute.mock.calls[1][0])).toMatch(/AND pan_verified_on IS NULL/);
    expect(r.updated).toBe(false);
  });

  it("does nothing when no employee is linked, rather than guessing one", async () => {
    // Attaching a verification to the wrong person is worse than leaving it unattached, so
    // there is no name or email fallback.
    execute.mockResolvedValueOnce(BRIDGE_MISS);
    const r = await propagateIdentityVerification("cand-1", "pan", new Date());
    expect(r).toEqual({ column: "pan_verified_on", employeeId: null, updated: false });
    expect(execute).toHaveBeenCalledTimes(1);     // no UPDATE attempted
  });

  it("resolves the employee only through the deterministic bridge", async () => {
    execute.mockResolvedValueOnce(BRIDGE_HIT).mockResolvedValueOnce(UPDATED);
    await propagateIdentityVerification("cand-1", "pan", new Date());
    expect(String(execute.mock.calls[0][0])).toMatch(/FROM ats_onboarding_bridge/);
    expect(String(execute.mock.calls[0][0])).not.toMatch(/full_name|email|mobile/i);
  });

  it("refuses to invent a date when the check carries none", async () => {
    for (const missing of [null, undefined, ""]) {
      execute.mockReset();
      const r = await propagateIdentityVerification("cand-1", "pan", missing as never);
      expect(r.updated).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("touches nothing for a non-identity check", async () => {
    const r = await propagateIdentityVerification("cand-1", "bank", new Date());
    expect(r).toEqual({ column: null, employeeId: null, updated: false });
    expect(execute).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildBranchActionBody,
  canDecideRejoin,
  canOpenRejoinReview,
  canRaiseRejoin,
  dossierErrorView,
  followUpFailures,
  followUpWarning,
  interpretApiError,
  raiseSubmitState,
  reviewLinkFor,
  statusBannerFor,
  addDaysIso,
  type EligibilityCheckState,
} from "../rejoinActions";
import type { RehireVerdict } from "../rejoinTypes";

const apiError = (status: number, payload: unknown, message = "HTTP error") =>
  Object.assign(new Error(message), { name: "HrmsApiError", status, payload });

const eligible: RehireVerdict = { status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false };
const review: RehireVerdict = {
  status: "review",
  reasons: [{ code: "ABSCONDING", severity: "review", message: "Left by absconding." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: true,
};
const blocked: RehireVerdict = {
  status: "blocked",
  reasons: [
    { code: "ABSCONDING", severity: "review", message: "Left by absconding." },
    { code: "TERMINATED", severity: "blocked", message: "Terminated employees cannot rejoin." },
  ],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: true,
};
const tooLong: RehireVerdict = {
  status: "blocked",
  reasons: [{ code: "GAP_EXCEEDS_30", severity: "blocked", message: "Gap exceeds 30 days." }],
  requiresFreshOnboarding: true,
  requiresAbscondingAck: false,
};

const ok = (eligibility: RehireVerdict, gapDays = 10): EligibilityCheckState => ({
  status: "ok",
  data: { employeeId: "e-1", proposedJoiningDate: "2026-10-06", gapDays, previousEndDate: "2026-09-26", eligibility },
});

describe("buildBranchActionBody", () => {
  it("trims remarks and sends the acknowledgement only for an approval that needs it", () => {
    expect(buildBranchActionBody("approved", "  fine to rejoin  ", { needsAck: true, acknowledged: true })).toEqual({
      action: "approved",
      remarks: "fine to rejoin",
      absconding_acknowledged: true,
    });
  });

  it("never claims an acknowledgement the case does not need", () => {
    expect(buildBranchActionBody("approved", "ok fine", { needsAck: false, acknowledged: true }).absconding_acknowledged).toBe(false);
  });

  it("a rejection never carries the acknowledgement", () => {
    expect(buildBranchActionBody("rejected", "no thanks", { needsAck: true, acknowledged: true })).toEqual({
      action: "rejected",
      remarks: "no thanks",
      absconding_acknowledged: false,
    });
  });
});

describe("interpretApiError", () => {
  it("shows the backend message verbatim", () => {
    const out = interpretApiError(apiError(400, { success: false, message: "Request is not pending branch head action" }));
    expect(out.message).toBe("Request is not pending branch head action");
    expect(out.status).toBe(400);
    expect(out.eligibility).toBeNull();
  });

  it("refetches the dossier when the request is no longer pending", () => {
    expect(interpretApiError(apiError(400, { message: "Request is not pending branch head action" })).refetchDossier).toBe(true);
  });

  it("carries a returned eligibility and asks for a dossier refetch", () => {
    const out = interpretApiError(apiError(400, { success: false, message: "Terminated employees cannot rejoin.", eligibility: blocked }));
    expect(out.eligibility).toEqual(blocked);
    expect(out.refetchDossier).toBe(true);
    expect(out.requiresFreshOnboarding).toBe(false);
  });

  it("detects the fresh-onboarding refusal from the reason code or the verdict", () => {
    expect(interpretApiError(apiError(400, { message: "Gap exceeds 30 days.", reason: "REQUIRES_FRESH_ONBOARDING", eligibility: tooLong })).requiresFreshOnboarding).toBe(true);
    expect(interpretApiError(apiError(400, { message: "Gap exceeds 30 days.", eligibility: tooLong })).requiresFreshOnboarding).toBe(true);
  });

  it("ignores a malformed eligibility", () => {
    const out = interpretApiError(apiError(400, { message: "x", eligibility: { status: "nope" } }));
    expect(out.eligibility).toBeNull();
    expect(out.refetchDossier).toBe(false);
  });

  it("appends the first validation error to the zod 'Invalid input' message", () => {
    const out = interpretApiError(apiError(400, { message: "Invalid input", errors: [{ path: ["remarks"], message: "String must contain at least 5 character(s)" }] }));
    expect(out.message).toBe("Invalid input: remarks: String must contain at least 5 character(s)");
  });

  it("falls back to the error's own message, then to a generic one", () => {
    expect(interpretApiError(new Error("Request timed out after 600s.")).message).toBe("Request timed out after 600s.");
    expect(interpretApiError(null).message).toBe("Something went wrong. Please try again.");
    expect(interpretApiError(new Error("Request timed out")).status).toBeNull();
  });
});

describe("dossierErrorView", () => {
  it("403 is a scope problem, not a retryable failure", () => {
    const v = dossierErrorView(apiError(403, { message: "This request is not in your assigned scope" }));
    expect(v.kind).toBe("forbidden");
    expect(v.title).toMatch(/not in your scope/i);
    expect(v.retry).toBe(false);
  });

  it("404 says the request was not found", () => {
    const v = dossierErrorView(apiError(404, { message: "Request not found" }));
    expect(v.kind).toBe("not_found");
    expect(v.title).toMatch(/request not found/i);
    expect(v.retry).toBe(false);
  });

  it("anything else shows the message and offers a retry", () => {
    const v = dossierErrorView(apiError(500, { message: "Failed to build dossier" }));
    expect(v.kind).toBe("other");
    expect(v.message).toBe("Failed to build dossier");
    expect(v.retry).toBe(true);
  });
});

describe("followUpFailures / followUpWarning", () => {
  it("lists only the failed steps, by name and detail", () => {
    const steps = [
      { step: "auth", ok: false, detail: "No login account is linked to this employee; HR must create one." },
      { step: "lms", ok: true },
      { step: "it_provisioning", ok: false },
    ];
    expect(followUpFailures(steps)).toEqual([
      { step: "auth", label: "Login account", detail: "No login account is linked to this employee; HR must create one." },
      { step: "it_provisioning", label: "IT provisioning", detail: null },
    ]);
    expect(followUpWarning(steps)).toBe(
      "Approved, but some follow-up steps need attention: Login account (No login account is linked to this employee; HR must create one.); IT provisioning.",
    );
  });

  it("nothing failed, or a missing / malformed list → no warning", () => {
    expect(followUpWarning([{ step: "lms", ok: true }])).toBeNull();
    expect(followUpWarning(undefined)).toBeNull();
    expect(followUpWarning("nope")).toBeNull();
    expect(followUpFailures([{ ok: false }, null])).toEqual([{ step: "unknown", label: "Unknown step", detail: null }]);
  });
});

describe("role helpers", () => {
  it("only a branch head decides", () => {
    expect(canDecideRejoin(["branch_head"])).toBe(true);
    expect(canDecideRejoin(["hr", "admin"])).toBe(false);
    expect(canDecideRejoin(["super_admin"])).toBe(false);
  });

  it("hr / admin / super_admin / manager may raise", () => {
    for (const r of ["hr", "admin", "super_admin", "manager"]) expect(canRaiseRejoin([r])).toBe(true);
    expect(canRaiseRejoin(["branch_head"])).toBe(false);
    expect(canRaiseRejoin(["payroll_head"])).toBe(false);
  });

  it("the review page is the dossier API's roles exactly", () => {
    for (const r of ["branch_head", "hr", "admin", "super_admin"]) expect(canOpenRejoinReview([r])).toBe(true);
    expect(canOpenRejoinReview(["manager"])).toBe(false);
    expect(canOpenRejoinReview(["payroll_head"])).toBe(false);
  });

  it("reviewLinkFor: Review for a branch head on a pending request, View otherwise, nothing without access", () => {
    expect(reviewLinkFor({ id: "r 1", status: "pending" }, ["branch_head"])).toEqual({ href: "/employees/reactivation/r%201/review", label: "Review" });
    expect(reviewLinkFor({ id: "r-1", status: "approved" }, ["branch_head"])).toEqual({ href: "/employees/reactivation/r-1/review", label: "View" });
    expect(reviewLinkFor({ id: "r-1", status: "pending" }, ["hr"])).toEqual({ href: "/employees/reactivation/r-1/review", label: "View" });
    expect(reviewLinkFor({ id: "r-1", status: "pending" }, ["manager"])).toBeNull();
    expect(reviewLinkFor({ id: "r-2", status: "branch_head_approved" }, ["branch_head"])).toEqual({ href: "/employees/reactivation/r-2/review", label: "Review" });
    expect(reviewLinkFor({ id: "r-2", status: "branch_head_approved" }, ["hr"])).toEqual({ href: "/employees/reactivation/r-2/review", label: "View" });
    expect(reviewLinkFor({ id: "r-3", status: "approved" }, ["branch_head"])).toEqual({ href: "/employees/reactivation/r-3/review", label: "View" });
  });
});

describe("raiseSubmitState", () => {
  const base = { employeeId: "e-1", joiningDate: "2026-10-06", reason: "Strong agent, wants to return", check: ok(eligible) };

  it("eligible with everything filled → submit", () => {
    expect(raiseSubmitState(base)).toEqual({ mode: "submit", canSubmit: true, why: null });
  });

  it("needs review still submits (the branch head decides)", () => {
    expect(raiseSubmitState({ ...base, check: ok(review) }).canSubmit).toBe(true);
  });

  it("asks for the employee, then the date", () => {
    expect(raiseSubmitState({ ...base, employeeId: null }).why).toMatch(/employee/i);
    expect(raiseSubmitState({ ...base, joiningDate: "" }).why).toMatch(/joining date/i);
  });

  it("reason must be at least 10 characters (trimmed), with a counter", () => {
    const s = raiseSubmitState({ ...base, reason: "  short   " });
    expect(s.canSubmit).toBe(false);
    expect(s.why).toBe("The reason needs at least 10 characters (5/10).");
  });

  it("blocked → disabled with the first blocked reason", () => {
    const s = raiseSubmitState({ ...base, check: ok(blocked) });
    expect(s).toEqual({ mode: "submit", canSubmit: false, why: "Blocked: Terminated employees cannot rejoin." });
  });

  it("gap over 30 days → fresh ATS onboarding instead of the submit", () => {
    const s = raiseSubmitState({ ...base, check: ok(tooLong, 41) });
    expect(s.mode).toBe("fresh_onboarding");
    expect(s.canSubmit).toBe(false);
    expect(s.why).toBe("The gap is 41 days (more than 30): this person needs fresh ATS onboarding.");
  });

  it("waits for the eligibility check", () => {
    expect(raiseSubmitState({ ...base, check: { status: "loading" } })).toEqual({ mode: "submit", canSubmit: false, why: "Checking eligibility…" });
    expect(raiseSubmitState({ ...base, check: { status: "idle" } }).canSubmit).toBe(false);
  });

  it("a failed check does not block: the server re-checks on submit", () => {
    expect(raiseSubmitState({ ...base, check: { status: "error", error: "boom" } })).toEqual({ mode: "submit", canSubmit: true, why: null });
  });

  it("the eligibility verdict wins over a short reason (no point typing more)", () => {
    expect(raiseSubmitState({ ...base, reason: "", check: ok(tooLong) }).mode).toBe("fresh_onboarding");
  });
});

describe("statusBannerFor", () => {
  it("no banner while pending", () => {
    expect(statusBannerFor("pending")).toBeNull();
  });
  it("legacy 'branch_head_approved': a neutral note that the final decision is still open, not a closed banner", () => {
    const text = statusBannerFor("branch_head_approved");
    expect(text).toBe("Approved earlier by the branch head under the old process; waiting for the final decision.");
    expect(text).not.toMatch(/cannot be actioned|Nothing is left/);
  });
  it("explains each closed state", () => {
    expect(statusBannerFor("approved")).toMatch(/approved/);
    expect(statusBannerFor("rejected")).toMatch(/rejected/);
    expect(statusBannerFor("weird")).toBe("This request is weird, so it cannot be actioned.");
  });
});

describe("addDaysIso", () => {
  it("adds days across month and year ends without a timezone shift", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-12-31T18:30:00.000Z", 1)).toBe("2027-01-01");
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("bad input → empty string", () => {
    expect(addDaysIso(null, 1)).toBe("");
    expect(addDaysIso("31/08/2026", 1)).toBe("");
  });
});

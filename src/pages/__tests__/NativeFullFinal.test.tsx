/**
 * NativeFullFinal.tsx — F&F frontend/backend deviation-gate fix.
 *
 * Backend gap this closes: ff.service.ts's createFF() (this session, ff-compute.service.ts)
 * now compares submitted notice_recovery/earned_leave_encashment/gratuity_amount/
 * advances_recovery against GET /api/exit/ff/:id/compute's derived values and 422s on any
 * deviation beyond FF_NET_TOLERANCE (0.01) unless the request also carries a non-empty
 * overrideReason. The frontend never called /compute and had no overrideReason field at all —
 * any real manual entry differing by a few paise hit an unactionable 422. This file verifies
 * the fix: the deviation-detection logic itself, and (since this repo's frontend tests have no
 * jsdom/click-simulation — see ClientBillingWorkspacePage.test.tsx's header for the same note)
 * a contract check that the real source actually wires /compute and overrideReason into the
 * request path a click would exercise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computedFieldsFromPreview,
  deviatingFields,
  netFromForm,
  DEVIATION_TOLERANCE,
  type FFFormState,
  type FfComputePreview,
} from "../NativeFullFinal";

const BASE_FORM: FFFormState = {
  calculation_date: "2026-08-20",
  notice_period_days: "30",
  notice_shortfall_days: "0",
  notice_recovery: "0",
  earned_leave_encashment: "0",
  gratuity_amount: "0",
  salary_hold: "0",
  advances_recovery: "0",
  net_payable: "0",
};

const PREVIEW: FfComputePreview = {
  notice: { recovery_amount: { value: 11000, status: "computed", note: "" } },
  leave_encashment: { amount: { value: 0, status: "not_applicable", note: "policy off" } },
  gratuity: { amount: 45000, status: "draft", note: "" },
  advances_loans: { total_recovery: { value: 5000, status: "computed", note: "" } },
};

describe("computedFieldsFromPreview", () => {
  it("returns only the fields with a real computed value", () => {
    const fields = computedFieldsFromPreview(PREVIEW);
    expect(fields.notice_recovery?.value).toBe(11000);
    expect(fields.advances_recovery?.value).toBe(5000);
    expect(fields.gratuity_amount?.value).toBe(45000); // gratuity.status === 'draft' -> treated as computed
    // Leave encashment is deliberately NOT surfaced as a computed field (6cf1a6c8 removed it
    // from the F&F form entirely). The preview payload still carries a leave_encashment block —
    // the backend keeps sending it — so this asserts the mapper drops it rather than that the
    // upstream field is gone. Guards the removal against being silently re-added.
    expect(fields.earned_leave_encashment).toBeUndefined();
  });

  it("omits gratuity when it isn't in draft status (pending_configuration/not_eligible)", () => {
    const fields = computedFieldsFromPreview({ ...PREVIEW, gratuity: { amount: 0, status: "pending_configuration", note: "" } });
    expect(fields.gratuity_amount).toBeUndefined();
  });

  it("returns an empty object for a null preview", () => {
    expect(computedFieldsFromPreview(null)).toEqual({});
  });
});

describe("deviatingFields — must match createFF()'s own comparison exactly", () => {
  it("flags nothing when submitted figures match the computed ones", () => {
    const form: FFFormState = { ...BASE_FORM, notice_recovery: "11000", gratuity_amount: "45000", advances_recovery: "5000" };
    expect(deviatingFields(form, PREVIEW)).toEqual([]);
  });

  it("flags a field that differs by more than the tolerance", () => {
    const form: FFFormState = { ...BASE_FORM, notice_recovery: "11500", gratuity_amount: "45000", advances_recovery: "5000" };
    expect(deviatingFields(form, PREVIEW)).toEqual(["notice_recovery"]);
  });

  it("does NOT flag sub-paisa drift — same tolerance the backend applies", () => {
    const form: FFFormState = { ...BASE_FORM, notice_recovery: String(11000 + DEVIATION_TOLERANCE / 2), gratuity_amount: "45000", advances_recovery: "5000" };
    expect(deviatingFields(form, PREVIEW)).toEqual([]);
  });

  it("flags a real deviation just over the tolerance — this is the exact bug: the old 1-rupee UI tolerance let this through and the backend then 422'd", () => {
    const form: FFFormState = { ...BASE_FORM, notice_recovery: String(11000 + DEVIATION_TOLERANCE + 0.01), gratuity_amount: "45000", advances_recovery: "5000" };
    expect(deviatingFields(form, PREVIEW)).toEqual(["notice_recovery"]);
  });

  it("never flags a field with no computed baseline (e.g. leave encashment when not_applicable)", () => {
    const form: FFFormState = { ...BASE_FORM, earned_leave_encashment: "99999", notice_recovery: "11000", gratuity_amount: "45000", advances_recovery: "5000" };
    expect(deviatingFields(form, PREVIEW)).toEqual([]);
  });

  it("returns no deviations when there's no preview at all (compute endpoint unavailable)", () => {
    const form: FFFormState = { ...BASE_FORM, notice_recovery: "99999" };
    expect(deviatingFields(form, null)).toEqual([]);
  });
});

describe("DEVIATION_TOLERANCE matches the backend's FF_NET_TOLERANCE", () => {
  it("is exactly 0.01, not the old 1-rupee UI tolerance", () => {
    expect(DEVIATION_TOLERANCE).toBe(0.01);
  });
});

describe("netFromForm", () => {
  it("is gratuity - notice recovery - salary hold - advances, EXCLUDING leave encashment", () => {
    const form: FFFormState = { ...BASE_FORM, earned_leave_encashment: "10000", gratuity_amount: "45000", notice_recovery: "11000", salary_hold: "2000", advances_recovery: "5000" };
    // earned_leave_encashment is set to a non-zero value on purpose: 6cf1a6c8 removed leave
    // encashment from the F&F payout, so a form still carrying the figure must not let it back
    // into the net. If it ever re-enters the formula this reads 10000 higher and fails.
    expect(netFromForm(form)).toBe(45000 - 11000 - 2000 - 5000);
  });
});

// ── Contract check: the wiring a click would exercise, verified against the real source ──────
describe("NativeFullFinal.tsx — source wiring (no jsdom/click-simulation in this repo)", () => {
  const source = readFileSync(resolve(__dirname, "../NativeFullFinal.tsx"), "utf-8");

  it("fetches the compute preview when an exit request is selected", () => {
    expect(source).toMatch(/\/api\/exit\/ff\/\$\{exitId\}\/compute/);
  });

  it("sends overrideReason in the create payload when fields deviate", () => {
    expect(source).toMatch(/overrideReason:\s*overrideReason\.trim\(\)/);
  });

  it("blocks submission until a reason is provided for a deviation", () => {
    expect(source).toMatch(/needsOverrideReason/);
    expect(source).toMatch(/disabled=\{submitting \|\| netMismatch \|\| needsOverrideReason\}/);
  });

  it("no longer uses the old 1-rupee net-mismatch tolerance anywhere", () => {
    expect(source).not.toMatch(/> 1\)/); // the exact old comparisons this fix replaced
  });
});

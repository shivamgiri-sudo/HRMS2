import { describe, expect, it } from "vitest";
import { isBalanceGated } from "./leaveFormRules";

describe("isBalanceGated", () => {
  it("gates paid leave on its balance", () => expect(isBalanceGated(false, true)).toBe(true));
  it("does not gate the form's special Unpaid Leave", () => expect(isBalanceGated(true, false)).toBe(false));
  it("does not gate any type that is not paid (Leave Without Pay)", () => expect(isBalanceGated(false, false)).toBe(false));
  it("keeps gating when paid status is unknown", () => {
    expect(isBalanceGated(false, null)).toBe(true);
    expect(isBalanceGated(false, undefined)).toBe(true);
  });
});

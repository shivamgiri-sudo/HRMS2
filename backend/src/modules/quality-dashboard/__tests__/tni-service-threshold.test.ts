import { describe, it, expect } from "vitest";
import { effectiveThreshold } from "../tni.service.js";

/**
 * A flat 60% pass-rate bar was tried first and was wrong. Verified live
 * (2026-08-09..2026-09-08): "correct_and_complete_information" runs an
 * audit-weighted org-wide pass rate around 49%, already below a flat 60% bar —
 * so a flat threshold there did not find agents with a gap, it flagged almost
 * everyone. Confirmed the scale of it directly: 57 of 63 agents (90%) were
 * flagged on at least one of 19 parameters under the flat bar; 29 of 63 (46%)
 * under this fix.
 */
describe("effectiveThreshold", () => {
  it("sets a real bar below a low (hard-parameter) baseline", () => {
    // ~49% baseline pass rate, minus a 15-point margin.
    expect(effectiveThreshold(49)).toBe(34);
  });

  it("caps at MAX_THRESHOLD so a naturally-easy parameter cannot flag everyone", () => {
    // A 98% baseline minus 15 would be 83 — capped at 60 so an 85%-passing agent,
    // still clearly fine, is not flagged just for being below a sky-high crowd.
    expect(effectiveThreshold(98)).toBe(60);
  });

  it("floors at MIN_THRESHOLD so a catastrophic parameter never stops flagging anyone", () => {
    // A 10% baseline minus 15 would be negative — floored at 20, so someone at
    // 15% still gets caught even though "everyone" is already failing this one.
    expect(effectiveThreshold(10)).toBe(20);
  });

  it("leaves the original 60% bar in place where it was never wrong", () => {
    // A parameter most agents already pass comfortably (85% baseline) still
    // uses a sensible, uncapped-feeling threshold once clamped.
    expect(effectiveThreshold(85)).toBe(60);
  });
});

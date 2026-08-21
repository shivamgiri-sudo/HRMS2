/**
 * isNightShift() regression coverage — 2026-08-21.
 *
 * The old implementation only recognized the literal textual shape "<pm-time> - <am-time>"
 * for 12h cells and required a colon on both sides for 24h cells, so it silently missed real
 * night/graveyard shifts written any other way. See the doc comment on isNightShift in
 * RosterImportPage.tsx for the full reasoning.
 */
import { describe, expect, it } from "vitest";
import { isNightShift } from "../RosterImportPage";

describe("isNightShift", () => {
  it("flags shifts that cross midnight (24h)", () => {
    expect(isNightShift("22:00 - 06:00")).toBe(true);
    expect(isNightShift("23:30 - 00:30")).toBe(true);
  });

  it("flags shifts that cross midnight (12h, pm-am)", () => {
    expect(isNightShift("07:00pm-04:00am")).toBe(true);
    expect(isNightShift("7pm - 4am")).toBe(true);
  });

  it("does not flag ordinary day shifts", () => {
    expect(isNightShift("10:00 - 19:00")).toBe(false);
    expect(isNightShift("09:30 - 18:30")).toBe(false);
    expect(isNightShift("06:00am-03:00pm")).toBe(false); // early start, still a day shift
  });

  it("does not flag non-shift cells", () => {
    expect(isNightShift("")).toBe(false);
    expect(isNightShift("WO")).toBe(false);
    expect(isNightShift("L")).toBe(false);
  });

  // ── Previously-missed cases (the reported gap) ──────────────────────────
  it("flags an am-am graveyard shift that doesn't wrap past midnight", () => {
    // Old regex required the first side to say "pm" — this is entirely "am" and was never
    // detected, even though 12am-8am is unambiguously a night/graveyard shift.
    expect(isNightShift("12:00am - 08:00am")).toBe(true);
    expect(isNightShift("01:00am-09:00am")).toBe(true);
  });

  it("flags a pm-pm late-evening shift that doesn't wrap past midnight", () => {
    expect(isNightShift("10:30pm-11:45pm")).toBe(true);
  });

  it("flags a 24h shift starting at/after 22:00 even without a colon on both sides", () => {
    expect(isNightShift("22 - 6")).toBe(true);
  });

  it("does not flag a legitimate early-morning day shift just because it starts before 6am", () => {
    // The night window is deliberately narrow (start < 05:00) so a 05:30 start stays a day shift.
    expect(isNightShift("05:30 - 14:30")).toBe(false);
  });
});

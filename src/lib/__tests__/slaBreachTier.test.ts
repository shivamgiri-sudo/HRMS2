import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSlaBreachTier } from "../slaBreachTier";

/**
 * Extracted 2026-08-24 from two near-duplicate copies (NativeHelpdesk.tsx,
 * NativeSupportCommandCenter.tsx) — this pins the thresholds so they can't silently drift
 * apart again, and pins the status-gating behavior NativeSupportCommandCenter's copy was
 * missing (latent, not live-broken, since its queue only ever loaded status=open tickets).
 */

describe("getSlaBreachTier", () => {
  const FIXED_NOW = new Date("2026-08-24T12:00:00Z").getTime();
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW));
  afterEach(() => vi.restoreAllMocks());

  it("returns null when there's no sla_due_at at all", () => {
    expect(getSlaBreachTier({ status: "open" })).toBeNull();
  });

  it.each(["resolved", "closed", "cancelled", "on_hold"])(
    "returns null for a terminal/paused status (%s), even with a due date in the past",
    (status) => {
      expect(getSlaBreachTier({ sla_due_at: "2020-01-01T00:00:00Z", status })).toBeNull();
    },
  );

  it("'breached' when the sla_breached flag is set, regardless of the computed deadline", () => {
    // Due date still technically in the future, but the flag says breached — flag wins.
    const future = new Date(FIXED_NOW + 10 * 60_000).toISOString();
    const result = getSlaBreachTier({ sla_due_at: future, sla_breached: true, status: "open" });
    expect(result?.tier).toBe("breached");
  });

  it("'breached' when the deadline has passed even if the flag hasn't caught up yet", () => {
    const past = new Date(FIXED_NOW - 5 * 60_000).toISOString();
    const result = getSlaBreachTier({ sla_due_at: past, sla_breached: false, status: "open" });
    expect(result?.tier).toBe("breached");
  });

  it("'due_lt_1h' at exactly 60 minutes left, 'due_lt_4h' just past it", () => {
    const at60 = new Date(FIXED_NOW + 60 * 60_000).toISOString();
    expect(getSlaBreachTier({ sla_due_at: at60, status: "open" })?.tier).toBe("due_lt_1h");

    const at61 = new Date(FIXED_NOW + 61 * 60_000).toISOString();
    expect(getSlaBreachTier({ sla_due_at: at61, status: "open" })?.tier).toBe("due_lt_4h");
  });

  it("'due_lt_4h' at exactly 240 minutes left, 'on_time' just past it", () => {
    const at240 = new Date(FIXED_NOW + 240 * 60_000).toISOString();
    expect(getSlaBreachTier({ sla_due_at: at240, status: "open" })?.tier).toBe("due_lt_4h");

    const at241 = new Date(FIXED_NOW + 241 * 60_000).toISOString();
    expect(getSlaBreachTier({ sla_due_at: at241, status: "open" })?.tier).toBe("on_time");
  });
});

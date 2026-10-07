import { describe, expect, it } from "vitest";
import { buildStripView, toggleExpanded, type HealthPayload } from "../healthStripModel";

const payload = (level: HealthPayload["level"]): HealthPayload => ({
  generatedAt: "2026-10-07T10:00:00.000Z",
  level,
  checks: [
    { key: "meta_configured", label: "Meta configured", level: "ok", detail: "Meta access token is set" },
    { key: "lead_intake", label: "Lead intake", level: "critical", detail: "No leads for 5 h" },
    { key: "sync", label: "Sync", level: "warn", detail: "Last sync 4 h ago" },
  ],
});

describe("healthStripModel", () => {
  it("maps overall level to a label", () => {
    expect(buildStripView(payload("ok"), null).overallLabel).toBe("All healthy");
    expect(buildStripView(payload("warn"), null).overallLabel).toBe("Needs attention");
    expect(buildStripView(payload("critical"), null).overallLabel).toBe("Critical");
  });
  it("gives every chip a level word and an icon key", () => {
    const chips = buildStripView(payload("critical"), null).chips;
    expect(chips.map((c) => [c.key, c.levelWord, c.icon])).toEqual([
      ["meta_configured", "OK", "check"],
      ["lead_intake", "Critical", "x"],
      ["sync", "Warning", "alert"],
    ]);
  });
  it("marks only the expanded chip and exposes its detail", () => {
    const chips = buildStripView(payload("critical"), "lead_intake").chips;
    expect(chips.filter((c) => c.expanded).map((c) => c.key)).toEqual(["lead_intake"]);
    expect(buildStripView(payload("critical"), "lead_intake").expandedDetail).toBe("No leads for 5 h");
    expect(buildStripView(payload("critical"), null).expandedDetail).toBeNull();
  });
  it("ignores an expanded key that no longer exists", () => {
    expect(buildStripView(payload("ok"), "gone").expandedDetail).toBeNull();
  });
  it("null payload yields no chips", () => {
    const v = buildStripView(null, null);
    expect(v.chips).toEqual([]);
    expect(v.overallLabel).toBeNull();
  });
  it("toggle opens one, switches, and closes on the same chip", () => {
    expect(toggleExpanded(null, "a")).toBe("a");
    expect(toggleExpanded("a", "b")).toBe("b");
    expect(toggleExpanded("a", "a")).toBeNull();
  });
});

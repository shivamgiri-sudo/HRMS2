import { describe, it, expect } from "vitest";
import { bandsDiffer, compareMetricMeta } from "../kpi-catalogue.drift.js";
import { defaultAudienceFor, processKeyFor } from "../kpi-catalogue.studio-sync.js";

const cat = { process_key: "gnc", metric_key: "in_aht_sec", metric_code: "AHT", unit: "seconds", direction: "lower_is_better" };

describe("compareMetricMeta", () => {
  it("flags a direction disagreement", () => {
    const out = compareMetricMeta(cat, { unit: "seconds", direction: "higher_is_better" });
    expect(out.map((o) => o.type)).toEqual(["direction_mismatch"]);
  });
  it("flags a unit disagreement but treats pct / % as percent", () => {
    expect(compareMetricMeta({ ...cat, unit: "percent" }, { unit: "pct", direction: "lower_is_better" })).toEqual([]);
    expect(compareMetricMeta(cat, { unit: "minutes", direction: "lower_is_better" }).map((o) => o.type)).toEqual(["unit_mismatch"]);
  });
  it("is silent when everything agrees", () => {
    expect(compareMetricMeta(cat, { unit: "seconds", direction: "lower_is_better" })).toEqual([]);
  });
});

describe("bandsDiffer", () => {
  const a = [{ label: "S", min: 100 }, { label: "A", min: 90 }];
  it("detects different bands, ignores order", () => {
    expect(bandsDiffer(a, [{ label: "A", min: 90 }, { label: "S", min: 100 }])).toBe(false);
    expect(bandsDiffer(a, [{ label: "S", min: 95 }, { label: "A", min: 85 }])).toBe(true);
  });
});

describe("studio sync helpers", () => {
  it("keeps an existing catalogue process key, else derives one from the process code, else _global", () => {
    expect(processKeyFor("gnc", { process_code: "GNC", process_name: "GNC" }).key).toBe("gnc");
    expect(processKeyFor(null, { process_code: "NEW_PROC", process_name: "New" }).key).toBe("new_proc");
    expect(processKeyFor(null, {}).key).toBe("_global");
  });
  it("process-grain definitions are not shown to agents", () => {
    expect(defaultAudienceFor("process")).not.toContain("agent");
    expect(defaultAudienceFor("employee")).toContain("agent");
  });
});

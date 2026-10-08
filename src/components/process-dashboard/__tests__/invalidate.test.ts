import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateData } from "../useDashboardData";

describe("invalidateData (live change)", () => {
  it("marks number queries stale but leaves tab probes, alerts and configs alone", async () => {
    const qc = new QueryClient();
    const keys = [["process-dashboard", "p1", "overview", "a"], ["process-dashboard", "p1", "forecast", "m"], ["process-dashboard", "p1", "why", "x"],
      ["process-dashboard", "p1", "sales"], ["process-dashboard", "p1", "alerts", "summary"], ["process-dashboard", "configs"], ["process-dashboard", "p2", "overview", "a"]];
    for (const k of keys) qc.setQueryData(k, 1);
    await invalidateData(qc, "p1");
    const stale = (k: string[]) => qc.getQueryState(k)!.isInvalidated;
    expect(keys.filter(stale).map((k) => k.slice(1, 3).join("/"))).toEqual(["p1/overview", "p1/forecast", "p1/why"]);
  });
});

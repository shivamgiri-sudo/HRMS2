import { describe, expect, it } from "vitest";
import { effectiveRankMetric } from "../pd.service.js";
import { profileFor } from "../pd.fields.js";

describe("effectiveRankMetric", () => {
  const inbound = profileFor("support_inbound")!;
  it("keeps the profile metric when its field is mapped", () => {
    expect(effectiveRankMetric(inbound, new Set(["calls", "handled"]))).toBe("calls");
  });
  it("falls back to a mapped count metric when calls is not mapped", () => {
    expect(effectiveRankMetric(inbound, new Set(["handled", "offered"]))).toBe("handled");
  });
});

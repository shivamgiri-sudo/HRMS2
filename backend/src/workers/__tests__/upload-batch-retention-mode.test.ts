import { describe, expect, it } from "vitest";
import { retentionMode, resolvePolicy } from "../upload-batch-retention.worker.js";

describe("upload-batch retention mode", () => {
  it("deletes by default (7-day retention must clean itself up)", () => {
    expect(retentionMode(undefined)).toBe("execute");
    expect(retentionMode("")).toBe("execute");
    expect(retentionMode("execute")).toBe("execute");
  });

  it("only an explicit dry_run switches deletion off", () => {
    expect(retentionMode("dry_run")).toBe("dry_run");
  });
});

describe("upload-batch retention policy fallback", () => {
  it("falls back to 7 days for a type with no row and no default row", () => {
    const p = resolvePolicy("ANYTHING", new Map());
    expect(p.retain_days).toBe(7);
    expect(p.enabled).toBe(1);
  });
});

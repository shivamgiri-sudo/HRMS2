import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImpactQuery } from "../roster-requests.routes.js";

describe("parseImpactQuery", () => {
  it("accepts a known kind and id", () => {
    expect(parseImpactQuery({ kind: "swap", id: "abc" })).toEqual({ kind: "swap", id: "abc" });
  });
  it("rejects an unknown kind", () => {
    expect(parseImpactQuery({ kind: "x", id: "abc" })).toBeNull();
  });
  it("rejects a missing id", () => {
    expect(parseImpactQuery({ kind: "swap" })).toBeNull();
  });
});

describe("mounting", () => {
  it("is mounted in app.ts under /api/roster-requests", () => {
    const app = readFileSync(resolve(__dirname, "../../../app.ts"), "utf-8");
    expect(app).toContain('app.use("/api/roster-requests"');
  });
});

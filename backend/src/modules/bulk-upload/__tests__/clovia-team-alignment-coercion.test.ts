import { describe, it, expect } from "vitest";
import { parseDate, CLOVIA_TEAM_ALIGNMENT_HEADERS } from "../clovia-team-alignment-bulk.service.js";

describe("parseDate", () => {
  it("reads the real DOJ Excel serial from the sample (45435 = 2024-05-23)", () => {
    expect(parseDate(45435)).toBe("2024-05-23");
  });
  it("reads a normal ISO date string", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
  it("returns null for blank", () => {
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_TEAM_ALIGNMENT_HEADERS).toContain("EMP");
    expect(CLOVIA_TEAM_ALIGNMENT_HEADERS).toContain("Team_Leader");
  });
});

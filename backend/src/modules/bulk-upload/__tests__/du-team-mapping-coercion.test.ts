import { describe, it, expect } from "vitest";
import { normalizeAgentId, DU_TEAM_MAPPING_HEADERS } from "../du-team-mapping-bulk.service.js";

describe("normalizeAgentId", () => {
  it("reads a real agent id from the sample", () => {
    expect(normalizeAgentId("Agent7004")).toBe("Agent7004");
  });
  it("treats a blank as absent", () => {
    expect(normalizeAgentId("")).toBeNull();
  });
  it("treats the real sample's literal 'NA' value as absent, not a real id", () => {
    expect(normalizeAgentId("NA")).toBeNull();
    expect(normalizeAgentId("na")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(DU_TEAM_MAPPING_HEADERS).toContain("Agent_ID");
    expect(DU_TEAM_MAPPING_HEADERS).toContain("MAS_ID");
  });
});

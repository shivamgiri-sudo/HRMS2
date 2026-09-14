import { describe, it, expect } from "vitest";
import { BVO_REPEAT_ALLOCATION_HEADERS } from "../bvo-repeat-allocation-masmis-bulk.service.js";

describe("headers", () => {
  it("names mobile_no, the row's identity", () => {
    expect(BVO_REPEAT_ALLOCATION_HEADERS).toContain("mobile_no");
  });
});

import { describe, it, expect } from "vitest";
import { BVO_REPEAT_CDR_HEADERS } from "../bvo-repeat-cdr-masmis-bulk.service.js";

describe("headers", () => {
  it("names PhoneNumber, the row's identity", () => {
    expect(BVO_REPEAT_CDR_HEADERS).toContain("PhoneNumber");
  });
});

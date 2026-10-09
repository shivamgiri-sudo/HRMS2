import { describe, expect, it } from "vitest";
import { logText } from "../log-text.js";

describe("logText", () => {
  it("keeps the first line only, drops e-mails and digit runs, caps the length", () => {
    expect(logText(new Error("send to asha@x.in failed for 98765 43210\nstack"))).toBe("send to [email] failed for #");
    expect(logText("x".repeat(500))).toHaveLength(200);
    expect(logText({ message: "Duplicate entry '9876543210' for key" })).toBe("Duplicate entry '#' for key");
    expect(logText(null)).toBe("null");
  });
});

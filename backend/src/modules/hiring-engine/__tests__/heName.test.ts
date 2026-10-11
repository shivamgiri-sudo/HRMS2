import { describe, expect, it } from "vitest";
import { displayFirstName, greetingName } from "../he-name.js";
describe("greetingName / decorative names", () => {
  it("rejects spaced-out or decorative names, keeps real ones", () => {
    expect(greetingName("Engineer-p-r-i-n-c-e ✨")).toBe("");
    expect(greetingName("𝔼𝕟𝕘𝕚𝕟𝕖𝕖𝕣-𝕡-𝕣-𝕚-𝕟-𝕔-𝕖 ✨.")).toBe("");
    expect(greetingName("Candidate")).toBe("");
    expect(greetingName("R")).toBe("");
    expect(greetingName("rahul sharma")).toBe("Rahul");
    expect(greetingName("K. P. R. Kumar")).toBe("Kumar");
  });
  it("displayFirstName falls back to 'there' for them", () => {
    expect(displayFirstName("Engineer-p-r-i-n-c-e")).toBe("there");
    expect(displayFirstName("anita devi")).toBe("Anita");
  });
});

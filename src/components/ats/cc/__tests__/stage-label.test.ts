import { describe, expect, it } from "vitest";
import { humanizeStage } from "../stage-label";

describe("humanizeStage", () => {
  it("turns snake_case codes into readable labels", () => {
    expect(humanizeStage("offer_approved")).toBe("Offer approved");
    expect(humanizeStage("bgv_in_progress")).toBe("Bgv in progress");
  });
  it("keeps names that already read well", () => {
    expect(humanizeStage("Round 1- HR Screening")).toBe("Round 1- HR Screening");
    expect(humanizeStage("Offer Rejected")).toBe("Offer Rejected");
  });
  it("never returns an empty label", () => {
    expect(humanizeStage("")).toBe("Unknown");
  });
});

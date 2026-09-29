import { describe, expect, it } from "vitest";
import { BUSINESS_DATAPOINT_CODES, formatDatapoint } from "../BusinessDatapoints";

describe("business datapoints formatting", () => {
  it("formats rupees in Indian units, percentages and counts", () => {
    expect(formatDatapoint(4283503.8, "currency")).toBe("₹42.84L");
    expect(formatDatapoint(15023, "currency")).toBe("₹15,023");
    expect(formatDatapoint(123456789, "currency")).toBe("₹12.35Cr");
    expect(formatDatapoint(65.54, "percentage")).toBe("65.5%");
    expect(formatDatapoint(4727, "count")).toBe("4,727");
    expect(formatDatapoint(null, "count")).toBe("—");
  });
  it("lists the processes with a wired sales system (kept in step with the backend adapters)", () => {
    expect(BUSINESS_DATAPOINT_CODES).toEqual(["BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC"]);
  });
});

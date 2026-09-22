import { describe, expect, it } from "vitest";
import { countSeverity, formatDate, formatDateTime } from "../opsControlTowerFormat";

describe("countSeverity", () => {
  it("bands none/low/medium/high against the given thresholds", () => {
    expect(countSeverity(0, 3, 8)).toBe("none");
    expect(countSeverity(1, 3, 8)).toBe("low");
    expect(countSeverity(3, 3, 8)).toBe("medium");
    expect(countSeverity(8, 3, 8)).toBe("high");
  });
});

describe("formatDate", () => {
  it("renders a readable date in IST", () => {
    expect(formatDate(Date.UTC(2026, 8, 20, 12, 30))).toMatch(/^20 Sept? 2026$/);
  });

  it("shows an em dash for no date", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders DD/MM/YYYY HH:mm in IST, the platform's date format", () => {
    expect(formatDateTime(Date.UTC(2026, 8, 22, 6, 10))).toBe("22/09/2026 11:40");
  });
});

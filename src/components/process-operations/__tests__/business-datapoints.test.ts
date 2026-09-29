import { describe, expect, it } from "vitest";
import { BUSINESS_DATAPOINT_CODES, formatDatapoint, pickHeroes, statusOf, withoutHeroes } from "../BusinessDatapoints";

describe("business datapoints formatting", () => {
  it("formats rupees in Indian units, percentages and counts", () => {
    expect(formatDatapoint(4283503.8, "currency")).toBe("₹42.84L");
    expect(formatDatapoint(15023, "currency")).toBe("₹15,023");
    expect(formatDatapoint(123456789, "currency")).toBe("₹12.35Cr");
    expect(formatDatapoint(65.54, "percentage")).toBe("65.5%");
    expect(formatDatapoint(4727, "count")).toBe("4,727");
    expect(formatDatapoint(null, "count")).toBe("—");
  });
  it("formats durations", () => {
    expect(formatDatapoint(45, "seconds")).toBe("45s");
    expect(formatDatapoint(216, "seconds")).toBe("3m 36s");
  });
  it("status needs a target and a direction, and respects direction", () => {
    expect(statusOf({ value: 90, target: 80, direction: "higher_is_better" })).toBe("pass");
    expect(statusOf({ value: 70, target: 80, direction: "higher_is_better" })).toBe("fail");
    expect(statusOf({ value: 9, target: 10, direction: "lower_is_better" })).toBe("pass");
    expect(statusOf({ value: 9, target: null, direction: "lower_is_better" })).toBe("none");
  });
  it("picks at most four hero cards, in source order, skipping empty ones", () => {
    const c = (key: string, hero: boolean, value: number | null) => ({ key, label: key, value, unit: "count" as const, hero });
    const groups = [{ key: "g1", title: "g1", source: "s", cards: [c("a", true, 1), c("b", false, 2), c("c", true, null), c("d", true, 4)] }, { key: "g2", title: "g2", source: "s", cards: [c("e", true, 5), c("f", true, 6), c("g", true, 7)] }];
    expect(pickHeroes(groups).map((x) => x.key)).toEqual(["a", "d", "e", "f"]);
  });
  it("removes headline figures from their section so nothing is shown twice", () => {
    const c = (key: string) => ({ key, label: key, value: 1, unit: "count" as const });
    const g = { key: "g", title: "g", source: "s", cards: [c("a"), c("b"), c("c")] };
    expect(withoutHeroes(g, new Set(["a", "c"])).cards.map((x) => x.key)).toEqual(["b"]);
  });
  it("lists the processes with a wired sales system (kept in step with the backend adapters)", () => {
    expect(BUSINESS_DATAPOINT_CODES).toEqual(["BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC", "HOUSING_OWNER", "HOUSING_PREMIUM", "CLOVIA", "BIRLANU", "DALMIA_CEMENT", "APPRICIATE_WEALTH", "ERESOLUTION", "DU_DIGITAL", "EXICOM", "VIEGA"]);
  });
});

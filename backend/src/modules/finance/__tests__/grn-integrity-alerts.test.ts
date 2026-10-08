import { describe, expect, it } from "vitest";
import {
  buildDigest,
  imprestRepeats,
  paidTwinsStillOpen,
  type DigestSection,
} from "../grn-integrity-alerts.js";

const section = (
  key: string,
  count: number,
  lines: string[] = [],
): DigestSection => ({ key, title: `Title ${key}`, count, lines });

describe("buildDigest", () => {
  it("is silent when nothing is flagged", () => {
    expect(
      buildDigest([section("a", 0), section("b", 0)], "07 Oct"),
    ).toBeNull();
  });

  it("lists only the sections with items, and says how many more there are", () => {
    const d = buildDigest(
      [section("a", 0), section("b", 7, ["one", "two"])],
      "07 Oct",
    );
    expect(d?.title).toBe("GRN check 07 Oct: 7 items to look at");
    expect(d?.description).toContain("Title b: 7");
    expect(d?.description).toContain("  - one");
    expect(d?.description).toContain("and 5 more");
    expect(d?.description).not.toContain("Title a");
  });

  it("uses the singular for one item and marks a paid-twin finding urgent", () => {
    const d = buildDigest([section("paid_twin", 1, ["x"])], "07 Oct");
    expect(d?.title).toContain("1 item to look at");
    expect(d?.urgent).toBe(true);
    expect(
      buildDigest([section("late_bill", 2, ["x"])], "07 Oct")?.urgent,
    ).toBe(false);
  });
});

describe("checks", () => {
  const fake = (rows: any[]) => ({
    execute: async () => [rows, undefined] as [any, any],
  });

  it("paidTwinsStillOpen turns rows into readable lines", async () => {
    const s = await paidTwinsStillOpen(
      fake([
        {
          grn_number: null,
          vendor_name: "OESPL",
          amount: 517902,
          status: "submitted",
          paid_grn: "Mas/9/26/126",
        },
      ]),
    );
    expect(s.count).toBe(1);
    expect(s.lines[0]).toBe(
      "OESPL ₹5,17,902: no number yet (submitted) matches paid Mas/9/26/126",
    );
  });

  it("imprestRepeats reports the group size", async () => {
    const s = await imprestRepeats(
      fake([{ sub_head: "R&R Expenses", amount: 500, n: 3 }]),
    );
    expect(s.lines[0]).toBe("3 entries of ₹500 under R&R Expenses");
  });
});

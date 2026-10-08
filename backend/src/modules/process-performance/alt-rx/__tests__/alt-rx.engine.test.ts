import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { brandOf, buildMisModel, toDate, weekOfDay, dayKey } from "../alt-rx.engine";

// The fixture (a 10-row sample of the source workbook and its saved MTD results) was never committed on
// tausif-mis either; the suite runs once it is added and is skipped, visibly, until then.
const FIXTURE = path.join(__dirname, "../__fixtures__/alt-rx-sample.json");
const HAS_FIXTURE = fs.existsSync(FIXTURE);
const fixture = (HAS_FIXTURE ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : { dump: [], sheet1_agents_mtd: {}, sheet1_types_mtd: {}, brand_mtd: {}, agentwise_mtd: {} }) as {
  dump: Array<Record<string, unknown>>;
  sheet1_agents_mtd: Record<string, Array<number | null>>;
  sheet1_types_mtd: Record<string, Array<number | null>>;
  brand_mtd: Record<string, number[]>;
  agentwise_mtd: { inflow_mtd: number; closure_mtd: number; within_mtd: number; out_mtd: number };
};

// Cached column order in the source's Sheet1 MTD tables: Inflow, Closure, Closure%, Within, Out, FRT%.
const [INFLOW, CLOSURE, , WITHIN, OUT] = [0, 1, 2, 3, 4];

describe.skipIf(!HAS_FIXTURE)("ALT RX engine vs the source workbook's saved results (MTD, 10-row sample)", () => {
  const model = buildMisModel(fixture.dump);

  it("headline matches the source totals", () => {
    const total = fixture.sheet1_agents_mtd["Grand Total"];
    expect(model.headline.inflow).toBe(total[INFLOW]);
    expect(model.headline.closure).toBe(total[CLOSURE]);
    expect(model.headline.within).toBe(total[WITHIN]);
    expect(model.headline.out).toBe(total[OUT]);
    expect(model.headline.frtPct).toBeCloseTo(total[5] as number, 6);
  });

  it("every agent matches the source's Sheet1 agent table", () => {
    for (const row of model.agents.rows) {
      const expected = fixture.sheet1_agents_mtd[row.key];
      expect(expected, `source has no row for agent ${row.key}`).toBeDefined();
      expect(row.mtd.inflow, `inflow ${row.key}`).toBe(expected[INFLOW]);
      expect(row.mtd.closure, `closure ${row.key}`).toBe(expected[CLOSURE]);
      expect(row.mtd.within, `within ${row.key}`).toBe(expected[WITHIN]);
      expect(row.mtd.out, `out ${row.key}`).toBe(expected[OUT]);
    }
  });

  it("every comment type matches the source's Sheet1 comments table", () => {
    for (const row of model.types.rows) {
      const expected = fixture.sheet1_types_mtd[row.key];
      expect(expected, `source has no row for type ${row.key}`).toBeDefined();
      expect(row.mtd.inflow, `inflow ${row.key}`).toBe(expected[INFLOW]);
      expect(row.mtd.within, `within ${row.key}`).toBe(expected[WITHIN]);
      expect(row.mtd.out, `out ${row.key}`).toBe(expected[OUT]);
    }
  });

  it("every brand's MTD inflow matches the source's Brand Wise table", () => {
    for (const row of model.brands.rows) {
      const expected = fixture.brand_mtd[row.key];
      if (expected === undefined) continue; // brand not listed in the source table
      expect(row.mtd.inflow, `brand ${row.key}`).toBe(expected[0]);
    }
  });

  it("Agent Wise inflow and closure totals match", () => {
    expect(model.headline.inflow).toBe(fixture.agentwise_mtd.inflow_mtd);
    expect(model.headline.closure).toBe(fixture.agentwise_mtd.closure_mtd);
    expect(model.headline.within).toBe(fixture.agentwise_mtd.within_mtd);
  });
});

describe("date and rule helpers", () => {
  it("week buckets follow day-of-month: 1-7, 8-14, 15-21, 22-28, 29-31", () => {
    expect(weekOfDay(1)).toBe("Week-1");
    expect(weekOfDay(7)).toBe("Week-1");
    expect(weekOfDay(8)).toBe("Week-2");
    expect(weekOfDay(28)).toBe("Week-4");
    expect(weekOfDay(29)).toBe("Week-5");
    expect(weekOfDay(31)).toBe("Week-5");
  });

  it("brand is the text after the first dash in Source Info", () => {
    expect(brandOf("Facebook - AltRx")).toBe("AltRx");
    expect(brandOf("Instagram-Trinity Meds")).toBe("Trinity Meds");
    expect(brandOf("Facebook")).toBe("Unknown brand");
    expect(brandOf("")).toBe("Unknown brand");
  });

  it("reads the staged text dates the uploader stores (M/D/YY H:mm and ISO without a zone)", () => {
    expect(dayKey(toDate("9/1/26 0:00") as Date)).toBe("2026-09-01");
    expect(dayKey(toDate("10/5/26 17:34") as Date)).toBe("2026-10-05");
    expect(dayKey(toDate("2026-09-01 00:00:21") as Date)).toBe("2026-09-01");
    expect(toDate("9/1/26 0:00")).not.toBeNull();
  });

  it("a local Date from the spreadsheet reader keeps its wall-clock day (no shift back a day)", () => {
    const fromSheetJs = new Date(2026, 8, 1, 0, 0, 21); // 1 Sep 00:00:21 local, as SheetJS builds it
    expect(dayKey(toDate(fromSheetJs) as Date)).toBe("2026-09-01");
  });

  it("reads Excel serials, Dates and ISO strings the same way", () => {
    expect(dayKey(toDate(45901) as Date)).toBe("2025-09-01");
    expect(dayKey(toDate("2026-09-01T00:00:21") as Date)).toBe("2026-09-01");
    expect(toDate("not a date")).toBeNull();
  });

  it("counts a ticket once when its Ticket ID repeats, and reports the duplicate", () => {
    const row = { "Ticket ID": 1, Status: "Open", Agent: "A", Type: "Price", "Source Info": "Facebook - AltRx", "Created time": "2026-09-02T10:00:00", "Initial response time": "2026-09-02T10:10:00", "Resolved time": null };
    const model = buildMisModel([row, { ...row }]);
    expect(model.headline.inflow).toBe(1);
    expect(model.skipped.duplicateTicketIds).toBe(1);
  });

  it("a response after 30 minutes is out of TAT; so is no response at all (source rule)", () => {
    const base = { "Ticket ID": "x", Status: "Open", Agent: "A", Type: "Price", "Source Info": "Facebook - AltRx", "Created time": "2026-09-02T10:00:00", "Resolved time": null };
    const late = buildMisModel([{ ...base, "Ticket ID": "1", "Initial response time": "2026-09-02T10:31:00" }]);
    const none = buildMisModel([{ ...base, "Ticket ID": "2", "Initial response time": null }]);
    const onTime = buildMisModel([{ ...base, "Ticket ID": "3", "Initial response time": "2026-09-02T10:30:00" }]);
    expect(late.headline.out).toBe(1);
    expect(none.headline.out).toBe(1);
    expect(onTime.headline.within).toBe(1);
    expect(none.headline.inflow).toBe(1);
  });
});

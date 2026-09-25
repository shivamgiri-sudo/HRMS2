import { describe, it, expect } from "vitest";
import {
  inboundBuckets, inboundDaily, languageTable, outboundBuckets, outboundDispositions, qrcBuckets, leadsSummary, leadInfo,
  taggedInboundByDate, weekOfDate, languageName, type IbCall, type DdRow, type ObRow,
} from "../dalmia-dashboard.calc.js";
import { hmsToSeconds } from "../dalmia-dashboard.service.js";

const call = (o: Partial<IbCall>): IbCall => ({
  date: "2026-09-01", agentId: "MAS63039", campaign: "Dalmia_Hindi", phone: "9113389275", disconnBy: "CALLER",
  callDurSec: 34, queueSec: 0, acwSec: 2, call20: 1, ...o,
});

describe("inbound definitions (from the workbook's Inbound View formulas)", () => {
  const calls: IbCall[] = [
    call({ phone: "1", callDurSec: 60, acwSec: 4 }),                                   // answered, unique
    call({ phone: "1", callDurSec: 30, acwSec: 2 }),                                   // answered, REPEAT (same phone, same date)
    call({ phone: "2", disconnBy: "ABANDON", callDurSec: 0, queueSec: 12, call20: 0 }), // abandoned inside 20s
    call({ phone: "3", disconnBy: "QUEUETIMEOUT", callDurSec: 0, queueSec: 45, call20: 0 }), // abandoned outside 20s
    call({ phone: "4", agentId: "VDCL", disconnBy: "CALLER", call20: 1 }),              // answered by the auto-dialer: not counted in threshold
    call({ phone: "1", date: "2026-09-02" }),                                           // same phone, NEW date -> unique again
  ];
  const day1 = inboundDaily(calls, new Map([["2026-09-01", 3]])).find((d) => d.date === "2026-09-01")!;

  it("counts offered, answered, unique and repeat per date", () => {
    expect(day1.offered).toBe(5);
    expect(day1.answered).toBe(3);   // CALLER, CALLER, CALLER(VDCL)
    expect(day1.unique).toBe(4);
    expect(day1.repeat).toBe(1);
    expect(day1.abandoned).toBe(2);
  });
  it("derives AL, Abn, Repeat, SL and ACHT from the sums", () => {
    expect(day1.alPct).toBeCloseTo(3 / 5);
    expect(day1.abnPct).toBeCloseTo(2 / 5);
    expect(day1.repeatPct).toBeCloseTo(1 / 5);
    expect(day1.ansInThreshold).toBe(2);         // the VDCL row is excluded
    expect(day1.abnInThreshold).toBe(1);         // only the 12s queue abandon
    expect(day1.slPct).toBeCloseTo(2 / (5 - 1)); // Ans in threshold / (Offered - Abn in threshold)
    expect(day1.achtSec).toBeCloseTo((60 + 30 + 34 + (4 + 2 + 2)) / 3); // talk + ACW of the three ANSWERED rows, over answered
  });
  it("Tagging % is DD 'Inbound' rows over answered calls", () => {
    expect(day1.tagged).toBe(3);
    expect(day1.taggingPct).toBeCloseTo(1);
  });
  it("buckets sum days; ratios come from the sums, not an average of days", () => {
    const b = inboundBuckets(calls, new Map());
    expect(b.MTD.offered).toBe(6);
    expect(b["W-1"].offered).toBe(6);
    expect(b["W-2"].offered).toBe(0);
    expect(b.MTD.alPct).toBeCloseTo(4 / 6);
  });
  it("assigns weeks by day of month", () => {
    expect(weekOfDate("2026-09-07")).toBe("W-1");
    expect(weekOfDate("2026-09-08")).toBe("W-2");
    expect(weekOfDate("2026-09-22")).toBe("W-4");
    expect(weekOfDate("2026-09-29")).toBe("W-5");
  });
  it("language table: total, abandon, caller, answered (not VDCL), threshold (queue <= 20s)", () => {
    const hindi = languageTable(calls, "MTD").find((l) => l.campaign === "Dalmia_Hindi")!;
    expect(hindi.total).toBe(6);
    expect(hindi.abandon).toBe(1);
    expect(hindi.caller).toBe(4);
    expect(hindi.answered).toBe(5);
    expect(hindi.threshold).toBe(5);
    expect(hindi.abnPct).toBeCloseTo(1 / 6);
    expect(languageName("Dalmia_Bengoli")).toBe("Bengali");
  });
  it("parses the dialer's h:mm:ss text durations", () => {
    expect(hmsToSeconds("00:00:34")).toBe(34);
    expect(hmsToSeconds("00:00:00.00")).toBe(0);
    expect(hmsToSeconds("00:01:23")).toBe(83);
    expect(hmsToSeconds(null)).toBe(0);
  });
});

describe("outbound (Outbound View formulas)", () => {
  const rows: ObRow[] = [
    { date: "2026-09-01", mobile: "111", status: "Contact", remarks: "Assigned call back" },
    { date: "2026-09-01", mobile: "111", status: "Contact", remarks: "Call Disconnected after Opening" },
    { date: "2026-09-01", mobile: "222", status: "Not Contact", remarks: "Ringing not answering" },
    { date: "2026-09-02", mobile: "111", status: "Contact", remarks: "Something else" },
  ];
  it("overall, unique (distinct mobile per date), connected and rates", () => {
    const b = outboundBuckets(rows).MTD;
    expect(b.overall).toBe(4);
    expect(b.unique).toBe(3);
    expect(b.connected).toBe(3);
    expect(b.conPct).toBeCloseTo(3 / 4);
    expect(b.uniquePct).toBeCloseTo(3 / 4);
  });
  it("connected dispositions only count Contact rows; unknown remarks are grouped as Other so the total is the connected count", () => {
    const d = outboundDispositions(rows, "MTD");
    expect(d.find((x) => x.name === "Assigned call back")?.count).toBe(1);
    expect(d.find((x) => x.name === "Ringing not answering")?.count).toBe(0); // that row is Not Contact
    expect(d.find((x) => x.name === "Other remarks")?.count).toBe(1);
    expect(d.reduce((n, x) => n + x.count, 0)).toBe(3);
  });
});

describe("DD: QRC, tagging and leads", () => {
  const dd = (o: Partial<DdRow>): DdRow => ({
    date: "2026-09-01", sourceOfLead: "Inbound", scenario: "Connected", sub1: "Query", sub2: null, sub3: "Cement Lead",
    status: "Open", typeOfLeads: null, leads: null, mt: 0, converted: 0, ...o,
  });
  const rows: DdRow[] = [
    dd({}), dd({ sub1: "Complain", sub3: "Cement Quality Issue", status: "Closed" }), dd({ sub1: "Request", sourceOfLead: "Website", scenario: "Not Connected", sub3: "General Enquiry" }),
    dd({ sub1: "Wrong No", sub3: null, sourceOfLead: "WhatsApp" }),
    dd({ sub2: "Institutional Sales", sub3: "Institutional Sales", converted: 2, mt: 8.5 }),
  ];
  it("QRC counts SUB SCENARIO 1 Query / Complain / Request", () => {
    const q = qrcBuckets(rows).MTD;
    expect(q.Query).toBe(2);
    expect(q.Complain).toBe(1);
    expect(q.Request).toBe(1);
    expect(q.total).toBe(4);
  });
  it("tagging counts only Source of Lead = Inbound", () => {
    expect(taggedInboundByDate(rows).get("2026-09-01")).toBe(3);
  });
  it("maps SUB SCENARIO 3 to a lead type and qualification (the workbook's Leads sheet)", () => {
    expect(leadInfo(rows[0])).toEqual({ type: "Retail", qualified: true });
    expect(leadInfo(rows[2])).toEqual({ type: "Query", qualified: false }); // General Enquiry = not qualified
    expect(leadInfo(rows[3])).toEqual({ type: null, qualified: false });
  });
  it("lead sources: data received, connected, qualified; types (IS by SUB SCENARIO 2); status, converted and MT", () => {
    const s = leadsSummary(rows, "MTD");
    const inbound = s.sources.find((x) => x.source === "Inbound")!;
    expect(inbound).toMatchObject({ dataReceived: 3, connected: 3, qualified: 3 });
    expect(s.sources.find((x) => x.source === "Website")).toMatchObject({ dataReceived: 1, connected: 0, qualified: 0 });
    expect(s.total).toEqual({ dataReceived: 5, connected: 4, qualified: 3 });
    expect(s.byType.find((t) => t.type === "IS")?.count).toBe(1);
    expect(s.byType.find((t) => t.type === "Retail")?.count).toBe(1);
    expect(s.byType.find((t) => t.type === "Complaint")?.count).toBe(1);
    expect(s.status).toEqual({ open: 2, closed: 1, converted: 2, mt: 8.5 });
  });
});

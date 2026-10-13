import { describe, expect, it } from "vitest";
import {
  classifyEmailStatus, countMapToRows, isUnknownName, parseCountMap, pickExtreme,
  reconcileTotal, safePct, sortBuckets, weightedMean,
} from "../gs1-metrics.js";
import {
  aggregateApproval, aggregateDataCard, aggregateEmail, buildComparison, buildDataQuality,
  buildOverall, buildReconciliation, type ApprovalRow, type DataCardRow, type EmailRow,
} from "../gs1-aggregate.js";
import { parseAnalyst, parseLob } from "../gs1-dashboard.service.js";

const email = (o: Partial<EmailRow>): EmailRow => ({
  date: "2026-09-01", analyst: "Asha", received: 0, gtin: 0, images: 0, slaPct: null, statusCounts: null,
  slaBuckets: null, queryTypes: null, avgDurationMin: null, durationKnown: null, noProcess: false, ...o,
});
const dc = (o: Partial<DataCardRow>): DataCardRow => ({
  date: "2026-09-01", analyst: "Ravi", tasks: 0, gtin: 0, withinTat: 0, tatKnown: null, completed: null,
  categories: null, avgDurationMin: null, durationKnown: null, noProcess: false, ...o,
});
const ap = (o: Partial<ApprovalRow>): ApprovalRow => ({
  date: "2026-09-01", analyst: "Kishan", result: "PASS", errorFlag: 0, errorCategory: null, items: 1, sku: 1, noProcess: false, ...o,
});

describe("gs1 metrics: N/A and weighting", () => {
  it("safePct returns null, not 0, when there is no denominator", () => {
    expect(safePct(0, 0)).toBeNull();
    expect(safePct(5, 0)).toBeNull();
    expect(safePct(1, 4)).toBe(25);
  });

  it("weightedMean weights by volume instead of averaging daily percentages", () => {
    // simple average would be 50%; 1 ticket at 0% and 99 at 100% is 99%
    expect(weightedMean([{ value: 0, weight: 1 }, { value: 100, weight: 99 }])).toBe(99);
    expect(weightedMean([{ value: null, weight: 10 }])).toBeNull();
    expect(weightedMean([{ value: 80, weight: 0 }])).toBeNull();
  });

  it("parses count maps defensively", () => {
    expect(parseCountMap('{"Closed":3,"Open":"2","x":-1}')).toEqual({ Closed: 3, Open: 2 });
    expect(parseCountMap("not json")).toBeNull();
    expect(parseCountMap(null)).toBeNull();
    expect(countMapToRows({ a: 1, b: 5, c: 2 }, 2)).toEqual([{ label: "b", count: 5 }, { label: "c", count: 2 }, { label: "(other)", count: 1 }]);
  });

  it("classifies email statuses", () => {
    expect(classifyEmailStatus("Closed")).toBe("closed");
    expect(classifyEmailStatus("Completed ")).toBe("closed");
    expect(classifyEmailStatus("In Process")).toBe("pending");
    expect(classifyEmailStatus("Pending")).toBe("pending");
    expect(classifyEmailStatus("Rejected")).toBe("rejected");
    expect(classifyEmailStatus("(blank)")).toBe("other");
    expect(classifyEmailStatus("Renewal")).toBe("other");
  });

  it("flags blank and placeholder names", () => {
    for (const v of ["", "  ", "NA", "n/a", "Unknown", null, undefined, "-"]) expect(isUnknownName(v)).toBe(true);
    expect(isUnknownName("Manisha")).toBe(false);
  });

  it("sorts SLA buckets numerically", () => {
    const rows = sortBuckets([{ label: ">60" }, { label: "15-30" }, { label: "0-15" }, { label: "(blank)" }, { label: "30-60" }]);
    expect(rows.map(r => r.label)).toEqual(["0-15", "15-30", "30-60", ">60", "(blank)"]);
  });

  it("reconciliation is exact", () => {
    expect(reconcileTotal([{ lob: "Email", value: 10 }, { lob: "Data Card", value: 5 }], 15).ok).toBe(true);
    const bad = reconcileTotal([{ lob: "Email", value: 10 }], 11);
    expect(bad.ok).toBe(false);
    expect(bad.diff).toBe(1);
  });

  it("pickExtreme ignores N/A values", () => {
    expect(pickExtreme([{ v: null }, { v: 3 }, { v: 1 }], r => r.v, "min")).toEqual({ v: 1 });
    expect(pickExtreme([{ v: null }], r => r.v, "max")).toBeNull();
  });

  it("validates filter input", () => {
    expect(parseLob("Data Card")).toBe("dataCard");
    expect(parseLob("datakart")).toBe("dataCard");
    expect(parseLob("bogus")).toBeNull();
    expect(parseAnalyst("  ")).toBeNull();
    expect(parseAnalyst("x".repeat(300))?.length).toBe(200);
  });
});

describe("gs1 aggregate: LOB sections", () => {
  it("email: closure from status, SLA ticket-weighted, unknown analyst kept visible", () => {
    const e = aggregateEmail([
      email({ received: 10, slaPct: 100, statusCounts: { Closed: 8, Pending: 2 }, slaBuckets: { "0-15": 10 }, gtin: 30 }),
      email({ date: "2026-09-02", analyst: "", received: 90, slaPct: 50, statusCounts: { Closed: 90 }, durationKnown: 90, avgDurationMin: 12 }),
    ]);
    expect(e.summary.received).toBe(100);
    expect(e.summary.processed).toBe(98);
    expect(e.summary.pending).toBe(2);
    expect(e.summary.closurePct).toBe(98);
    expect(e.summary.withinSlaPct).toBe(55); // (10*100 + 90*50) / 100, not (100+50)/2
    expect(e.summary.avgTatMin).toBe(12);
    expect(e.byAnalyst.map(a => a.analyst)).toContain("(unknown)");
    expect(e.daily.reduce((s, d) => s + d.received, 0)).toBe(100);
  });

  it("email without status capture shows N/A closure, not 0", () => {
    const e = aggregateEmail([email({ received: 5, slaPct: 40 })]);
    expect(e.summary.processed).toBeNull();
    expect(e.summary.closurePct).toBeNull();
    expect(e.statusMix).toEqual([]);
  });

  it("data card: blank source TAT is N/A (legacy 0 and new tat_known_count 0)", () => {
    const d = aggregateDataCard([dc({ tasks: 20, withinTat: 0 }), dc({ tasks: 5, withinTat: 0, tatKnown: 0, completed: 5 })]);
    expect(d.summary.withinSlaPct).toBeNull();
    expect(d.summary.closurePct).toBe(100);
    expect(d.completionCoverage).toBe(5);
  });

  it("data card: within TAT weighted by tasks with a TAT value", () => {
    const d = aggregateDataCard([dc({ tasks: 10, withinTat: 100, tatKnown: 10 }), dc({ tasks: 30, withinTat: 0, tatKnown: 30 })]);
    expect(d.summary.withinSlaPct).toBe(25);
  });

  it("approval: pending never counted as processed; error % over processed only", () => {
    const a = aggregateApproval([
      ap({ items: 6 }),
      ap({ result: "FAIL", items: 2, errorFlag: 1, errorCategory: "Wrong GTIN" }),
      ap({ result: "FAIL", items: 2, errorFlag: 1 }),
      ap({ result: "PENDING", items: 10, errorFlag: 1 }),
    ]);
    expect(a.summary.received).toBe(20);
    expect(a.summary.processed).toBe(10);
    expect(a.summary.pending).toBe(10);
    expect(a.approvalPct).toBe(60);
    expect(a.rejectionPct).toBe(40);
    expect(a.errorPct).toBe(40);
    expect(a.reasons).toEqual([{ label: "Wrong GTIN", count: 2 }, { label: "(not specified)", count: 2 }]);
    expect(a.summary.withinSlaPct).toBeNull();
  });

  it("empty period: hasData false and every percentage N/A", () => {
    const set = { email: aggregateEmail([]), dataCard: aggregateDataCard([]), approval: aggregateApproval([]) };
    const o = buildOverall(set);
    expect(o.hasData).toBe(false);
    expect(o.received).toBe(0);
    expect(set.approval.summary.closurePct).toBeNull();
    expect(set.email.summary.withinSlaPct).toBeNull();
    expect(buildComparison(set).highlights.highestInflow).toBeNull();
  });
});

describe("gs1 aggregate: overall, reconciliation, data quality", () => {
  const eRows = [email({ received: 10, statusCounts: { Closed: 10 } })];
  const dRows = [dc({ tasks: 4 }), dc({ tasks: 3, analyst: "NA" })];
  const aRows = [ap({ items: 2 }), ap({ result: "FAIL", items: 1, errorFlag: 1 })];
  const set = { email: aggregateEmail(eRows), dataCard: aggregateDataCard(dRows), approval: aggregateApproval(aRows) };

  it("overall work items = Email + Data Card + Approval", () => {
    const o = buildOverall(set);
    expect(o.received).toBe(10 + 7 + 3);
    expect(o.processed).toBe(10 + 3); // data card has no completion captured -> excluded, not 0
    expect(o.closurePct).toBe(100);
  });

  it("reconciliation rows all pass when DB totals match", () => {
    const rows = buildReconciliation(set, { email: 10, dataCard: 7, approval: 3 });
    expect(rows.every(r => r.ok)).toBe(true);
    expect(rows[0].expected).toBe(20);
  });

  it("reconciliation flags a mismatch against the database", () => {
    const rows = buildReconciliation(set, { email: 11, dataCard: 7, approval: 3 });
    expect(rows[0].ok).toBe(false);
    expect(rows.find(r => r.check.startsWith("Email: dashboard"))?.diff).toBe(-1);
  });

  it("comparison picks the highest inflow and lowest closure, skipping N/A", () => {
    const c = buildComparison(set);
    expect(c.highlights.highestInflow).toBe("Email");
    expect(c.highlights.lowestClosure).toBe("Email"); // email 100%, approval 100% -> first min wins; data card N/A skipped
    expect(c.rows.find(r => r.lob === "dataCard")?.closurePct).toBeNull();
  });

  it("data quality surfaces unknown analysts and missing reasons", () => {
    const dq = buildDataQuality({ email: eRows, dataCard: dRows, approval: aRows }, set, { approvalBlankAuditor: 0 });
    expect(dq.find(r => r.check === "Tasks with blank / unknown analyst")).toMatchObject({ count: 3, severity: "error" });
    expect(dq.find(r => r.check === "Rejected / error audits without an error category")).toMatchObject({ count: 1, severity: "warn" });
    expect(dq.find(r => r.check === "Rows without a LOB")).toMatchObject({ count: 0, severity: "ok" });
  });
});

import { describe, expect, it } from "vitest";
import {
  bottleneck, buildFunnel, countByBucket, filterRows, neglected, nudgeLabel, nudgeSummary, nudgeTally,
  rankBranches, rowLinks, rowsToCsv, isNudgeableBlock,
} from "../opsControlTowerAnalytics";
import type { CountBlock, OpsControlTowerSummary } from "../opsControlTowerTypes";

const blk = (rows: Array<[string, string, number]>): CountBlock => ({
  branches: rows.map(([branchId, branchName, count]) => ({ branchId, branchName, count })),
  grandTotal: rows.reduce((s, r) => s + r[2], 0),
} as CountBlock);
const empty = blk([["b1", "NOIDA", 0], ["b2", "AHM", 0]]);

function summary(over: Partial<OpsControlTowerSummary> = {}): OpsControlTowerSummary {
  return {
    nowMs: 0, esignSlaDays: 3, appointmentLetterSlaDays: 7,
    attendanceMismatch: { branches: [{ branchId: "b1", branchName: "NOIDA", count: 2, stale: false, correctionLastDateMs: null }], grandTotal: 2 },
    rosterUploaded: { branches: [] }, joining: { branches: [], grandTotal: 0, grandBuckets: {} },
    fnfPending: empty, nocPending: empty, digilockerPending: empty, esignPending: empty, appointmentLetter: empty,
    pennyDropMissing: empty, accountDetailsMissing: empty, docsPending: empty, bgvPending: empty, addressReviewPending: empty,
    itProvisioningPending: empty, adminProvisioningPending: empty, wfmProvisioningPending: empty,
    ...over,
  } as unknown as OpsControlTowerSummary;
}

describe("funnel", () => {
  it("lists joiner steps in journey order with totals", () => {
    const f = buildFunnel(summary({ digilockerPending: blk([["b1", "NOIDA", 5]]) }));
    expect(f.map((s) => s.label)).toEqual(["Bank details", "Documents", "Penny drop", "DigiLocker", "Joining-kit eSign", "Appointment letter", "BGV", "Address review", "IT", "Admin", "WFM"]);
    expect(f.find((s) => s.key === "digilocker-pending")?.total).toBe(5);
  });
  it("bottleneck is the biggest step, or null when nothing is pending", () => {
    expect(bottleneck(buildFunnel(summary()))).toBeNull();
    const b = bottleneck(buildFunnel(summary({ bgvPending: blk([["b1", "NOIDA", 9]]), esignPending: blk([["b1", "NOIDA", 4]]) })));
    expect(b?.key).toBe("bgv-pending");
  });
});

describe("rankBranches", () => {
  it("sums every block per branch, names the worst block, sorts desc and drops zero branches", () => {
    const r = rankBranches(summary({
      bgvPending: blk([["b1", "NOIDA", 3], ["b2", "AHM", 1]]),
      pennyDropMissing: blk([["b1", "NOIDA", 1], ["b2", "AHM", 6]]),
    }));
    expect(r.map((x) => x.branchId)).toEqual(["b2", "b1"]);
    expect(r[0]).toMatchObject({ total: 7, worstBlock: "penny-drop-missing", worstCount: 6 });
    expect(r[1]).toMatchObject({ total: 6, worstBlock: "bgv-pending" }); // 3 bgv + 1 penny + 2 attendance
  });
  it("respects the limit", () => {
    const rows: Array<[string, string, number]> = Array.from({ length: 12 }, (_, i) => [`b${i}`, `B${i}`, i + 1]);
    expect(rankBranches(summary({ bgvPending: blk(rows) }), 5)).toHaveLength(5);
  });
});

describe("drawer helpers", () => {
  const rows = [
    { ageBucket: "8+" as const, daysOpen: 9, nudge: { count: 0, lastSentMs: null, due: true, nextEligibleMs: 0 } },
    { ageBucket: "3-7" as const, daysOpen: 4, nudge: { count: 2, lastSentMs: 1, due: false, nextEligibleMs: 9 } },
    { ageBucket: "0-2" as const, daysOpen: 1, nudge: { count: 1, lastSentMs: 1, due: true, nextEligibleMs: 0 } },
  ];
  it("filters by ageing bucket and nudge state", () => {
    expect(filterRows(rows, "8+", "all")).toHaveLength(1);
    expect(filterRows(rows, "all", "never")).toHaveLength(1);
    expect(filterRows(rows, "all", "due")).toHaveLength(2);
    expect(filterRows(rows, "3-7", "never")).toHaveLength(0);
    expect(filterRows(rows, "all", "all")).toHaveLength(3);
  });
  it("counts rows per bucket", () => expect(countByBucket(rows)).toEqual({ "0-2": 1, "3-7": 1, "8+": 1 }));
  it("labels nudge state", () => {
    expect(nudgeLabel(undefined)).toBe("Never notified");
    expect(nudgeLabel(rows[0].nudge)).toBe("Never notified");
    expect(nudgeLabel({ count: 2, lastSentMs: Date.UTC(2026, 9, 1, 6), due: false, nextEligibleMs: 0 })).toMatch(/^Notified 2× · last 01 Oct 2026$/);
  });
  it("neglected = 3+ days open and never notified; non-nudgeable rows never flagged", () => {
    expect(neglected(rows[0])).toBe(true);
    expect(neglected(rows[1])).toBe(false);
    expect(neglected({ daysOpen: 20 })).toBe(false);
  });
  it("links: HR/payroll fix-on-behalf deep links open the right profile-completion step", () => {
    const hrefs = (b: Parameters<typeof rowLinks>[0]) => rowLinks(b, { employeeId: "e1" }).map((l) => l.href);
    expect(hrefs("account-details-missing")).toContain("/employees/e1/complete-profile?step=bank");
    expect(hrefs("penny-drop-missing")).toContain("/employees/e1/complete-profile?step=bank");
    expect(hrefs("docs-pending")).toEqual(expect.arrayContaining(["/employees/e1/complete-profile?step=documents", "/employees/e1/joining-documents"]));
    expect(hrefs("digilocker-pending")).toContain("/employees/e1/complete-profile?step=bgv");
    expect(hrefs("fnf-pending")).toEqual(["/employees/e1/360"]);
  });
  it("links: employee 360 always; joining docs for eSign; BGV report only with a candidate", () => {
    expect(rowLinks("fnf-pending", { employeeId: "e1" })).toEqual([{ label: "Employee 360", href: "/employees/e1/360" }]);
    expect(rowLinks("esign-pending", { employeeId: "e1" }).map((l) => l.href)).toContain("/employees/e1/joining-documents");
    expect(rowLinks("bgv-pending", { employeeId: "e1", candidateId: "c9" }).map((l) => l.href)).toContain("/bgv-report-view/c9");
    expect(rowLinks("bgv-pending", { employeeId: "e1", candidateId: null }).map((l) => l.href).some((h) => h.startsWith("/bgv-report-view"))).toBe(false);
  });
  it("isNudgeableBlock matches the backend list", () => {
    expect(isNudgeableBlock("bgv-pending")).toBe(true);
    expect(isNudgeableBlock("fnf-pending")).toBe(false);
  });
});

describe("nudge summary", () => {
  it("tallies statuses", () => {
    expect(nudgeTally([{ employeeId: "a", status: "sent" }, { employeeId: "b", status: "sent" }, { employeeId: "c", status: "failed" }])).toEqual({ sent: 2, failed: 1 });
  });
  it("explains the unconfigured case instead of claiming success", () => {
    const s = nudgeSummary({ skipped_unconfigured: 3 });
    expect(s.tone).toBe("warning");
    expect(s.text).toMatch(/not configured/);
  });
  it("success / failure tones with details", () => {
    expect(nudgeSummary({ sent: 4, skipped_cooldown: 2 })).toEqual({ text: "4 sent · 2 already notified in last 24h", tone: "success" });
    expect(nudgeSummary({ sent: 1, failed: 1 }).tone).toBe("error");
    expect(nudgeSummary({ skipped_cooldown: 1 }).tone).toBe("warning");
  });
});

describe("rowsToCsv", () => {
  it("escapes commas/quotes and includes nudge columns", () => {
    const csv = rowsToCsv([{ employeeId: "e1", employeeCode: "C1", employeeName: 'Rao, "Asha"', daysOpen: 4, ageBucket: "3-7", nudge: { count: 0, lastSentMs: null, due: true, nextEligibleMs: 0 } }]);
    const [h, line] = csv.split("\n");
    expect(h).toBe("Employee code,Name,Days open,Age bucket,Notified count,Last notified");
    expect(line).toBe('C1,"Rao, ""Asha""",4,3-7,0,');
  });
});

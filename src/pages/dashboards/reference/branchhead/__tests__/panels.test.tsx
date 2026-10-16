import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatInr, formatPct, scoreBand } from "../format";
import { FinancePanel } from "../FinancePanel";
import { ProcessPnlPanel } from "../ProcessPnlPanel";
import { AttritionPanel } from "../AttritionPanel";
import { AttendanceDetailPanel } from "../AttendanceDetailPanel";
import { HeadcountPanel } from "../HeadcountPanel";
import { HiringPanel } from "../HiringPanel";
import { BacklogPanel } from "../BacklogPanel";
import * as fx from "./fixtures";

const r = (el: JSX.Element) => renderToStaticMarkup(el);

describe("format", () => {
  it("scoreBand boundaries", () => {
    expect(scoreBand(75)).toEqual({ label: "Good", icon: "check" });
    expect(scoreBand(74.99).label).toBe("Fair");
    expect(scoreBand(50)).toEqual({ label: "Fair", icon: "alert" });
    expect(scoreBand(49.99)).toEqual({ label: "Poor", icon: "x" });
  });
  it("formatInr", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(null)).toBe("—");
    expect(formatInr(undefined)).toBe("—");
    expect(formatInr(6016216.8)).toBe("₹60.2 L");
    expect(formatInr(1500000000)).toBe("₹150 Cr");
    expect(formatInr(14000000)).toBe("₹1.4 Cr");
    expect(formatInr(99999)).toBe("₹99,999");
    expect(formatInr(-6016216.8)).toBe("-₹60.2 L");
    expect(formatInr(-1234)).toBe("-₹1,234");
  });
  it("formatPct", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("FinancePanel", () => {
  const out = r(<FinancePanel section={fx.ok(fx.finance)} />);
  it("labels the month-to-date basis and shows revenue, cost and profit", () => {
    for (const t of ["Running P&amp;L - month to date (as in the emailed report)", "₹60.2 L", "Invoice", "Accrual", "Credit notes", "Salary", "GRN consumed", "GRN reserved", "Operating profit", "13.6%"]) expect(out).toContain(t);
  });
  it("shows projection with its basis", () => {
    expect(out).toContain("Projection");
    expect(out).toContain("linear on days elapsed");
  });
  it("hides the projection without P&L data", () => {
    const f = { ...fx.finance, pnl: { ...fx.finance.pnl, dataAvailable: false } };
    const o = r(<FinancePanel section={fx.ok(f)} />);
    expect(o).toContain("No P&amp;L data yet for this month");
    expect(o).not.toContain("linear on days elapsed");
  });
  it("shows budget, heads, GRN pipeline and tie-out", () => {
    for (const t of ["Available", "₹7.5 L", "Rent", "Utilities", "Over budget", "Branch Head", "Vendor GRN", "Unbudgeted", "Tie-out", "Imprest reserved with no cost centre", "Pending regularization"]) expect(out).toContain(t);
  });
  it("renders error inline", () => {
    expect(r(<FinancePanel section={fx.err("P&L source timed out")} />)).toContain("P&amp;L source timed out");
  });
});

describe("ProcessPnlPanel", () => {
  it("shows rows in given order with status text, totals and counts", () => {
    const out = r(<ProcessPnlPanel section={fx.ok(fx.pnl(3))} />);
    expect(out).toContain("Process P&amp;L - P&amp;L pages basis, 2026-10");
    expect(out.indexOf("Process 0")).toBeLessThan(out.indexOf("Process 1"));
    for (const t of ["Loss-making", "At risk", "Total", "2 loss-making", "1 at risk", "0 profitable", "Uses the same calculation as the Process P&amp;L pages, so it can differ from the month-to-date running figures above."]) expect(out).toContain(t);
    expect(out).not.toContain("Show all");
  });
  it("caps at 8 rows and offers Show all N inside a collapsed details", () => {
    const out = r(<ProcessPnlPanel section={fx.ok(fx.pnl(12))} />);
    expect(out).toContain("Show all 12 processes");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)/);
    expect(out).toContain("Process 11");
    expect(out.split("<details")[0]).not.toContain("Process 9");
  });
  it("empty and error states", () => {
    expect(r(<ProcessPnlPanel section={fx.emptySection()} />)).toContain("No process P&amp;L for this branch");
    expect(r(<ProcessPnlPanel section={fx.err("P&L could not be loaded")} />)).toContain("role=\"alert\"");
  });
  it("null opPct renders a dash", () => {
    const d = fx.pnl(1); d.rows[0].opPct = null; d.totals.opPct = null;
    expect(r(<ProcessPnlPanel section={fx.ok(d)} />)).toContain("—");
  });
});

describe("AttritionPanel", () => {
  it("shows KPIs, tables and the names sentence, no names", () => {
    const out = r(<AttritionPanel section={fx.ok(fx.attrition)} />);
    for (const t of ["Critical risk", "High risk", "Medium risk", "Expected exits (30 days)", "Absent streak", "New joiner risk", "2026-09", "Alpha Voice", "Names are available in the process drill-down."]) expect(out).toContain(t);
  });
  it("empty means not available", () => {
    expect(r(<AttritionPanel section={fx.emptySection()} />)).toContain("Attrition analysis is not available for this branch right now");
  });
});

describe("AttendanceDetailPanel", () => {
  it("shows by-slot, by-process and signed change vs yesterday", () => {
    const out = r(<AttendanceDetailPanel section={fx.ok(fx.attendance)} />);
    for (const t of ["09:00-18:00", "Beta Chat", "+2.0 pts", "up", "vs yesterday"]) expect(out).toContain(t);
  });
  it("down change has minus and down word", () => {
    const a = { ...fx.attendance, previousDay: { shrinkagePct: 15, absent: 9, scheduled: 100 } };
    const out = r(<AttendanceDetailPanel section={fx.ok(a)} />);
    expect(out).toContain("-3.0 pts");
    expect(out).toContain("down");
  });
  it("no previous day", () => {
    expect(r(<AttendanceDetailPanel section={fx.ok({ ...fx.attendance, previousDay: null })} />)).toContain("No data for yesterday");
  });
});

describe("HeadcountPanel", () => {
  it("never calls 0 or null mandate over", () => {
    const out = r(<HeadcountPanel section={fx.ok(fx.people)} />);
    expect(out).toContain("Alpha Voice");
    expect(out).toContain("Over by 10");
    expect(out.match(/Over by/g)?.length).toBe(1);
    expect(out).toContain("No mandate");
    expect(out).toContain("Banking");
  });
});

describe("HiringPanel", () => {
  it("shows batches, offers and ATS", () => {
    const out = r(<HiringPanel section={fx.ok(fx.hiring)} />);
    for (const t of ["Telecaller", "Batch A", "Last 30 days", "Month to date", "70.0%", "Joining in next 7 days", "Walk-ins", "SLA breaches", "GRNs awaiting approval"]) expect(out).toContain(t);
  });
});

describe("BacklogPanel", () => {
  it("shows aged counts", () => {
    const out = r(<BacklogPanel section={fx.ok(fx.backlogs)} />);
    for (const t of ["Regularization", "Leave", "Over 7 days", "14", "Escalated"]) expect(out).toContain(t);
  });
  it("empty state", () => {
    expect(r(<BacklogPanel section={fx.emptySection()} />)).toContain("No backlog data");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaveHero } from "./LeaveHero";
import { LeaveTimeline } from "./LeaveTimeline";
import { LeaveCharts } from "./LeaveCharts";
import { LeaveStatusPill, LeaveTypeChip } from "./LeaveRequestRow";
import type { LeaveRequest } from "@/hooks/useLeaves";

describe("LeaveHero", () => {
  it("uses theme variables for its gradient (no hard-coded pink/purple) and shows the counts", () => {
    const html = renderToStaticMarkup(
      <LeaveHero stats={{ pending: 3, approved: 12, rejected: 1, cancelled: 2 }} onApply={() => {}} />,
    );
    expect(html).toContain("var(--sidebar-background)");
    expect(html).toContain("var(--primary)");
    expect(html).not.toMatch(/pink|purple|fuchsia/i);
    expect(html).toContain("Apply for leave");
    for (const n of ["3", "12", "1"]) expect(html).toContain(`>${n}<`);
  });

  it("shows a dash instead of a false zero while counts are loading", () => {
    expect(renderToStaticMarkup(<LeaveHero onApply={() => {}} />)).toContain("–");
  });
});

describe("LeaveTimeline", () => {
  it("renders every step with a screen-reader state, and the branch-head step only when escalated", () => {
    const plain = renderToStaticMarkup(<LeaveTimeline status="pending" submittedAt="2026-10-01T09:00:00" />);
    expect(plain).toContain("Manager review");
    expect(plain).toContain("current");
    expect(plain).not.toContain("Branch Head review");
    const escalated = renderToStaticMarkup(<LeaveTimeline status="pending_branch_head" submittedAt="2026-10-01T09:00:00" />);
    expect(escalated).toContain("Branch Head review");
  });
});

describe("pills and chips", () => {
  it("label statuses in plain words with the shared pill colours", () => {
    const html = renderToStaticMarkup(<LeaveStatusPill status="pending_branch_head" />);
    expect(html).toContain("Awaiting Branch Head");
    expect(renderToStaticMarkup(<LeaveStatusPill status="branch_head_approved" />)).toContain("Approved");
  });
  it("colours a leave type from the theme chart palette", () => {
    expect(renderToStaticMarkup(<LeaveTypeChip type="Casual Leave" />)).toMatch(/var\(--chart-[1-8]\)/);
  });
});

describe("LeaveCharts", () => {
  const none: LeaveRequest[] = [];
  it("says so when there is no approved leave this year instead of drawing empty charts", () => {
    expect(renderToStaticMarkup(<LeaveCharts requests={none} year={2026} />)).toContain("No approved leave in 2026");
  });
});

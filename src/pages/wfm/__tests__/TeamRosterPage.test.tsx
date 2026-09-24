/**
 * TeamRosterPage tests. Same approach as RosterBuilderPage.test.tsx: the frontend suite runs under
 * `environment: "node"` (no jsdom, no @testing-library), so the REAL page tree is rendered with
 * renderToStaticMarkup, `hrmsApi` mocked at the module boundary and the react-query cache
 * pre-seeded; pure helpers are asserted directly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn(() => new Promise(() => undefined)); // never resolves: an unseeded query stays loading
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: (...a: unknown[]) => get(...(a as [])), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const access = { pages: new Set<string>(), roles: new Set<string>() };
vi.mock("@/hooks/useUserRole", () => ({
  useWorkforceAccess: () => ({ canViewPage: (c: string) => access.pages.has(c), hasAnyRole: (...r: string[]) => r.some((x) => access.roles.has(x)) }),
}));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => children }));

import TeamRosterPage, { visibleTabs } from "@/pages/wfm/TeamRosterPage";
import { DrawerBody, approvalSteps } from "@/components/wfm/team-roster/SubmissionDrawer";
import { countDraftChanges } from "@/components/wfm/team-roster/MyTeamRosterTab";
import { AttendanceDrawerBody } from "@/components/wfm/team-roster/TeamAttendanceDrawer";
import {
  ATTENDANCE_CELL_CLASS, attendanceCellClass, choiceValue, formatDmy, monthOptions, formatDmyTime, parseChoice, presetRange, storedLabel, unpackError,
} from "@/components/wfm/team-roster/teamRosterFormat";
import {
  approvalsKey, attendanceKey, draftKey, gridKey, meKey, submissionsKey, templatesKey,
  type GridResponse, type SubmissionDetail, type TeamAttendanceDetail, type TeamAttendanceResponse, type TeamRosterMe,
} from "@/hooks/useTeamRoster";

const TODAY = "2026-10-01";
const me = (over: Partial<TeamRosterMe> = {}): TeamRosterMe => ({
  employee: { id: "mgr", code: "MAS100", name: "Meera Manager" }, isManager: true, teamSize: 2, teamTruncated: false,
  hasReportingManager: true, canApproveManagerStep: false, canApproveWfmStep: false, today: TODAY, maxRangeDays: 31, ...over,
});

const range = presetRange("next-7", TODAY);
const grid = (): GridResponse => ({
  from: range.from, to: range.to, today: TODAY, dates: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"], total: 2, offset: 0, limit: 50, teamTruncated: false,
  rows: [
    {
      employeeId: "e1", code: "MAS1", name: "Asha Kulkarni", processId: "p1", processName: "Collections",
      cells: {
        "2026-10-01": { assignment: { id: "a1", type: "SHIFT", isWeekOff: false, shiftTemplateId: "t1", shiftCode: "GEN", shiftName: "General", start: "09:00", end: "18:00", finalStatus: "acknowledged" } },
        "2026-10-02": { draft: { kind: "FILL_BLANK", type: "WEEK_OFF", shiftTemplateId: null, reason: null } },
        "2026-10-03": { leave: "FULL" },
      },
    },
    { employeeId: "e2", code: "MAS2", name: "Ravi Sen", processId: "p1", processName: "Collections",
      cells: { "2026-10-02": { lockedBy: { submissionId: 9, submissionNo: "RTS-2026-000009", status: "pending_wfm", submitter: "Priya Rao" } } } },
  ],
});

function render(meData: TeamRosterMe | null, seed: (c: QueryClient) => void = () => undefined, url = "/wfm/team-roster") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (meData) client.setQueryData(meKey, meData);
  seed(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><TeamRosterPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const seedManager = (c: QueryClient) => {
  c.setQueryData(gridKey({ from: range.from, to: range.to, search: "", offset: 0, limit: 50 }), grid());
  c.setQueryData(templatesKey, { processes: [{ processId: "p1", processName: "Collections", templates: [{ id: "t1", shiftCode: "GEN", shiftName: "General", start: "09:00", end: "18:00", night: false }] }] });
  c.setQueryData(draftKey, { draft: { id: 5, note: null, createdAt: "2026-10-01 09:00:00", lines: [{ employeeId: "e1", date: "2026-10-02", kind: "FILL_BLANK", type: "WEEK_OFF", shiftTemplateId: null, reason: null }] } });
};

beforeEach(() => { vi.clearAllMocks(); access.pages.clear(); access.roles.clear(); });

describe("TeamRosterPage - states", () => {
  it("shows a loading state while the access check is in flight", () => {
    const html = render(null);
    expect(html).toContain("Loading");
    expect(html).not.toContain("You have no team members");
  });

  it("shows the friendly empty state to someone with nobody reporting to them (the employee-role grant is only the door)", () => {
    const html = render(me({ isManager: false, teamSize: 0 }));
    expect(html).toContain("You have no team members");
    expect(html).not.toContain("My Team Roster");
    expect(html).not.toContain("Approvals");
  });

  it("gives a manager the roster, attendance and submissions tabs, and hides Approvals when they cannot approve anything", () => {
    const html = render(me(), seedManager);
    expect(html).toContain("My Team Roster");
    expect(html).toContain("Team Attendance");
    expect(html).toContain("My Submissions");
    expect(html).not.toContain(">Approvals<");
  });

  it("shows Approvals when the caller can approve either step", () => {
    expect(render(me({ canApproveManagerStep: true }), seedManager)).toContain(">Approvals<");
    expect(render(me({ canApproveWfmStep: true }), seedManager)).toContain(">Approvals<");
  });

  it("a WFM approver with no team gets only the Approvals tab, with the empty queue text", () => {
    const html = render(me({ isManager: false, teamSize: 0, canApproveWfmStep: true }), (c) => c.setQueryData(approvalsKey("wfm", 0), { items: [], total: 0, offset: 0, limit: 25 }));
    expect(html).toContain(">Approvals<");
    expect(html).not.toContain("My Team Roster");
    expect(html).toContain("Nothing is waiting for your approval.");
  });

  it("the queue rows are clickable and formatted DD/MM/YYYY", () => {
    const html = render(me({ isManager: false, canApproveManagerStep: true }), (c) => c.setQueryData(approvalsKey("manager", 0), {
      items: [{ id: 7, submissionNo: "RTS-2026-000007", status: "pending_manager", from: "2026-10-02", to: "2026-10-05", submittedAt: "2026-10-01 09:30:00", appliedAt: null, submitter: { code: "MAS9", name: "Sam Sub" }, managerApprover: "Meera", lineCount: 4, appliedCount: 0, warningCount: 2 }],
      total: 1, offset: 0, limit: 25,
    }));
    expect(html).toContain("Open submission RTS-2026-000007");
    expect(html).toContain("02/10/2026 - 05/10/2026");
    expect(html).toContain("01/10/2026 09:30");
    expect(html).toContain("Awaiting manager");
  });
});

describe("My Team Roster grid", () => {
  const html = () => render(me(), seedManager);

  it("renders team rows with sticky first column, DD/MM/YYYY headers and the range controls", () => {
    const out = html();
    expect(out).toContain("Asha Kulkarni");
    expect(out).toContain("MAS1 - Collections");
    expect(out).toContain("01/10/2026");
    expect(out).toContain("sticky left-0");
    expect(out).toContain("Next 7 days");
    expect(out).toContain('type="date"');
  });

  it("existing cells are read-only with a Propose change action; past cells are not editable", () => {
    const out = html();
    expect(out).toContain("Propose change for Asha Kulkarni on 01/10/2026");
    expect(out).toContain("GEN");
    // 30/09 is before today: no select and no propose button for it
    expect(out).not.toContain("Roster for Asha Kulkarni on 30/09/2026");
    expect(out).not.toContain("Propose change for Asha Kulkarni on 30/09/2026");
  });

  it("blank cells are dropdowns of the employee's process shifts plus the closed set Week off / Training / Unscheduled", () => {
    const out = html();
    expect(out).toContain("Roster for Asha Kulkarni on 02/10/2026");
    expect(out).toContain("General (09:00-18:00)");
    expect(out).toContain(">Week off<");
    expect(out).toContain(">Training<");
    expect(out).toContain(">Unscheduled<");
  });

  it("highlights a draft value and marks approved leave", () => {
    const out = html();
    expect(out).toContain("ring-2 ring-amber-300");
    expect(out).toContain('title="Approved leave"');
  });

  it("shows a lock badge with a tooltip for a cell pending in another submission, with no editor", () => {
    const out = html();
    expect(out).toContain("Pending with Priya Rao (RTS-2026-000009)");
    expect(out).not.toContain("Roster for Ravi Sen on 02/10/2026");
  });

  it("the sticky footer counts the saved draft lines and offers Save draft / Submit for approval", () => {
    const out = html();
    expect(out).toContain("1 change");
    expect(out).toContain("Save draft");
    expect(out).toContain("Submit for approval");
    expect(out).toContain("Discard draft");
  });

  it("with an empty draft the submit button is disabled and there is no discard", () => {
    const out = render(me(), (c) => { seedManager(c); c.setQueryData(draftKey, { draft: null }); });
    expect(out).toContain("0 changes");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Submit for approval<\/button>/);
    expect(out).not.toContain("Discard draft");
  });

  it("explains the routing according to whether there is a reporting manager", () => {
    expect(html()).toContain("by your reporting manager and then by WFM");
    expect(render(me({ hasReportingManager: false }), seedManager)).toContain("you have no reporting manager on record");
  });
});

describe("submission drawer body", () => {
  const detail = (over: Partial<SubmissionDetail> = {}, perms: Partial<SubmissionDetail["permissions"]> = {}): SubmissionDetail => ({
    submission: {
      id: 7, submissionNo: "RTS-2026-000007", status: "pending_wfm", from: "2026-10-02", to: "2026-10-03", note: "Festival cover",
      submitter: { id: "s", code: "MAS9", name: "Sam Sub" }, managerApprover: { id: "b", name: "Bo Boss" }, managerStepSkipped: false,
      managerDecision: { decision: "approved", at: "2026-10-01 10:00:00", remarks: "ok" }, wfmDecision: null,
      createdAt: "2026-10-01 09:00:00", submittedAt: "2026-10-01 09:05:00", appliedAt: null,
    },
    lines: [
      { id: 1, employeeId: "e1", employeeCode: "MAS1", employeeName: "Asha K", date: "2026-10-02", kind: "CHANGE", old: { type: "SHIFT", label: "GEN 09:00-18:00" }, new: { type: "WEEK_OFF", label: null }, reason: "Asked for a day off", warnings: ["Off-day policy: Friday is a fixed weekly off"], status: "pending", skipReason: null, appliedAssignmentId: null },
      { id: 2, employeeId: "e2", employeeCode: "MAS2", employeeName: "Ravi S", date: "2026-10-03", kind: "FILL_BLANK", old: null, new: { type: "SHIFT", label: "GEN 09:00-18:00" }, reason: null, warnings: [], status: "skipped", skipReason: "date already rostered", appliedAssignmentId: null },
    ],
    summary: { total: 2, applied: 0, skipped: 1, failed: 0, pending: 1, withWarnings: 1 },
    timeline: [{ action: "submitted", actorName: "Sam Sub", actorRole: "employee", remarks: null, at: "2026-10-01 09:05:00", meta: null }],
    permissions: { canCancel: false, canManagerDecide: false, canWfmDecide: true, canCopyToDraft: false, ...perms },
    ...over,
  });
  const body = (d: SubmissionDetail) => renderToStaticMarkup(<DrawerBody detail={d} busy={false} onAction={() => undefined} />);

  it("has every section with an uppercase label: overview, progress, warnings, changes, timeline, actions", () => {
    const out = body(detail());
    for (const label of ["Overview", "Approval progress", "Warnings for approvers", "Changes (2)", "Timeline", "Actions"]) expect(out).toContain(label);
    expect(out).toContain("text-xs font-bold uppercase tracking-wide text-slate-400");
  });

  it("shows the old -> new diff, the reason, the warning and the per-line result", () => {
    const out = body(detail());
    expect(out).toContain("GEN 09:00-18:00");
    expect(out).toContain("Reason: Asked for a day off");
    expect(out).toContain("Friday is a fixed weekly off");
    expect(out).toContain("date already rostered");
    expect(out).toContain("02/10/2026");
    expect(out).toContain("01/10/2026 09:05");
  });

  it("offers Approve and apply / Reject to a WFM approver, and Reject is disabled until remarks are entered", () => {
    const out = body(detail());
    expect(out).toContain("Approve and apply");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Reject<\/button>/);
    expect(out).toContain("writes these changes to the live roster");
  });

  it("offers manager approval wording at the manager step, and Cancel only to the submitter", () => {
    const out = body(detail({}, { canWfmDecide: false, canManagerDecide: true }));
    expect(out).toContain("Approve and send to WFM");
    expect(body(detail({}, { canWfmDecide: false, canCancel: true }))).toContain("Cancel submission");
    expect(body(detail({}, { canWfmDecide: false }))).not.toContain("Actions");
  });

  it("shows compact None placeholders instead of hiding empty sections", () => {
    const out = body(detail({ lines: [], timeline: [], summary: { total: 0, applied: 0, skipped: 0, failed: 0, pending: 0, withWarnings: 0 } }));
    expect(out).toContain("Changes (0)");
    expect(out.match(/>None</g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("derives the approver progress, including a skipped manager step", () => {
    const steps = approvalSteps(detail().submission);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "waiting"]);
    const skipped = approvalSteps({ ...detail().submission, managerApprover: null, managerStepSkipped: true, managerDecision: null });
    expect(skipped[1]).toMatchObject({ state: "skipped", note: "No reporting manager, step skipped" });
    expect(approvalSteps({ ...detail().submission, status: "rejected", wfmDecision: { decision: "rejected", at: null, remarks: null } })[2].state).toBe("rejected");
  });
});

describe("deep links (?tab=&submission=)", () => {
  it("?tab=submissions opens the submissions tab; the drawer id is read from ?submission= (portal content is not server-renderable)", () => {
    const html = render(me(), (c) => {
      seedManager(c);
      c.setQueryData(submissionsKey("all", 0), { items: [], total: 0, offset: 0, limit: 25 });
    }, "/wfm/team-roster?tab=submissions&submission=7");
    expect(html).toMatch(/aria-selected="true"[^>]*id="[^"]*trigger-submissions"/);
    expect(html).toContain("You have not submitted anything yet.");
    const source = readFileSync(resolve(process.cwd(), "src/pages/wfm/TeamRosterPage.tsx"), "utf8");
    expect(source).toContain('params.get("submission")');
    expect(source).toContain("<SubmissionDrawer id={drawerId}");
  });

  it("an unknown or unauthorised ?tab= falls back to the first tab the caller has", () => {
    const html = render(me(), seedManager, "/wfm/team-roster?tab=approvals");
    expect(html).toMatch(/aria-selected="true"[^>]*id="[^"]*trigger-roster"/);
  });
});

describe("Team Attendance tab (preview of the Attendance Register)", () => {
  const days = (n: number, fill: (d: number) => string) => Array.from({ length: n }, (_, i) => fill(i + 1));
  const attendance = (over: Partial<TeamAttendanceResponse> = {}): TeamAttendanceResponse => ({
    month: "2026-10", daysInMonth: 31, dates: days(31, (d) => "2026-10-" + String(d).padStart(2, "0")),
    legend: [{ code: "P", label: "Present" }, { code: "A", label: "Absent" }, { code: "HD", label: "Half day" }, { code: "L", label: "Leave" }, { code: "OD", label: "On duty" }, { code: "H", label: "Holiday" }],
    notes: ["Preview only. The Attendance Register and payroll figures remain the source of truth."],
    total: 2, offset: 0, limit: 50, teamTruncated: false,
    rows: [
      { employeeId: "e1", code: "MAS1", name: "Asha Kulkarni", designation: "Agent", processName: "Collections", regularizedDays: [1],
        days: days(31, (d) => (d === 1 ? "P" : d === 2 ? "HD" : d === 3 ? "L" : d === 4 ? "H" : d <= 6 ? "A" : "")),
        totals: { present: 1, absent: 2, onDuty: 0, halfDay: 1, leave: 1, holiday: 1, weekOff: 4, totalWorkingDays: 7.5 } },
      { employeeId: "e2", code: "MAS2", name: "Ravi Sen", designation: null, processName: null, regularizedDays: [], days: days(31, () => "A"),
        totals: { present: 0, absent: 31, onDuty: 0, halfDay: 0, leave: 0, holiday: 0, weekOff: 0, totalWorkingDays: 0 } },
    ],
    ...over,
  });
  const key = { month: "2026-10", search: "", offset: 0, limit: 50 };
  const renderTab = (data: TeamAttendanceResponse | null) =>
    render(me(), (c) => { if (data) c.setQueryData(attendanceKey(key), data); }, "/wfm/team-roster?tab=attendance");

  it("renders the register-style table: sticky first column, Mon-DD day headers with weekday, coloured codes, totals", () => {
    const out = renderTab(attendance());
    expect(out).toContain("Asha Kulkarni");
    expect(out).toContain("MAS1 - Agent - Collections");
    expect(out).toContain("sticky left-0");
    expect(out).toContain("Oct-01");
    expect(out).toContain("Oct-31");
    expect(out).toContain(">Thu<"); // 01/10/2026 is a Thursday
    expect(out).toContain(ATTENDANCE_CELL_CLASS.P);
    expect(out).toContain(ATTENDANCE_CELL_CLASS.HD);
    expect(out).toContain("ring-1 ring-inset ring-orange-500"); // regularized day
    for (const heading of ["P", "A", "OD", "HD", "L", "H", "WO", "Working days"]) expect(out).toContain(">" + heading + "</th>");
    expect(out).toContain("7.5");
  });

  it("shows the legend, the preview note and the source-of-truth statement", () => {
    const out = renderTab(attendance());
    expect(out).toContain('aria-label="Legend"');
    for (const label of ["Present", "Absent", "Half day", "Leave", "On duty", "Holiday", "Regularized"]) expect(out).toContain(label);
    expect(out).toContain("Preview of the Attendance Register for Oct 2026. The register and payroll figures remain the source of truth.");
    expect(out).toContain("appear as A, exactly as in the register");
  });

  it("the month picker offers the current month and 11 past months, never a future one, newest first", () => {
    const out = renderTab(attendance());
    expect(out).toContain('<option value="2026-10" selected="">Oct 2026</option>');
    expect(out).toContain('value="2025-11"');
    expect(out).not.toContain('value="2026-11"');
    expect(out).not.toContain('value="2025-10"');
  });

  it("each row is a clickable drill-down and the count reads from the response", () => {
    const out = renderTab(attendance());
    expect(out).toContain("Open attendance for Asha Kulkarni");
    expect(out).toContain('role="button"');
    expect(out).toContain("2 employees - Oct 2026");
  });

  it("an empty tree / no match shows a friendly empty state, and a loading state while fetching", () => {
    expect(renderTab(attendance({ rows: [], total: 0 }))).toContain("No team members match your search.");
    expect(renderTab(null)).toContain("Loading");
  });

  it("paginates only when there are more people than one page", () => {
    expect(renderTab(attendance())).not.toContain(">Next<");
    expect(renderTab(attendance({ total: 120, limit: 50 }))).toContain(">Next<");
  });

  it("the full-register link appears only for users who can already open /payroll/attendance-register (page grant AND role)", () => {
    expect(renderTab(attendance())).not.toContain("Open full Attendance Register");
    access.pages.add("ATTENDANCE_REGISTER_EXPORT");
    expect(renderTab(attendance())).not.toContain("Open full Attendance Register"); // grant without a listed role
    access.roles.add("hr");
    const out = renderTab(attendance());
    expect(out).toContain("Open full Attendance Register");
    expect(out).toContain('href="/payroll/attendance-register"');
    access.pages.clear();
    expect(renderTab(attendance())).not.toContain("Open full Attendance Register"); // role without the grant
  });

  it("the drawer body has labelled sections, DD/MM/YYYY dates, totals and the legend label per status", () => {
    const detail: TeamAttendanceDetail = {
      month: "2026-10", daysInMonth: 2, legend: attendance().legend, notes: ["Preview only."],
      employee: { employeeId: "e1", code: "MAS1", name: "Asha Kulkarni", designation: "Agent", processName: "Collections" },
      totals: { present: 1, absent: 0, onDuty: 0, halfDay: 1, leave: 0, holiday: 0, weekOff: 4, totalWorkingDays: 5.5 },
      days: [{ date: "2026-10-01", day: 1, weekday: "Thu", code: "P", regularized: true }, { date: "2026-10-02", day: 2, weekday: "Fri", code: "HD", regularized: false }],
    };
    const out = renderToStaticMarkup(<AttendanceDrawerBody detail={detail} />);
    for (const label of ["Employee", "Month totals - Oct 2026", "Day by day", "About these figures"]) expect(out).toContain(label);
    expect(out).toContain("text-xs font-bold uppercase tracking-wide text-slate-400");
    expect(out).toContain("01/10/2026");
    expect(out).toContain("Half day");
    expect(out).toContain("Regularized");
    expect(out).toContain("5.5");
  });
});

describe("attendance helpers", () => {
  it("monthOptions is newest-first, 12 long, crosses the year and never exceeds the current month", () => {
    const opts = monthOptions("2026-02");
    expect(opts).toHaveLength(12);
    expect(opts[0]).toEqual({ value: "2026-02", label: "Feb 2026" });
    expect(opts[1].value).toBe("2026-01");
    expect(opts[2].value).toBe("2025-12");
    expect(opts.every((o) => o.value <= "2026-02")).toBe(true);
  });

  it("cell colours follow the register palette; unknown or blank codes are muted", () => {
    expect(attendanceCellClass("A")).toContain("bg-red-100");
    expect(attendanceCellClass("p")).toContain("bg-green-100");
    expect(attendanceCellClass("")).toBe("text-slate-300");
  });
});

describe("pure helpers", () => {
  it("visibleTabs encodes the audience rules", () => {
    expect(visibleTabs({ isManager: true, canApproveManagerStep: false, canApproveWfmStep: false })).toEqual(["roster", "attendance", "submissions"]);
    expect(visibleTabs({ isManager: false, canApproveManagerStep: false, canApproveWfmStep: true })).toEqual(["approvals"]);
    expect(visibleTabs({ isManager: true, canApproveManagerStep: true, canApproveWfmStep: true })).toEqual(["roster", "attendance", "submissions", "approvals"]);
    expect(visibleTabs({ isManager: false, canApproveManagerStep: false, canApproveWfmStep: false })).toEqual([]);
  });

  it("formats dates DD/MM/YYYY and DD/MM/YYYY HH:mm", () => {
    expect(formatDmy("2026-10-05")).toBe("05/10/2026");
    expect(formatDmy(null)).toBe("None");
    expect(formatDmyTime("2026-10-05 14:07:33")).toBe("05/10/2026 14:07");
  });

  it("range presets never start in the past and next-30 fits the 31-day cap", () => {
    expect(presetRange("next-7", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(presetRange("this-week", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-04" }); // Thu -> Sun
    expect(presetRange("next-week", "2026-10-01")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(presetRange("next-30", "2026-10-01").to).toBe("2026-10-30");
  });

  it("round-trips the closed set of cell choices", () => {
    expect(parseChoice("")).toBeNull();
    expect(parseChoice("HOLIDAY")).toBeNull();
    expect(parseChoice("WEEK_OFF")).toEqual({ type: "WEEK_OFF", shiftTemplateId: null });
    expect(parseChoice("SHIFT:t1")).toEqual({ type: "SHIFT", shiftTemplateId: "t1" });
    expect(choiceValue(parseChoice("SHIFT:t1"))).toBe("SHIFT:t1");
    expect(choiceValue(null)).toBe("");
  });

  it("labels stored cells, whether imported (times only) or built (template)", () => {
    expect(storedLabel({ type: "SHIFT", isWeekOff: false, shiftCode: "GEN", shiftName: "General", start: "09:00", end: "18:00" })).toEqual({ short: "GEN", long: "General 09:00-18:00" });
    expect(storedLabel({ type: null, isWeekOff: false, shiftCode: null, shiftName: null, start: "22:00", end: "06:00" }).short).toBe("22:00-06:00");
    expect(storedLabel({ type: "SHIFT", isWeekOff: true, shiftCode: null, shiftName: null, start: null, end: null }).short).toBe("WO");
  });

  it("counts draft changes as server lines plus staged additions minus staged removals", () => {
    expect(countDraftChanges(["a|1", "b|1"], {})).toBe(2);
    expect(countDraftChanges(["a|1"], { "c|2": { choice: { type: "WEEK_OFF", shiftTemplateId: null }, reason: null } })).toBe(2);
    expect(countDraftChanges(["a|1", "b|1"], { "a|1": { choice: null, reason: null } })).toBe(1);
    expect(countDraftChanges(["a|1"], { "a|1": { choice: { type: "TRAINING", shiftTemplateId: null }, reason: null } })).toBe(1);
  });

  it("unpacks API failures, including the cell-level details of a 409/422", () => {
    const err = Object.assign(new Error("Some cells are already pending"), { payload: { code: "CELL_PENDING", message: "Some cells are already pending in another submission.", details: [{ employeeId: "e1", date: "2026-10-02", message: "pending with Priya" }, { nope: true }] } });
    expect(unpackError(err)).toEqual({ message: "Some cells are already pending in another submission.", code: "CELL_PENDING", details: [{ employeeId: "e1", date: "2026-10-02", message: "pending with Priya" }] });
    expect(unpackError(new Error("boom"))).toEqual({ message: "boom", code: null, details: [] });
  });
});

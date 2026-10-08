import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileText } from "lucide-react";
import { SectionCard } from "../SectionCard";
import { AttendanceSectionCard } from "../AttendanceSectionCard";
import { LateComingSectionCard } from "../LateComingSectionCard";
import { KpiSectionCard } from "../KpiSectionCard";
import { LeaveSectionCard } from "../LeaveSectionCard";
import { LearningSectionCard } from "../LearningSectionCard";
import { ConductSectionCard } from "../ConductSectionCard";
import { ExitFileSectionCard } from "../ExitFileSectionCard";
import { PayrollSectionCard } from "../PayrollSectionCard";
import { TimelineSectionCard } from "../TimelineSectionCard";
import { RejoinHeaderCard } from "../RejoinHeaderCard";
import { RejoinVerdictStrip } from "../RejoinVerdictStrip";
import type { SectionResult } from "../rejoinTypes";
import * as fx from "./fixtures";

const html = (node: JSX.Element) => renderToStaticMarkup(node);
const err = <T,>(error = "Unknown column 'x' in 'field list'"): SectionResult<T> => ({ status: "error", error });

describe("SectionCard", () => {
  const render = (result: SectionResult<{ n: number | null } | null>) =>
    html(
      <SectionCard id="demo" title="Demo section" icon={FileText} result={result} isEmpty={(d) => d.n === 0} emptyText="Nothing here.">
        {(d) => <p>Value: {d.n === null ? "—" : d.n}</p>}
      </SectionCard>,
    );

  it("ok: renders the children inside a labelled region", () => {
    const out = render({ status: "ok", data: { n: 7 } });
    expect(out).toContain("Value: 7");
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-labelledby="rejoin-demo-title"');
    expect(out).toContain('id="rejoin-demo-title"');
  });

  it("error: compact inline alert with the backend message and nothing else", () => {
    const out = render(err());
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load demo section.");
    expect(out).toContain("Unknown column &#x27;x&#x27; in &#x27;field list&#x27;");
    expect(out).not.toContain("Value:");
  });

  it("no data: explicit empty line for null data and for isEmpty", () => {
    expect(render({ status: "ok", data: null })).toContain("Nothing here.");
    expect(render({ status: "ok", data: { n: 0 } })).toContain("Nothing here.");
  });

  it("null value renders a dash, never 0", () => {
    const out = render({ status: "ok", data: { n: null } });
    expect(out).toContain("Value: —");
  });
});

describe("AttendanceSectionCard", () => {
  const out = html(<AttendanceSectionCard result={{ status: "ok", data: fx.attendance }} windowMonths={fx.windowMonths} />);
  it("shows headline %, absences, LOP and regularization breakdown", () => {
    expect(out).toContain("92.5%");
    expect(out).toContain("2 approved · 1 rejected · 1 pending");
  });
  it("labels the chart and gives an sr-only table with one row per window month; empty months are a dash", () => {
    expect(out).toContain('role="img"');
    expect(out).toMatch(/aria-label="Monthly attendance percentage/);
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("Sep 2025");
    expect(out).toContain("Aug 2026");
    // Jun: (22 + 1 + 1) / 26 = 92.3%
    expect(out).toContain("92.3%");
    // 12 window months -> 12 body rows
    expect((out.match(/<th scope="row">/g) ?? []).length).toBe(12);
  });
  it("null attendance % shows a dash", () => {
    const o = html(<AttendanceSectionCard result={{ status: "ok", data: { ...fx.attendance, attendancePct: null } }} />);
    expect(o).toContain("—");
    expect(o).not.toContain(">0%<");
  });
  it("error", () => expect(html(<AttendanceSectionCard result={err()} />)).toContain("Could not load attendance."));
});

describe("LateComingSectionCard", () => {
  it("renders totals, worst month and a labelled chart", () => {
    const out = html(<LateComingSectionCard result={{ status: "ok", data: fx.attendance }} windowMonths={fx.windowMonths} />);
    expect(out).toContain("Jul 2026");
    expect(out).toContain("6 late marks");
    expect(out).toContain("18.3 min");
    expect(out).toMatch(/aria-label="Late marks by month/);
  });
  it("null averages render a dash", () => {
    const out = html(
      <LateComingSectionCard
        result={{ status: "ok", data: { ...fx.attendance, late: { totalLateMarks: 0, avgLateMarksPerMonth: null, avgLateMinutes: null, worstMonth: null } } }}
      />,
    );
    expect(out).toContain("—");
    expect(out).toContain("No late marks in this window.");
  });
  it("error", () => expect(html(<LateComingSectionCard result={err()} />)).toContain("Could not load late coming."));
});

describe("KpiSectionCard", () => {
  it("months at target X/Y (Z%), best/worst and the target line label", () => {
    const out = html(<KpiSectionCard result={{ status: "ok", data: fx.kpi }} />);
    expect(out).toContain("1/2");
    expect(out).toContain("50%");
    expect(out).toContain("82.5%");
    expect(out).toContain("Target");
    expect(out).toMatch(/aria-label="Monthly KPI achievement/);
  });
  it("null at-target % renders a dash", () => {
    const out = html(<KpiSectionCard result={{ status: "ok", data: { ...fx.kpi, atTargetPct: null, best: null, worst: null } }} />);
    expect(out).toContain("—");
  });
  it("no months: No data", () => {
    const out = html(<KpiSectionCard result={{ status: "ok", data: { ...fx.kpi, months: [], monthsWithData: 0 } }} />);
    expect(out).toContain("No KPI scores recorded");
  });
  it("error", () => expect(html(<KpiSectionCard result={err()} />)).toContain("Could not load kpi."));
});

describe("LeaveSectionCard", () => {
  const out = html(<LeaveSectionCard result={{ status: "ok", data: fx.leave }} />);
  it("table by type keeps leave codes as written, with a totals row", () => {
    expect(out).toContain(">CL<");
    expect(out).toContain("Leave Without Pay");
    expect(out).toContain("Unpaid");
    expect(out).toContain("<tfoot");
    expect(out).toContain("Total");
  });
  it("labels the heuristics", () => {
    expect(out).toContain("applied at/after the day before start");
    expect(out).toContain("start Monday or end Friday");
  });
  it("null percentages render a dash", () => {
    const o = html(<LeaveSectionCard result={{ status: "ok", data: { ...fx.leave, shortNoticePct: null, weekendAdjacentPct: null } }} />);
    expect(o).toContain("—");
  });
  it("error", () => expect(html(<LeaveSectionCard result={err()} />)).toContain("Could not load leave."));
});

describe("LearningSectionCard", () => {
  it("courses X/Y, average and certifications", () => {
    const out = html(<LearningSectionCard result={{ status: "ok", data: fx.learning }} />);
    expect(out).toContain("1/2");
    expect(out).toContain("70%");
    expect(out).toContain("Collections Level 1");
    expect(out).toContain("10 Jan 2025");
  });
  it("null average renders a dash; empty is No data", () => {
    expect(html(<LearningSectionCard result={{ status: "ok", data: { ...fx.learning, avgCompletionPct: null } }} />)).toContain("—");
    expect(
      html(<LearningSectionCard result={{ status: "ok", data: { coursesTotal: 0, coursesCompleted: 0, avgCompletionPct: null, courses: [], certifications: [] } }} />),
    ).toContain("No courses or certifications on record.");
  });
  it("error", () => expect(html(<LearningSectionCard result={err()} />)).toContain("Could not load learning."));
});

describe("ConductSectionCard", () => {
  const out = html(<ConductSectionCard result={{ status: "ok", data: fx.conduct }} />);
  it("shows the disciplinary flag and that it was lifted", () => {
    expect(out).toContain("Disciplinary flag");
    expect(out).toContain("Customer abuse complaint");
    expect(out).toContain("20 Aug 2026");
    expect(out).toMatch(/[Ll]ifted/);
  });
  it("warnings carry a severity chip with text (and an icon), not colour only", () => {
    expect(out).toContain("Final");
    expect(out).toContain("Verbal");
    expect(out).toContain("Repeated unapproved absence");
    expect(out).toContain("14 Jul 2026");
    expect(out).toContain("<svg");
  });
  it("PIPs, prior history, coaching and open alerts", () => {
    expect(out).toContain("Low QA scores");
    expect(out).toContain("Prior absconding exits");
    expect(out).toContain("Prior rejoins");
    expect(out).toContain("Rejoin requests approved");
    expect(out).toContain("Coaching sessions");
    expect(out).toContain("Unacknowledged alerts");
  });
  it("a PIP with no end date shows a dash", () => expect(out).toContain("01 May 2026 – —"));
  it("clean record is an explicit No data line", () => {
    const clean = html(
      <ConductSectionCard
        result={{
          status: "ok",
          data: {
            warnings: [], activeWarnings: 0, finalWarnings: 0, pips: [], openPip: false, unacknowledgedAlerts: 0, completedCoachingSessions: 0,
            disciplinaryFlag: { flagged: false, reason: null, date: null, lifted: false }, priorAbscondingExits: 0, priorRejoins: 0, priorRejoinRequests: 0,
          },
        }}
      />,
    );
    expect(clean).toContain("No warnings, PIPs, disciplinary flag or prior exits on record.");
  });
  it("error", () => expect(html(<ConductSectionCard result={err()} />)).toContain("Could not load conduct."));
});

describe("ExitFileSectionCard", () => {
  const out = html(<ExitFileSectionCard result={{ status: "ok", data: fx.exit }} />);
  it("type, sub-type, absconding since, LWD and notice shortfall", () => {
    expect(out).toContain("Resignation");
    expect(out).toContain("Absconding");
    expect(out).toContain("25 Aug 2026");
    expect(out).toContain("31 Aug 2026");
    expect(out).toContain("24 days short");
  });
  it("clearance X/Y with pending departments, assets held, F&F", () => {
    expect(out).toContain("2/4");
    expect(out).toContain("IT");
    expect(out).toContain("Laptop not returned");
    expect(out).toContain("Dell Latitude 5420");
    expect(out).toContain("₹18,450");
    expect(out).toContain("Not paid");
  });
  it("null exit is 'No exit on file'", () => {
    expect(html(<ExitFileSectionCard result={{ status: "ok", data: null }} />)).toContain("No exit on file.");
  });
  it("null reason / notice / F&F render a dash", () => {
    const o = html(
      <ExitFileSectionCard
        result={{ status: "ok", data: { ...fx.exit, reasonCategory: null, abscondingSince: null, notice: { requiredDays: null, servedDays: null, shortfallDays: null }, ff: null } }}
      />,
    );
    expect(o).toContain("—");
    expect(o).toContain("No F&amp;F calculation");
  });
  it("error", () => expect(html(<ExitFileSectionCard result={err()} />)).toContain("Could not load exit file."));
});

describe("PayrollSectionCard", () => {
  it("last/avg net, current salary, recoveries and recent payslips", () => {
    const out = html(<PayrollSectionCard result={{ status: "ok", data: fx.payroll }} />);
    expect(out).toContain("₹18,900");
    expect(out).toContain("₹19,000");
    expect(out).toContain("₹2,52,000");
    expect(out).toContain("₹6,200");
    expect(out).toContain("Aug 2026");
  });
  it("pendingRecoveries null is Unavailable, not zero; null salary is a dash", () => {
    const out = html(
      <PayrollSectionCard result={{ status: "ok", data: { ...fx.payroll, pendingRecoveries: null, currentSalary: null, lastNet: null, avgNet: null } }} />,
    );
    expect(out).toContain("Unavailable");
    expect(out).not.toContain("₹0");
    expect(out).toContain("—");
  });
  it("error", () => expect(html(<PayrollSectionCard result={err()} />)).toContain("Could not load payroll."));
});

describe("TimelineSectionCard", () => {
  it("lists events newest first", () => {
    const out = html(<TimelineSectionCard result={{ status: "ok", data: { ...fx.timeline, events: [...fx.timeline.events].reverse() } }} />);
    expect(out).toContain("<ol");
    expect(out.indexOf("20 Sep 2026")).toBeLessThan(out.indexOf("31 Aug 2026"));
    expect(out.indexOf("31 Aug 2026")).toBeLessThan(out.indexOf("01 Apr 2024"));
    expect(out).toContain("Rejoin request raised");
  });
  it("says it may be incomplete when sources were skipped", () => {
    const out = html(<TimelineSectionCard result={{ status: "ok", data: { ...fx.timeline, skipped: ["promotion_record", "transfer_record"] } }} />);
    expect(out).toContain("may be incomplete (missing: promotion_record, transfer_record)");
  });
  it("no events is No data", () => {
    expect(html(<TimelineSectionCard result={{ status: "ok", data: { events: [], skipped: [] } }} />)).toContain("No events on record.");
  });
  it("error", () => expect(html(<TimelineSectionCard result={err()} />)).toContain("Could not load timeline."));
});

describe("RejoinHeaderCard", () => {
  it("identity, placement and request facts", () => {
    const out = html(<RejoinHeaderCard dossier={fx.dossier()} />);
    expect(out).toContain("Asha Kumari");
    expect(out).toContain("MAS10234");
    expect(out).toContain("2 yr 4 mo");
    expect(out).toContain("06 Oct 2026");
    expect(out).toContain("36 days");
  });
  it("header error degrades to an inline message, request facts still show", () => {
    const d = fx.dossier();
    const out = html(<RejoinHeaderCard dossier={{ ...d, sections: { ...d.sections, header: err() } }} />);
    expect(out).toContain("Could not load the employee header.");
    expect(out).toContain("06 Oct 2026");
  });
});

describe("RejoinVerdictStrip", () => {
  it("rating and every eligibility reason with severity text and code", () => {
    const d = fx.dossier();
    const out = html(<RejoinVerdictStrip verdict={d.verdict} eligibility={d.eligibility} />);
    expect(out).toContain("Weak");
    expect(out).toContain("Advisory only");
    expect(out).toContain("Blocked");
    expect(out).toContain("GAP_EXCEEDS_30");
    expect(out).toContain("ABSCONDING");
    expect(out).toContain("Review:");
    expect(out).toContain("checked again by the server when you approve");
  });
});

import { describe, expect, it } from "vitest";
import {
  addDays,
  buildReport,
  classifyOutcome,
  escalationFor,
  summarize,
  toFact,
  weekStartOf,
  SLA,
  type RawTokenRow,
  type TokenFact,
} from "../branch-activity-report/metrics.js";
import { renderEmail, esc } from "../branch-activity-report/template.js";
import { canonicalBranch, recruiterKey } from "../ats-vocabulary.js";

const RD = "2026-09-21"; // Monday

let seq = 0;
const row = (o: Partial<RawTokenRow> = {}): RawTokenRow => ({
  form_date: null,
  token_id: `t${++seq}`,
  candidate_id: `c${seq}`,
  token_number: `NOI-${seq}`,
  full_name: "Cand",
  process: "Sales",
  branch_raw: "NOIDA",
  recruiter_raw: "Asha",
  arrival_date: RD,
  arrival_hhmm: "10:00",
  queue_status: "waiting",
  has_queue_row: 1,
  sub_id: null,
  decision_text: "Waiting",
  current_stage: "Arrived",
  wait_min: null,
  handle_min: null,
  has_call: 0,
  since_arrival_min: 10,
  since_call_min: null,
  ...o,
});
const fact = (o: Partial<RawTokenRow> = {}): TokenFact =>
  toFact(row(o), canonicalBranch, recruiterKey);
const closed = (decision: string, o: Partial<RawTokenRow> = {}) =>
  row({
    queue_status: "completed",
    sub_id: "s",
    form_date: o.arrival_date ?? RD,
    decision_text: decision,
    has_call: 1,
    wait_min: 10,
    handle_min: 60,
    since_arrival_min: 200,
    since_call_min: 190,
    ...o,
  });

describe("classifyOutcome", () => {
  it.each([
    ["Selected", "selected"],
    ["Rejected", "rejected"],
    ["No Show", "no_show"],
    ["Client Round - Pending", "client_round"],
    ["Hold", "hold"],
    ["Waiting", "open"],
    ["Selection Discussion", "open"],
    ["Walkout", "walkout"],
  ])("%s → %s", (text, expected) => {
    expect(
      classifyOutcome({
        decision_text: text,
        queue_status: "waiting",
        sub_id: null,
      }),
    ).toBe(expected);
  });
  it("treats a walked_out token as walkout and a submission with unknown text as closed", () => {
    expect(
      classifyOutcome({
        decision_text: "Waiting",
        queue_status: "walked_out",
        sub_id: null,
      }),
    ).toBe("walkout");
    expect(
      classifyOutcome({
        decision_text: "Other",
        queue_status: "completed",
        sub_id: "x",
      }),
    ).toBe("other_closed");
  });
});

describe("escalationFor", () => {
  it("does not escalate a token still inside its stage SLA", () => {
    expect(
      escalationFor(fact({ since_arrival_min: SLA.waitToCallMin }), RD),
    ).toBeNull();
  });
  it("L1 when the wait-for-call SLA is breached the same day", () => {
    expect(escalationFor(fact({ since_arrival_min: 45 }), RD)?.level).toBe(1);
  });
  it("uses time since the call (not arrival) once called", () => {
    const e = escalationFor(
      fact({
        queue_status: "called",
        has_call: 1,
        since_arrival_min: 200,
        since_call_min: 90,
      }),
      RD,
    );
    expect(e).toBeNull(); // 90m since call is inside the 120m closure SLA even though 200m since arrival
  });
  it("L2 at 4h since arrival, L3 when carried over past the day", () => {
    const base = {
      queue_status: "in_interview",
      has_call: 1,
      since_call_min: 150,
    };
    expect(
      escalationFor(fact({ ...base, since_arrival_min: 260 }), RD)?.level,
    ).toBe(2);
    expect(
      escalationFor(
        fact({ ...base, since_arrival_min: 1600, arrival_date: "2026-09-20" }),
        RD,
      )?.level,
    ).toBe(3);
  });
  it("never escalates a closed token", () => {
    expect(
      escalationFor(
        toFact(closed("Selected"), canonicalBranch, recruiterKey),
        RD,
      ),
    ).toBeNull();
  });
});

describe("buildReport", () => {
  const facts = [
    toFact(closed("Selected"), canonicalBranch, recruiterKey),
    toFact(closed("Rejected"), canonicalBranch, recruiterKey),
    toFact(
      closed("No Show", { has_call: 0, wait_min: null, handle_min: null }),
      canonicalBranch,
      recruiterKey,
    ),
    fact({
      queue_status: "called",
      has_call: 1,
      wait_min: 15,
      since_arrival_min: 300,
      since_call_min: 200,
    }), // open, breached
    fact({ since_arrival_min: 5 }), // open, inside SLA
    toFact(
      closed("Selected", { arrival_date: "2026-09-16", handle_min: 200 }),
      canonicalBranch,
      recruiterKey,
    ), // MTD only (previous week), SLA-2 breach
    toFact(
      closed("Rejected", { arrival_date: "2026-09-02" }),
      canonicalBranch,
      recruiterKey,
    ), // MTD only
  ];
  const r = buildReport({ facts, reportDate: RD });

  it("splits FTD / WTD / MTD by arrival date", () => {
    expect(r.overall.ftd.tokens).toBe(5);
    expect(r.overall.wtd.tokens).toBe(5); // Monday: week starts today, the 16th is MTD only
    expect(r.overall.mtd.tokens).toBe(7);
    expect(r.weekStart).toBe("2026-09-21");
    expect(weekStartOf("2026-09-20")).toBe("2026-09-14");
  });
  it("walk-ins are distinct token holders", () => {
    expect(r.overall.ftd.walkins).toBe(5);
    expect(r.overall.ftd.tokens).toBe(5);
  });
  it("computes closure, interviewed and selection %", () => {
    const f = r.overall.ftd;
    expect(f.closed).toBe(3);
    expect(f.interviewed).toBe(2); // closed − no-show
    expect(f.selectionPct).toBe(50); // 1 selected ÷ 2 interviewed
    expect(f.open).toBe(2);
  });
  it("SLA-2: open called token past 120m counts as breached; open inside SLA is excluded", () => {
    expect(r.overall.ftd.sla2).toMatchObject({
      met: 2,
      breached: 1,
      pct: 66.7,
    });
    expect(r.overall.mtd.sla2.breached).toBe(2); // + the 200m closed selection on the 16th
  });
  it("SLA-1: open uncalled token inside SLA is not a breach", () => {
    expect(r.overall.ftd.sla1.breached).toBe(0);
  });
  it("lists only tokens past SLA as escalations and counts the rest as on-track", () => {
    expect(r.escalations).toHaveLength(1);
    expect(r.escalations[0]).toMatchObject({
      level: 2,
      stage: "Called — interview pending",
    });
    expect(r.onTrackOpen).toBe(1);
  });
  it("groups recruiters case-insensitively within a branch", () => {
    const b = buildReport({
      facts: [
        fact({ recruiter_raw: "SOFIYA SULTAN" }),
        fact({ recruiter_raw: "Sofiya Sultan" }),
      ],
      reportDate: RD,
    });
    expect(b.branches[0].recruiters).toHaveLength(1);
    expect(b.branches[0].recruiters[0].ftd.tokens).toBe(2);
  });
});

describe("renderEmail", () => {
  it("escapes dynamic values and renders without throwing on empty data", () => {
    const evil = buildReport({
      facts: [fact({ full_name: "<script>x</script>", since_arrival_min: 90 })],
      reportDate: RD,
    });
    const html = renderEmail(evil, { generatedAt: "now", dateLabel: "Monday" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(
      renderEmail(buildReport({ facts: [], reportDate: RD }), {
        generatedAt: "now",
        dateLabel: "Monday",
      }),
    ).toContain("nothing to escalate");
    expect(esc(null)).toBe("");
  });
});

describe("single-branch email", () => {
  it("scopes numbers to the branch and titles the mail with it", () => {
    const all = [
      fact({ branch_raw: "NOIDA" }),
      fact({ branch_raw: "NOIDA" }),
      fact({ branch_raw: "NOIDA-2" }),
    ];
    const noida = buildReport({
      facts: all.filter((f) => f.branch === "NOIDA"),
      reportDate: RD,
    });
    expect(noida.overall.ftd.tokens).toBe(2);
    expect(noida.branches).toHaveLength(1);
    const html = renderEmail(noida, {
      generatedAt: "now",
      dateLabel: "Monday",
      branchLabel: "NOIDA",
    });
    expect(html).toContain("NOIDA — Daily Recruitment Activity");
    expect(html).not.toContain("Branch-wise activity");
    expect(html).toContain("Recruiter-wise activity");
  });
});

describe("SLA data coverage", () => {
  it("marks an SLA unreliable when most tokens carry no call time, instead of reporting a verdict", () => {
    const rows = [
      ...Array.from({ length: 9 }, () =>
        fact(
          closed("Rejected", { has_call: 0, wait_min: null, handle_min: null }),
        ),
      ),
      fact(closed("Selected", { wait_min: 60 })),
    ];
    const s = buildReport({ facts: rows, reportDate: RD }).overall.ftd.sla1;
    expect(s).toMatchObject({
      measured: 1,
      population: 10,
      coveragePct: 10,
      reliable: false,
    });
  });
  it("flags bulk closures stamped within a minute of the call", () => {
    const rows = Array.from({ length: 25 }, () =>
      fact(closed("Rejected", { handle_min: 0 })),
    );
    const q = buildReport({ facts: rows, reportDate: RD }).dataQuality;
    expect(q.instantClosures).toBe(25);
  });
});

describe("forms submitted (activity-based)", () => {
  it("credits a form to the day it was filed, even for an earlier day's token", () => {
    const rows = [
      fact(closed("Selected")), // today's token, form today
      fact(closed("No Show", { arrival_date: "2026-09-19", form_date: RD })), // 2-day-old token, form today
      fact(
        closed("Rejected", {
          arrival_date: "2026-09-19",
          form_date: "2026-09-19",
        }),
      ), // old, filed on its own day
    ];
    const r = buildReport({ facts: rows, reportDate: RD });
    expect(r.overall.ftd.tokens).toBe(1);
    expect(r.overall.ftd.formsSubmitted).toBe(2);
    expect(r.overall.ftd.formsFromEarlier).toBe(1);
    expect(r.overall.mtd.formsSubmitted).toBe(3);
  });
});

describe("SLA coverage never exceeds 100%", () => {
  it("counts a called no-show in both measured and population", () => {
    const rows = [
      fact(closed("No Show", { wait_min: 30 })),
      fact(closed("Selected", { wait_min: 10 })),
      fact(
        closed("Rejected", { has_call: 0, wait_min: null, handle_min: null }),
      ),
    ];
    const s = buildReport({ facts: rows, reportDate: RD }).overall.ftd.sla1;
    expect(s.measured).toBe(2);
    expect(s.population).toBe(3);
    expect(s.coveragePct).toBeLessThanOrEqual(100);
  });
});

describe("scheduler timing", () => {
  it("targets the next 20:00 IST regardless of host timezone", async () => {
    const { msUntilNextRun } =
      await import("../branch-activity-report/scheduler.js");
    const istToUtc = (iso: string) => Date.parse(iso) - 5.5 * 3600_000; // iso is an IST wall-clock time
    expect(msUntilNextRun(istToUtc("2026-09-21T19:00:00Z"))).toBe(3600_000);
    expect(msUntilNextRun(istToUtc("2026-09-21T20:00:00Z"))).toBe(
      24 * 3600_000,
    );
    expect(msUntilNextRun(istToUtc("2026-09-21T21:30:00Z"))).toBe(
      22.5 * 3600_000,
    );
  });
});

describe("queue completion is not closure (NOIDA 2026-09-25)", () => {
  it("a token completed in the queue with no form while the candidate is still Waiting stays open", () => {
    expect(
      classifyOutcome({
        decision_text: "Waiting",
        queue_status: "completed",
        sub_id: null,
      }),
    ).toBe("open");
  });
  it("a completed token whose candidate moved on to another status is still closed", () => {
    expect(
      classifyOutcome({
        decision_text: "Round 2- Op's",
        queue_status: "completed",
        sub_id: null,
      }),
    ).toBe("other_closed");
  });
  it("marks the fact as queue-completed-without-outcome and escalates it once the call SLA has run out", () => {
    const f = fact({
      queue_status: "completed",
      decision_text: "Waiting",
      has_call: 1,
      since_arrival_min: 300,
      since_call_min: 290,
      handle_min: 0,
    });
    expect(f.closed).toBe(false);
    expect(f.queueCompletedNoOutcome).toBe(true);
    expect(escalationFor(f, RD)?.stage).toBe(
      "Queue-completed — no interview outcome",
    );
  });
});

describe("post-selection statuses count as Selected", () => {
  it.each(["profile_submitted", "hr_approved", "offer_approved"])(
    "%s → selected",
    (text) => {
      expect(
        classifyOutcome({ decision_text: text, queue_status: "completed", sub_id: "s" }),
      ).toBe("selected");
    },
  );
  it("counts profile_submitted inside Selected and every token in exactly one outcome bucket", () => {
    const facts = [
      fact({ token_id: "1", candidate_id: "a", decision_text: "profile_submitted", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "2", candidate_id: "b", decision_text: "Selected", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "3", candidate_id: "c", decision_text: "Rejected", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "4", candidate_id: "d", decision_text: "No Show", queue_status: "no_show" }),
      fact({ token_id: "5", candidate_id: "e", decision_text: "Hold", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "6", candidate_id: "f", decision_text: "Client Round - Pending", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "7", candidate_id: "g", decision_text: "Waiting", queue_status: "completed" }),
      fact({ token_id: "8", candidate_id: "h", decision_text: "Waiting", queue_status: "waiting" }),
    ];
    const s = summarize(facts);
    expect(s.selected).toBe(2);
    expect(s.profileSubmitted).toBe(1);
    expect(s.open).toBe(2);
    expect(s.openQueueCompleted).toBe(1);
    expect(s.openWaiting).toBe(1);
    expect(
      s.selected + s.rejected + s.noShow + s.walkout + s.clientRound + s.hold + s.otherClosed + s.open,
    ).toBe(s.tokens);
  });
});

describe("report insights", () => {
  const sel = (id: string, o: Partial<RawTokenRow>) =>
    fact({
      token_id: id,
      candidate_id: id,
      queue_status: "completed",
      sub_id: "s",
      decision_text: "Selected",
      has_call: 1,
      handle_min: 30,
      arrival_date: RD,
      ...o,
    });

  it("counts the post-selection pipeline cumulatively", () => {
    const facts = [
      sel("a", {}),
      sel("b", { cand_status: "hr_approved", current_stage: "offer_approved" }),
      sel("c", { cand_status: "profile_submitted", current_stage: "offer_approved" }),
      sel("d", { current_stage: "joined" }),
    ];
    const p = buildReport({ facts, reportDate: RD }).branches[0].insights.pipeline;
    expect(p).toEqual({ selected: 4, offerApproved: 3, profileSubmitted: 2, joined: 1 });
  });

  it("normalises the sourcing channel spellings into one bucket", () => {
    const facts = [
      sel("a", { source_channel: "WALKIN" }),
      sel("b", { source_channel: "Walk-In" }),
      sel("c", { source_channel: "Reference" }),
      sel("d", { source_channel: null }),
    ];
    const rows = buildReport({ facts, reportDate: RD }).branches[0].insights.sources;
    expect(rows.find((r) => r.source === "Walk-in")?.walkins).toBe(2);
    expect(rows.find((r) => r.source === "Reference")?.walkins).toBe(1);
    expect(rows.find((r) => r.source === "Not recorded")?.walkins).toBe(1);
  });

  it("compares today with yesterday and the same day last week, and lists recent no-shows to re-call", () => {
    const facts = [
      sel("t", {}),
      sel("y", { arrival_date: addDays(RD, -1) }),
      sel("w", { arrival_date: addDays(RD, -7) }),
      fact({ token_id: "n", candidate_id: "n", queue_status: "no_show", decision_text: "No Show", arrival_date: addDays(RD, -1) }),
    ];
    const i = buildReport({ facts, reportDate: RD }).branches[0].insights;
    expect(i.compare.map((c) => [c.label, c.selected, c.noShow])).toEqual([
      ["Today", 1, 0],
      ["Yesterday", 1, 1],
      ["Same day last week", 1, 0],
    ]);
    expect(i.recall).toHaveLength(1);
    expect(i.recall[0].token).toBeDefined();
  });

  it("flags closures within a minute as not well recorded", () => {
    const facts = [sel("a", { handle_min: 0 }), sel("b", { handle_min: 45 })];
    const i = buildReport({ facts, reportDate: RD }).branches[0].insights;
    expect(i.recordingQualityPct).toBe(50);
    expect(i.recruiterQuality[0].instantClosures).toBe(1);
  });
});

describe("no interview feedback count", () => {
  it("counts tokens with no interview form, but not no-shows or walk-outs", () => {
    const facts = [
      fact({ token_id: "1", candidate_id: "a", decision_text: "Selected", sub_id: "s", queue_status: "completed" }),
      fact({ token_id: "2", candidate_id: "b", decision_text: "Waiting", queue_status: "completed" }),
      fact({ token_id: "3", candidate_id: "c", decision_text: "Waiting", queue_status: "waiting" }),
      fact({ token_id: "4", candidate_id: "d", decision_text: "No Show", queue_status: "no_show" }),
      fact({ token_id: "5", candidate_id: "e", decision_text: "Walkout", queue_status: "walked_out" }),
    ];
    const s = summarize(facts);
    expect(s.noShow).toBe(1);
    expect(s.noFeedback).toBe(2);
  });
});

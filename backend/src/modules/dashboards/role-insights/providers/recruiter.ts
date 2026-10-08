import type { InsightAction, InsightKpi, InsightProvider, InsightSection, InsightSectionFn, InsightSignal } from "../types.js";
import { severityFor, toneFor } from "../helpers.js";
import { allowedPageCodes, pickHref } from "./pageAccess.js";
import {
  COHORT_DAYS, loadBgvPending, loadCohort, loadDailyTargets, loadJoinsByDay, loadOffers, loadRequisitions, loadStageTimes,
} from "./recruiterData.js";
import {
  addDays, ageDays, buildFunnel, candidateDepth, dailyCounts, isClosed, noShowRate, offerOutcomes, pctOf, recruiterLeague,
  requisitionAgeing, sourceYield, stageDepth, statusDepth, FUNNEL_STEPS, JOINED_DEPTH, type CohortCandidate,
} from "./recruiterLogic.js";

const CODE = "RECRUITER_DASHBOARD";
const drill = (metric: string) => `/dashboards/drill/${CODE}/${metric}`;
const DOCS_OVERDUE_DAYS = 2;
const LINK_STUCK_DAYS = 1;
/** A link older than this with no profile is an abandoned candidate, not a pending one. */
const DOCS_ABANDONED_DAYS = 21;
const REVIEW_STALE_DAYS = 30;

/** Candidates that entered the pipeline in [today-29, today] vs the 30 days before it. */
function split(cands: CohortCandidate[], today: string) {
  const cut = addDays(today, -29);
  return { cur: cands.filter((c) => c.createdDate >= cut), prev: cands.filter((c) => c.createdDate < cut) };
}

const tidy = (label: string) => (label === label.toUpperCase() && label.length > 4 ? label.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : label);
const pp = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

const funnel: InsightSectionFn = async (ctx): Promise<InsightSection> => {
  const { candidates } = await loadCohort(ctx);
  const allowed = await allowedPageCodes(ctx);
  const master = pickHref(allowed, ["/ats/candidate-master"], drill("ONBOARDING"));
  const { cur, prev } = split(candidates, ctx.today);
  const curF = buildFunnel(cur.map(candidateDepth));
  const prevF = buildFunnel(prev.map(candidateDepth));

  // Disjoint "where do open candidates sit right now" — current stage only, closed + joined removed.
  const open = candidates.filter((c) => !isClosed(c.status) && !c.joined);
  const sit = FUNNEL_STEPS.map((s, i) => ({ label: s.label, value: open.filter((c) => Math.max(0, stageDepth(c.stage), statusDepth(c.status)) === i).length })).filter((p) => p.value > 0);

  const selRate = curF[4].fromTopPct;
  const prevSel = prevF[4].fromTopPct;
  const joinRate = curF[JOINED_DEPTH].fromTopPct;
  const kpis: InsightKpi[] = [
    { key: "active_pipeline", label: "Active pipeline", value: open.length, unit: "count", tone: "blue", href: master,
      helper: `open candidates from the last ${COHORT_DAYS}d`, formula: `Genuine candidates registered in the last ${COHORT_DAYS} days, not Rejected / No Show / Inactive and not yet joined. Excludes legacy employee rows and IDC records.` },
    { key: "selection_rate", label: "Selection rate (30d)", value: selRate, unit: "percent", delta: pp(selRate, prevSel), deltaLabel: "vs previous 30d", tone: toneFor(selRate, 25, 15), href: master,
      formula: "Registered in the last 30 days who reached Selected or beyond / all registered in the same 30 days." },
    { key: "join_rate", label: "Registered to joined (30d)", value: joinRate, unit: "percent", tone: toneFor(joinRate, 10, 5), href: master,
      helper: "joins linked to an ATS candidate (no trend: older joiners carry no candidate link)", formula: "30-day registrations that have an employee record linked (employees.candidate_id) / all 30-day registrations. Joiners with no candidate link are not counted here, so this is a floor." },
  ];
  const signals: InsightSignal[] = [];
  const weakest = curF.slice(1).filter((s) => s.fromPrevPct !== null && curF[curF.indexOf(s) - 1].reached >= 20).sort((a, b) => (a.fromPrevPct as number) - (b.fromPrevPct as number))[0];
  if (weakest) signals.push({ tone: (weakest.fromPrevPct as number) < 30 ? "bad" : "watch", title: `Biggest leak: into "${weakest.label}"`, detail: `Only ${weakest.fromPrevPct}% of candidates who reached the previous step moved on, over the last 30 days.`, value: `${weakest.fromPrevPct}%`, href: master });
  if (selRate !== null && prevSel !== null && Math.abs(selRate - prevSel) >= 3) signals.push({ tone: selRate > prevSel ? "good" : "bad", title: `Selection rate ${selRate > prevSel ? "up" : "down"} ${Math.abs(pp(selRate, prevSel) as number)} pp`, detail: `${selRate}% this 30 days vs ${prevSel}% the 30 days before.`, value: `${selRate}%`, href: master });

  return {
    kpis, signals,
    series: [
      { key: "funnel_30d", title: "Hiring funnel — last 30 days", subtitle: "furthest step each candidate has reached; steps are cumulative, so widths only ever narrow", kind: "funnel", href: master,
        points: curF.map((s) => ({ label: s.label, value: s.reached, fromPrevPct: s.fromPrevPct, fromTopPct: s.fromTopPct, prevFromTopPct: s.key === "joined" ? null : prevF.find((p) => p.key === s.key)?.fromTopPct ?? null })) },
      { key: "pipeline_now", title: "Where open candidates sit now", subtitle: "current stage only (disjoint) — not a funnel", kind: "ranked", href: master, points: sit },
    ],
  };
};

const today: InsightSectionFn = async (ctx) => {
  const [{ candidates }, offers, stageTimes, joins, targets, allowed] = await Promise.all([
    loadCohort(ctx), loadOffers(ctx), loadStageTimes(ctx, ["Onboarding Link Sent"]), loadJoinsByDay(ctx, 21), loadDailyTargets(ctx), allowedPageCodes(ctx),
  ]);
  const N = 14;
  const t = ctx.today;
  const walkins = dailyCounts(candidates.map((c) => c.walkInDate), t, 21);
  const registered = dailyCounts(candidates.map((c) => c.createdDate), t, 21);
  const selected = dailyCounts(stageTimes.map((s) => s.at), t, 21);
  const offered = dailyCounts(offers.filter((o) => o.status === "bh_approved").map((o) => o.approvedAt), t, 21);
  const joined = dailyCounts(joins, t, 21);
  const bench = (xs: number[]) => r1(avg(xs.slice(-8, -1)));
  const waitingToday = candidates.filter((c) => (c.walkInDate ?? c.createdDate) === t && String(c.status ?? "").toLowerCase() === "waiting").length;
  const queue = pickHref(allowed, ["/ats/walkin-queue", "/ats/waiting-queue", "/ats/candidate-master"], drill("ONBOARDING"));
  const master = pickHref(allowed, ["/ats/candidate-master"], drill("ONBOARDING"));
  const offerPage = pickHref(allowed, ["/ats/offer-approvals", "/ats/joining-control-room", "/ats/candidate-master"], drill("ONBOARDING"));
  const joinPage = pickHref(allowed, ["/ats/joining-control-room", "/ats/onboarding-requests", "/ats/candidate-master"], drill("ONBOARDING"));
  const mk = (key: string, label: string, series: number[], target: number | undefined, href: string, helper?: string): InsightKpi => {
    const v = series[series.length - 1];
    const b = bench(series);
    return {
      key, label, value: v, unit: "count", spark: series.slice(-N), href, tone: target !== undefined ? toneFor(v / (target || 1) * 100, 100, 70) : "blue",
      delta: target !== undefined ? v - target : b === null ? null : r1(v - b),
      deltaLabel: target !== undefined ? `vs daily target ${target}` : b === null ? undefined : `vs 7-day avg ${b}`,
      helper: helper ?? (target === undefined ? "no daily target configured" : undefined),
      formula: `${label} dated ${t} (IST). Benchmark is the average of the previous 7 days${target !== undefined ? "; the daily target comes from dashboard targets" : ""}.`,
    };
  };
  const keys = [
    { key: "registered", label: "Registered", tone: "blue" as const }, { key: "walkins", label: "Walk-ins", tone: "violet" as const },
    { key: "selected", label: "Selected (link sent)", tone: "green" as const }, { key: "offers", label: "Offers approved", tone: "amber" as const }, { key: "joined", label: "Joined", tone: "red" as const },
  ];
  const days = Array.from({ length: N }, (_, i) => addDays(t, i - (N - 1)));
  return {
    kpis: [
      mk("walkins_today", "Walk-ins today", walkins, targets.RECRUITER_WALKINS, queue, waitingToday ? `${waitingToday} still waiting for interview` : undefined),
      mk("registered_today", "Registered today", registered, targets.RECRUITER_REGISTRATIONS, master),
      mk("selected_today", "Selected today", selected, targets.RECRUITER_SELECTIONS, master, "onboarding link sent today"),
      mk("offers_today", "Offers approved today", offered, targets.RECRUITER_OFFERS, offerPage),
      mk("joined_today", "Joined today", joined, targets.RECRUITER_JOINS, joinPage, "all joiners, linked to ATS or not"),
    ],
    series: [{
      key: "daily_flow", title: "Daily flow — last 14 days", subtitle: "registrations, walk-ins, selections, offers and joins per day (IST)", kind: "line", keys, href: master,
      points: days.map((d, i) => ({ label: d.slice(5), registered: registered[7 + i], walkins: walkins[7 + i], selected: selected[7 + i], offers: offered[7 + i], joined: joined[7 + i] })),
    }],
  };
};

const offersSection: InsightSectionFn = async (ctx) => {
  const [offers, allowed] = await Promise.all([loadOffers(ctx), allowedPageCodes(ctx)]);
  const o = offerOutcomes(offers, ctx.today);
  const approvals = pickHref(allowed, ["/ats/offer-approvals", "/ats/candidate-master"], drill("ONBOARDING"));
  const joinRoom = pickHref(allowed, ["/ats/joining-control-room", "/ats/onboarding-requests", "/ats/candidate-master"], drill("ONBOARDING"));
  const actions: InsightAction[] = [
    { id: "offers_bh_pending", label: "Offers awaiting branch-head approval", count: o.awaitingCount, severity: o.awaitingOver3d ? "critical" : severityFor(o.awaitingCount, 3, 10), oldestDays: o.oldestAwaiting, overdue: o.awaitingOver3d,
      href: approvals, hint: "overdue = waiting more than 3 days", group: "Offers" },
    { id: "offers_ghosted", label: "Offers past joining date, not joined (14d)", count: o.ghosted.length, severity: severityFor(o.ghosted.length, 3, 10),
      oldestDays: o.ghosted.reduce<number | null>((m, x) => { const a = ageDays(x.doj, ctx.today); return a === null ? m : Math.max(m ?? 0, a); }, null),
      overdue: o.ghosted.length, href: joinRoom, hint: "follow up: joined late, deferred or dropped out", group: "Offers" },
  ];
  const signals: InsightSignal[] = [];
  if (o.offerToJoinPct !== null) signals.push({ tone: o.offerToJoinPct >= 85 ? "good" : o.offerToJoinPct >= 70 ? "watch" : "bad", title: "Offer-to-join conversion", detail: `${o.joinedCount} of ${o.dueCount} approved offers whose joining date passed in the last 30 days actually joined.`, value: `${o.offerToJoinPct}%`, href: joinRoom });
  if (o.awaitingOver3d) signals.push({ tone: "bad", title: `${o.awaitingOver3d} offer(s) stuck at branch-head approval`, detail: "Waiting more than 3 days; each day of delay risks the candidate accepting elsewhere.", value: o.awaitingOver3d, href: approvals });
  return {
    actions, signals,
    kpis: [
      { key: "offer_to_join", label: "Offer-to-join (30d)", value: o.offerToJoinPct, unit: "percent", tone: toneFor(o.offerToJoinPct, 85, 70), href: joinRoom,
        helper: o.dueCount ? `${o.joinedCount} of ${o.dueCount} due offers joined` : undefined, unavailable: o.dueCount ? null : "no approved offers have reached their joining date in the window",
        formula: "Approved offers (ats_employment_offer.status = bh_approved) with joining date in the last 30 days and before today: joined (employee record linked to the candidate) / due. Offers still waiting for their joining day are excluded." },
      { key: "offers_ghosted", label: "Offer no-shows (14d)", value: o.ghosted.length, unit: "count", higherIsBetter: false, tone: toneFor(o.ghosted.length, 0, 3, false), href: joinRoom, helper: "approved, joining date passed, not joined" },
    ],
  };
};

const joiners: InsightSectionFn = async (ctx) => {
  const [offers, allowed] = await Promise.all([loadOffers(ctx), allowedPageCodes(ctx)]);
  const o = offerOutcomes(offers, ctx.today);
  const room = pickHref(allowed, ["/ats/joining-control-room", "/ats/onboarding-requests", "/ats/candidate-master"], drill("ONBOARDING"));
  const days = Array.from({ length: 8 }, (_, i) => addDays(ctx.today, i));
  return {
    kpis: [{ key: "joining_week", label: "Joining in next 7 days", value: o.week.length, unit: "count", tone: "violet", href: room, helper: "approved offers, not yet joined", formula: "Approved offers with a joining date from today to today+7 whose candidate has no employee record yet." }],
    series: [{ key: "joiners_by_day", title: "Joining this week", subtitle: "approved offers by joining date", kind: "bar", href: room, points: days.map((d) => ({ label: d.slice(5), value: o.week.filter((x) => x.doj === d).length })) }],
    tables: [{
      key: "joiners_next", title: "Next joiners", href: room,
      columns: [{ key: "name", label: "Candidate" }, { key: "process", label: "Process" }, { key: "branch", label: "Branch" }, { key: "doj", label: "Joins" }, { key: "in", label: "In", unit: "days", align: "right" }],
      rows: [...o.week].sort((a, b) => String(a.doj).localeCompare(String(b.doj))).slice(0, 10).map((x) => ({ name: x.name, process: x.process, branch: x.branch, doj: x.doj, in: ageDays(ctx.today, x.doj as string) ?? 0, href: room })),
    }],
  };
};

const onboarding: InsightSectionFn = async (ctx) => {
  const [{ candidates }, times, bgv, allowed] = await Promise.all([loadCohort(ctx), loadStageTimes(ctx, ["Onboarding Link Sent", "Profile Submitted"]), loadBgvPending(ctx), allowedPageCodes(ctx)]);
  const t = ctx.today;
  const live = new Map(candidates.filter((c) => !c.joined && !isClosed(c.status)).map((c) => [c.id, c]));
  const linkAt = new Map<string, string>(); const profileSent = new Set<string>();
  for (const s of times) { if (s.stage === "Onboarding Link Sent") linkAt.set(s.candidateId, s.at); else profileSent.add(s.candidateId); }
  const open = [...linkAt].filter(([id]) => live.has(id) && !profileSent.has(id) && candidateDepth(live.get(id) as CohortCandidate) < 6).map(([, at]) => ageDays(at, t) ?? 0);
  const docs = open.filter((d) => d <= DOCS_ABANDONED_DAYS);
  const abandoned = open.length - docs.length;
  const docsOverdue = docs.filter((d) => d > DOCS_OVERDUE_DAYS).length;
  const noLink = [...live.values()].filter((c) => String(c.status).toLowerCase() === "selected" && candidateDepth(c) === 4 && (ageDays(c.updatedDate, t) ?? 0) >= LINK_STUCK_DAYS);
  const review = [...live.values()].filter((c) => String(c.status).toLowerCase() === "profile_submitted" && (ageDays(c.updatedDate, t) ?? 0) <= REVIEW_STALE_DAYS);
  const hrReview = review.length;
  const docsHref = pickHref(allowed, ["/ats/joining-documents-tracker", "/ats/onboarding-requests", "/ats/candidate-master"], drill("ONBOARDING"));
  const reqHref = pickHref(allowed, ["/ats/onboarding-requests", "/ats/candidate-master"], drill("ONBOARDING"));
  const workspace = pickHref(allowed, ["/ats/recruiter/workspace", "/ats/candidate-master"], drill("ONBOARDING"));
  const bgvHref = pickHref(allowed, ["/ats/bgv", "/ats/candidate-master"], drill("ONBOARDING"));
  const actions: InsightAction[] = [
    { id: "selected_no_link", label: "Selected but onboarding link not sent", count: noLink.length, severity: severityFor(noLink.length, 5, 20), oldestDays: noLink.reduce<number | null>((m, c) => Math.max(m ?? 0, ageDays(c.updatedDate, t) ?? 0), null), overdue: noLink.length, href: workspace, hint: "send the link the day they are selected", group: "Onboarding" },
    { id: "docs_pending", label: "Onboarding link sent, profile/documents pending", count: docs.length, severity: docsOverdue ? "high" : severityFor(docs.length, 10, 40), oldestDays: docs.length ? Math.max(...docs) : null, overdue: docsOverdue, href: docsHref, hint: `overdue = more than ${DOCS_OVERDUE_DAYS} days with no profile${abandoned ? `; ${abandoned} older than ${DOCS_ABANDONED_DAYS}d treated as abandoned` : ""}`, group: "Onboarding" },
    { id: "hr_review", label: "Profiles submitted, awaiting HR review", count: hrReview, severity: severityFor(hrReview, 10, 30), oldestDays: review.reduce<number | null>((m, c) => Math.max(m ?? 0, ageDays(c.updatedDate, t) ?? 0), null), href: reqHref, hint: `updated in the last ${REVIEW_STALE_DAYS} days`, group: "Onboarding" },
    { id: "bgv_pending", label: "Background verification pending", count: bgv.count, severity: severityFor(bgv.count, 15, 60), oldestDays: bgv.oldestDays, href: bgvHref, hint: bgv.manualReview ? `${bgv.manualReview} need manual review / mismatch` : undefined, group: "Onboarding" },
  ];
  const signals: InsightSignal[] = [];
  if (docsOverdue) signals.push({ tone: "bad", title: `${docsOverdue} candidate(s) sitting on onboarding documents`, detail: `Link sent more than ${DOCS_OVERDUE_DAYS} days ago with no profile submitted: highest drop-off risk before joining.`, value: docsOverdue, href: docsHref });
  if (noLink.length) signals.push({ tone: "watch", title: `${noLink.length} selected candidate(s) have no onboarding link`, detail: "Selected, but nobody has sent the onboarding link yet.", value: noLink.length, href: workspace });
  return {
    actions, signals,
    kpis: [
      { key: "docs_pending", label: "Onboarding docs pending", value: docs.length, unit: "count", higherIsBetter: false, tone: toneFor(docsOverdue, 0, 5, false), href: docsHref, helper: docsOverdue ? `${docsOverdue} overdue (>${DOCS_OVERDUE_DAYS}d)` : "none overdue",
        formula: `Candidates whose Onboarding Link was sent in the last ${DOCS_ABANDONED_DAYS} days with no Profile Submitted, not rejected/no-show and not yet joined. Links older than ${DOCS_ABANDONED_DAYS} days are treated as abandoned and listed in the hint, not counted.` },
      { key: "bgv_pending", label: "BGV pending", value: bgv.count, unit: "count", higherIsBetter: false, tone: toneFor(bgv.count, 10, 40, false), href: bgvHref, helper: bgv.oldestDays !== null ? `oldest ${bgv.oldestDays}d` : undefined,
        formula: "Distinct pipeline candidates (not joined, not closed) with at least one background check not yet verified/waived/failed." },
    ],
  };
};

const requisitions: InsightSectionFn = async (ctx) => {
  const [r, allowed] = await Promise.all([loadRequisitions(ctx), allowedPageCodes(ctx)]);
  const a = requisitionAgeing(r.open, ctx.today);
  const href = pickHref(allowed, ["/recruitment/job-requisition"], drill("RECRUITER_ACTIVITY"));
  const byProcess = new Map<string, number>();
  for (const x of a.open) byProcess.set(x.process ?? "Unspecified", (byProcess.get(x.process ?? "Unspecified") ?? 0) + x.open);
  const urgent = a.open.filter((x) => (x.priority === "urgent" || x.priority === "high") && x.age > 14);
  const signals: InsightSignal[] = [];
  if (a.overdue.length) signals.push({ tone: "bad", title: `${a.overdue.length} requisition(s) past their target joining date`, detail: `${a.overdue.reduce((s, x) => s + x.open, 0)} seats still open after the date the business asked for them.`, value: a.overdue.length, href });
  if (urgent.length) signals.push({ tone: "watch", title: `${urgent.length} urgent/high requisition(s) open more than 14 days`, detail: "Priority demand that is ageing.", value: urgent.length, href });
  return {
    actions: [
      { id: "req_pending_approval", label: "Requisitions awaiting approval", count: r.pendingApproval, severity: severityFor(r.pendingApproval, 3, 8), href, group: "Demand" },
      { id: "req_overdue", label: "Requisitions past target joining date", count: a.overdue.length, severity: severityFor(a.overdue.length, 1, 4), oldestDays: a.oldest, overdue: a.overdue.length, href, group: "Demand" },
    ],
    kpis: [
      { key: "open_seats", label: "Open seats", value: a.seats, unit: "count", higherIsBetter: false, tone: "amber", href, helper: `${a.open.length} requisition(s), ${a.fillPct ?? "—"}% filled`, formula: "Sum of (requested - fulfilled headcount) over approved, active, not-closed requisitions. Test requisitions (TEST-*) excluded." },
      { key: "time_to_fill", label: "Avg time-to-fill", value: r.avgTimeToFill, unit: "days", higherIsBetter: false, tone: toneFor(r.avgTimeToFill, 21, 35, false), href, unavailable: r.filledClosed ? null : "no requisition closed with hires in the last 180 days", helper: r.filledClosed ? `${r.filledClosed} closed in 180d` : undefined, formula: "Average days from requisition approval (or creation) to closure, over requisitions closed in the last 180 days with at least one hire." },
    ],
    series: [{ key: "open_by_process", title: "Open seats by process", kind: "ranked", href, unit: "count", points: [...byProcess].sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label, value })) }],
    tables: [{
      key: "req_ageing", title: "Requisition ageing", href,
      columns: [{ key: "code", label: "Requisition" }, { key: "process", label: "Process" }, { key: "open", label: "Open", align: "right" }, { key: "fill", label: "Filled", unit: "percent", align: "right" }, { key: "age", label: "Age", unit: "days", align: "right" }],
      rows: [...a.open].sort((x, y) => y.age - x.age).slice(0, 8).map((x) => ({ code: x.code, process: x.process, open: x.open, fill: pctOf(x.fulfilled, x.requested, 0), age: x.age, href })),
    }],
    signals,
  };
};

const sources: InsightSectionFn = async (ctx) => {
  const { candidates } = await loadCohort(ctx);
  const { cur } = split(candidates, ctx.today);
  const y = sourceYield(cur).map((s) => ({ ...s, source: tidy(s.source) }));
  const sources = pickHref(await allowedPageCodes(ctx), ["/ats/sourcing-analysis", "/ats/candidate-master"], drill("RECRUITER_ACTIVITY"));
  const signals: InsightSignal[] = [];
  const big = y.filter((s) => s.registered >= 30 && s.joinedPct !== null);
  const best = [...big].sort((a, b) => (b.joinedPct as number) - (a.joinedPct as number))[0];
  const worst = [...big].sort((a, b) => (a.joinedPct as number) - (b.joinedPct as number))[0];
  if (best && worst && best.source !== worst.source) {
    signals.push({ tone: "good", title: `${best.source} is the best-yielding source`, detail: `${best.joinedPct}% of ${best.registered} registrations joined (30d).`, value: `${best.joinedPct}%`, href: sources });
    signals.push({ tone: "watch", title: `${worst.source} yields least`, detail: `${worst.joinedPct}% of ${worst.registered} registrations joined (30d); review spend/effort on this channel.`, value: `${worst.joinedPct}%`, href: sources });
  }
  return {
    signals,
    tables: [{
      key: "source_yield", title: "Source-wise yield (30d)", href: sources,
      columns: [{ key: "source", label: "Source" }, { key: "registered", label: "Registered", align: "right" }, { key: "selected", label: "Selected", align: "right" }, { key: "selectedPct", label: "Sel %", unit: "percent", align: "right" }, { key: "joined", label: "Joined", align: "right" }, { key: "joinedPct", label: "Join %", unit: "percent", align: "right" }],
      rows: y.map((s) => ({ ...s, href: sources })),
    }],
  };
};

const league: InsightSectionFn = async (ctx) => {
  const { candidates } = await loadCohort(ctx);
  const { cur } = split(candidates, ctx.today);
  const rows = recruiterLeague(cur).slice(0, 12).map((r) => ({ ...r }));
  return {
    tables: [{
      key: "recruiter_league", title: "Recruiter league table (30d)",
      columns: [{ key: "recruiter", label: "Recruiter" }, { key: "registered", label: "Registered", align: "right" }, { key: "screened", label: "Screened", align: "right" }, { key: "selected", label: "Selected", align: "right" }, { key: "selectedPct", label: "Sel %", unit: "percent", align: "right" }, { key: "joined", label: "Joined", align: "right" }, { key: "noShow", label: "No-show", align: "right" }],
      rows,
    }],
  };
};

const noShow: InsightSectionFn = async (ctx) => {
  const { candidates } = await loadCohort(ctx);
  const { cur, prev } = split(candidates, ctx.today);
  const c = noShowRate(cur, ctx.today);
  const p = noShowRate(prev, ctx.today);
  const href = pickHref(await allowedPageCodes(ctx), ["/ats/candidate-master"], drill("RECRUITER_ACTIVITY"));
  const daily = dailyCounts(cur.filter((x) => String(x.status).toLowerCase() === "no show").map((x) => x.walkInDate ?? x.createdDate), addDays(ctx.today, -1), 14);
  return {
    kpis: [{ key: "no_show_rate", label: "Walk-in no-show rate (30d)", value: c.ratePct, unit: "percent", higherIsBetter: false, delta: pp(c.ratePct, p.ratePct), deltaLabel: "vs previous 30d", spark: daily, tone: toneFor(c.ratePct, 15, 30, false), href,
      helper: `${c.noShow} no-show of ${c.due} due`, unavailable: c.due ? null : "no completed walk-in days in the window",
      formula: "Candidates marked No Show / candidates whose walk-in day (or registration day) is before today, last 30 days. Today is excluded. Sparkline = no-shows per day, last 14 days to yesterday." }],
    signals: c.ratePct !== null && c.ratePct >= 25 ? [{ tone: "bad", title: "High walk-in no-show rate", detail: `${c.ratePct}% of candidates due to attend were marked No Show (${c.noShow} of ${c.due}).`, value: `${c.ratePct}%`, href }] : [],
  };
};

const health: InsightSectionFn = async (ctx) => {
  const [{ candidates }, offers] = await Promise.all([loadCohort(ctx), loadOffers(ctx)]);
  const { cur } = split(candidates, ctx.today);
  const o = offerOutcomes(offers, ctx.today);
  const ns = noShowRate(cur, ctx.today);
  const parts: Array<[string, number | null]> = [["offer-to-join", o.offerToJoinPct], ["walk-in attendance (100 - no-show %)", ns.ratePct === null ? null : Math.round((100 - ns.ratePct) * 10) / 10], ["offers approved within 3 days (100 - stuck share)", o.awaitingCount ? Math.round((1 - o.awaitingOver3d / o.awaitingCount) * 1000) / 10 : null]];
  const have = parts.filter((p): p is [string, number] => p[1] !== null);
  return have.length ? { healthScore: Math.round(avg(have.map((p) => p[1])) as number), healthBasis: `Average of ${have.map((p) => `${p[0]} ${p[1]}%`).join(", ")}.` } : { healthScore: null, healthBasis: null };
};

const provider: InsightProvider = {
  sections: { funnel, today, offers: offersSection, joiners, onboarding, requisitions, sources, league, noShow, health },
};

export default provider;

/**
 * SBI Card Collections -- account-level operations view (pure calculations, no DB), fed by the latest snapshot of sbi_card_account_file.
 *
 * Built for the people running the floor: who has not been worked yet, how deep we have dialled, what is promised and what has
 * lapsed, which bucket / region / product / score band / call table holds the exposure and where it is converting.
 *
 * Definitions:
 *   exposure          total_amount_due (what the bank wants collected this cycle), summed.
 *   attempts          call slots 1..6 that carry a call time or a disposition; dial_cnt is used when the dialer counted more.
 *   worked            attempts > 0.   untouched = attempts = 0.   coverage % = worked / accounts.
 *   PTP account       any attempt dispositioned PTP, or last_action_code = PTP, or a last_ptp_date on file.
 *   overdue PTP       a PTP account whose last_ptp_date is before the snapshot day (a promise not yet honoured).
 *   overdue callback  callback_dt before the snapshot day, still on the file.
 *   exhausted         worked, no PTP, and at least EXHAUSTED_ATTEMPTS attempts: dialling harder is not paying, change the approach.
 * Empty denominators give 0, never NaN. Account numbers appear only in the three short worklists; phone numbers never leave the table.
 */
import { pct, round1 } from "./sbi-card-dashboard.calc.js";
import { chiSquareP } from "./sbi-card-stats.js";
import { CALL_WINDOW_LABEL, SBI_DISPOSITIONS, dispLabel, isExcludeAfterFirstPass, isLiveButNotCounted, CLIENT_CONTACT_CODES, isListed, isNoConversation, isPromise, outsideCallWindow, parseCallTable } from "./sbi-card-dispositions.js";

export const EXHAUSTED_ATTEMPTS = 4;
const MIN_AGENT_ATTEMPTS = 30;
const n0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number): number => Math.round(n * 100) / 100;

export interface AttemptIn { dt: string | null; disp: string | null; agent: string | null }
export interface AccountOpsRow {
  accountNo: string; delq: string | null; billingCycle: string | null; cibil: number | null; vintage: number | null;
  region: string | null; productClass: string | null; accountClass: string | null; callTable: string | null; promo: string | null;
  ntc: string | null; newToCard: string | null; totalDue: number | null; curBal: number | null;
  flow?: string | null;
  cd?: number | null; nrr?: string | null; lastPmtDate?: string | null; dpiBal?: number | null;
  lastActionCode: string | null; lastPtpDate: string | null; callbackDt: string | null; dnc: string | null; dialCnt: number | null;
  attempts: AttemptIn[];
}

export interface Bucket { accounts: number; exposure: number }
export interface OpsDimRow {
  key: string; accounts: number; exposure: number; worked: number; untouched: number; coveragePct: number; attemptsPerAccount: number;
  ptpAccounts: number; ptpPct: number; overduePtp: number; exhausted: number; dnc: number;
}
export interface OpsWorkItem { accountNo: string; delq: string | null; region: string | null; totalDue: number; attempts: number; lastActionCode: string | null; due: string | null }
export interface CollectionsOpsOut {
  snapshotDate: string | null;
  headline: {
    accounts: number; exposure: number; worked: number; untouched: number; untouchedExposure: number; coveragePct: number;
    attemptsTotal: number; attemptsPerAccount: number; attemptsPerWorked: number; ptpAccounts: number; ptpPct: number; ptpExposure: number;
    overduePtp: number; overduePtpExposure: number; ptpDueSoon: number; callbacksOverdue: number; callbacksUpcoming: number;
    exhausted: number; exhaustedExposure: number; dnc: number; dncExposure: number;
    /** Do-not-call accounts that still carry call attempts (a compliance breach to explain, not a performance metric). */
    dncDialled: number; dncDialledAttempts: number;
    /** Accounts whose last payment is 60+ days before the snapshot, with their amount due. */
    stalePayers: number; stalePayersExposure: number;
    /** Delinquent-payment interest accrued on top of the balance (cur_bal_plus_dpi - cur_bal). */
    dpiAccrued: number;
  };
  /** Every account in exactly one stage (first match wins): lapsed > promised > exhausted > untouched > in progress. Sums to the headline. */
  position: Array<{ stage: PositionStage; accounts: number; exposure: number }>;
  contactability: {
    attempts: number; noConversation: number; noConversationPct: number;
    /** Worked accounts with 3+ attempts where every attempt was NC / VOML / WN: the number or the channel is the problem, not the effort. */
    stuck: { accounts: number; exposure: number };
    voicemailRepeat: { accounts: number; exposure: number };
    wrongNumber: { accounts: number; exposure: number };
    byDate: Array<{ date: string; attempts: number; noConversationPct: number }>;
    /** The client's MIS definition of a contact (PTP, PAD, OTP, DS, RTP, CBL) versus live conversations it does not count. */
    clientContact: { attempts: number; pct: number; notCounted: { attempts: number; pct: number; codes: Array<{ code: string; label: string; attempts: number }> } };
    /** p-values (chi-square) for "do these segments really differ?"; null = too little data to say. Below 0.05 the split is worth acting on. */
    evidence: { hourDeadP: number | null; hourPtpP: number | null; agentPtpP: number | null };
    agentSpread: { agents: number; p25: number; median: number; p75: number; best: { agentId: string; ptpPct: number } | null; worst: { agentId: string; ptpPct: number } | null } | null;
  };
  dispositions: Array<{ code: string; label: string; listed: boolean; attempts: number; sharePct: number }>;
  /** What the client's rules say about how the dial list was worked: calling window, exclusions, welfare / dispute flags, high-intent customers. */
  compliance: {
    windowLabel: string;
    window: { attempts: number; outside: number; outsidePct: number; before: number; after: number };
    redialedAfterExclusion: { accounts: number; attempts: number; byCode: Array<{ code: string; label: string; accounts: number }> };
    welfare: { suicideThreat: Bucket; deceased: Bucket; dispute: Bucket; refusal: Bucket };
    intent: { settlement: Bucket; hardship: Bucket; languageBarrier: Bucket; paidAlready: Bucket };
    unlisted: { attempts: number; pct: number; codes: Array<{ code: string; attempts: number }> };
  };
  lastAction: Array<{ code: string; accounts: number; exposure: number }>;
  attemptDepth: Array<{ attempts: string; accounts: number; exposure: number; ptpAccounts: number; ptpPct: number }>;
  byHour: Array<{ hour: number; attempts: number; ptp: number; ptpPct: number; noConversationPct: number }>;
  agents: Array<{ agentId: string; attempts: number; accountsTouched: number; ptp: number; ptpPct: number }>;
  dimensions: Record<OpsDimKey, OpsDimRow[]>;
  /** Per dimension: does PTP yield / coverage differ between its segments by more than chance? */
  dimensionSignal: Record<OpsDimKey, { ptpP: number | null; coverageP: number | null }>;
  worklists: { untouched: OpsWorkItem[]; overduePtp: OpsWorkItem[]; overdueCallbacks: OpsWorkItem[] };
}

export type PositionStage = "promised" | "lapsed" | "exhausted" | "untouched" | "inProgress";
export const POSITION_STAGES: PositionStage[] = ["promised", "inProgress", "untouched", "exhausted", "lapsed"];
export function stageOf(e: { overduePtp: boolean; isPtp: boolean; exhausted: boolean; n: number }): PositionStage {
  if (e.overduePtp) return "lapsed";
  if (e.isPtp) return "promised";
  if (e.exhausted) return "exhausted";
  if (e.n === 0) return "untouched";
  return "inProgress";
}

export type OpsDimKey = "cd" | "program" | "flow" | "tier" | "nrr" | "recencyBand" | "balanceBand" | "delq" | "region" | "productClass" | "accountClass" | "cibilBand" | "vintageBand" | "callTable" | "billingCycle" | "customerType";
export const OPS_DIM_KEYS: OpsDimKey[] = ["cd", "program", "flow", "tier", "nrr", "recencyBand", "balanceBand", "delq", "region", "productClass", "accountClass", "cibilBand", "vintageBand", "callTable", "billingCycle", "customerType"];

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function cibilBand(score: number | null): string {
  if (score === null || !(score > 0)) return "No score";
  if (score < 600) return "<600";
  if (score < 650) return "600-649";
  if (score < 700) return "650-699";
  if (score < 750) return "700-749";
  return "750+";
}
export function vintageBand(v: number | null): string {
  if (v === null || v < 0) return "Unknown";
  if (v <= 30) return "0-30";
  if (v <= 60) return "31-60";
  if (v <= 90) return "61-90";
  return "90+";
}
/** Days between the last payment and the snapshot day, in the bands collections teams use to judge how cold an account is. */
export function recencyBand(lastPmt: string | null | undefined, snapshot: string | null): string {
  if (!lastPmt || !snapshot) return "No payment on file";
  const d = Math.floor((Date.parse(`${snapshot}T00:00:00Z`) - Date.parse(`${lastPmt.slice(0, 10)}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(d) || d < 0) return "No payment on file";
  if (d <= 15) return "0-15 days"; if (d <= 30) return "16-30 days"; if (d <= 45) return "31-45 days"; if (d <= 60) return "46-60 days";
  return "60+ days";
}
export function balanceBand(bal: number | null): string {
  if (bal === null || !(bal > 0)) return "No balance";
  if (bal < 25000) return "<25k"; if (bal < 50000) return "25k-50k"; if (bal < 100000) return "50k-1L"; return "1L+";
}
/** The dialer call tables encode the segment: "..._HB" high balance, "..._L_" low balance (e.g. ELEVATE_CD3_NTH_HB, EL_DEL_CD2_SBI_L_1_4_). */
export function tierOf(callTable: string | null): string {
  if (!callTable) return "Unknown";
  const t = parseCallTable(callTable).tier;
  return t === "HB" ? "High balance (HB)" : t === "HB1" ? "High balance (HB1)" : t === "Low" ? "Low balance (L)" : "Standard";
}
const customerType = (r: AccountOpsRow): string =>
  r.newToCard === "Y" ? "New to card" : r.ntc === "Y" ? "New to credit" : "Seasoned";

const dateOnly = (v: string | null): string | null => (v ? v.slice(0, 10) : null);

export interface Enriched {
  r: AccountOpsRow; n: number; stale: boolean; isPtp: boolean; due: number; overduePtp: boolean; exhausted: boolean; dnc: boolean;
}

export function enrich(r: AccountOpsRow, snapshot: string): Enriched {
  const stale = recencyBand(r.lastPmtDate, snapshot === "9999-12-31" ? null : snapshot) === "60+ days";
  const filled = r.attempts.filter((a) => a.dt || a.disp).length;
  const n = Math.max(filled, n0(r.dialCnt));
  const isPtp = r.attempts.some((a) => isPromise(a.disp)) || r.lastActionCode === "PTP" || !!r.lastPtpDate;
  const ptpDay = dateOnly(r.lastPtpDate);
  return {
    r, n, stale, isPtp, due: n0(r.totalDue), overduePtp: isPtp && !!ptpDay && ptpDay < snapshot,
    exhausted: n >= EXHAUSTED_ATTEMPTS && !isPtp, dnc: r.dnc === "Y",
  };
}

function dimRows(list: Enriched[], keyOf: (r: AccountOpsRow) => string): OpsDimRow[] {
  const m = new Map<string, Enriched[]>();
  for (const e of list) { const k = keyOf(e.r); const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); }
  return [...m.entries()].map(([key, es]) => {
    const worked = es.filter((e) => e.n > 0).length;
    const ptp = es.filter((e) => e.isPtp).length;
    return {
      key, accounts: es.length, exposure: money(es.reduce((s, e) => s + e.due, 0)), worked, untouched: es.length - worked,
      coveragePct: pct(worked, es.length), attemptsPerAccount: round1(es.reduce((s, e) => s + e.n, 0) / es.length),
      ptpAccounts: ptp, ptpPct: pct(ptp, worked), overduePtp: es.filter((e) => e.overduePtp).length,
      exhausted: es.filter((e) => e.exhausted).length, dnc: es.filter((e) => e.dnc).length,
    };
  });
}

const sortDim = (k: OpsDimKey, rows: OpsDimRow[]): OpsDimRow[] =>
  k === "callTable" || k === "customerType" || k === "region" || k === "productClass" || k === "accountClass"
    ? rows.sort((a, b) => b.exposure - a.exposure || natural(a.key, b.key))
    : rows.sort((a, b) => natural(a.key, b.key));

const topItems = (list: Enriched[], due: (e: Enriched) => string | null, limit: number): OpsWorkItem[] =>
  list.sort((a, b) => b.due - a.due).slice(0, limit).map((e) => ({
    accountNo: e.r.accountNo, delq: e.r.delq, region: e.r.region, totalDue: money(e.due), attempts: e.n, lastActionCode: e.r.lastActionCode, due: due(e),
  }));

export function collectionsOps(rows: AccountOpsRow[], snapshotDate: string | null, worklistLimit = 15): CollectionsOpsOut {
  const snap = snapshotDate ?? "9999-12-31";
  const list = rows.map((r) => enrich(r, snap));
  const worked = list.filter((e) => e.n > 0);
  const untouched = list.filter((e) => e.n === 0);
  const ptp = list.filter((e) => e.isPtp);
  const sum = (es: Enriched[]) => es.reduce((s, e) => s + e.due, 0);
  const attemptsTotal = list.reduce((s, e) => s + e.n, 0);
  const soonLimit = new Date(`${snap}T00:00:00Z`); soonLimit.setUTCDate(soonLimit.getUTCDate() + 3);
  const soon = Number.isNaN(soonLimit.getTime()) ? "9999-12-31" : soonLimit.toISOString().slice(0, 10);
  const cbOverdue = list.filter((e) => { const d = dateOnly(e.r.callbackDt); return !!d && d < snap; });
  const cbUpcoming = list.filter((e) => { const d = dateOnly(e.r.callbackDt); return !!d && d >= snap; });
  const overduePtp = list.filter((e) => e.overduePtp);
  const exhausted = list.filter((e) => e.exhausted);
  const dnc = list.filter((e) => e.dnc);
  const dncDialled = dnc.filter((e) => e.n > 0);
  const stale = list.filter((e) => e.stale);

  const disp = new Map<string, number>();
  const hour = new Map<number, { attempts: number; ptp: number; dead: number }>();
  const date = new Map<string, { attempts: number; dead: number }>();
  const agent = new Map<string, { attempts: number; ptp: number; accounts: Set<string> }>();
  let dispTotal = 0;
  for (const e of list) {
    for (const a of e.r.attempts) {
      if (!a.dt && !a.disp) continue;
      const isPtp = isPromise(a.disp);
      if (a.disp) { disp.set(a.disp, (disp.get(a.disp) ?? 0) + 1); dispTotal += 1; }
      if (a.dt) {
        const h = Number(a.dt.slice(11, 13));
        if (Number.isInteger(h) && h >= 0 && h <= 23) { const c = hour.get(h) ?? { attempts: 0, ptp: 0, dead: 0 }; c.attempts += 1; if (isPtp) c.ptp += 1; if (a.disp && isNoConversation(a.disp)) c.dead += 1; hour.set(h, c); }
        const day = a.dt.slice(0, 10); const dc = date.get(day) ?? { attempts: 0, dead: 0 }; dc.attempts += 1; if (a.disp && isNoConversation(a.disp)) dc.dead += 1; date.set(day, dc);
      }
      if (a.agent) {
        const c = agent.get(a.agent) ?? { attempts: 0, ptp: 0, accounts: new Set<string>() };
        c.attempts += 1; if (isPtp) c.ptp += 1; c.accounts.add(e.r.accountNo); agent.set(a.agent, c);
      }
    }
  }

  const last = new Map<string, { accounts: number; exposure: number }>();
  for (const e of list) {
    const k = e.r.lastActionCode ?? "No action";
    const c = last.get(k) ?? { accounts: 0, exposure: 0 }; c.accounts += 1; c.exposure += e.due; last.set(k, c);
  }

  const seqOf = (e: Enriched) => e.r.attempts.filter((a) => a.disp).map((a) => a.disp as string);
  const stuck = list.filter((e) => { const q = seqOf(e); return q.length >= 3 && q.every((c) => isNoConversation(c)); });
  const vmRepeat = list.filter((e) => seqOf(e).filter((c) => c === "VOML").length >= 2);
  const wrong = list.filter((e) => seqOf(e).includes("WN"));
  const deadAttempts = [...disp.entries()].filter(([c]) => isNoConversation(c)).reduce((n, [, v]) => n + v, 0);
  const quant = (xs: number[], q: number) => { const i = (xs.length - 1) * q; const lo = Math.floor(i); return round1(xs[lo]! + (xs[Math.min(lo + 1, xs.length - 1)]! - xs[lo]!) * (i - lo)); };
  const ranked = [...agent.entries()].filter(([, v]) => v.attempts >= MIN_AGENT_ATTEMPTS).map(([agentId, v]) => ({ agentId, ptpPct: pct(v.ptp, v.attempts) })).sort((a, b) => a.ptpPct - b.ptpPct);
  const ys = ranked.map((r) => r.ptpPct);

  const hourRows = [...hour.values()];
  const evidence = {
    hourDeadP: chiSquareP(hourRows.map((v) => [v.dead, v.attempts - v.dead] as [number, number])),
    hourPtpP: chiSquareP(hourRows.map((v) => [v.ptp, v.attempts - v.ptp] as [number, number])),
    agentPtpP: chiSquareP([...agent.values()].filter((v) => v.attempts >= MIN_AGENT_ATTEMPTS).map((v) => [v.ptp, v.attempts - v.ptp] as [number, number])),
  };

  // Client rules (mail of 24-Sep-2026): calling window, accounts that must leave the dial list after the first pass, welfare / dispute flags.
  const timed = list.map((e) => ({ e, a: e.r.attempts.filter((x) => x.dt).sort((p, q) => String(p.dt).localeCompare(String(q.dt))) }));
  let winAttempts = 0; let before = 0; let after = 0;
  const redial = new Map<string, number>(); let redialAccounts = 0; let redialAttempts = 0;
  for (const { a } of timed) {
    for (const x of a) { winAttempts += 1; const o = outsideCallWindow(x.dt); if (o === "before") before += 1; else if (o === "after") after += 1; }
    const first = a.findIndex((x) => isExcludeAfterFirstPass(x.disp));
    if (first >= 0 && first < a.length - 1) {
      redialAccounts += 1; redialAttempts += a.length - 1 - first;
      const code = a[first]!.disp as string; redial.set(code, (redial.get(code) ?? 0) + 1);
    }
  }
  const withCode = (codes: string[]): Bucket => { const es = list.filter((e) => e.r.attempts.some((a) => a.disp && codes.includes(a.disp))); return { accounts: es.length, exposure: money(sum(es)) }; };
  const unlistedCodes = [...disp.entries()].filter(([c]) => !isListed(c)).map(([code, attempts]) => ({ code, attempts })).sort((a, b) => b.attempts - a.attempts);
  const unlistedAttempts = unlistedCodes.reduce((n, c) => n + c.attempts, 0);
  const compliance: CollectionsOpsOut["compliance"] = {
    windowLabel: CALL_WINDOW_LABEL,
    window: { attempts: winAttempts, outside: before + after, outsidePct: pct(before + after, winAttempts), before, after },
    redialedAfterExclusion: { accounts: redialAccounts, attempts: redialAttempts, byCode: [...redial.entries()].map(([code, accounts]) => ({ code, label: dispLabel(code), accounts })).sort((a, b) => b.accounts - a.accounts) },
    welfare: { suicideThreat: withCode(["SUTH"]), deceased: withCode(["DS"]), dispute: withCode(["DISP"]), refusal: withCode(["RTP"]) },
    intent: { settlement: withCode(["WS"]), hardship: withCode(["WH"]), languageBarrier: withCode(["LB"]), paidAlready: withCode(["PAD"]) },
    unlisted: { attempts: unlistedAttempts, pct: pct(unlistedAttempts, dispTotal), codes: unlistedCodes },
  };

  const depthKey = (n: number) => (n >= 5 ? "5+" : String(n));
  const depth = new Map<string, Enriched[]>();
  for (const e of list) { const k = depthKey(e.n); const a = depth.get(k); if (a) a.push(e); else depth.set(k, [e]); }

  const dims = {} as Record<OpsDimKey, OpsDimRow[]>;
  const keyFns: Record<OpsDimKey, (r: AccountOpsRow) => string> = {
    program: (r) => (r.callTable ? parseCallTable(r.callTable).program : "Unknown"), flow: (r) => (r.flow ? r.flow.toUpperCase() : "NEW"),
    cd: (r) => (r.cd === null || r.cd === undefined ? "Unknown" : `CD${r.cd}`), tier: (r) => tierOf(r.callTable), nrr: (r) => r.nrr ?? "Unknown",
    recencyBand: (r) => recencyBand(r.lastPmtDate, snapshotDate), balanceBand: (r) => balanceBand(r.curBal),
    delq: (r) => r.delq ?? "Unknown", region: (r) => r.region ?? "Unknown", productClass: (r) => r.productClass ?? "Unknown",
    accountClass: (r) => r.accountClass ?? "Unknown", cibilBand: (r) => cibilBand(r.cibil), vintageBand: (r) => vintageBand(r.vintage),
    callTable: (r) => r.callTable ?? "Unknown", billingCycle: (r) => r.billingCycle ?? "Unknown", customerType,
  };
  for (const k of OPS_DIM_KEYS) dims[k] = sortDim(k, dimRows(list, keyFns[k]));
  const order = (k: OpsDimKey, o: string[]) => dims[k].sort((a, b) => o.indexOf(a.key) - o.indexOf(b.key));
  order("recencyBand", ["0-15 days", "16-30 days", "31-45 days", "46-60 days", "60+ days", "No payment on file"]);
  order("balanceBand", ["<25k", "25k-50k", "50k-1L", "1L+", "No balance"]);
  const cibilOrder = ["<600", "600-649", "650-699", "700-749", "750+", "No score"];
  dims.cibilBand.sort((a, b) => cibilOrder.indexOf(a.key) - cibilOrder.indexOf(b.key));
  const vintOrder = ["0-30", "31-60", "61-90", "90+", "Unknown"];
  dims.vintageBand.sort((a, b) => vintOrder.indexOf(a.key) - vintOrder.indexOf(b.key));

  const dimensionSignal = {} as CollectionsOpsOut["dimensionSignal"];
  for (const k of OPS_DIM_KEYS) {
    const r = dims[k].filter((x) => x.accounts > 0);
    dimensionSignal[k] = {
      ptpP: chiSquareP(r.filter((x) => x.worked > 0).map((x) => [x.ptpAccounts, x.worked - x.ptpAccounts] as [number, number])),
      coverageP: chiSquareP(r.map((x) => [x.worked, x.untouched] as [number, number])),
    };
  }
  return {
    snapshotDate,
    headline: {
      accounts: list.length, exposure: money(sum(list)), worked: worked.length, untouched: untouched.length,
      untouchedExposure: money(sum(untouched)), coveragePct: pct(worked.length, list.length), attemptsTotal,
      attemptsPerAccount: list.length ? round1(attemptsTotal / list.length) : 0, attemptsPerWorked: worked.length ? round1(attemptsTotal / worked.length) : 0,
      ptpAccounts: ptp.length, ptpPct: pct(ptp.length, worked.length), ptpExposure: money(sum(ptp)),
      overduePtp: overduePtp.length, overduePtpExposure: money(sum(overduePtp)),
      ptpDueSoon: ptp.filter((e) => { const d = dateOnly(e.r.lastPtpDate); return !!d && d >= snap && d <= soon; }).length,
      callbacksOverdue: cbOverdue.length, callbacksUpcoming: cbUpcoming.length,
      exhausted: exhausted.length, exhaustedExposure: money(sum(exhausted)), dnc: dnc.length, dncExposure: money(sum(dnc)),
      dncDialled: dncDialled.length, dncDialledAttempts: dncDialled.reduce((n, e) => n + e.n, 0),
      stalePayers: stale.length, stalePayersExposure: money(sum(stale)),
      dpiAccrued: money(rows.reduce((n, r) => n + Math.max(0, n0(r.dpiBal) - n0(r.curBal)), 0)),
    },
    position: POSITION_STAGES.map((stage) => {
      const es = list.filter((e) => stageOf(e) === stage);
      return { stage, accounts: es.length, exposure: money(sum(es)) };
    }),
    contactability: {
      attempts: dispTotal, noConversation: deadAttempts, noConversationPct: pct(deadAttempts, dispTotal),
      stuck: { accounts: stuck.length, exposure: money(sum(stuck)) },
      voicemailRepeat: { accounts: vmRepeat.length, exposure: money(sum(vmRepeat)) },
      wrongNumber: { accounts: wrong.length, exposure: money(sum(wrong)) },
      byDate: [...date.entries()].map(([d, v]) => ({ date: d, attempts: v.attempts, noConversationPct: pct(v.dead, v.attempts) })).sort((a, b) => a.date.localeCompare(b.date)),
      clientContact: (() => {
        const hit = [...disp.entries()].filter(([c]) => CLIENT_CONTACT_CODES.has(c)).reduce((n, [, v]) => n + v, 0);
        const live = [...disp.entries()].filter(([c]) => isLiveButNotCounted(c));
        const liveN = live.reduce((n, [, v]) => n + v, 0);
        return { attempts: hit, pct: pct(hit, dispTotal), notCounted: { attempts: liveN, pct: pct(liveN, dispTotal), codes: live.map(([code, attempts]) => ({ code, label: dispLabel(code), attempts })).sort((a, b) => b.attempts - a.attempts) } };
      })(),
      evidence,
      agentSpread: ranked.length >= 4 ? { agents: ranked.length, p25: quant(ys, 0.25), median: quant(ys, 0.5), p75: quant(ys, 0.75), best: ranked[ranked.length - 1]!, worst: ranked[0]! } : null,
    },
    compliance,
    dispositions: [...disp.entries()].map(([code, attempts]) => ({ code, label: dispLabel(code), listed: isListed(code), attempts, sharePct: pct(attempts, dispTotal) })).sort((a, b) => b.attempts - a.attempts),
    lastAction: [...last.entries()].map(([code, v]) => ({ code, accounts: v.accounts, exposure: money(v.exposure) })).sort((a, b) => b.accounts - a.accounts),
    attemptDepth: [...depth.entries()].map(([attempts, es]) => {
      const p = es.filter((e) => e.isPtp).length;
      return { attempts, accounts: es.length, exposure: money(sum(es)), ptpAccounts: p, ptpPct: pct(p, es.length) };
    }).sort((a, b) => natural(a.attempts, b.attempts)),
    byHour: [...hour.entries()].map(([h, v]) => ({ hour: h, attempts: v.attempts, ptp: v.ptp, ptpPct: pct(v.ptp, v.attempts), noConversationPct: pct(v.dead, v.attempts) })).sort((a, b) => a.hour - b.hour),
    agents: [...agent.entries()].map(([agentId, v]) => ({ agentId, attempts: v.attempts, accountsTouched: v.accounts.size, ptp: v.ptp, ptpPct: pct(v.ptp, v.attempts) }))
      .sort((a, b) => b.attempts - a.attempts || natural(a.agentId, b.agentId)),
    dimensions: dims,
    dimensionSignal,
    worklists: {
      untouched: topItems(untouched.filter((e) => !e.dnc), () => null, worklistLimit),
      overduePtp: topItems([...overduePtp], (e) => dateOnly(e.r.lastPtpDate), worklistLimit),
      overdueCallbacks: topItems([...cbOverdue], (e) => dateOnly(e.r.callbackDt), worklistLimit),
    },
  };
}

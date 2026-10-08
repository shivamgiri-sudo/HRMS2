/**
 * SBI Card Collections -- ad-hoc call lists (pure). The client's mail asks for "adhoc file running facilities, as and when required by
 * Business". A list is ACCOUNT NUMBERS ONLY, never a phone number (the client's PII rule), ranked by amount due, and never contains an
 * account that must not be called: do-not-call, deceased, dispute, or a welfare (suicide-threat) case.
 */
import { enrich, type AccountOpsRow, type Enriched } from "./sbi-card-collections-ops.calc.js";
import { dispLabel } from "./sbi-card-dispositions.js";

export const ADHOC_TYPES = ["lapsed-promises", "missed-callbacks", "untouched", "exhausted", "stuck", "settlement-hardship", "language"] as const;
export type AdhocType = (typeof ADHOC_TYPES)[number];
export const ADHOC_TITLES: Record<AdhocType, string> = {
  "lapsed-promises": "Lapsed promises", "missed-callbacks": "Missed callbacks", untouched: "Untouched accounts", exhausted: "Exhausted accounts (4+ attempts, no promise)",
  stuck: "Never reached a person (3+ attempts)", "settlement-hardship": "Settlement / hardship requests", language: "Language barrier",
};
const NEVER_CALL = ["DS", "SUTH", "DISP"];
const NO_CONVERSATION = new Set(["NC", "NAA", "WN", "VOML"]);

export interface AdhocRow { accountNo: string; cd: string; delq: string; amountDue: number; callTable: string; reason: string; priority: number }

const codes = (e: Enriched): string[] => e.r.attempts.map((a) => a.disp).filter((d): d is string => !!d);
const day = (v: string | null): string => (v ? v.slice(0, 10) : "");

export function adhocList(rows: AccountOpsRow[], snapshot: string, type: AdhocType): AdhocRow[] {
  const out: Array<Omit<AdhocRow, "priority">> = [];
  for (const r of rows) {
    const e = enrich(r, snapshot); const cs = codes(e);
    if (e.dnc || cs.some((c) => NEVER_CALL.includes(c))) continue;            // never recommend calling these
    let reason: string | null = null;
    switch (type) {
      case "lapsed-promises": if (e.overduePtp) reason = `Promise lapsed on ${day(r.lastPtpDate)}`; break;
      case "missed-callbacks": { const d = day(r.callbackDt); if (d && d < snapshot) reason = `Callback was due ${d}`; break; }
      case "untouched": if (e.n === 0) reason = "No call attempt yet"; break;
      case "exhausted": if (e.exhausted) reason = `${e.n} attempts, no promise`; break;
      case "stuck": if (cs.length >= 3 && cs.every((c) => NO_CONVERSATION.has(c))) reason = `${cs.length} attempts, never a conversation: change number or channel`; break;
      case "settlement-hardship": { const w = cs.find((c) => c === "WS" || c === "WH"); if (w) reason = `${dispLabel(w)}: hand to the ${w === "WS" ? "settlement" : "hardship"} desk`; break; }
      case "language": if (cs.includes("LB")) reason = "Language barrier: route to an agent who speaks the customer's language"; break;
    }
    if (reason) out.push({ accountNo: r.accountNo, cd: r.cd === null || r.cd === undefined ? "" : `CD${r.cd}`, delq: r.delq ?? "", amountDue: Math.round((r.totalDue ?? 0) * 100) / 100, callTable: r.callTable ?? "", reason });
  }
  return out.sort((a, b) => b.amountDue - a.amountDue || a.accountNo.localeCompare(b.accountNo)).map((x, i) => ({ ...x, priority: i + 1 }));
}

const q = (v: string | number): string => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV with a fixed header and no phone number anywhere. A leading formula character is neutralised so a spreadsheet cannot run it. */
export function adhocCsv(rows: AdhocRow[], reportDate: string): string {
  const safe = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);
  const head = ["PRIORITY", "ACCOUNT_NO", "CD", "DELQ1", "AMOUNT_DUE", "CALL_TABLE", "REASON", "REPORT_DATE"];
  return [head.join(","), ...rows.map((r) => [r.priority, safe(r.accountNo), r.cd, r.delq, r.amountDue, safe(r.callTable), safe(r.reason), reportDate].map(q).join(","))].join("\r\n") + "\r\n";
}

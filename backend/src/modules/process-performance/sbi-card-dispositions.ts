/**
 * SBI Card disposition plan and call-table naming, as set out in the client's mail of 24-Sep-2026 ("PII Information Restriction :
 * SFTP Automation"). The 17 user dispositions, what each means, and "Exclude After 1st pass" (the account must leave the dial list
 * once it carries that disposition). Codes seen in dialer exports but NOT in this plan (VOML, AU, CT, TC, TPC, EWS ...) are system
 * dispositions: they are reported as "not in SBI's plan" instead of being guessed at.
 */
export type DispGroup = "promise" | "positive" | "intent" | "paid" | "refusal" | "risk" | "callback" | "noConversation" | "routing";
export interface DispInfo { label: string; group: DispGroup; excludeAfterFirstPass: boolean }

export const SBI_DISPOSITIONS: Record<string, DispInfo> = {
  BCTP: { label: "Beyond Cycle Promise to Pay", group: "promise", excludeAfterFirstPass: true },
  CBL: { label: "Call Back Later", group: "callback", excludeAfterFirstPass: false },
  DISP: { label: "Dispute", group: "risk", excludeAfterFirstPass: true },
  DPTP: { label: "Delayed Promise to Pay", group: "promise", excludeAfterFirstPass: true },
  DS: { label: "Deceased Customer", group: "risk", excludeAfterFirstPass: true },
  LB: { label: "Language Barrier", group: "routing", excludeAfterFirstPass: false },
  NAA: { label: "No Answer User", group: "noConversation", excludeAfterFirstPass: false },
  NC: { label: "No Contact", group: "noConversation", excludeAfterFirstPass: false },
  OTP: { label: "Other Positive", group: "positive", excludeAfterFirstPass: true },
  PAD: { label: "Payment Already Paid", group: "paid", excludeAfterFirstPass: true },
  PTP: { label: "Promise To Pay", group: "promise", excludeAfterFirstPass: true },
  RTP: { label: "Refusal To Pay", group: "refusal", excludeAfterFirstPass: true },
  SUTH: { label: "Suicide Threat", group: "risk", excludeAfterFirstPass: true },
  TCBL: { label: "Third Party Call Back Later", group: "callback", excludeAfterFirstPass: false },
  WN: { label: "Wrong Number", group: "noConversation", excludeAfterFirstPass: false },
  WS: { label: "Want Settlement", group: "intent", excludeAfterFirstPass: true },
  WH: { label: "Want Hardship", group: "intent", excludeAfterFirstPass: true },
};

export const isListed = (code: string): boolean => code in SBI_DISPOSITIONS;
export const dispLabel = (code: string): string => SBI_DISPOSITIONS[code]?.label ?? "Not in SBI's disposition plan";
export const isPromise = (code: string | null | undefined): boolean => !!code && SBI_DISPOSITIONS[code]?.group === "promise";
export const isExcludeAfterFirstPass = (code: string | null | undefined): boolean => !!code && SBI_DISPOSITIONS[code]?.excludeAfterFirstPass === true;
/** No live conversation took place. VOML (voicemail left) is a system code outside the plan but is clearly a non-conversation. */
export const isNoConversation = (code: string | null | undefined): boolean => !!code && (SBI_DISPOSITIONS[code]?.group === "noConversation" || code === "VOML");

/**
 * The client's own definitions, recovered from their DIALER MIS workbook (SAMPLE_DIALER_MIS.xlsx): across all 37 data rows,
 * TOTAL Contacts = PTP + PAD + OTP + DS + RTP + CBL and TOTAL Promises = PTP + PAD, with zero error. The list predates the newer
 * dispositions (WS, WH, BCTP, DPTP, DISP, LB, TCBL ...), which the MIS does not count as contacts. Used to reconcile our numbers with
 * the figures SBI Card sees; our own analysis keeps the full disposition plan.
 */
export const CLIENT_CONTACT_CODES: ReadonlySet<string> = new Set(["PTP", "PAD", "OTP", "DS", "RTP", "CBL"]);
export const CLIENT_PROMISE_CODES: ReadonlySet<string> = new Set(["PTP", "PAD"]);
/** Live conversations in the disposition plan that the client's MIS does not count as a contact. */
export const isLiveButNotCounted = (code: string | null | undefined): boolean =>
  !!code && isListed(code) && !CLIENT_CONTACT_CODES.has(code) && !isNoConversation(code);

/** Agents must not place calls (dialer or manual) before 08:00 or after 18:55, per the client. Minutes since midnight. */
export const CALL_WINDOW = { startMin: 8 * 60, endMin: 18 * 60 + 55 } as const;
export const CALL_WINDOW_LABEL = "08:00-18:55";
export function minutesOfDay(dt: string | null | undefined): number | null {
  const m = /[ T](\d{2}):(\d{2})/.exec(String(dt ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const outsideCallWindow = (dt: string | null | undefined): "before" | "after" | null => {
  const m = minutesOfDay(dt);
  if (m === null) return null;
  return m < CALL_WINDOW.startMin ? "before" : m > CALL_WINDOW.endMin ? "after" : null;
};

export interface CallTableInfo { site: string | null; cd: number | null; program: string; tier: string; date: string | null }
/**
 * Call tables: new "MAS_AHM_CD3_FAT_S_HB1_DDMMYYYY", "MAS_AHM_CD3_STAB_HB_DDMMYYYY"; test / old "ELEVATE_CD3_NTH_HB", "EL_DEL_CD2_SBI_L_1_4_".
 * program = the treatment stream (FAT_S, STAB, PTP, CTC, JO, SBI, or Base); tier = HB / HB1 / Low / Standard. What FAT_S, CTC and HB1
 * stand for is the client's to confirm; they are carried as labels, not interpreted.
 */
export function parseCallTable(name: string | null | undefined): CallTableInfo {
  const t = String(name ?? "").toUpperCase();
  const date = (() => { const m = /(\d{2})(\d{2})(\d{4})_?$/.exec(t); if (!m) return null; const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2020 ? `${y}-${m[2]}-${m[1]}` : null; })();
  const cd = /CD(\d)/.exec(t);
  const site = /^(?:MAS|AL|EL)_([A-Z]{2,4})_/.exec(t)?.[1] ?? null;
  const program = /_FAT_S(_|$)/.test(t) ? "FAT_S" : /_STAB(_|$)/.test(t) ? "STAB" : /_PTP(_|$)/.test(t) ? "PTP" : /_CTC(_|$)/.test(t) ? "CTC" : /_JO(_|$)/.test(t) ? "JO" : /_SBI(_|$)/.test(t) ? "SBI" : "Base";
  const tier = /_HB1(_|$)/.test(t) ? "HB1" : /_HB(_|$)/.test(t) ? "HB" : /_L(_|$)/.test(t) ? "Low" : "Standard";
  return { site, cd: cd ? Number(cd[1]) : null, program, tier, date };
}

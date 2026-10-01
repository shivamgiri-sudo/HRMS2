/**
 * Turns the free-ish text people typed into the legacy HRMS "LeftReason" (96 distinct spellings:
 * "Absconded", "Abscond", "Batter Job", "ZTP Error", "Left by sudeep negi" ...) into the same coded
 * categories the exit workflow uses, so legacy and current exits chart together.
 *
 * It also infers voluntary / involuntary from the category, because the legacy mirror carries no
 * exit type. Anything that is not clearly one or the other stays null rather than guessed.
 */
export type ExitTypeGuess = "voluntary" | "involuntary" | null;
export interface LeavingReason { category: string; exitType: ExitTypeGuess }

const INVOLUNTARY = new Set(["absconding", "process_closure", "performance_action", "termination_misconduct"]);
const VOLUNTARY = new Set(["better_opportunity", "family_reasons", "relocation", "health_personal", "higher_education", "compensation", "work_environment", "dissatisfaction_management", "resignation_no_reason"]);

// Order matters: the first rule that matches wins, so the narrow phrases come before the broad ones.
const RULES: [RegExp, string][] = [
  [/abscond|no[\s-]?show|left by system|not reachable|unreachable|not responding/, "absconding"],
  [/process\s*(clos|ramp|shut|down)|ramp\s*down|ram+p?down|project\s*clos|client\s*(clos|ramp)|batch\s*clos/, "process_closure"],
  [/better\s*(opportunit|job|offer|pay|package)|batter\s*job|another\s*(option|job|offer|company)|other\s*(job|company)|got\s*(a\s*)?job|higher\s*(pay|package|salary)/, "better_opportunity"],
  [/perform|decertif|ztp|zero\s*tolerance|quality|target|not\s*able\s*to\s*(perform|cope)/, "performance_action"],
  [/asked?\s*to\s*leave|ask\s*to\s*leave|terminat|disciplin|behaviou?r|misconduct|fake|fraud|integrity|escalation|abuse|harass/, "termination_misconduct"],
  [/further\s*stud|higher\s*stud|stud(y|ies)|exam|education|college|course/, "higher_education"],
  [/salary|\bpay\b|ctc|incentive|compensation|hike|increment/, "compensation"],
  [/supervisor|\bmanager\b|team\s*leader|\btl\b|management|boss/, "dissatisfaction_management"],
  [/shift|timing|transport|commut|distance|travel|night|work\s*(load|pressure|environment)|denied\s*leave|leave\s*(issue|not)/, "work_environment"],
  [/relocat|shift(ed|ing)?\s*(to|city)|moving|migrat/, "relocation"],
  [/family|marriage|married|pregnan|maternity|child|parents?|husband|wife/, "family_reasons"],
  [/health|medical|ill(ness)?|expired|death|died|accident|surgery/, "health_personal"],
  [/personal/, "health_personal"],
  [/off[\s-]?roll|on[\s-]?roll|movement|transfer|rejoin|re-join/, "internal_transfer"],
  [/^resign(ed|ation|ing)?$|^resign\b|^left$|^leaving$/, "resignation_no_reason"],
];

const NOT_A_REASON = /^(na|n\/a|n\.a\.?|none|nil|null|0|-+|\.+|not\s*available|not\s*applicable|no\s*reason|unknown)$/i;

/** Every coded category: the ones above plus the exit workflow's own. A stored value that is already one is kept as is. */
const KNOWN = new Set([...new Set(RULES.map(([, c]) => c)), "other", "career_growth", "contract_end", "entrepreneurship", "family_reasons", "absconding"]);

/** An exit record's reason may be a coded category ("better_opportunity") or typed text ("Absconded"): unify them. */
export function canonicalReason(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (KNOWN.has(t)) return t;
  return normaliseLeavingReason(t)?.category ?? t;
}

export function normaliseLeavingReason(raw: string | null | undefined): LeavingReason | null {
  const text = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || NOT_A_REASON.test(text)) return null;
  for (const [re, category] of RULES) {
    if (re.test(text)) return { category, exitType: INVOLUNTARY.has(category) ? "involuntary" : VOLUNTARY.has(category) ? "voluntary" : null };
  }
  return { category: "other", exitType: null };
}

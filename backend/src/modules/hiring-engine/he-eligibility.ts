/**
 * Eligibility gate (pure): may this person be lined up for this requisition, and in what priority?
 * Facts are fetched by SQL elsewhere; every rule lives here so it is testable and cannot drift.
 */
export const REJECT_COOLING_DAYS = 90;
export const MAX_NO_SHOWS_PER_REQUISITION = 3;
export const MAX_APPROACHES_30D = 6;
export const STALE_DAYS = 180;
const MS_DAY = 86_400_000;

export interface PastRejection {
  /** Process the person was rejected in (free text from ATS / requisition). */
  process: string | null;
  /** ISO date of the rejection. */
  at: string | null;
  /** Reason text (hard-reject reasons block permanently). */
  reason?: string | null;
}

export interface EligibilityFacts {
  status: string;
  finalStatus: "none" | "rejected" | "selected" | "joined";
  isEmployee: boolean;
  age: number | null;
  lastAttemptDate: string | null;
  walkinCount: number;
  lastOutcome: string | null;
  approaches30d: number;
  /** Ex-employee facts when the number belongs to a former employee. */
  exEmployee?: { cleanVoluntary: boolean } | null;
  requisition: { processName: string | null };
  rejections: PastRejection[];
  /** Already selected / offered / booked / invited for THIS requisition. */
  alreadySelectedForRequisition: boolean;
  alreadyBookedForRequisition: boolean;
  noShowsForRequisition: number;
  now: Date;
}

export interface Eligibility {
  eligible: boolean;
  /** 1 = call first ... 9 = last (ex-employees). Meaningless when not eligible. */
  priority: number;
  blocks: string[];
  warnings: string[];
}

export function normProcess(v: string | null | undefined): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const HARD_REJECT = /misconduct|abus|fraud|fake|forg|theft|violen|absconding|blacklist|do not (re)?hire|threat/i;

export function isHardReject(reason: string | null | undefined): boolean {
  return HARD_REJECT.test(String(reason ?? ""));
}

function daysBetween(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / MS_DAY) : null;
}

export function evaluateEligibility(f: EligibilityFacts, opts: { coolingDays?: number } = {}): Eligibility {
  const coolingDays = opts.coolingDays ?? REJECT_COOLING_DAYS;
  const blocks: string[] = [];
  const warnings: string[] = [];

  if (f.status === "opted_out") blocks.push("opted_out");
  if (f.status === "dead") blocks.push("dead");
  if (f.status === "joined" || f.finalStatus === "joined") blocks.push("already_joined");
  if (f.isEmployee) blocks.push("current_employee");
  if (f.lastOutcome === "wrong_number") blocks.push("wrong_number");
  if (f.age !== null && f.age < 18) blocks.push("under_age");
  if (f.alreadySelectedForRequisition) blocks.push("already_selected_here");
  if (f.noShowsForRequisition >= MAX_NO_SHOWS_PER_REQUISITION) blocks.push("no_show_cap_here");
  if (f.approaches30d >= MAX_APPROACHES_30D) blocks.push("contact_cap_30d");

  const proc = normProcess(f.requisition.processName);
  if (proc) {
    for (const r of f.rejections) {
      if (normProcess(r.process) !== proc) continue;
      if (isHardReject(r.reason)) {
        blocks.push("hard_rejected_in_process");
        break;
      }
      if (coolingDays <= 0) continue; // cooling-off switched off by the owner; hard rejections above still block
      const age = daysBetween(r.at, f.now);
      if (age === null || age < coolingDays) {
        blocks.push("rejected_in_process_cooling");
        break;
      }
    }
  }

  if (f.exEmployee && !f.exEmployee.cleanVoluntary) blocks.push("ex_employee_not_eligible");

  if (blocks.length) return { eligible: false, priority: 99, blocks: [...new Set(blocks)], warnings };

  if (f.finalStatus === "rejected") warnings.push("rejected_elsewhere");
  const sinceAttempt = daysBetween(f.lastAttemptDate, f.now);
  const stale = sinceAttempt !== null && sinceAttempt > STALE_DAYS;
  if (stale) warnings.push("stale_contact");
  if (f.exEmployee) warnings.push("former_employee");

  let priority = 3;
  if (f.exEmployee) priority = 9;
  else if (f.alreadyBookedForRequisition || f.status === "confirmed" || f.status === "invited" || f.status === "interested" || f.lastOutcome === "interested") priority = 1;
  else if (f.walkinCount > 0 && f.finalStatus !== "rejected") priority = 2;
  else if (stale) priority = 4;

  return { eligible: true, priority, blocks: [], warnings };
}

export interface ExitFacts {
  exitType: string | null;
  exitSubType: string | null;
  reasonCategory: string | null;
  employmentStatus: string | null;
  disciplinaryFlag: boolean;
}

/** Former employee we may message (always last priority): voluntary resignation, nothing adverse on record. */
export function isCleanVoluntary(x: ExitFacts): boolean {
  if (x.disciplinaryFlag) return false;
  if (String(x.exitType ?? "").toLowerCase() !== "voluntary") return false;
  if (String(x.exitSubType ?? "").toLowerCase() !== "resignation") return false;
  const adverse = /terminat|misconduct|performance_action|abscond|abandon|did_not_join|disciplin/i;
  if (adverse.test(String(x.reasonCategory ?? ""))) return false;
  if (/terminat|abscond|not_joined/i.test(String(x.employmentStatus ?? ""))) return false;
  return true;
}

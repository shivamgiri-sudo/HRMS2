/**
 * Drive credit for selected / joined, the same for every source type (meta_live, meta_old, he). A person counts as selected or joined
 * THROUGH A DRIVE only when both hold:
 * 1. arrival is proven: their he_match on that drive is in state 'arrived' or 'selected';
 * 2. the selection / joining event is timed on or after the drive's drive_date (IST wall clock; a DATETIME compared with the DATE is
 *    compared with its 00:00:00). The current state must still say selected / joined, and the event time comes from:
 *    - he_match.state = 'selected': he_match.updated_at (the row has no selected_at; its last change is the selection or later);
 *    - he_lead.status = 'joined': he_lead.status_at;
 *    - ATS current_stage in SELECTED_STAGES / JOINED_STAGES: an ats_candidate_stage_log row into such a stage with stage_date on or after
 *      the drive date; for a join also ats_onboarding_bridge.joining_date on or after the drive date.
 *    A stage with no such timestamp is never credited (old walk-ins imported with a stage label and no history stay out).
 * A join is also a selection. The stage log and onboarding bridge are reached by candidate id only (idx_stage_log_cand, candidate_id).
 */
export const SELECTED_STAGES = ["selected", "offered", "offer", "offer_approved", "onboarded", "converted"] as const;
export const JOINED_STAGES = ["joined", "payroll_validated"] as const;

const list = (xs: readonly string[]): string => xs.map((x) => `'${x}'`).join(",");
const ARRIVED_STATES = "('arrived','selected')";

export interface CreditAliases { m: string; d: string; hl: string; ac: string }

/** CASE-ready boolean SQL for the two flags; `d` is the drive of the match `m`. */
export function driveCreditSql(a: CreditAliases): { joined: string; selected: string } {
  const after = (col: string): string => `${col} >= ${a.d}.drive_date`;
  const logged = (stages: readonly string[]): string =>
    `EXISTS (SELECT 1 FROM ats_candidate_stage_log sl WHERE sl.candidate_id = ${a.ac}.id AND LOWER(sl.to_stage) IN (${list(stages)}) AND ${after("sl.stage_date")})`;
  const arrived = `${a.m}.state IN ${ARRIVED_STATES}`;
  const joinedEvent = `(${a.hl}.status = 'joined' AND ${after(`${a.hl}.status_at`)})`
    + ` OR (LOWER(${a.ac}.current_stage) IN (${list(JOINED_STAGES)}) AND (${logged(JOINED_STAGES)}`
    + ` OR EXISTS (SELECT 1 FROM ats_onboarding_bridge ob WHERE ob.candidate_id = ${a.ac}.id AND ${after("ob.joining_date")})))`;
  const joined = `(${arrived} AND (${joinedEvent}))`;
  const selectedEvent = `(${a.m}.state = 'selected' AND ${after(`${a.m}.updated_at`)})`
    + ` OR (LOWER(${a.ac}.current_stage) IN (${list(SELECTED_STAGES)}) AND ${logged([...SELECTED_STAGES, ...JOINED_STAGES])})`;
  return { joined, selected: `(${joined} OR (${arrived} AND (${selectedEvent})))` };
}

/** The same rule over plain facts (the specification the SQL above is tested against). Times are IST 'YYYY-MM-DD[ HH:MM:SS]'. */
export interface CreditFacts {
  driveDate: string | null; matchState: string | null; matchUpdatedAt: string | null; leadStatus: string | null; leadStatusAt: string | null;
  atsStage: string | null; stageLog: Array<{ toStage: string; at: string }>; joiningDate: string | null;
}
export function creditedOutcome(f: CreditFacts): { selected: boolean; joined: boolean } {
  const dd = f.driveDate;
  if (!dd || !(f.matchState === "arrived" || f.matchState === "selected")) return { selected: false, joined: false };
  const after = (t: string | null): boolean => t !== null && t.slice(0, 10) >= dd;
  const stage = (f.atsStage ?? "").toLowerCase();
  const inList = (xs: readonly string[], s: string): boolean => xs.includes(s);
  const logged = (xs: readonly string[]): boolean => f.stageLog.some((r) => inList(xs, r.toStage.toLowerCase()) && after(r.at));
  const joined = (f.leadStatus === "joined" && after(f.leadStatusAt))
    || (inList(JOINED_STAGES, stage) && (logged(JOINED_STAGES) || after(f.joiningDate)));
  const selected = joined
    || (f.matchState === "selected" && after(f.matchUpdatedAt))
    || (inList(SELECTED_STAGES, stage) && logged([...SELECTED_STAGES, ...JOINED_STAGES]));
  return { selected, joined };
}

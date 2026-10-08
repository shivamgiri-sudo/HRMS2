import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Guards transitions of ats_candidate.current_stage.
 *
 * This previously governed a vocabulary — Applied, Screening, HR Interview,
 * Selected, Offered, Joined... — that the live recruiter flow has never
 * written. The real writer (ats-full-parity/recruiterInterview.service.ts)
 * uses a completely different set: Arrival, Round 1- HR Screening,
 * Interview - Skill Test, Round 2- Op's, Round 3- Client, Selection
 * Discussion (confirmed against live ats_candidate data). Because none of
 * those appeared in ALLOWED_TRANSITIONS, `allowed` was always undefined and
 * the guard below was skipped entirely — any transition committed, including
 * moving a candidate whose outcome was already 'Rejected' straight to a
 * terminal stage.
 *
 * Two things changed to close that:
 *
 *   1. The vocabulary here now matches what current_stage actually holds in
 *      production.
 *   2. The real system tracks round (`current_stage`) and outcome (`status`)
 *      separately — a candidate can sit at "Selection Discussion" with
 *      status 'Selected', 'Rejected' or 'Waiting'. This machine only ever
 *      inspected `current_stage`, so a Rejected outcome never blocked
 *      anything. It now also reads `status` and refuses to move a candidate
 *      whose outcome is already Rejected, regardless of what transition was
 *      requested.
 *
 * An unrecognised `current_stage` value (there is some legacy stray data —
 * "Interview", "New", "converted" — from earlier imports, each a handful of
 * rows) now fails the transition rather than silently permitting it. That is
 * a deliberate reversal: unrecognised used to mean "allow anything"; it now
 * means "refuse, and say why" until someone normalises the row by hand.
 *
 * Note: this endpoint (POST /api/ats/candidates/:id/move-stage) is not called
 * from any frontend screen today — confirmed by search. Outcome-setting
 * (Selected/Rejected/Hold/etc.) happens through interview.service.ts and
 * recruiterInterview.service.ts writing `status` directly; they do not call
 * this function. Tightening it therefore carries no UI regression risk, but it
 * also means this guard alone does not make those other writers safe — see the
 * hiring-chain audit for the writers that still bypass it.
 */

// Round-by-round progression actually written by the recruiter flow.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  "Applied":                ["Arrival", "Round 1- HR Screening"],
  "Arrival":                ["Round 1- HR Screening"],
  "Round 1- HR Screening":  ["Interview - Skill Test", "Round 2- Op's"],
  "Interview - Skill Test": ["Round 2- Op's"],
  "Round 2- Op's":          ["Round 3- Client", "Selection Discussion"],
  "Round 3- Client":        ["Selection Discussion"],
  // Terminal for this machine: the outcome (Selected/Rejected/Waiting) is
  // carried on `status`, not `current_stage`, from here on. Progressing to an
  // actual employee happens through offer approval and employee-code
  // generation, not through this endpoint.
  "Selection Discussion":   [],
  // Set only by employee-code generation (employee-creation-orchestrator);
  // nothing should move a candidate further after that.
  "Onboarded":              [],
};

const TERMINAL_STAGES = new Set(["Onboarded"]);

/** Case/spacing variants seen in production data, mapped onto the real value. */
const STAGE_ALIASES: Record<string, string> = {
  applied: "Applied",
  arrival: "Arrival",
  arrived: "Arrival",
  "round 1- hr screening": "Round 1- HR Screening",
  "round 1 - hr screening": "Round 1- HR Screening",
  "interview - skill test": "Interview - Skill Test",
  "round 2- op's": "Round 2- Op's",
  "round 2 - op's": "Round 2- Op's",
  "round 3- client": "Round 3- Client",
  "round 3 - client": "Round 3- Client",
  "selection discussion": "Selection Discussion",
  onboarded: "Onboarded",
};

/** Outcomes on `status` that block any further stage movement. */
const BLOCKING_STATUSES = new Set(["rejected"]);

export interface TransitionResult {
  success: boolean;
  message: string;
  candidateId?: string;
  fromStage?: string;
  toStage?: string;
}

export async function transitionCandidateState(
  candidateId: string,
  toStage: string,
  userId: string,
  remarks?: string,
): Promise<TransitionResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, current_stage, status FROM ats_candidate WHERE id = ? LIMIT 1",
    [candidateId],
  );
  const candidate = (rows as RowDataPacket[])[0];
  if (!candidate) {
    return { success: false, message: `Candidate ${candidateId} not found` };
  }

  const fromStage: string = candidate.current_stage ?? "Applied";
  const currentStatus = String(candidate.status ?? "").trim().toLowerCase();

  if (BLOCKING_STATUSES.has(currentStatus)) {
    return {
      success: false,
      message: `Cannot move candidate: outcome is already "${candidate.status}"`,
    };
  }

  const normalizeStage = (s: string) => {
    const trimmed = s.trim();
    const alias = STAGE_ALIASES[trimmed.toLowerCase()];
    if (alias) return alias;
    return Object.keys(ALLOWED_TRANSITIONS).find(
      (k) => k.toLowerCase() === trimmed.toLowerCase(),
    ) ?? trimmed;
  };

  const normFrom = normalizeStage(fromStage);
  const normTo = normalizeStage(toStage);

  if (TERMINAL_STAGES.has(normFrom)) {
    return {
      success: false,
      message: `Cannot move candidate from terminal stage "${normFrom}"`,
    };
  }

  const allowed = ALLOWED_TRANSITIONS[normFrom];
  if (!allowed) {
    // Unrecognised source stage. Failing closed is the point of this rewrite
    // — the old code treated this as "no restriction" and let anything
    // through.
    return {
      success: false,
      message: `"${normFrom}" is not a recognised stage; the transition was refused rather than allowed unconditionally`,
    };
  }
  if (!allowed.map((a) => a.toLowerCase()).includes(normTo.toLowerCase())) {
    return {
      success: false,
      message: `Transition from "${normFrom}" to "${normTo}" is not allowed`,
    };
  }

  // Commit the transition
  await db.execute(
    "UPDATE ats_candidate SET current_stage = ?, updated_at = NOW() WHERE id = ?",
    [normTo, candidateId],
  );

  // Append stage log
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, stage_date, remarks, updated_by)
     VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
    [randomUUID(), candidateId, fromStage, normTo, remarks ?? null, userId],
  );

  return {
    success: true,
    message: `Moved from "${normFrom}" to "${normTo}"`,
    candidateId,
    fromStage,
    toStage: normTo,
  };
}

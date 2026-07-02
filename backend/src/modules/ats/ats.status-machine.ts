import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Valid ATS stage transitions: from -> allowed tos
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  "Applied":         ["Screening", "Rejected", "Hold"],
  "Screening":       ["Written Test", "HR Interview", "Rejected", "Hold"],
  "Written Test":    ["HR Interview", "Rejected", "Hold"],
  "HR Interview":    ["Manager Interview", "Operations Interview", "Selected", "Rejected", "Hold"],
  "Manager Interview":    ["Operations Interview", "Selected", "Rejected", "Hold"],
  "Operations Interview": ["Selected", "Rejected", "Hold"],
  "Selected":        ["Offered", "Rejected", "Hold"],
  "Offered":         ["Joined", "Declined", "Rejected", "Hold"],
  "Hold":            ["Screening", "Written Test", "HR Interview", "Manager Interview", "Operations Interview", "Selected", "Offered", "Rejected"],
  "Declined":        ["Hold"],
  "Rejected":        [],
  "Joined":          [],
};

// Stages that are final (no further movement except Hold override by admin)
const TERMINAL_STAGES = new Set(["Joined", "Rejected"]);

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
    "SELECT id, current_stage FROM ats_candidate WHERE id = ? LIMIT 1",
    [candidateId],
  );
  const candidate = (rows as RowDataPacket[])[0];
  if (!candidate) {
    return { success: false, message: `Candidate ${candidateId} not found` };
  }

  const fromStage: string = candidate.current_stage ?? "Applied";

  // Normalise case for lookup
  const normalizeStage = (s: string) =>
    Object.keys(ALLOWED_TRANSITIONS).find(
      (k) => k.toLowerCase() === s.trim().toLowerCase(),
    ) ?? s.trim();

  const normFrom = normalizeStage(fromStage);
  const normTo   = normalizeStage(toStage);

  if (TERMINAL_STAGES.has(normFrom)) {
    return {
      success: false,
      message: `Cannot move candidate from terminal stage "${normFrom}"`,
    };
  }

  const allowed = ALLOWED_TRANSITIONS[normFrom];
  if (allowed && !allowed.map((a) => a.toLowerCase()).includes(normTo.toLowerCase())) {
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

import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { NON_REACTIVATABLE_STATUSES } from "../../exit/exitEmploymentStatus.js";
import { evaluateRehire, type RehireVerdict } from "./rehireEligibility.js";
import { loadRehireFacts, type SqlExecutor } from "./rehireFacts.js";

export interface ReturningLeaver {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  employmentStatus: string;
}

export type LeaverOutcome =
  | { action: "none" }
  | { action: "block_rejoin_required"; reason: string }
  | { action: "block_not_allowed"; reason: string }
  | { action: "allow_fresh_onboarding"; warning: string };

/**
 * A leaver is someone who actually worked here and left. 'not_joined' is in the exit module's
 * non-reactivatable list but is NOT a leaver (an id was created and the person never started), so it is
 * excluded here: they are a normal fresh hire.
 */
const LEAVER_STATUSES = NON_REACTIVATABLE_STATUSES.filter((s) => s !== "not_joined");
const STATUS_SQL = LEAVER_STATUSES.map((s) => `'${s}'`).join(", "); // compile-time literals

const normPan = (v: unknown) => String(v ?? "").trim().toUpperCase();
const normAadhaar = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * The existing duplicate-identity check (orchestrator findActiveEmployeeByStatutoryId) matches only
 * active_status = 1, so a LEAVER matched nothing and silently became a second employee record. This is the
 * missing half: match by PAN / Aadhaar against people who left. Raw columns, because pan_blind_index is
 * empty on every employee row.
 */
export async function findReturningLeaverForCandidate(db: SqlExecutor, candidateId: string): Promise<ReturningLeaver | null> {
  const [cand] = await db.execute<RowDataPacket[]>(
    `SELECT pan_number, aadhar_number FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId],
  );
  const pan = normPan(cand[0]?.pan_number);
  const aadhaar = normAadhaar(cand[0]?.aadhar_number);
  if (!pan && !aadhaar) return null;

  const clauses: string[] = [];
  const params: string[] = [];
  if (pan) {
    clauses.push(`(e.pan_number IS NOT NULL AND e.pan_number <> '' AND UPPER(e.pan_number) = ?)`);
    clauses.push(`(s.pan_number IS NOT NULL AND s.pan_number <> '' AND UPPER(s.pan_number) = ?)`);
    params.push(pan, pan);
  }
  if (aadhaar) {
    clauses.push(`(e.aadhaar_number IS NOT NULL AND e.aadhaar_number <> '' AND REPLACE(e.aadhaar_number, ' ', '') = ?)`);
    clauses.push(`(s.aadhaar_id IS NOT NULL AND s.aadhaar_id <> '' AND REPLACE(s.aadhaar_id, ' ', '') = ?)`);
    params.push(aadhaar, aadhaar);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS full_name, e.employment_status
       FROM employees e
       LEFT JOIN employee_statutory_info s ON s.employee_id = e.id
      WHERE e.active_status = 0
        AND LOWER(COALESCE(e.employment_status, '')) IN (${STATUS_SQL})
        AND (${clauses.join(" OR ")})
      ORDER BY e.date_of_exit DESC
      LIMIT 1`,
    params,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    employeeId: String(r.id),
    employeeCode: String(r.employee_code),
    fullName: String(r.full_name ?? "").trim(),
    employmentStatus: String(r.employment_status ?? ""),
  };
}

// Reasons that mean "this person must not come back", as opposed to "the gap is too long for a quick rejoin".
const GAP_ONLY_CODES = new Set(["GAP_EXCEEDS_30", "REJOIN_BEFORE_EXIT"]);

export function decideLeaverOutcome(leaver: ReturningLeaver, verdict: RehireVerdict): LeaverOutcome {
  const who = `${leaver.fullName} (${leaver.employeeCode}, ${leaver.employmentStatus})`;

  const conductBlock = verdict.reasons.find((r) => r.severity === "blocked" && !GAP_ONLY_CODES.has(r.code));
  if (conductBlock) {
    return {
      action: "block_not_allowed",
      reason: `This candidate is the former employee ${who}, who cannot be rehired: ${conductBlock.message} A new employee record cannot be created for them.`,
    };
  }
  if (verdict.requiresFreshOnboarding) {
    return {
      action: "allow_fresh_onboarding",
      warning: `This candidate is the former employee ${who}, away for more than 30 days, so fresh onboarding is allowed. Link the new record to ${leaver.employeeCode} for history.`,
    };
  }
  return {
    action: "block_rejoin_required",
    reason: `This candidate is the former employee ${who}. Raise a rejoin request for ${leaver.employeeCode} (Employees > Reactivation) instead of creating a new employee record.`,
  };
}

export interface LeaverCheck {
  outcome: LeaverOutcome;
  leaver: ReturningLeaver | null;
  warning?: string;
}

/**
 * One call for the orchestrator. Fails OPEN: if the lookup errors, conversion continues with a warning,
 * because failing closed would stop all hiring on a transient query error.
 */
export async function checkReturningLeaver(conn: SqlExecutor | PoolConnection, candidateId: string, joiningDate: string | null): Promise<LeaverCheck> {
  // A PoolConnection's execute() has stricter param typing than SqlExecutor but is call-compatible.
  const db = conn as unknown as SqlExecutor;
  try {
    const leaver = await findReturningLeaverForCandidate(db, candidateId);
    if (!leaver) return { outcome: { action: "none" }, leaver: null };
    const proposed = (joiningDate ?? new Date().toISOString()).slice(0, 10);
    const loaded = await loadRehireFacts(db, leaver.employeeId, proposed);
    if (!loaded) return { outcome: { action: "none" }, leaver: null };
    return { outcome: decideLeaverOutcome(leaver, evaluateRehire(loaded.facts)), leaver };
  } catch (err) {
    console.error(`[returning-leaver] check failed for candidate ${candidateId}:`, (err as Error).message);
    return { outcome: { action: "none" }, leaver: null, warning: "Could not check whether this candidate is a former employee." };
  }
}

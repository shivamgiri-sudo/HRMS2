/**
 * Keeps job_requisition.joined_headcount equal to the number of distinct employees (employee code generated) reached through the
 * requisition's two candidate paths: ats_candidate.requisition_id and the job_requisition_candidate junction. Writes only the rows whose
 * number changed. Runs from the engine tick; never throws.
 */
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

const SQL = `
  UPDATE job_requisition jr
  LEFT JOIN (
    SELECT u.rid, COUNT(DISTINCT u.eid) AS n FROM (
      SELECT c.requisition_id AS rid, ob.employee_id AS eid
        FROM ats_candidate c JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id AND ob.employee_id IS NOT NULL
        JOIN employees e ON e.id = ob.employee_id AND e.employee_code IS NOT NULL AND e.employee_code <> ''
       WHERE c.requisition_id IS NOT NULL
      UNION
      SELECT jrc.requisition_id AS rid, ob.employee_id AS eid
        FROM job_requisition_candidate jrc JOIN ats_onboarding_bridge ob ON ob.candidate_id = jrc.candidate_id AND ob.employee_id IS NOT NULL
        JOIN employees e ON e.id = ob.employee_id AND e.employee_code IS NOT NULL AND e.employee_code <> ''
    ) u GROUP BY u.rid
  ) x ON x.rid = jr.id
  SET jr.joined_headcount = COALESCE(x.n, 0)
  WHERE jr.joined_headcount <> COALESCE(x.n, 0)`;

export async function refreshJoinedHeadcount(): Promise<number> {
  try {
    const [r] = await db.execute<ResultSetHeader>(SQL);
    const n = Number(r.affectedRows ?? 0);
    if (n > 0) logger.info({ updated: n }, "[requisition-joined] joined counts refreshed");
    return n;
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 140) }, "[requisition-joined] refresh failed");
    return 0;
  }
}

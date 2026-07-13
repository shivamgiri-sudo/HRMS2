import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { atsService } from "./ats.service.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";

export interface ConvertResult {
  employee_id: string;
  employee_code: string;
}

export async function convertCandidateToEmployee(
  candidateId: string,
  actorId: string
): Promise<ConvertResult> {
  const candidate = await atsService.getCandidate(candidateId);
  if (!candidate.active_status) throw new Error("Candidate is not active");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ob.employee_id, e.employee_code, r.status AS request_status
     FROM ats_onboarding_bridge ob
     LEFT JOIN employees e ON e.id = ob.employee_id
     LEFT JOIN ats_onboarding_request r ON r.candidate_id = ob.candidate_id
     WHERE ob.candidate_id = ?
     LIMIT 1`,
    [candidateId]
  );
  const bridge = rows[0];
  if (bridge?.employee_id && bridge?.employee_code) {
    try {
      const lmsResult = await provisionLmsIdentityForEmployee({
        employeeCode: String(bridge.employee_code),
        createdBy: actorId,
      });
      if (lmsResult.message) {
        console.info(`[ATS] LMS provisioning for ${bridge.employee_code}: ${lmsResult.message}`);
      }
    } catch (err) {
      console.warn(
        `[ATS] LMS provisioning skipped for ${bridge.employee_code}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    return {
      employee_id: String(bridge.employee_id),
      employee_code: String(bridge.employee_code),
    };
  }

  const error = new Error(
    "Employee creation happens automatically after the employment offer is approved. Complete onboarding, submit the offer, and obtain branch-head approval."
  );
  Object.assign(error, {
    statusCode: 409,
    code: "OFFER_APPROVAL_REQUIRED",
    actorId,
  });
  throw error;
}

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { atsService } from "./ats.service.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";
import { queueJoiningKit, dispatchJoiningKit } from "../employees/joiningKitDispatch.service.js";

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

    // Send the joining kit here too, not only from employee creation.
    //
    // createEmployeeFromCandidate auto-dispatches the kit for anyone created
    // after that was wired in, but this function creates nobody — it returns an
    // employee the orchestrator already made. So a joiner created before
    // auto-dispatch existed, or one whose kit blocked at creation time on a
    // reason since resolved, never receives it: HR presses "generate employee
    // code" in the Joining Control Room, gets a code back, and no kit goes out.
    // Both callers of this function are explicit HR POST actions, so a send is
    // always intended here.
    //
    // Deliberately NOT calling autoGenerateJoiningDocuments first, as the
    // orchestrator does. attachGeneratedArtifact resets checklist status to
    // 'draft_generated' for every document it regenerates, which on an existing
    // employee would downgrade documents that are already esign_completed. The
    // kit is assembled from whatever drafts exist; if some are missing it blocks
    // with draft_missing and names them, which is a work list rather than a
    // silent corruption of signed records.
    //
    // Safe to repeat: queueJoiningKit returns the open kit rather than making a
    // second one, dispatchJoiningKit answers 'already_open' for a kit that is
    // sent or signed, and kitEligibleDocuments excludes anything already signed.
    // So a double click cannot bill the provider twice.
    void queueJoiningKit({
      employeeId: String(bridge.employee_id),
      candidateId,
      actorUserId: actorId,
      triggerSource: 'joining_control_room',
    })
      .then(({ kitId }) => dispatchJoiningKit(kitId, actorId))
      .then((outcome) => {
        console.log(`[ATS] Joining kit dispatch: ${outcome.status}`, {
          employeeCode: bridge.employee_code,
          blockedReason: outcome.blockedReason ?? null,
        });
      })
      .catch((err: unknown) => {
        // no_documents is the ordinary answer for someone whose documents are
        // all signed already, not a fault worth an error-level line.
        const code = (err as { code?: string })?.code;
        console[code === 'no_documents' ? 'info' : 'error'](
          `[ATS] Joining kit not sent for ${bridge.employee_code}:`,
          err instanceof Error ? err.message : String(err),
        );
      });

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

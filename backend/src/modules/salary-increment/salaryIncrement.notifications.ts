/**
 * Salary-increment notifications.
 *
 * Registered event `salary_increment_letter` (notification_event_config) had zero call
 * sites anywhere in the codebase — this module wires it to the one lifecycle point where
 * an increment becomes real: salaryIncrementService.transition(id, "implement"), which
 * flips employee_salary_assignment to the new CTC.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { notificationGateway } from "../communication/notification.gateway.js";

interface IncrementContextRow extends RowDataPacket {
  employee_id: string;
  branch_id: string | null;
  process_id: string | null;
  proposed_ctc: number;
  current_ctc: number;
  increment_percentage: number;
  effective_from: string;
}

/** Increment implemented — the new CTC is now active. */
export async function notifySalaryIncrementLetter(requestId: string): Promise<void> {
  try {
    const [rows] = await db.execute<IncrementContextRow[]>(
      `SELECT sir.employee_id, e.branch_id, e.process_id,
              sir.proposed_ctc, sir.current_ctc, sir.increment_percentage, sir.effective_from
         FROM salary_increment_request sir
         JOIN employees e ON e.id = sir.employee_id
        WHERE sir.id = ? LIMIT 1`,
      [requestId],
    );
    const r = rows[0];
    if (!r) return;
    await notificationGateway.notify({
      eventCode: "salary_increment_letter",
      dedupeKey: `salary_increment_request:${requestId}:implemented`,
      context: { employeeId: r.employee_id, branchId: r.branch_id, processId: r.process_id },
      entityType: "salary_increment_request",
      entityId: requestId,
      correlationId: `salary_increment:${requestId}`,
      data: {
        proposed_ctc: Number(r.proposed_ctc),
        current_ctc: Number(r.current_ctc),
        increment_percentage: Number(r.increment_percentage),
        effective_from: r.effective_from,
      },
    });
  } catch (err) {
    console.error(`[salary-increment-notify] letter ${requestId}:`, (err as Error).message);
  }
}

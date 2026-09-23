import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getLastWorkedDate } from "../employees/awol-detection.service.js";
import { exitService } from "../exit/exit.service.js";
import { completeWorkItem } from "./work-inbox.service.js";

type AwolWorkItem = {
  itemType: string;
  employeeId: string;
  title: string;
};

async function loadAwolWorkItem(workItemId: string): Promise<AwolWorkItem> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT item_type, entity_id, title FROM work_item WHERE id = ? LIMIT 1`,
    [workItemId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) {
    throw Object.assign(new Error("Work item not found"), { statusCode: 404 });
  }
  if (row.item_type !== "AWOL_SUSPECTED") {
    throw Object.assign(
      new Error("This action only applies to an AWOL_SUSPECTED work item"),
      { statusCode: 400 },
    );
  }
  return {
    itemType: String(row.item_type),
    employeeId: String(row.entity_id),
    title: String(row.title ?? ""),
  };
}

/**
 * The AWOL_PAYROLL_NOTICE item raised alongside this AWOL_SUSPECTED item for the same
 * employee (see triggerAwolSuspected in work-inbox.triggers.ts). Once the manager decides
 * either way, payroll's "still running" notice about the same no-show is resolved too —
 * there is nothing further for payroll to watch once an exit exists (confirm) or the
 * no-show is explained (reject).
 */
async function findSiblingPayrollNoticeId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item
      WHERE entity_type = 'employee' AND entity_id = ? AND item_type = 'AWOL_PAYROLL_NOTICE'
        AND status NOT IN ('completed', 'cancelled')
      LIMIT 1`,
    [employeeId],
  );
  return (rows as RowDataPacket[])[0]?.id ? String((rows as RowDataPacket[])[0].id) : null;
}

export async function getAwolContext(
  workItemId: string,
): Promise<{ employeeId: string; employeeName: string; lastWorkedDate: string | null }> {
  const item = await loadAwolWorkItem(workItemId);
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(full_name, ''), employee_code) AS full_name
       FROM employees WHERE id = ? LIMIT 1`,
    [item.employeeId],
  );
  const employeeName = String((empRows as RowDataPacket[])[0]?.full_name ?? item.title);
  const lastWorkedDate = await getLastWorkedDate(item.employeeId);
  return { employeeId: item.employeeId, employeeName, lastWorkedDate };
}

export async function confirmAwolAbsconding(
  workItemId: string,
  userId: string,
  input: { lastWorkedDate: string; remarks?: string },
): Promise<{ exitRequestId: string }> {
  const item = await loadAwolWorkItem(workItemId);

  const exit = await exitService.createExitRequest(
    {
      employeeId: item.employeeId,
      exitDate: input.lastWorkedDate,
      exitType: "involuntary",
      exitSubType: "absconding",
      abscondingSince: input.lastWorkedDate,
      reason: input.remarks ?? "Confirmed absconding via AWOL work item",
      initiatedBy: "manager",
    },
    userId,
  );

  await completeWorkItem(workItemId, userId, input.remarks ?? "Absconding confirmed");
  const siblingId = await findSiblingPayrollNoticeId(item.employeeId);
  if (siblingId) {
    await completeWorkItem(siblingId, userId, `Absconding confirmed, exit ${exit.id} raised`);
  }

  return { exitRequestId: exit.id };
}

export async function rejectAwolSuspected(
  workItemId: string,
  userId: string,
  remarks: string,
): Promise<void> {
  if (!remarks?.trim()) {
    throw Object.assign(new Error("A reason is required to dismiss this AWOL item"), {
      statusCode: 400,
    });
  }
  const item = await loadAwolWorkItem(workItemId);
  await completeWorkItem(workItemId, userId, remarks.trim());
  const siblingId = await findSiblingPayrollNoticeId(item.employeeId);
  if (siblingId) {
    await completeWorkItem(siblingId, userId, `Not absconding: ${remarks.trim()}`);
  }
}

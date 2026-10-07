/**
 * Mira action: cancel an existing leave request.
 * Finds the employee's most-recent matching cancellable leave, drafts a summary,
 * and on confirm calls leaveService.reviewRequest with status='cancelled'.
 * Same draft→confirm pattern as mira-leave-action.service.ts.
 */

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { leaveService } from "../leave/leave.service.js";
import {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
  type PendingLeaveCancelAction,
  type AnyPendingAction,
} from "./ai-conversation.service.js";

const MIRA_ACTIONS_ENABLED = process.env.MIRA_ACTIONS_ENABLED === "true";

function asLeaveCancelAction(
  a: AnyPendingAction | null,
): PendingLeaveCancelAction | null {
  return a?.type === "leave_cancel" ? (a as PendingLeaveCancelAction) : null;
}

const CANCEL_VERB =
  /\b(cancel|withdraw|revoke|recall|take\s+back)\b[^.?!]{0,40}\bleave\b/i;
const CANCEL_DATE = /\bleave\b[^.?!]{0,40}\b(cancel|withdraw|revoke)\b/i;

export function isLeaveCancelRequest(text: string): boolean {
  return CANCEL_VERB.test(text) || CANCEL_DATE.test(text);
}

interface LeaveRow extends RowDataPacket {
  id: string;
  leave_name: string;
  from_date: string;
  to_date: string;
  status: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function extractDateHint(text: string): string | null {
  const m = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month || day < 1 || day > 31) return null;
  const year = new Date().getFullYear();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${iso}T12:00:00+05:30`));
}

async function writeAudit(row: {
  userId: string;
  employeeId: string | null;
  status: "drafted" | "confirmed" | "failed" | "cancelled";
  payload?: unknown;
  leaveRequestId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO mira_action_audit_log
         (id, user_id, employee_id, action_type, status, payload, leave_request_id, error_message)
       VALUES (?, ?, ?, 'leave_cancel', ?, CAST(? AS JSON), ?, ?)`,
      [
        randomUUID(),
        row.userId,
        row.employeeId,
        row.status,
        row.payload ? JSON.stringify(row.payload) : null,
        row.leaveRequestId ?? null,
        row.errorMessage ?? null,
      ],
    );
  } catch (e) {
    console.error(
      "[Mira] leave_cancel audit write failed",
      e instanceof Error ? e.message : e,
    );
  }
}

export interface LeaveCancelDraftResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

export async function draftLeaveCancelRequest(
  question: string,
  userId: string,
): Promise<LeaveCancelDraftResult> {
  if (!MIRA_ACTIONS_ENABLED) {
    return {
      ok: false,
      error:
        "Mira can't cancel leave on your behalf yet — please use the Leave page.",
    };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return {
      ok: false,
      error: "Your login is not linked to an active employee record.",
    };
  }

  const dateHint = extractDateHint(question);

  // Fetch cancellable leaves (pending or approved), optionally filtered by date
  const [rows] = await db.execute<LeaveRow[]>(
    `SELECT lr.id, lt.leave_name, lr.from_date, lr.to_date, lr.status
       FROM leave_request lr
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ?
        AND lr.status IN ('pending', 'approved', 'pending_branch_head')
        ${dateHint ? "AND (lr.from_date = ? OR lr.to_date = ? OR (lr.from_date <= ? AND lr.to_date >= ?))" : ""}
      ORDER BY lr.from_date DESC
      LIMIT 5`,
    dateHint
      ? [employee.id, dateHint, dateHint, dateHint, dateHint]
      : [employee.id],
  );

  if (!rows.length) {
    return {
      ok: false,
      error: dateHint
        ? `I couldn't find any cancellable leave around ${fmt(dateHint)}. It may already be cancelled or rejected.`
        : "You don't have any pending or approved leave requests that can be cancelled right now.",
    };
  }

  const leave = rows[0] as LeaveRow;
  const payload: PendingLeaveCancelAction["payload"] = {
    employeeId: employee.id,
    leaveRequestId: leave.id,
    leaveTypeName: leave.leave_name,
    fromDate: leave.from_date,
    toDate: leave.to_date,
    currentStatus: leave.status,
  };

  setPendingAction(userId, {
    type: "leave_cancel",
    payload,
    createdAt: Date.now(),
  });
  await writeAudit({
    userId,
    employeeId: employee.id,
    status: "drafted",
    payload,
  });

  const range =
    leave.from_date === leave.to_date
      ? fmt(leave.from_date)
      : `${fmt(leave.from_date)} to ${fmt(leave.to_date)}`;
  const summary = `Cancel your **${leave.leave_name}** (${range}, currently *${leave.status}*)? Nothing is changed yet — confirm to cancel it.`;
  return { ok: true, summary };
}

export async function confirmLeaveCancelAction(
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = asLeaveCancelAction(getPendingAction(userId));
  if (!pending) {
    return {
      ok: false,
      message:
        "I don't have a leave cancellation waiting on your confirmation.",
    };
  }

  await writeAudit({
    userId,
    employeeId: pending.payload.employeeId,
    status: "confirmed",
    payload: pending.payload,
  });

  try {
    await leaveService.reviewRequest(
      pending.payload.leaveRequestId,
      { status: "cancelled", remarks: "Cancelled via Mira" },
      userId,
    );
    clearPendingAction(userId);
    await writeAudit({
      userId,
      employeeId: pending.payload.employeeId,
      status: "confirmed",
      leaveRequestId: pending.payload.leaveRequestId,
      payload: pending.payload,
    });
    return {
      ok: true,
      message: `Done — your ${pending.payload.leaveTypeName} (${fmt(pending.payload.fromDate)} to ${fmt(pending.payload.toDate)}) has been cancelled.`,
    };
  } catch (error) {
    clearPendingAction(userId);
    const msg =
      error instanceof Error ? error.message : "Something went wrong.";
    await writeAudit({
      userId,
      employeeId: pending.payload.employeeId,
      status: "failed",
      payload: pending.payload,
      errorMessage: msg,
    });
    return { ok: false, message: `Couldn't cancel that leave: ${msg}` };
  }
}

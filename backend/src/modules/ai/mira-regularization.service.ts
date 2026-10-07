/**
 * Mira action: submit an attendance regularization request.
 * Parse "my punch wasn't recorded on 5th Sept" → draft → confirm → wfmService.submitRegularization().
 */

import { randomUUID } from "crypto";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { wfmService } from "../wfm/wfm.service.js";
import { regularizationSchema } from "../wfm/wfm.validation.js";
import { db } from "../../db/mysql.js";
import {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
  type PendingRegularizationAction,
  type AnyPendingAction,
} from "./ai-conversation.service.js";

const MIRA_ACTIONS_ENABLED = process.env.MIRA_ACTIONS_ENABLED === "true";

function asRegularization(
  a: AnyPendingAction | null,
): PendingRegularizationAction | null {
  return a?.type === "attendance_regularization"
    ? (a as PendingRegularizationAction)
    : null;
}

// Detect phrases like "punch not recorded", "attendance not marked", "regularize my attendance"
const REGULARIZATION_PATTERNS = [
  /\b(regularize?|regularisation|regularization)\b/i,
  /\b(punch|attendance)\b[^.?!]{0,30}\b(not\s+(?:recorded|marked|captured|logged)|miss(?:ing|ed)|wrong|incorrect)\b/i,
  /\b(forgot|missed)\b[^.?!]{0,20}\b(to\s+)?(punch|swipe|clock|mark)\b/i,
  /\b(mark|correct|fix)\b[^.?!]{0,20}\b(my\s+)?(attendance|punch)\b/i,
];

export function isRegularizationRequest(text: string): boolean {
  return REGULARIZATION_PATTERNS.some((p) => p.test(text));
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

function extractDate(text: string): string | null {
  // "5th Sept", "September 15", "15/09"
  const dayMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2].toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      let year = new Date().getFullYear();
      const candidate = new Date(year, month - 1, day);
      if (candidate > new Date()) year--;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "yesterday"
  if (/\byesterday\b/i.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

function extractTime(text: string, role: "in" | "out"): string | null {
  // Look for "punch in at 9:30" / "out at 18:00" etc.
  const pattern =
    role === "in"
      ? /\b(?:punch[\s-]?in|clock[\s-]?in|in[\s-]?time)\b[^.?!]{0,20}(\d{1,2})[:\.](\d{2})\s*([ap]m)?/i
      : /\b(?:punch[\s-]?out|clock[\s-]?out|out[\s-]?time)\b[^.?!]{0,20}(\d{1,2})[:\.](\d{2})\s*([ap]m)?/i;
  const m = text.match(pattern);
  if (!m) return null;
  let hr = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    const ampm = m[3].toLowerCase();
    if (ampm === "pm" && hr !== 12) hr += 12;
    if (ampm === "am" && hr === 12) hr = 0;
  }
  if (hr < 0 || hr > 23 || min < 0 || min > 59) return null;
  return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function extractReason(text: string): string {
  const m = text.match(/\b(?:because|reason|since|as)\s+([^.?!]{5,200})/i);
  if (m) return m[1].trim();
  // Fallback description from message
  return text.slice(0, 200).trim();
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
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO mira_action_audit_log
         (id, user_id, employee_id, action_type, status, payload, error_message)
       VALUES (?, ?, ?, 'attendance_regularization', ?, CAST(? AS JSON), ?)`,
      [
        randomUUID(),
        row.userId,
        row.employeeId,
        row.status,
        row.payload ? JSON.stringify(row.payload) : null,
        row.errorMessage ?? null,
      ],
    );
  } catch (e) {
    console.error(
      "[Mira] regularization audit write failed",
      e instanceof Error ? e.message : e,
    );
  }
}

export interface RegularizationDraftResult {
  ok: boolean;
  summary?: string;
  error?: string;
  clarifyingQuestion?: string;
}

export async function draftRegularizationRequest(
  question: string,
  userId: string,
): Promise<RegularizationDraftResult> {
  if (!MIRA_ACTIONS_ENABLED) {
    return {
      ok: false,
      error: "Mira can't submit regularizations yet — use the Attendance page.",
    };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return {
      ok: false,
      error: "Your login is not linked to an active employee record.",
    };
  }

  const sessionDate = extractDate(question);
  if (!sessionDate) {
    return {
      ok: false,
      clarifyingQuestion:
        'Which date do you need to regularize? For example "5th September" or "yesterday".',
    };
  }

  const reason = extractReason(question);
  const newPunchIn = extractTime(question, "in");
  const newPunchOut = extractTime(question, "out");

  const payload: PendingRegularizationAction["payload"] = {
    employeeId: employee.id,
    sessionDate,
    reason,
    requestedStatus: null,
    newPunchIn,
    newPunchOut,
  };

  // Validate with real schema before drafting
  const parsed = regularizationSchema.safeParse({
    sessionDate,
    reason,
    newPunchIn: newPunchIn ?? undefined,
    newPunchOut: newPunchOut ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: `Can't create regularization: ${parsed.error.issues[0]?.message ?? "check the date."}`,
    };
  }

  setPendingAction(userId, {
    type: "attendance_regularization",
    payload,
    createdAt: Date.now(),
  });
  await writeAudit({
    userId,
    employeeId: employee.id,
    status: "drafted",
    payload,
  });

  const parts = [`Regularize attendance for **${fmt(sessionDate)}**`];
  if (newPunchIn) parts.push(`punch-in: ${newPunchIn}`);
  if (newPunchOut) parts.push(`punch-out: ${newPunchOut}`);
  parts.push(`reason: "${reason.slice(0, 80)}"`);
  const summary = `${parts.join(", ")}. Nothing submitted yet — confirm to send this request.`;
  return { ok: true, summary };
}

export async function confirmRegularizationAction(
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = asRegularization(getPendingAction(userId));
  if (!pending) {
    return {
      ok: false,
      message: "No regularization request is waiting for your confirmation.",
    };
  }

  await writeAudit({
    userId,
    employeeId: pending.payload.employeeId,
    status: "confirmed",
    payload: pending.payload,
  });

  try {
    await wfmService.submitRegularization(
      {
        employeeId: pending.payload.employeeId,
        sessionDate: pending.payload.sessionDate,
        reason: pending.payload.reason,
        requestedStatus: pending.payload.requestedStatus ?? undefined,
        newPunchIn: pending.payload.newPunchIn ?? undefined,
        newPunchOut: pending.payload.newPunchOut ?? undefined,
        requestedByType: "employee",
      },
      userId,
    );
    clearPendingAction(userId);
    return {
      ok: true,
      message: `Done — regularization request for ${fmt(pending.payload.sessionDate)} submitted. Your manager will review it shortly.`,
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
    return {
      ok: false,
      message: `Couldn't submit that regularization: ${msg}`,
    };
  }
}

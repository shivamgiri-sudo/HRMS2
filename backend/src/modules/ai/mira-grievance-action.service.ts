/**
 * Mira action: raise a grievance / complaint.
 * "I want to raise a complaint about my salary" → draft → confirm → helpdeskService.createGrievance().
 */

import { randomUUID } from "crypto";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { helpdeskService } from "../helpdesk/helpdesk.service.js";
import { db } from "../../db/mysql.js";
import {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
  type PendingGrievanceAction,
  type AnyPendingAction,
} from "./ai-conversation.service.js";

const MIRA_ACTIONS_ENABLED = process.env.MIRA_ACTIONS_ENABLED === "true";

function asGrievance(
  a: AnyPendingAction | null,
): PendingGrievanceAction | null {
  return a?.type === "grievance" ? (a as PendingGrievanceAction) : null;
}

const GRIEVANCE_PATTERNS = [
  /\b(raise|file|submit|lodge|register)\b[^.?!]{0,20}\b(grievance|complaint|complaint)\b/i,
  /\bwant\s+to\s+(raise|file|complain|report)\b/i,
  /\b(harass(?:ment)?|discriminat(?:e|ion)|unfair|unjust)\b/i,
];

export function isGrievanceRequest(text: string): boolean {
  return GRIEVANCE_PATTERNS.some((p) => p.test(text));
}

// Map keywords → category
const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; category: string }> = [
  {
    pattern:
      /\b(salary|pay(?:roll)?|wages?|deduction|arrears?|bonus|incentive)\b/i,
    category: "payroll",
  },
  { pattern: /\b(leave|attendance|absent|punch)\b/i, category: "attendance" },
  {
    pattern: /\b(harass(?:ment)?|discriminat|bully|threat|intimidat)\b/i,
    category: "harassment",
  },
  {
    pattern: /\b(appraisal|promotion|increment|rating|performance)\b/i,
    category: "performance",
  },
  {
    pattern: /\b(asset|laptop|equipment|device|workstation)\b/i,
    category: "assets",
  },
  {
    pattern: /\b(manager|supervisor|team\s+lead|boss)\b/i,
    category: "management",
  },
];

function detectCategory(text: string): string {
  for (const { pattern, category } of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return "workplace";
}

function detectSeverity(text: string): "low" | "medium" | "high" {
  if (
    /\b(serious|urgent|critical|harass|threat|illegal|discriminat|violat)\b/i.test(
      text,
    )
  )
    return "high";
  if (/\b(unfair|wrong|mistake|error|issue|problem)\b/i.test(text))
    return "medium";
  return "low";
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
       VALUES (?, ?, ?, 'grievance', ?, CAST(? AS JSON), ?)`,
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
      "[Mira] grievance audit write failed",
      e instanceof Error ? e.message : e,
    );
  }
}

export interface GrievanceDraftResult {
  ok: boolean;
  summary?: string;
  error?: string;
  clarifyingQuestion?: string;
}

export async function draftGrievanceRequest(
  question: string,
  userId: string,
): Promise<GrievanceDraftResult> {
  if (!MIRA_ACTIONS_ENABLED) {
    return {
      ok: false,
      error: "Mira can't raise grievances yet — use the Helpdesk page.",
    };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return {
      ok: false,
      error: "Your login is not linked to an active employee record.",
    };
  }

  // Extract description — strip intent phrases to keep only the substance
  const description =
    question
      .replace(
        /^(i\s+)?(want\s+to\s+)?(raise|file|submit|lodge|register)\s+(a\s+)?(grievance|complaint|issue|concern)\s*(about|regarding|on|for|because)?\s*/i,
        "",
      )
      .trim() || question.trim();

  if (description.length < 10) {
    return {
      ok: false,
      clarifyingQuestion:
        "Please describe what happened. What is your complaint about?",
    };
  }

  const category = detectCategory(question);
  const severity = detectSeverity(question);

  const payload: PendingGrievanceAction["payload"] = {
    employeeId: employee.id,
    description,
    category,
    severity,
  };

  setPendingAction(userId, {
    type: "grievance",
    payload,
    createdAt: Date.now(),
  });
  await writeAudit({
    userId,
    employeeId: employee.id,
    status: "drafted",
    payload,
  });

  const summary = `Raise a **${category}** grievance (severity: ${severity}):\n> "${description.slice(0, 120)}${description.length > 120 ? "…" : ""}"\n\nNothing filed yet — confirm to submit this to HR.`;
  return { ok: true, summary };
}

export async function confirmGrievanceAction(
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = asGrievance(getPendingAction(userId));
  if (!pending) {
    return {
      ok: false,
      message: "No grievance is waiting for your confirmation.",
    };
  }

  await writeAudit({
    userId,
    employeeId: pending.payload.employeeId,
    status: "confirmed",
    payload: pending.payload,
  });

  try {
    const created = await helpdeskService.createGrievance({
      employee_id: pending.payload.employeeId,
      description: pending.payload.description,
      category: pending.payload.category,
      severity: pending.payload.severity,
    });
    clearPendingAction(userId);
    const code = (created as { grievance_code?: string }).grievance_code ?? "";
    return {
      ok: true,
      message: `Grievance filed successfully${code ? ` (ref: ${code})` : ""}. HR will review it and follow up with you.`,
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
    return { ok: false, message: `Couldn't file that grievance: ${msg}` };
  }
}

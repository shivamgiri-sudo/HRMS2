/**
 * SLA resolution for UAT feedback.
 *
 * The severity x priority -> minutes matrix lives in uat_sla_policy, effective-dated, rather
 * than in constants here. Two reasons: the business can retune it without a deploy, and an
 * item raised six months ago still shows the targets that were in force when it was raised
 * rather than today's — which is the difference between an audit trail and a guess.
 *
 * Deliberately NOT reusing helpdesk-sla.service.ts. That service recomputes breach flags
 * across every helpdesk ticket on each dashboard call; borrowing it would either pull UAT
 * rows into helpdesk reporting or require changing a service 39 endpoints depend on. This
 * module owns its own, much smaller, SLA model and touches nothing else.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Priority, Severity } from "./uat-pipeline.types.js";

export interface SlaTargets {
  firstResponseMins: number;
  triageMins: number;
  resolutionMins: number;
  escalationRole: string | null;
}

interface SlaRow extends RowDataPacket {
  first_response_mins: number;
  triage_mins: number;
  resolution_mins: number;
  escalation_role: string | null;
}

/**
 * The policy in force at `at` for this severity/priority pair.
 *
 * Returns null when no row matches. Callers must treat that as "no SLA", NOT as "zero
 * minutes": a missing policy that silently became an immediately-overdue item would fill
 * the console with false escalations and train everyone to ignore the red flags.
 */
export async function resolveSla(
  severity: Severity,
  priority: Priority,
  at: Date = new Date()
): Promise<SlaTargets | null> {
  const [rows] = await db.execute<SlaRow[]>(
    `SELECT first_response_mins, triage_mins, resolution_mins, escalation_role
       FROM uat_sla_policy
      WHERE severity = ? AND priority = ?
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [severity, priority, at, at]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    firstResponseMins: r.first_response_mins,
    triageMins: r.triage_mins,
    resolutionMins: r.resolution_mins,
    escalationRole: r.escalation_role,
  };
}

/** Resolution deadline for a newly-created item, or null when no policy covers it. */
export async function computeDueAt(
  severity: Severity,
  priority: Priority,
  from: Date = new Date()
): Promise<Date | null> {
  const sla = await resolveSla(severity, priority, from);
  if (!sla) return null;
  return new Date(from.getTime() + sla.resolutionMins * 60_000);
}

export interface AgingInfo {
  ageMins: number;
  overdue: boolean;
  minutesRemaining: number | null;
}

/** Pure, so the console can compute aging for a list without a query per row. */
export function agingFor(createdAt: Date, dueAt: Date | null, now: Date = new Date()): AgingInfo {
  const ageMins = Math.max(0, Math.round((now.getTime() - createdAt.getTime()) / 60_000));
  if (!dueAt) return { ageMins, overdue: false, minutesRemaining: null };
  const remaining = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  return { ageMins, overdue: remaining < 0, minutesRemaining: remaining };
}

/**
 * Default priority for a severity, used when the submitter does not choose one. A blocker
 * defaults to p0 so a UAT stopper is not sitting at the bottom of a list because the person
 * who found it did not know the priority vocabulary.
 */
export function defaultPriorityFor(severity: Severity): Priority {
  switch (severity) {
    case "blocker":
      return "p0";
    case "high":
      return "p1";
    case "medium":
      return "p2";
    default:
      return "p3";
  }
}

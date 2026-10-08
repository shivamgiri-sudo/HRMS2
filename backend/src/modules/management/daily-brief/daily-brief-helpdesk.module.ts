/**
 * Helpdesk / IT Service Impact module for the D-1 Daily Manager Briefing Engine.
 *
 * Reuses `helpdesk_ticket` (columns verified live against modules/helpdesk/helpdesk.service.ts
 * and modules/helpdesk/helpdesk-sla.service.ts: id, ticket_code, employee_id, category,
 * it_subcategory, subject, description, priority, status, sla_breached, sla_due_at,
 * created_at, resolved_at) and reuses the existing SLA-breach definition as-is —
 * `sla_breached = 1` — rather than recomputing a breach from sla_due_at, matching
 * getHelpdeskDashboard's own `SUM(t.sla_breached = 1 ...)`.
 *
 * Deliberately does NOT call helpdesk-sla.service.ts's `refreshSlaBreachFlags()`. That
 * function issues a table-wide UPDATE against `helpdesk_ticket` and is already invoked by
 * `getSupportCommandCenter` / the helpdesk-sla.cron.ts cron; triggering another table-wide
 * write from every daily-brief generation would be a new, uninvited side effect on a
 * protected existing workflow. This module reads `sla_breached` as last refreshed by those
 * existing callers.
 *
 * Never exposes `subject` or `description` (internal support notes) in either detail level —
 * only counts and, in `detailed` mode, a category breakdown (labels only, no ticket content).
 *
 * IMPORTANT: grievance data/tables are explicitly untouched by this module and by this
 * entire change — not even read "just in case". Grievance remains deferred per the
 * governing spec (confidentiality complexity).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";

export type HelpdeskDetailLevel = "operational" | "detailed";

export interface HelpdeskSummary {
  newTickets: number;
  resolvedTickets: number;
  openTickets: number;
  slaBreached: number;
  urgentHighPriorityOpen: number;
}

export interface HelpdeskModuleResult {
  detailLevel: HelpdeskDetailLevel;
  summary: HelpdeskSummary;
  /** operational mode only: a one-line business-impact rollup, no ticket content. */
  businessImpactLine: string | null;
  /** detailed mode only: category label + open/breached counts, no ticket content. */
  categoryBreakdown: BriefSignal[] | null;
  sourceHealth: SourceHealth;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptySummary(): HelpdeskSummary {
  return { newTickets: 0, resolvedTickets: 0, openTickets: 0, slaBreached: 0, urgentHighPriorityOpen: 0 };
}

function buildBusinessImpactLine(summary: HelpdeskSummary): string {
  if (summary.openTickets === 0 && summary.newTickets === 0) {
    return "No open helpdesk tickets affecting your team.";
  }
  const parts = [`${summary.openTickets} ticket${summary.openTickets === 1 ? "" : "s"} affecting your team`];
  if (summary.slaBreached > 0) {
    parts.push(`${summary.slaBreached} SLA breach${summary.slaBreached === 1 ? "" : "es"}`);
  }
  return parts.join(", ");
}

export async function buildHelpdeskModule(
  teamEmployeeIds: string[],
  reportingDate: string,
  detailLevel: HelpdeskDetailLevel,
): Promise<HelpdeskModuleResult> {
  if (teamEmployeeIds.length === 0) {
    return {
      detailLevel,
      summary: emptySummary(),
      businessImpactLine: detailLevel === "operational" ? "No team members in scope." : null,
      categoryBreakdown: detailLevel === "detailed" ? [] : null,
      sourceHealth: { module: "helpdesk", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: reportingDate },
    };
  }

  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [summaryRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(DATE(t.created_at) = ?) AS new_tickets,
         SUM(DATE(t.resolved_at) = ?) AS resolved_tickets,
         SUM(t.status NOT IN ('resolved','closed','cancelled')) AS open_tickets,
         SUM(t.sla_breached = 1 AND t.status NOT IN ('resolved','closed','cancelled')) AS sla_breached,
         SUM(t.priority IN ('urgent','high') AND t.status NOT IN ('resolved','closed','cancelled')) AS urgent_high_open
       FROM helpdesk_ticket t
      WHERE t.employee_id IN (${placeholders})`,
      [reportingDate, reportingDate, ...teamEmployeeIds],
    );
    const row = summaryRows[0] ?? {};
    const summary: HelpdeskSummary = {
      newTickets: numberValue(row.new_tickets),
      resolvedTickets: numberValue(row.resolved_tickets),
      openTickets: numberValue(row.open_tickets),
      slaBreached: numberValue(row.sla_breached),
      urgentHighPriorityOpen: numberValue(row.urgent_high_open),
    };

    let categoryBreakdown: BriefSignal[] | null = null;
    if (detailLevel === "detailed") {
      const [categoryRows] = await db.execute<RowDataPacket[]>(
        `SELECT t.category,
                COUNT(*) AS total,
                SUM(t.status NOT IN ('resolved','closed','cancelled')) AS open,
                SUM(t.sla_breached = 1) AS breached
           FROM helpdesk_ticket t
          WHERE t.employee_id IN (${placeholders})
            AND t.status NOT IN ('resolved','closed','cancelled')
          GROUP BY t.category
          ORDER BY total DESC
          LIMIT 20`,
        teamEmployeeIds,
      );
      categoryBreakdown = (categoryRows as RowDataPacket[]).map((r) => ({
        key: `helpdesk_category_${String(r.category ?? "unknown")}`,
        label: String(r.category ?? "Unclassified"),
        value: numberValue(r.open),
        unit: "count" as const,
      }));
    }

    const hasAnyData = summary.newTickets > 0 || summary.resolvedTickets > 0 || summary.openTickets > 0;
    return {
      detailLevel,
      summary,
      businessImpactLine: detailLevel === "operational" ? buildBusinessImpactLine(summary) : null,
      categoryBreakdown,
      sourceHealth: { module: "helpdesk", state: hasAnyData ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      detailLevel,
      summary: emptySummary(),
      businessImpactLine: null,
      categoryBreakdown: null,
      sourceHealth: {
        module: "helpdesk",
        state: "ERROR",
        detail: `Helpdesk query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

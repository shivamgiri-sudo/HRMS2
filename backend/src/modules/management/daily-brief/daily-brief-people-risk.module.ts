/**
 * People Risk module for the D-1 Daily Manager Briefing Engine — privacy-restricted.
 *
 * Reuses `people_experience_health_snapshot` and the `riskLabel(score)` bands defined
 * in modules/people-experience/people-experience.service.ts (verified live: >=82
 * highly_engaged, >=65 stable, >=45 watchlist, >=30 attrition_risk, <30
 * critical_people_risk). That function is not exported, so the band NAMES it produces
 * are reused as literal SQL filter values (`risk_label IN ('attrition_risk',
 * 'critical_people_risk')`) rather than the function itself — those are exactly the two
 * bands business-actions.signal-sync.ts's syncPeopleExperience already treats as
 * action-worthy (verified by reading that file directly).
 *
 * Per the governing spec, this module deliberately does NOT surface the underlying
 * engagement score, the risk_label itself, or any driver/reason text (top_risk_drivers_json)
 * anywhere in its output — only a count + severity + a generic "review in HRMS" action link.
 *
 * Role gating: only people-manager-adjacent roles get anything at all. Everyone else
 * (it, finance, recruiter, ...) gets an explicit NOT_APPLICABLE, empty result — never a
 * silent zero that could be misread as "no risk" for a role that was never entitled to see
 * this in the first place.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";

/**
 * Roles entitled to see even the minimal people-risk signal. EDITORIAL DEFAULT: this
 * list is not copied from an existing single source of truth — no shared
 * "people-manager-adjacent roles" constant was found in the repo at the time of writing.
 * It is assembled from the role names the prompt named explicitly; flagged for review
 * against platform/policy/roles.ts if a canonical list exists or is added later.
 */
const PEOPLE_MANAGER_ADJACENT_ROLES = new Set([
  "hr",
  "branch_head",
  "manager",
  "team_leader",
  "tl",
  "admin",
  "super_admin",
]);

export type PeopleRiskSeverity = "critical" | "high";

export interface PeopleRiskModuleResult {
  applicable: boolean;
  /** Count of team members in bands attrition_risk + critical_people_risk. Null when not applicable. */
  countRequiringAttention: BriefSignal | null;
  severity: PeopleRiskSeverity | null;
  /** Safe, generic action link — never a per-employee deep link with a reason attached. */
  actionLabel: string | null;
  sourceHealth: SourceHealth;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPeopleManagerAdjacentRole(role: string): boolean {
  return PEOPLE_MANAGER_ADJACENT_ROLES.has(role.trim().toLowerCase());
}

export async function buildPeopleRiskModule(
  teamEmployeeIds: string[],
  recipientRole: string,
  reportingDate: string,
): Promise<PeopleRiskModuleResult> {
  if (!isPeopleManagerAdjacentRole(recipientRole)) {
    return {
      applicable: false,
      countRequiringAttention: null,
      severity: null,
      actionLabel: null,
      sourceHealth: { module: "people_risk", state: "NOT_APPLICABLE", detail: "Role not people-manager-adjacent", asOfDate: reportingDate },
    };
  }
  if (teamEmployeeIds.length === 0) {
    return {
      applicable: true,
      countRequiringAttention: null,
      severity: null,
      actionLabel: null,
      sourceHealth: { module: "people_risk", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: reportingDate },
    };
  }

  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT px.risk_label
         FROM people_experience_health_snapshot px
         JOIN (
           SELECT employee_id, MAX(snapshot_date) AS snapshot_date
             FROM people_experience_health_snapshot
            WHERE employee_id IN (${placeholders})
            GROUP BY employee_id
         ) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date
        WHERE px.employee_id IN (${placeholders})
          AND px.risk_label IN ('attrition_risk', 'critical_people_risk')`,
      [...teamEmployeeIds, ...teamEmployeeIds],
    );
    const resultRows = rows as RowDataPacket[];
    const count = resultRows.length;
    const hasCritical = resultRows.some((r) => r.risk_label === "critical_people_risk");
    const severity: PeopleRiskSeverity | null = count === 0 ? null : hasCritical ? "critical" : "high";

    return {
      applicable: true,
      countRequiringAttention: {
        key: "people_risk_attention_count",
        label: "Team members needing people-risk attention",
        value: count,
        unit: "count",
      },
      severity,
      actionLabel: count > 0 ? "Review in HRMS" : null,
      sourceHealth: { module: "people_risk", state: count > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      applicable: true,
      countRequiringAttention: null,
      severity: null,
      actionLabel: null,
      sourceHealth: {
        module: "people_risk",
        state: "ERROR",
        detail: `People-risk query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

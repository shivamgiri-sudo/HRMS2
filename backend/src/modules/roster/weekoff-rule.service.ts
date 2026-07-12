import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface WeekoffRule extends RowDataPacket {
  id: string;
  process_id: string;
  rule_type: "min_gap_days" | "blackout_date" | "force_sunday_for_role" | "senior_priority" | "rotation_enforce";
  rule_params: string; // JSON stored as string
  priority: number;
  active_status: number;
}

export interface WeekoffRuleContext {
  employeeId: string;
  designation: string | null;
  preferredDay: number | null;
  candidateDate: string; // YYYY-MM-DD
  dow: number;           // 0=Sun
  lastWeekoffDate: string | null; // YYYY-MM-DD or null
}

export interface WeekoffRuling {
  allow: boolean;
  reason: string;
  override?: { day: number };
}

export async function loadWeekoffRules(processId: string): Promise<WeekoffRule[]> {
  const [rows] = await db.execute<WeekoffRule[]>(
    `SELECT id, process_id, rule_type, rule_params, priority, active_status
       FROM process_weekoff_rule
      WHERE process_id = ? AND active_status = 1
      ORDER BY priority ASC`,
    [processId]
  );
  return rows;
}

export function applyWeekoffRules(rules: WeekoffRule[], ctx: WeekoffRuleContext): WeekoffRuling {
  for (const rule of rules) {
    let params: Record<string, unknown>;
    try {
      params = typeof rule.rule_params === "string" ? JSON.parse(rule.rule_params) : (rule.rule_params as Record<string, unknown>);
    } catch {
      continue;
    }

    if (rule.rule_type === "blackout_date") {
      if (params.blackout === ctx.candidateDate) {
        return { allow: false, reason: `blackout_date:${ctx.candidateDate}` };
      }
    }

    if (rule.rule_type === "min_gap_days") {
      const minGap = Number(params.min_gap ?? 6);
      if (ctx.lastWeekoffDate) {
        const last = new Date(ctx.lastWeekoffDate + "T00:00:00");
        const candidate = new Date(ctx.candidateDate + "T00:00:00");
        const diffDays = Math.floor((candidate.getTime() - last.getTime()) / 86_400_000);
        if (diffDays < minGap) {
          return { allow: false, reason: `min_gap_days:gap_${diffDays}_lt_${minGap}` };
        }
      }
    }

    if (rule.rule_type === "force_sunday_for_role") {
      const targetRole = String(params.role ?? "").toLowerCase();
      const empDesig = String(ctx.designation ?? "").toLowerCase();
      if (targetRole && empDesig.includes(targetRole) && ctx.dow !== 0) {
        // Redirect week-off to Sunday (dow=0) rather than blocking
        return { allow: true, reason: `force_sunday_for_role:${ctx.designation}`, override: { day: 0 } };
      }
    }

    // senior_priority: metadata for queue resorting — not a gate, skip here
    // rotation_enforce: deferred
  }

  return { allow: true, reason: "no_rule_blocked" };
}

export function sortBySeniorPriority(
  rules: WeekoffRule[],
  employees: Array<{ id: string; joining_date?: string | null; designation?: string | null }>
): typeof employees {
  const seniorRule = rules.find((r) => r.rule_type === "senior_priority");
  if (!seniorRule) return employees;

  return [...employees].sort((a, b) => {
    const dateA = a.joining_date ? new Date(a.joining_date).getTime() : Infinity;
    const dateB = b.joining_date ? new Date(b.joining_date).getTime() : Infinity;
    return dateA - dateB; // Earlier joining_date = higher seniority = earlier in FCFS queue
  });
}

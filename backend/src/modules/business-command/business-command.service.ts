import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { businessActionsService } from "../business-actions/business-actions.service.js";

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
}

async function scalar(sql: string, params: unknown[] = [], fallback = 0): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const first = rows[0] ?? {};
    const value = Object.values(first)[0];
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export const businessCommandService = {
  async overview() {
    const actions = await businessActionsService.summary();

    const activeEmployees = await scalar(
      "SELECT COUNT(*) FROM employees WHERE active_status = 1 AND LOWER(COALESCE(employment_status, 'active')) = 'active'"
    );

    const todayAttendance = await tableExists("attendance_daily_record")
      ? {
          present: await scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE attendance_date = CURDATE() AND LOWER(status) IN ('present','p')"),
          absent: await scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE attendance_date = CURDATE() AND LOWER(status) IN ('absent','a','lwp')"),
          late: await scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE attendance_date = CURDATE() AND LOWER(status) IN ('late','half_day_late')"),
        }
      : { present: 0, absent: 0, late: 0 };

    const support = await tableExists("helpdesk_ticket")
      ? {
          open: await scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled')"),
          breached: await scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled') AND ((sla_due_at IS NOT NULL AND sla_due_at < NOW()) OR (sla_due_at IS NULL AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 48))"),
          urgent: await scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled') AND priority = 'urgent'"),
        }
      : { open: 0, breached: 0, urgent: 0 };

    const peopleRisk = await tableExists("people_experience_health_snapshot")
      ? {
          watchlist: await scalar("SELECT COUNT(*) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date WHERE px.risk_label = 'watchlist'"),
          attrition_risk: await scalar("SELECT COUNT(*) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date WHERE px.risk_label IN ('attrition_risk','critical_people_risk')"),
          average_score: await scalar("SELECT AVG(px.engagement_score) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date"),
        }
      : { watchlist: 0, attrition_risk: 0, average_score: 0 };

    const grievances = await tableExists("grievance")
      ? {
          open: await scalar("SELECT COUNT(*) FROM grievance WHERE status NOT IN ('resolved','closed')"),
          critical: await scalar("SELECT COUNT(*) FROM grievance WHERE status NOT IN ('resolved','closed') AND (severity IN ('critical','high') OR category IN ('harassment','safety','security','discrimination'))"),
        }
      : { open: 0, critical: 0 };

    const payroll = await tableExists("salary_prep_run")
      ? {
          latest_gross: await scalar("SELECT COALESCE(SUM(gross_pay),0) FROM salary_prep_line WHERE run_id = (SELECT id FROM salary_prep_run ORDER BY created_at DESC LIMIT 1)"),
          latest_net: await scalar("SELECT COALESCE(SUM(net_pay),0) FROM salary_prep_line WHERE run_id = (SELECT id FROM salary_prep_run ORDER BY created_at DESC LIMIT 1)"),
        }
      : { latest_gross: 0, latest_net: 0 };

    const healthSignals = [
      { label: "Business actions", value: Number(actions.open_count ?? 0), status: Number(actions.critical_open ?? 0) > 0 ? "critical" : Number(actions.overdue ?? 0) > 0 ? "warning" : "healthy" },
      { label: "Attendance", value: todayAttendance.absent, status: todayAttendance.absent > Math.max(5, activeEmployees * 0.08) ? "warning" : "healthy" },
      { label: "Support SLA", value: support.breached, status: support.breached > 0 ? "critical" : "healthy" },
      { label: "People risk", value: peopleRisk.attrition_risk, status: peopleRisk.attrition_risk > 0 ? "warning" : "healthy" },
      { label: "Grievance", value: grievances.critical, status: grievances.critical > 0 ? "critical" : "healthy" },
    ];

    return {
      generated_at: new Date().toISOString(),
      executive_summary: {
        active_employees: activeEmployees,
        open_actions: Number(actions.open_count ?? 0),
        critical_actions: Number(actions.critical_open ?? 0),
        overdue_actions: Number(actions.overdue ?? 0),
        support_sla_breached: support.breached,
        people_attrition_risk: peopleRisk.attrition_risk,
        open_grievances: grievances.open,
        latest_payroll_gross_inr: payroll.latest_gross,
      },
      attendance: todayAttendance,
      support,
      people_risk: peopleRisk,
      grievances,
      payroll,
      action_summary: actions,
      health_signals: healthSignals,
      data_confidence: {
        attendance: await tableExists("attendance_daily_record") ? 80 : 20,
        support: await tableExists("helpdesk_ticket") ? 85 : 20,
        people_experience: await tableExists("people_experience_health_snapshot") ? 75 : 20,
        payroll: await tableExists("salary_prep_run") ? 65 : 20,
      },
    };
  },
};

import { tableExists, scalar } from "../../shared/dbHelpers.js";
import { businessActionsService } from "../business-actions/business-actions.service.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";

export const businessCommandService = {
  async overview() {
    // Parallel table existence checks first
    const [hasAttendance, hasHelpdesk, hasPeopleExp, hasGrievance, hasPayroll, hasContract] = await Promise.all([
      tableExists("attendance_daily_record"),
      tableExists("helpdesk_ticket"),
      tableExists("people_experience_health_snapshot"),
      tableExists("grievance"),
      tableExists("salary_prep_run"),
      tableExists("client_contract_master"),
    ]);

    // Run all independent sections in parallel
    const [actions, revenueRisk, activeEmployees, attendanceData, supportData, peopleRiskData, grievanceData, payrollData] = await Promise.all([
      businessActionsService.summary() as Promise<any>,
      revenueRiskService.snapshot(),
      scalar("SELECT COUNT(*) FROM employees WHERE active_status = 1 AND LOWER(COALESCE(employment_status, 'active')) = 'active'"),
      hasAttendance
        ? Promise.all([
            scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE record_date = (SELECT MAX(record_date) FROM attendance_daily_record) AND attendance_status IN ('present','half_day')"),
            scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE record_date = (SELECT MAX(record_date) FROM attendance_daily_record) AND attendance_status IN ('absent','unreconciled')"),
            scalar("SELECT COUNT(*) FROM attendance_daily_record WHERE record_date = (SELECT MAX(record_date) FROM attendance_daily_record) AND late_mark = 1"),
          ]).then(([present, absent, late]) => ({ present, absent, late }))
        : Promise.resolve({ present: 0, absent: 0, late: 0 }),
      hasHelpdesk
        ? Promise.all([
            scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled')"),
            scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled') AND ((sla_due_at IS NOT NULL AND sla_due_at < NOW()) OR (sla_due_at IS NULL AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 48))"),
            scalar("SELECT COUNT(*) FROM helpdesk_ticket WHERE status NOT IN ('resolved','closed','cancelled') AND priority = 'urgent'"),
          ]).then(([open, breached, urgent]) => ({ open, breached, urgent }))
        : Promise.resolve({ open: 0, breached: 0, urgent: 0 }),
      hasPeopleExp
        ? Promise.all([
            scalar("SELECT COUNT(*) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date WHERE px.risk_label = 'watchlist'"),
            scalar("SELECT COUNT(*) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date WHERE px.risk_label IN ('attrition_risk','critical_people_risk')"),
            scalar("SELECT AVG(px.engagement_score) FROM people_experience_health_snapshot px JOIN (SELECT employee_id, MAX(snapshot_date) snapshot_date FROM people_experience_health_snapshot GROUP BY employee_id) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date"),
          ]).then(([watchlist, attrition_risk, average_score]) => ({ watchlist, attrition_risk, average_score }))
        : Promise.resolve({ watchlist: 0, attrition_risk: 0, average_score: 0 }),
      hasGrievance
        ? Promise.all([
            scalar("SELECT COUNT(*) FROM grievance WHERE status NOT IN ('resolved','closed')"),
            scalar("SELECT COUNT(*) FROM grievance WHERE status NOT IN ('resolved','closed') AND (severity IN ('critical','high') OR category IN ('harassment','safety','security','discrimination'))"),
          ]).then(([open, critical]) => ({ open, critical }))
        : Promise.resolve({ open: 0, critical: 0 }),
      hasPayroll
        ? Promise.all([
            scalar("SELECT COALESCE(SUM(gross_pay),0) FROM salary_prep_line WHERE run_id = (SELECT id FROM salary_prep_run ORDER BY created_at DESC LIMIT 1)"),
            scalar("SELECT COALESCE(SUM(net_pay),0) FROM salary_prep_line WHERE run_id = (SELECT id FROM salary_prep_run ORDER BY created_at DESC LIMIT 1)"),
          ]).then(([latest_gross, latest_net]) => ({ latest_gross, latest_net }))
        : Promise.resolve({ latest_gross: 0, latest_net: 0 }),
    ]);

    const revenueAtRisk = Number(revenueRisk?.totals?.revenue_at_risk ?? 0);
    const shortageHc = Number(revenueRisk?.totals?.shortage_hc ?? 0);

    const healthSignals = [
      { label: "Revenue at risk", value: Math.round(revenueAtRisk), status: revenueAtRisk >= 100000 || shortageHc >= 20 ? "critical" : revenueAtRisk > 0 || shortageHc > 0 ? "warning" : "healthy" },
      { label: "Business actions", value: Number(actions.open_count ?? 0), status: Number(actions.critical_open ?? 0) > 0 ? "critical" : Number(actions.overdue ?? 0) > 0 ? "warning" : "healthy" },
      { label: "Attendance", value: attendanceData.absent, status: attendanceData.absent > Math.max(5, activeEmployees * 0.08) ? "warning" : "healthy" },
      { label: "Support SLA", value: supportData.breached, status: supportData.breached > 0 ? "critical" : "healthy" },
      { label: "People risk", value: peopleRiskData.attrition_risk, status: peopleRiskData.attrition_risk > 0 ? "warning" : "healthy" },
      { label: "Grievance", value: grievanceData.critical, status: grievanceData.critical > 0 ? "critical" : "healthy" },
    ];

    return {
      generated_at: new Date().toISOString(),
      executive_summary: {
        active_employees: activeEmployees,
        open_actions: Number(actions.open_count ?? 0),
        critical_actions: Number(actions.critical_open ?? 0),
        overdue_actions: Number(actions.overdue ?? 0),
        support_sla_breached: supportData.breached,
        people_attrition_risk: peopleRiskData.attrition_risk,
        open_grievances: grievanceData.open,
        latest_payroll_gross_inr: payrollData.latest_gross,
        revenue_at_risk_inr: revenueAtRisk,
        shortage_hc: shortageHc,
      },
      attendance: attendanceData,
      support: supportData,
      people_risk: peopleRiskData,
      grievances: grievanceData,
      payroll: payrollData,
      revenue_risk: revenueRisk,
      action_summary: actions,
      health_signals: healthSignals,
      data_confidence: {
        attendance: hasAttendance ? 80 : 20,
        support: hasHelpdesk ? 85 : 20,
        people_experience: hasPeopleExp ? 75 : 20,
        payroll: hasPayroll ? 65 : 20,
        revenue_risk: hasContract ? 65 : 25,
      },
    };
  },
};

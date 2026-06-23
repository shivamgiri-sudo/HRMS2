import type { FieldPacket, PoolConnection, QueryResult, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

export interface AgentStatus {
  agent_id: string;
  agent_code: string;
  agent_name: string;
  status: "Logged In" | "Logged Out" | "On Break" | "Absent";
  duration: number; // in minutes
  call_id?: string | null;
  process_name: string | null;
  branch_name: string | null;
  last_activity: string | null;
}

export interface OperationsSummary {
  total_agents: number;
  logged_in: number;
  on_break: number;
  logged_out: number;
  absent: number;
  avg_call_duration: number;
}

export interface LiveStatusResponse {
  agents: AgentStatus[];
  summary: OperationsSummary;
  timestamp: string;
}

export interface ProcessUtilization {
  process_name: string;
  planned_headcount: number;
  actual_logged_in: number;
  utilization_pct: number;
  shrinkage_forecast: number;
}

export interface RosterVsActualResponse {
  utilization_pct: number;
  processes: ProcessUtilization[];
  timestamp: string;
}

export interface AttritionSignal {
  type: "resignation_notice" | "attendance_drop" | "quality_decline" | "escalation";
  severity: "low" | "medium" | "high";
  description: string;
}

export interface EmployeeAttritionRisk {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  risk_score: number; // 0-100
  signals: AttritionSignal[];
  retention_action: string | null;
  last_updated: string;
}

export interface AttritionRiskResponse {
  employees: EmployeeAttritionRisk[];
  high_risk_count: number;
  medium_risk_count: number;
  timestamp: string;
}

type DbExecutor = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]>;
  getConnection?: () => Promise<PoolConnection>;
};

class OperationsLiveService {
  private db: DbExecutor;
  constructor(dbPool?: DbExecutor) { this.db = dbPool ?? db; }

  /**
   * Get live agent status for all agents or filtered by process/branch
   */
  async getLiveStatus(
    processName?: string,
    branchName?: string
  ): Promise<LiveStatusResponse> {
    try {
      const conditions: string[] = ["e.employment_status = 'Active'"];
      const params: any[] = [];

      if (processName) {
        conditions.push("ra.process_name = ?");
        params.push(processName);
      }

      if (branchName) {
        conditions.push("ra.branch_name = ?");
        params.push(branchName);
      }

      const whereClause = conditions.join(" AND ");

      // Get live session data from roster assignments and attendance sessions
      const [agents] = await this.db.execute<RowDataPacket[]>(
        `
        SELECT
          e.id as agent_id,
          e.employee_code as agent_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS agent_name,
          COALESCE(s.current_status, 'Absent') AS status,
          COALESCE(TIMESTAMPDIFF(MINUTE, s.login_time, NOW()), 0) AS duration,
          s.call_id,
          ra.process_name,
          ra.branch_name,
          s.last_activity
        FROM employees e
        LEFT JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = CURDATE()
        LEFT JOIN wfm_attendance_session s ON s.employee_id = e.id AND s.session_date = CURDATE()
        WHERE ${whereClause}
        ORDER BY ra.process_name, e.employee_code
        `,
        params
      );

      const agentList: AgentStatus[] = (agents as any[]).map((row) => ({
        agent_id: row.agent_id,
        agent_code: row.agent_code,
        agent_name: row.agent_name,
        status: row.status || "Absent",
        duration: row.duration || 0,
        call_id: row.call_id,
        process_name: row.process_name,
        branch_name: row.branch_name,
        last_activity: row.last_activity,
      }));

      // Calculate summary
      const summary: OperationsSummary = {
        total_agents: agentList.length,
        logged_in: agentList.filter((a) => a.status === "Logged In").length,
        on_break: agentList.filter((a) => a.status === "On Break").length,
        logged_out: agentList.filter((a) => a.status === "Logged Out").length,
        absent: agentList.filter((a) => a.status === "Absent").length,
        avg_call_duration: Math.round(
          agentList.reduce((sum, a) => sum + a.duration, 0) / Math.max(agentList.length, 1)
        ),
      };

      return {
        agents: agentList,
        summary,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error fetching live status:", error);
      throw error;
    }
  }

  /**
   * Get roster vs actual utilization comparison by process
   */
  async getRosterVsActual(): Promise<RosterVsActualResponse> {
    try {
      const [processes] = await this.db.execute<RowDataPacket[]>(
        `
        SELECT
          ra.process_name,
          COUNT(DISTINCT ra.employee_id) AS planned_headcount,
          COUNT(DISTINCT CASE WHEN s.current_status = 'Logged In' THEN s.employee_id END) AS actual_logged_in
        FROM wfm_roster_assignment ra
        LEFT JOIN wfm_attendance_session s
          ON s.employee_id = ra.employee_id AND s.session_date = ra.roster_date AND ra.roster_date = CURDATE()
        WHERE ra.roster_date = CURDATE()
        GROUP BY ra.process_name
        ORDER BY ra.process_name
        `
      );

      const processUtilization: ProcessUtilization[] = (processes as any[]).map((p) => {
        const utilization_pct =
          p.planned_headcount > 0
            ? Math.round((p.actual_logged_in / p.planned_headcount) * 100)
            : 0;

        return {
          process_name: p.process_name,
          planned_headcount: p.planned_headcount,
          actual_logged_in: p.actual_logged_in,
          utilization_pct,
          shrinkage_forecast: 100 - utilization_pct,
        };
      });

      const totalPlanned = processUtilization.reduce((sum, p) => sum + p.planned_headcount, 0);
      const totalActual = processUtilization.reduce((sum, p) => sum + p.actual_logged_in, 0);
      const overallUtilization =
        totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;

      return {
        utilization_pct: overallUtilization,
        processes: processUtilization,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error fetching roster vs actual:", error);
      throw error;
    }
  }

  /**
   * Calculate attrition risk scores based on resignation signals, attendance drop, and quality decline
   */
  async getAttritionRiskScores(minRiskScore: number = 0): Promise<AttritionRiskResponse> {
    try {
      // Get employees with risk signals
      const [employees] = await this.db.execute<RowDataPacket[]>(
        `
        SELECT DISTINCT
          e.id as employee_id,
          e.employee_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
          e.employment_status,
          res.resignation_submitted_on,
          res.resignation_accepted_on
        FROM employees e
        LEFT JOIN resignation res ON res.employee_id = e.id
        WHERE e.employment_status IN ('Active', 'Resigned')
        `
      );

      const riskList: EmployeeAttritionRisk[] = [];

      for (const emp of employees as any[]) {
        const signals: AttritionSignal[] = [];
        let riskScore = 0;

        // Signal 1: Resignation notice
        if (emp.resignation_submitted_on) {
          signals.push({
            type: "resignation_notice",
            severity: "high",
            description: "Resignation notice submitted",
          });
          riskScore += 80;
        }

        // Signal 2: Attendance drop (get last 30 days attendance)
        const [attendance] = await this.db.execute<RowDataPacket[]>(
          `
          SELECT
            COUNT(*) as total_days,
            SUM(CASE WHEN current_status = 'Absent' THEN 1 ELSE 0 END) as absent_days
          FROM wfm_attendance_session
          WHERE employee_id = ? AND session_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          `,
          [emp.employee_id]
        );

        const attData = attendance?.[0] as any;
        if (attData?.total_days > 0) {
          const absentRate = (attData.absent_days / attData.total_days) * 100;
          if (absentRate > 15) {
            signals.push({
              type: "attendance_drop",
              severity: absentRate > 25 ? "high" : "medium",
              description: `${Math.round(absentRate)}% absent in last 30 days`,
            });
            riskScore += absentRate > 25 ? 40 : 20;
          }
        }

        // Signal 3: Quality decline (if available in quality data)
        // This would require integration with quality metrics DB
        // Placeholder for future integration

        // Signal 4: Escalations/Complaints (future integration point)

        if (riskScore >= minRiskScore) {
          riskList.push({
            employee_id: emp.employee_id,
            employee_code: emp.employee_code,
            employee_name: emp.employee_name,
            risk_score: Math.min(100, riskScore),
            signals,
            retention_action: riskScore >= 60 ? "Schedule retention discussion" : null,
            last_updated: new Date().toISOString(),
          });
        }
      }

      // Sort by risk score descending
      riskList.sort((a, b) => b.risk_score - a.risk_score);

      const highRiskCount = riskList.filter((r) => r.risk_score >= 70).length;
      const mediumRiskCount = riskList.filter((r) => r.risk_score >= 50 && r.risk_score < 70).length;

      return {
        employees: riskList,
        high_risk_count: highRiskCount,
        medium_risk_count: mediumRiskCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error calculating attrition risk:", error);
      throw error;
    }
  }
}

export const operationsLiveService = new OperationsLiveService();

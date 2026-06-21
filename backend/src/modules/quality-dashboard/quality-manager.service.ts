import { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../../logger.js';

export interface TeamQualitySummary {
  avg_quality: number;
  agent_count: number;
  calls_handled: number;
  top_performer: { agent_code: string; agent_name: string; quality: number };
  bottom_performer: { agent_code: string; agent_name: string; quality: number };
  quality_distribution: { excellent: number; good: number; average: number; poor: number };
}

export interface AgentBreakdown {
  agent_code: string;
  agent_name: string;
  quality_pct: number;
  calls_handled: number;
  weak_areas: string[];
  coaching_needed: boolean;
  risk_score: number;
}

export class QualityManagerService {
  constructor(private db: Pool) {}

  async getTeamQuality(
    managerCode: string,
    daysBack: number = 7,
    process: string = 'INBOUND'
  ): Promise<{
    team_summary: TeamQualitySummary;
    agent_breakdown: AgentBreakdown[];
  }> {
    const conn = await this.db.getConnection();

    try {
      // Get all direct reports for this manager
      const [directReports] = await conn.execute<RowDataPacket[]>(
        `SELECT id, employee_code, CONCAT(first_name, ' ', COALESCE(last_name, '')) as full_name
         FROM mas_hrms.employees
         WHERE reporting_manager_id = (
           SELECT id FROM mas_hrms.employees WHERE employee_code = ? AND employment_status = 'Active'
         )
         AND employment_status = 'Active'`,
        [managerCode]
      );

      if (!directReports || directReports.length === 0) {
        logger.info(`No direct reports found for manager: ${managerCode}`);
        return {
          team_summary: {
            avg_quality: 0,
            agent_count: 0,
            calls_handled: 0,
            top_performer: { agent_code: '', agent_name: '', quality: 0 },
            bottom_performer: { agent_code: '', agent_name: '', quality: 0 },
            quality_distribution: { excellent: 0, good: 0, average: 0, poor: 0 }
          },
          agent_breakdown: []
        };
      }

      const agentCodes = directReports.map((r: any) => r.employee_code);

      // Get quality metrics for all direct reports
      const placeholders = agentCodes.map(() => '?').join(',');
      const [qualityMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.User as agent_code,
           e.first_name as agent_first_name,
           e.last_name as agent_last_name,
           ROUND(AVG(cqa.quality_percentage), 2) as quality_pct,
           COUNT(*) as calls_handled,
           COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) as poor_calls,
           MAX(cqa.CallDate) as last_assessment_date
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         WHERE cqa.User IN (${placeholders})
           AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
           AND cqa.Campaign LIKE CONCAT(?, '%')
         GROUP BY cqa.User, e.first_name, e.last_name
         ORDER BY quality_pct DESC`,
        [...agentCodes, daysBack, process]
      );

      if (!qualityMetrics || qualityMetrics.length === 0) {
        logger.info(`No quality metrics found for team of manager: ${managerCode}`);
        return {
          team_summary: {
            avg_quality: 0,
            agent_count: 0,
            calls_handled: 0,
            top_performer: { agent_code: '', agent_name: '', quality: 0 },
            bottom_performer: { agent_code: '', agent_name: '', quality: 0 },
            quality_distribution: { excellent: 0, good: 0, average: 0, poor: 0 }
          },
          agent_breakdown: []
        };
      }

      // Calculate team summary
      const avgQuality = qualityMetrics.length > 0
        ? qualityMetrics.reduce((sum: number, m: any) => sum + m.quality_pct, 0) / qualityMetrics.length
        : 0;

      const totalCalls = qualityMetrics.reduce((sum: number, m: any) => sum + m.calls_handled, 0);

      const distribution = {
        excellent: qualityMetrics.filter((m: any) => m.quality_pct >= 90).length,
        good: qualityMetrics.filter((m: any) => m.quality_pct >= 80 && m.quality_pct < 90).length,
        average: qualityMetrics.filter((m: any) => m.quality_pct >= 70 && m.quality_pct < 80).length,
        poor: qualityMetrics.filter((m: any) => m.quality_pct < 70).length,
      };

      const teamSummary: TeamQualitySummary = {
        avg_quality: Math.round(avgQuality * 100) / 100,
        agent_count: qualityMetrics.length,
        calls_handled: totalCalls,
        top_performer: qualityMetrics.length > 0 ? {
          agent_code: qualityMetrics[0].agent_code,
          agent_name: `${qualityMetrics[0].agent_first_name} ${qualityMetrics[0].agent_last_name || ''}`.trim(),
          quality: qualityMetrics[0].quality_pct
        } : { agent_code: '', agent_name: '', quality: 0 },
        bottom_performer: qualityMetrics.length > 0 ? {
          agent_code: qualityMetrics[qualityMetrics.length - 1].agent_code,
          agent_name: `${qualityMetrics[qualityMetrics.length - 1].agent_first_name} ${qualityMetrics[qualityMetrics.length - 1].agent_last_name || ''}`.trim(),
          quality: qualityMetrics[qualityMetrics.length - 1].quality_pct
        } : { agent_code: '', agent_name: '', quality: 0 },
        quality_distribution: distribution
      };

      // Build agent breakdown with weak areas and risk scoring
      const agentBreakdown: AgentBreakdown[] = qualityMetrics.map((m: any) => {
        const weakAreas: string[] = [];
        if (m.quality_pct < 85) weakAreas.push('Communication');
        if (m.quality_pct < 75) weakAreas.push('Problem Resolution');
        if (m.poor_calls > 5) weakAreas.push('Consistency');

        let riskScore = 30; // baseline
        if (m.quality_pct < 70) riskScore = 80;
        else if (m.quality_pct < 75) riskScore = 65;
        else if (m.quality_pct < 80) riskScore = 50;
        else if (m.quality_pct < 85) riskScore = 35;

        return {
          agent_code: m.agent_code,
          agent_name: `${m.agent_first_name} ${m.agent_last_name || ''}`.trim(),
          quality_pct: m.quality_pct,
          calls_handled: m.calls_handled,
          weak_areas: weakAreas,
          coaching_needed: m.quality_pct < 70,
          risk_score: riskScore
        };
      });

      return { team_summary: teamSummary, agent_breakdown: agentBreakdown };
    } finally {
      conn.release();
    }
  }
}

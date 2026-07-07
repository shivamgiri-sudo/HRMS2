import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

interface DropOffAnalysis {
  fromStage: string;
  toStage: string;
  dropOff: number;
  dropOffRate: number;
}

interface TimeSeriesDataPoint {
  date: string;
  arrivals: number;
  selections: number;
  rejections: number;
  pending: number;
  avgWaitHours: number;
}

interface Comparison {
  arrivals: number;
  selections: number;
  rejections: number;
}

interface RecruiterMetrics {
  id: string;
  name: string;
  branch: string;
  avatar: string | null;
  metrics: {
    sourcedCount: number;
    attendedCount: number;
    selectedCount: number;
    selectionRate: number;
    slaComplianceRate: number;
    avgWaitMinutes: number;
  };
  performance: "exceeds" | "meets" | "below";
  trend: "up" | "down" | "stable";
  attentionFlags: string[] | null;
}

interface LeaderboardEntry {
  recruiterId: string;
  rank: number;
  score: number;
}

interface SourceChannel {
  name: string;
  arrivals: number;
  selections: number;
  rejections: number;
  selectionRate: number;
  avgWaitMinutes: number;
}

interface RejectionReason {
  reason: string;
  count: number;
  percentage: number;
}

interface QueueMetrics {
  queueLength: number;
  avgWaitTime: number;
  slaBreachCount: number;
  nextInterview: string | null;
}

/**
 * Analytics Service for ATS Command Center
 * Provides aggregated data for dashboard visualizations
 */
export class ATSAnalyticsService {
  /**
   * Get hiring funnel data showing progression through stages
   */
  async getHiringFunnel(filters: {
    period?: string;
    branch?: string;
    process?: string;
    recruiter?: string;
  }): Promise<{ funnel: FunnelStage[]; dropOffAnalysis: DropOffAnalysis[] }> {
    const whereConditions: string[] = ["1=1"];
    const params: unknown[] = [];

    // Apply period filter
    if (filters.period && filters.period !== "ALL") {
      whereConditions.push(this.getPeriodWhereClause(filters.period));
    }

    // Apply branch filter
    if (filters.branch) {
      whereConditions.push("applied_for_branch = ?");
      params.push(filters.branch);
    }

    // Apply process filter
    if (filters.process) {
      whereConditions.push("applied_for_process = ?");
      params.push(filters.process);
    }

    // Apply recruiter filter
    if (filters.recruiter) {
      whereConditions.push("recruiter_assigned_name = ?");
      params.push(filters.recruiter);
    }

    const whereClause = whereConditions.join(" AND ");

    // Get stage counts - using actual database column names
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        'Registered' as stage, COUNT(*) as count FROM ats_candidate WHERE ${whereClause}
      UNION ALL
      SELECT
        'Screened' as stage, COUNT(*) as count FROM ats_candidate
        WHERE ${whereClause} AND current_stage IN ('Screening', 'Interview', 'Selected', 'Joined', 'Onboarding')
      UNION ALL
      SELECT
        'Interviewed' as stage, COUNT(*) as count FROM ats_candidate
        WHERE ${whereClause} AND current_stage IN ('Interview', 'Selected', 'Joined', 'Onboarding')
      UNION ALL
      SELECT
        'Selected' as stage, COUNT(*) as count FROM ats_candidate
        WHERE ${whereClause} AND current_stage IN ('Selected', 'Joined', 'Onboarding')
      UNION ALL
      SELECT
        'Joined' as stage, COUNT(*) as count FROM ats_candidate
        WHERE ${whereClause} AND current_stage = 'Joined'
      ORDER BY count DESC`,
      [...params, ...params, ...params, ...params, ...params]
    );

    const totalRegistered = rows.find(r => r.stage === "Registered")?.count || 1;

    const funnel: FunnelStage[] = rows.map(row => ({
      stage: String(row.stage),
      count: Number(row.count),
      percentage: Math.round((Number(row.count) / totalRegistered) * 100)
    }));

    // Calculate drop-off between stages
    const dropOffAnalysis: DropOffAnalysis[] = [];
    for (let i = 0; i < funnel.length - 1; i++) {
      const current = funnel[i];
      const next = funnel[i + 1];
      const dropOff = current.count - next.count;
      const dropOffRate = current.count > 0 ? Math.round((dropOff / current.count) * 100) : 0;

      dropOffAnalysis.push({
        fromStage: current.stage,
        toStage: next.stage,
        dropOff,
        dropOffRate
      });
    }

    return { funnel, dropOffAnalysis };
  }

  /**
   * Get time-series trends data
   */
  async getTrendsData(filters: {
    period?: string;
    branch?: string;
    process?: string;
    days?: number;
  }): Promise<{
    timeSeries: TimeSeriesDataPoint[];
    comparisons: {
      mtdVsLastMonth: Comparison;
      wtdVsLastWeek: Comparison;
    };
  }> {
    const days = filters.days || 30;
    const whereConditions: string[] = [];
    const params: unknown[] = [];

    // Apply branch filter
    if (filters.branch) {
      whereConditions.push("applied_for_branch = ?");
      params.push(filters.branch);
    }

    // Apply process filter
    if (filters.process) {
      whereConditions.push("applied_for_process = ?");
      params.push(filters.process);
    }

    const whereClause = whereConditions.length > 0 ? `AND ${whereConditions.join(" AND ")}` : "";

    // Get daily time series - using actual database columns
    const [timeSeriesRows] = await db.execute<RowDataPacket[]>(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as arrivals,
        SUM(CASE WHEN current_stage IN ('Selected', 'Joined', 'Onboarding') THEN 1 ELSE 0 END) as selections,
        SUM(CASE WHEN current_stage = 'Rejected' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN current_stage NOT IN ('Selected', 'Joined', 'Rejected', 'Onboarding') THEN 1 ELSE 0 END) as pending,
        AVG(TIMESTAMPDIFF(HOUR, created_at, IFNULL(updated_at, NOW()))) as avgWaitHours
      FROM ats_candidate
      WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ${whereClause}
      GROUP BY DATE(created_at)
      ORDER BY date DESC`,
      [days, ...params]
    );

    const timeSeries: TimeSeriesDataPoint[] = timeSeriesRows.map(row => ({
      date: String(row.date),
      arrivals: Number(row.arrivals),
      selections: Number(row.selections),
      rejections: Number(row.rejections),
      pending: Number(row.pending),
      avgWaitHours: Number(row.avgWaitHours || 0)
    }));

    // Get month-to-date comparison - using current_stage
    const [mtdRows] = await db.execute<RowDataPacket[]>(
      `SELECT
        'current' as period,
        COUNT(*) as arrivals,
        SUM(CASE WHEN current_stage IN ('Selected', 'Joined', 'Onboarding') THEN 1 ELSE 0 END) as selections,
        SUM(CASE WHEN current_stage = 'Rejected' THEN 1 ELSE 0 END) as rejections
      FROM ats_candidate
      WHERE YEAR(created_at) = YEAR(CURDATE())
        AND MONTH(created_at) = MONTH(CURDATE())
        ${whereClause}
      UNION ALL
      SELECT
        'previous' as period,
        COUNT(*) as arrivals,
        SUM(CASE WHEN current_stage IN ('Selected', 'Joined', 'Onboarding') THEN 1 ELSE 0 END) as selections,
        SUM(CASE WHEN current_stage = 'Rejected' THEN 1 ELSE 0 END) as rejections
      FROM ats_candidate
      WHERE YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
        AND MONTH(created_at) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
        ${whereClause}`,
      [...params, ...params]
    );

    const currentMonth = mtdRows.find(r => r.period === "current");
    const previousMonth = mtdRows.find(r => r.period === "previous");

    const mtdVsLastMonth: Comparison = {
      arrivals: Number(currentMonth?.arrivals || 0) - Number(previousMonth?.arrivals || 0),
      selections: Number(currentMonth?.selections || 0) - Number(previousMonth?.selections || 0),
      rejections: Number(currentMonth?.rejections || 0) - Number(previousMonth?.rejections || 0)
    };

    // Week-to-date comparison (simplified - using 7 days)
    const wtdVsLastWeek: Comparison = {
      arrivals: 0,
      selections: 0,
      rejections: 0
    };

    return { timeSeries, comparisons: { mtdVsLastMonth, wtdVsLastWeek } };
  }

  /**
   * Get recruiter performance data
   */
  async getRecruiterPerformance(filters: {
    period?: string;
    branch?: string;
  }): Promise<{
    recruiters: RecruiterMetrics[];
    leaderboard: LeaderboardEntry[];
  }> {
    const whereConditions: string[] = ["rr.active_status = 1"];
    const params: unknown[] = [];

    if (filters.period && filters.period !== "ALL") {
      whereConditions.push(this.getPeriodWhereClause(filters.period, "c"));
    }

    if (filters.branch) {
      whereConditions.push("c.applied_for_branch = ?");
      params.push(filters.branch);
    }

    const whereClause = whereConditions.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        rr.id,
        rr.name,
        rr.branch,
        rr.email,
        COUNT(DISTINCT c.id) as sourcedCount,
        COUNT(DISTINCT CASE WHEN c.status != 'Pending' THEN c.id END) as attendedCount,
        COUNT(DISTINCT CASE WHEN c.status = 'Selected' THEN c.id END) as selectedCount,
        AVG(CASE
          WHEN c.status = 'Selected' THEN 100
          WHEN c.status = 'Rejected' THEN 0
          ELSE 50
        END) as selectionRate,
        AVG(CASE WHEN c.sla_breach = 1 THEN 0 ELSE 100 END) as slaComplianceRate,
        AVG(TIMESTAMPDIFF(MINUTE, c.created_at, IFNULL(c.updated_at, NOW()))) as avgWaitMinutes
      FROM ats_recruiter_roster rr
      LEFT JOIN ats_candidate c ON rr.name = c.recruiter_assigned_name
        AND ${whereClause}
      WHERE rr.active_status = 1
      GROUP BY rr.id, rr.name, rr.branch, rr.email
      HAVING sourcedCount > 0
      ORDER BY selectionRate DESC, selectedCount DESC`,
      params
    );

    const recruiters: RecruiterMetrics[] = rows.map((row, index) => {
      const selectionRate = Number(row.selectionRate || 0);
      const slaRate = Number(row.slaComplianceRate || 0);

      let performance: "exceeds" | "meets" | "below" = "meets";
      if (selectionRate >= 80 && slaRate >= 90) performance = "exceeds";
      else if (selectionRate < 50 || slaRate < 70) performance = "below";

      const attentionFlags: string[] = [];
      if (slaRate < 70) attentionFlags.push("High SLA breach");
      if (selectionRate < 40) attentionFlags.push("Low selection rate");
      if (Number(row.sourcedCount) < 5) attentionFlags.push("Low activity");

      return {
        id: String(row.id),
        name: String(row.name),
        branch: String(row.branch || ""),
        avatar: null,
        metrics: {
          sourcedCount: Number(row.sourcedCount),
          attendedCount: Number(row.attendedCount),
          selectedCount: Number(row.selectedCount),
          selectionRate: Math.round(selectionRate),
          slaComplianceRate: Math.round(slaRate),
          avgWaitMinutes: Math.round(Number(row.avgWaitMinutes || 0))
        },
        performance,
        trend: "stable" as const,
        attentionFlags: attentionFlags.length > 0 ? attentionFlags : null
      };
    });

    // Create leaderboard
    const leaderboard: LeaderboardEntry[] = recruiters
      .map((r, index) => ({
        recruiterId: r.id,
        rank: index + 1,
        score: Math.round((r.metrics.selectionRate + r.metrics.slaComplianceRate) / 2)
      }))
      .slice(0, 10);

    return { recruiters, leaderboard };
  }

  /**
   * Get source channel analytics
   */
  async getSourceAnalytics(filters: {
    period?: string;
    branch?: string;
  }): Promise<{
    channels: SourceChannel[];
  }> {
    const whereConditions: string[] = ["1=1"];
    const params: unknown[] = [];

    if (filters.period && filters.period !== "ALL") {
      whereConditions.push(this.getPeriodWhereClause(filters.period));
    }

    if (filters.branch) {
      whereConditions.push("applied_for_branch = ?");
      params.push(filters.branch);
    }

    const whereClause = whereConditions.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        COALESCE(source, 'Direct') as name,
        COUNT(*) as arrivals,
        SUM(CASE WHEN status = 'Selected' THEN 1 ELSE 0 END) as selections,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejections,
        AVG(CASE WHEN status = 'Selected' THEN 100 ELSE 0 END) as selectionRate,
        AVG(TIMESTAMPDIFF(MINUTE, created_at, IFNULL(updated_at, NOW()))) as avgWaitMinutes
      FROM ats_candidate
      WHERE ${whereClause}
      GROUP BY COALESCE(source, 'Direct')
      ORDER BY arrivals DESC
      LIMIT 10`,
      params
    );

    const channels: SourceChannel[] = rows.map(row => ({
      name: String(row.name),
      arrivals: Number(row.arrivals),
      selections: Number(row.selections),
      rejections: Number(row.rejections),
      selectionRate: Math.round(Number(row.selectionRate)),
      avgWaitMinutes: Math.round(Number(row.avgWaitMinutes || 0))
    }));

    return { channels };
  }

  /**
   * Get rejection analysis data
   */
  async getRejectionAnalytics(filters: {
    period?: string;
    branch?: string;
  }): Promise<{
    reasons: RejectionReason[];
    trends: TimeSeriesDataPoint[];
  }> {
    const whereConditions: string[] = ["status = 'Rejected'"];
    const params: unknown[] = [];

    if (filters.period && filters.period !== "ALL") {
      whereConditions.push(this.getPeriodWhereClause(filters.period));
    }

    if (filters.branch) {
      whereConditions.push("applied_for_branch = ?");
      params.push(filters.branch);
    }

    const whereClause = whereConditions.join(" AND ");

    // Get rejection reasons
    const [reasonRows] = await db.execute<RowDataPacket[]>(
      `SELECT
        COALESCE(rejection_reason, 'Unspecified') as reason,
        COUNT(*) as count
      FROM ats_candidate
      WHERE ${whereClause}
      GROUP BY COALESCE(rejection_reason, 'Unspecified')
      ORDER BY count DESC
      LIMIT 10`,
      params
    );

    const totalRejections = reasonRows.reduce((sum, row) => sum + Number(row.count), 0);

    const reasons: RejectionReason[] = reasonRows.map(row => ({
      reason: String(row.reason),
      count: Number(row.count),
      percentage: totalRejections > 0 ? Math.round((Number(row.count) / totalRejections) * 100) : 0
    }));

    // Get rejection trends (last 7 weeks)
    const [trendRows] = await db.execute<RowDataPacket[]>(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as rejections
      FROM ats_candidate
      WHERE status = 'Rejected'
        AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 49 DAY)
        ${filters.branch ? "AND applied_for_branch = ?" : ""}
      GROUP BY DATE(created_at)
      ORDER BY date DESC`,
      filters.branch ? [filters.branch] : []
    );

    const trends: TimeSeriesDataPoint[] = trendRows.map(row => ({
      date: String(row.date),
      arrivals: 0,
      selections: 0,
      rejections: Number(row.rejections),
      pending: 0,
      avgWaitHours: 0
    }));

    return { reasons, trends };
  }

  /**
   * Get real-time queue metrics
   */
  async getQueueMetrics(filters: {
    branch?: string;
  }): Promise<QueueMetrics> {
    const whereConditions: string[] = ["status = 'Pending'"];
    const params: unknown[] = [];

    if (filters.branch) {
      whereConditions.push("applied_for_branch = ?");
      params.push(filters.branch);
    }

    const whereClause = whereConditions.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        COUNT(*) as queueLength,
        AVG(TIMESTAMPDIFF(MINUTE, created_at, NOW())) as avgWaitTime,
        SUM(CASE WHEN sla_breach = 1 THEN 1 ELSE 0 END) as slaBreachCount,
        (SELECT created_at FROM ats_candidate WHERE ${whereClause} ORDER BY created_at ASC LIMIT 1) as nextInterview
      FROM ats_candidate
      WHERE ${whereClause}`,
      [...params, ...params]
    );

    const row = rows[0];

    return {
      queueLength: Number(row?.queueLength || 0),
      avgWaitTime: Math.round(Number(row?.avgWaitTime || 0)),
      slaBreachCount: Number(row?.slaBreachCount || 0),
      nextInterview: row?.nextInterview ? String(row.nextInterview) : null
    };
  }

  /**
   * Helper: Get SQL WHERE clause for period filter
   */
  private getPeriodWhereClause(period: string, tableAlias?: string): string {
    const table = tableAlias ? `${tableAlias}.` : "";

    switch (period) {
      case "FTD":
        return `DATE(${table}created_at) = CURDATE()`;
      case "WTD":
        return `YEARWEEK(${table}created_at, 1) = YEARWEEK(CURDATE(), 1)`;
      case "MTD":
        return `YEAR(${table}created_at) = YEAR(CURDATE()) AND MONTH(${table}created_at) = MONTH(CURDATE())`;
      default:
        return "1=1";
    }
  }
}

export const atsAnalyticsService = new ATSAnalyticsService();

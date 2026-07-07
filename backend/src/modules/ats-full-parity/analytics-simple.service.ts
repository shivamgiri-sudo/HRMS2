/**
 * Simplified Analytics Service
 * Leverages existing atsFullParity.webData() instead of duplicating queries
 */

import { atsFullParityService } from "./atsFullParity.service.js";

export class SimpleAnalyticsService {
  /**
   * Get hiring funnel - simplified to use existing data
   */
  async getHiringFunnel(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);
    const candidates = webData.candidateRows || [];

    // Count candidates by stage
    const registered = candidates.length;
    const screened = candidates.filter((c: any) =>
      c.current_stage && !['New', 'Applied', 'Registered'].includes(c.current_stage)
    ).length;
    const interviewed = candidates.filter((c: any) =>
      c.current_stage && ['Interview', 'Assessment', "OP's Round", 'Client Round', 'Selected', 'Joined'].includes(c.current_stage)
    ).length;
    const selected = candidates.filter((c: any) =>
      c._selected || ['Selected', 'Joined', 'Onboarding'].includes(c.current_stage)
    ).length;
    const joined = candidates.filter((c: any) =>
      c.current_stage === 'Joined'
    ).length;

    const funnel = [
      { stage: "Registered", count: registered, percentage: 100 },
      { stage: "Screened", count: screened, percentage: registered > 0 ? Math.round((screened / registered) * 100) : 0 },
      { stage: "Interviewed", count: interviewed, percentage: registered > 0 ? Math.round((interviewed / registered) * 100) : 0 },
      { stage: "Selected", count: selected, percentage: registered > 0 ? Math.round((selected / registered) * 100) : 0 },
      { stage: "Joined", count: joined, percentage: registered > 0 ? Math.round((joined / registered) * 100) : 0 },
    ];

    const dropOffAnalysis = [];
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
   * Get trends data - use existing summary data
   */
  async getTrendsData(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);

    // Use existing dashboard rows for time series
    const timeSeries = (webData.dashboardRows || []).map((row: any) => ({
      date: row.Date || row._dateKey,
      arrivals: Number(row["Total Arrival"] || 0),
      selections: Number(row.Selection || 0),
      rejections: Number(row.Rejection || 0),
      pending: Number(row.Pending || 0),
      avgWaitHours: Math.round(Number(row["Avg Time"] || 0) / 60 * 10) / 10
    }));

    // Calculate comparisons from trends
    const trends = webData.trends || {};
    const today = trends.today || {};
    const wtd = trends.wtd || {};
    const mtd = trends.mtd || {};

    return {
      timeSeries,
      comparisons: {
        mtdVsLastMonth: {
          arrivals: Number(mtd.totalArrival || 0) - Number(today.totalArrival || 0),
          selections: Number(mtd.totalSelection || 0) - Number(today.totalSelection || 0),
          rejections: Number(mtd.totalRejection || 0) - Number(today.totalRejection || 0)
        },
        wtdVsLastWeek: {
          arrivals: Number(wtd.totalArrival || 0),
          selections: Number(wtd.totalSelection || 0),
          rejections: Number(wtd.totalRejection || 0)
        }
      }
    };
  }

  /**
   * Get recruiter performance - use existing recruiter table
   */
  async getRecruiterPerformance(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);
    const recruiterTable = webData.recruiterTable || [];

    const recruiters = recruiterTable.map((r: any, index: number) => {
      const selectionRate = Number(r.SelectionRate || 0);
      const slaRate = Number(r.SlaCompliancePercent || 0);

      let performance: "exceeds" | "meets" | "below" = "meets";
      if (selectionRate >= 40 && slaRate >= 90) performance = "exceeds";
      else if (selectionRate < 20 || slaRate < 70) performance = "below";

      const attentionFlags: string[] = [];
      if (slaRate < 70) attentionFlags.push("High SLA breach");
      if (selectionRate < 20) attentionFlags.push("Low selection rate");
      if (Number(r.SourcedCount || 0) < 5) attentionFlags.push("Low activity");

      return {
        id: String(r.Recruiter || index),
        name: String(r.Recruiter || "Unknown"),
        branch: String(r.Branch || ""),
        avatar: null,
        metrics: {
          sourcedCount: Number(r.SourcedCount || 0),
          attendedCount: Number(r.AttendedCount || 0),
          selectedCount: Number(r.SelectedCount || 0),
          selectionRate: Math.round(selectionRate),
          slaComplianceRate: Math.round(slaRate),
          avgWaitMinutes: Math.round(Number(r.AvgWaitMinutes || 0))
        },
        performance,
        trend: "stable" as const,
        attentionFlags: attentionFlags.length > 0 ? attentionFlags : null
      };
    });

    const leaderboard = recruiters
      .map((r, index) => ({
        recruiterId: r.id,
        rank: index + 1,
        score: Math.round((r.metrics.selectionRate + r.metrics.slaComplianceRate) / 2)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return { recruiters, leaderboard };
  }

  /**
   * Get source analytics - use existing source table
   */
  async getSourceAnalytics(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);
    const sourceTable = webData.sourceTable || [];

    const channels = sourceTable.map((s: any) => ({
      name: String(s.Name || "Unknown"),
      arrivals: Number(s.TotalArrival || 0),
      selections: Number(s.Selection || 0),
      rejections: Number(s.Rejection || 0),
      selectionRate: Math.round(Number(s.SelectionRate || 0)),
      avgWaitMinutes: Math.round(Number(s.AvgWaitMinutes || 0))
    }));

    return { channels };
  }

  /**
   * Get rejection analytics
   */
  async getRejectionAnalytics(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);
    const candidates = webData.candidateRows || [];

    const rejected = candidates.filter((c: any) => c._rejected);

    // Count by rejection reason
    const reasonCounts: Record<string, number> = {};
    rejected.forEach((c: any) => {
      const reason = c._hardRejectReason || c.rejection_reason || "Unspecified";
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    const totalRejections = rejected.length;
    const reasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: totalRejections > 0 ? Math.round((count / totalRejections) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Simplified trends - just use rejection counts from periods
    const trends = (webData.dashboardRows || []).map((row: any) => ({
      date: row.Date || row._dateKey,
      arrivals: 0,
      selections: 0,
      rejections: Number(row.Rejection || 0),
      pending: 0,
      avgWaitHours: 0
    }));

    return { reasons, trends };
  }

  /**
   * Get real-time queue metrics
   */
  async getQueueMetrics(filters: Record<string, string>) {
    const webData = await atsFullParityService.webData(filters);
    const queueRows = webData.queueRows || [];

    const slaBreachCount = queueRows.filter((r: any) => r.SLAFlag).length;
    const avgWaitTime = queueRows.length > 0
      ? Math.round(queueRows.reduce((sum: number, r: any) => sum + Number(r.WaitingMinutes || 0), 0) / queueRows.length)
      : 0;

    return {
      queueLength: queueRows.length,
      avgWaitTime,
      slaBreachCount,
      nextInterview: queueRows[0]?.created_at || null
    };
  }
}

export const simpleAnalyticsService = new SimpleAnalyticsService();

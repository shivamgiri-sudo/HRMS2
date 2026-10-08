/**
 * Cost Efficiency Analysis Routes
 * Endpoints to expose cost efficiency metrics as REST API
 *
 * Base Path: /api/admin/cost-efficiency
 *
 * Endpoints:
 *   GET /api/admin/cost-efficiency/agents
 *   GET /api/admin/cost-efficiency/processes
 *   GET /api/admin/cost-efficiency/opportunities
 *   GET /api/admin/cost-efficiency/salary-quality
 *   GET /api/admin/cost-efficiency/forecast
 *   GET /api/admin/cost-efficiency/dashboard
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../../middleware/requireRole.js';
import { CostEfficiencyService } from './costEfficiency.service.js';
import { logger } from '../../logger.js';

const router = Router();

// Middleware: Require HR or Finance leadership role
const requireCostAccess = requireRole('super_admin', 'hr', 'finance', 'finance_head', 'accounts_head');

// ──────────────────────────────────────────────────────────────────────────
// Helper: Query Parameter Extraction
// ──────────────────────────────────────────────────────────────────────────

function getQueryParams(req: Request) {
  const daysBack = parseInt(req.query.daysBack as string, 10) || 30;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const topN = parseInt(req.query.topN as string, 10) || 20;

  // Validate ranges
  const validDaysBack = Math.min(Math.max(daysBack, 7), 180); // 7-180 days
  const validLimit = Math.min(Math.max(limit, 10), 500); // 10-500 rows
  const validTopN = Math.min(Math.max(topN, 5), 100); // 5-100 results

  return { daysBack: validDaysBack, limit: validLimit, topN: validTopN };
}

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /agents
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/agents',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack, limit } = getQueryParams(req);
      const data = await CostEfficiencyService.getAgentCostEfficiency(daysBack, limit);

      res.json({
        success: true,
        message: `Retrieved ${data.length} agent cost efficiency records`,
        meta: {
          daysBack,
          limit,
          count: data.length,
          timestamp: new Date().toISOString(),
        },
        data,
      });
    } catch (error) {
      logger.error('Error in GET /agents:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /processes
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/processes',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack, limit } = getQueryParams(req);
      const data = await CostEfficiencyService.getProcessROI(daysBack, limit);

      res.json({
        success: true,
        message: `Retrieved ${data.length} process ROI records`,
        meta: {
          daysBack,
          limit,
          count: data.length,
          timestamp: new Date().toISOString(),
        },
        data,
      });
    } catch (error) {
      logger.error('Error in GET /processes:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /opportunities
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/opportunities',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack, topN } = getQueryParams(req);
      const data = await CostEfficiencyService.getSavingsOpportunities(topN, daysBack);

      const totalSavings = data.reduce((sum, row) => sum + (row.potential_monthly_savings || 0), 0);

      res.json({
        success: true,
        message: `Retrieved ${data.length} savings opportunities`,
        meta: {
          daysBack,
          topN,
          count: data.length,
          totalMonthlySavings: totalSavings,
          totalAnnualSavings: totalSavings * 12,
          timestamp: new Date().toISOString(),
        },
        data,
      });
    } catch (error) {
      logger.error('Error in GET /opportunities:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /salary-quality
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/salary-quality',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack } = getQueryParams(req);
      const data = await CostEfficiencyService.getSalaryQualityCorrelation(daysBack);

      res.json({
        success: true,
        message: 'Retrieved salary-quality correlation analysis',
        meta: {
          daysBack,
          quartiles: data.length,
          timestamp: new Date().toISOString(),
        },
        data,
      });
    } catch (error) {
      logger.error('Error in GET /salary-quality:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /forecast
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/forecast',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack } = getQueryParams(req);
      const data = await CostEfficiencyService.getAnnualForecast(daysBack);

      res.json({
        success: true,
        message: 'Retrieved annual cost forecast',
        meta: {
          daysBack,
          projectionBasis: `${daysBack}-day trend annualized`,
          timestamp: new Date().toISOString(),
        },
        data: data[0] || null,
      });
    } catch (error) {
      logger.error('Error in GET /forecast:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /dashboard
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/dashboard',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack } = getQueryParams(req);
      const dashboard = await CostEfficiencyService.getDashboard(daysBack);

      res.json({
        success: true,
        message: 'Retrieved comprehensive cost efficiency dashboard',
        meta: {
          daysBack,
          timestamp: new Date().toISOString(),
        },
        data: dashboard,
      });
    } catch (error) {
      logger.error('Error in GET /dashboard:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Endpoint: GET /export (CSV Export)
// ──────────────────────────────────────────────────────────────────────────

router.get(
  '/export/:report',
  requireCostAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysBack } = getQueryParams(req);
      const report = req.params.report as string;

      let data;
      let filename;

      switch (report) {
        case 'agents':
          data = await CostEfficiencyService.getAgentCostEfficiency(daysBack, 500);
          filename = `agent-cost-efficiency-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'processes':
          data = await CostEfficiencyService.getProcessROI(daysBack, 100);
          filename = `process-roi-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'opportunities':
          data = await CostEfficiencyService.getSavingsOpportunities(50, daysBack);
          filename = `savings-opportunities-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid report type. Use: agents, processes, opportunities',
          });
      }

      // Convert to CSV
      if (data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No data available for export',
        });
      }

      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      logger.error('Error in GET /export:', error);
      next(error);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Helper: Convert Array of Objects to CSV
// ──────────────────────────────────────────────────────────────────────────

function convertToCSV(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          // Escape quotes and wrap in quotes if contains comma
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(','),
    ),
  ];

  return csv.join('\n');
}

export default router;

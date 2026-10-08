import { Router, Request, Response } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { ConversionFunnelService } from "./conversion-funnel.service.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db as pool } from "../../db/mysql.js";

const router = Router();

/**
 * POST /api/kpi/conversion-funnel/inbound
 * Record an inbound call conversion event
 */
router.post(
  "/inbound",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const eventId = await ConversionFunnelService.recordInboundEvent({
        contact_id: req.body.contact_id,
        employee_id: req.body.employee_id,
        customer_id: req.body.customer_id,
        call_initiated_at: new Date(req.body.call_initiated_at),
        call_connected_at: req.body.call_connected_at
          ? new Date(req.body.call_connected_at)
          : undefined,
        concern_identified_at: req.body.concern_identified_at
          ? new Date(req.body.concern_identified_at)
          : undefined,
        offer_presented_at: req.body.offer_presented_at
          ? new Date(req.body.offer_presented_at)
          : undefined,
        sale_completed_at: req.body.sale_completed_at
          ? new Date(req.body.sale_completed_at)
          : undefined,
        sale_amount: req.body.sale_amount,
        iq_score: req.body.iq_score,
        csat_score: req.body.csat_score,
      });

      res.json({
        success: true,
        message: "Inbound funnel event recorded",
        event_id: eventId,
      });
    } catch (error) {
      console.error("Error recording inbound event:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record inbound event",
      });
    }
  }
);

/**
 * POST /api/kpi/conversion-funnel/outbound
 * Record an outbound call conversion event
 */
router.post(
  "/outbound",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const eventId = await ConversionFunnelService.recordOutboundEvent({
        contact_id: req.body.contact_id,
        employee_id: req.body.employee_id,
        customer_id: req.body.customer_id,
        dial_initiated_at: new Date(req.body.dial_initiated_at),
        connection_established_at: req.body.connection_established_at
          ? new Date(req.body.connection_established_at)
          : undefined,
        talk_start_at: req.body.talk_start_at
          ? new Date(req.body.talk_start_at)
          : undefined,
        talk_end_at: req.body.talk_end_at
          ? new Date(req.body.talk_end_at)
          : undefined,
        talk_duration_secs: req.body.talk_duration_secs,
        sale_completed_at: req.body.sale_completed_at
          ? new Date(req.body.sale_completed_at)
          : undefined,
        sale_amount: req.body.sale_amount,
        attempt_number: req.body.attempt_number,
      });

      res.json({
        success: true,
        message: "Outbound funnel event recorded",
        event_id: eventId,
      });
    } catch (error) {
      console.error("Error recording outbound event:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record outbound event",
      });
    }
  }
);

/**
 * POST /api/kpi/conversion-funnel/chat
 * Record a chat conversion event
 */
router.post(
  "/chat",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const eventId = await ConversionFunnelService.recordChatEvent({
        contact_id: req.body.contact_id,
        employee_id: req.body.employee_id,
        customer_id: req.body.customer_id,
        chat_initiated_at: new Date(req.body.chat_initiated_at),
        first_response_at: req.body.first_response_at
          ? new Date(req.body.first_response_at)
          : undefined,
        resolution_accepted_at: req.body.resolution_accepted_at
          ? new Date(req.body.resolution_accepted_at)
          : undefined,
        upsell_accepted_at: req.body.upsell_accepted_at
          ? new Date(req.body.upsell_accepted_at)
          : undefined,
        sale_completed_at: req.body.sale_completed_at
          ? new Date(req.body.sale_completed_at)
          : undefined,
        sale_amount: req.body.sale_amount,
        message_count: req.body.message_count,
        csat_score: req.body.csat_score,
      });

      res.json({
        success: true,
        message: "Chat funnel event recorded",
        event_id: eventId,
      });
    } catch (error) {
      console.error("Error recording chat event:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record chat event",
      });
    }
  }
);

/**
 * POST /api/kpi/conversion-funnel/email
 * Record an email conversion event
 */
router.post(
  "/email",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const eventId = await ConversionFunnelService.recordEmailEvent({
        contact_id: req.body.contact_id,
        employee_id: req.body.employee_id,
        customer_id: req.body.customer_id,
        email_received_at: new Date(req.body.email_received_at),
        email_subject: req.body.email_subject,
        first_response_at: req.body.first_response_at
          ? new Date(req.body.first_response_at)
          : undefined,
        resolution_provided_at: req.body.resolution_provided_at
          ? new Date(req.body.resolution_provided_at)
          : undefined,
        upsell_offered_at: req.body.upsell_offered_at
          ? new Date(req.body.upsell_offered_at)
          : undefined,
        sale_completed_at: req.body.sale_completed_at
          ? new Date(req.body.sale_completed_at)
          : undefined,
        sale_amount: req.body.sale_amount,
        email_exchange_count: req.body.email_exchange_count,
      });

      res.json({
        success: true,
        message: "Email funnel event recorded",
        event_id: eventId,
      });
    } catch (error) {
      console.error("Error recording email event:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record email event",
      });
    }
  }
);

/**
 * GET /api/kpi/conversion-funnel/metrics/:processType
 * Get funnel metrics for a specific process
 */
router.get(
  "/metrics/:processType",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const processType = req.params.processType as
        | "inbound"
        | "outbound"
        | "chat"
        | "email";
      const daysBack = parseInt(req.query.days as string) || 30;

      const metrics = await ConversionFunnelService.getFunnelMetrics(
        processType,
        daysBack
      );

      res.json({
        success: true,
        process_type: processType,
        days_back: daysBack,
        metrics,
      });
    } catch (error) {
      console.error("Error fetching funnel metrics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch funnel metrics",
      });
    }
  }
);

/**
 * GET /api/kpi/conversion-funnel/report/summary
 * Get comprehensive conversion funnel summary
 */
router.get(
  "/report/summary",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const connection = await pool.getConnection();

      // Overall summary
      const [summary] = await connection.query(
        `
        SELECT
          COUNT(DISTINCT cfe.id) as total_entries,
          COUNT(DISTINCT cfe.process_type) as unique_processes,
          COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) as total_conversions,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) /
                NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as overall_conversion_rate,
          COALESCE(SUM(
            CASE
              WHEN cfe.process_type = 'inbound' THEN ifd.sale_amount
              WHEN cfe.process_type = 'outbound' THEN ofd.sale_amount
              WHEN cfe.process_type = 'chat' THEN cfd.sale_amount
              WHEN cfe.process_type = 'email' THEN efd.sale_amount
              ELSE 0
            END
          ), 0) as total_revenue,
          MIN(cfe.stage_entered_at) as data_start,
          MAX(cfe.stage_entered_at) as data_end
        FROM conversion_funnel_event cfe
        LEFT JOIN inbound_funnel_detail ifd ON ifd.conversion_funnel_event_id = cfe.id
        LEFT JOIN outbound_funnel_detail ofd ON ofd.conversion_funnel_event_id = cfe.id
        LEFT JOIN chat_funnel_detail cfd ON cfd.conversion_funnel_event_id = cfe.id
        LEFT JOIN email_funnel_detail efd ON efd.conversion_funnel_event_id = cfe.id
        WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `
      );

      // By process type
      const [byProcess] = await connection.query(
        `
        SELECT
          cfe.process_type,
          COUNT(DISTINCT cfe.id) as entries,
          COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) as conversions,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) /
                NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as conversion_rate
        FROM conversion_funnel_event cfe
        WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY cfe.process_type
        `
      );

      connection.release();

      const summaryRows = summary as RowDataPacket[];
      const byProcessRows = byProcess as RowDataPacket[];

      res.json({
        success: true,
        summary: summaryRows[0],
        by_process: byProcessRows,
      });
    } catch (error) {
      console.error("Error fetching funnel summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch funnel summary",
      });
    }
  }
);

/**
 * GET /api/kpi/conversion-funnel/report/bottlenecks
 * Identify and report bottleneck stages
 */
router.get(
  "/report/bottlenecks",
  requireAuth,
  requireRole("Super Admin", "WFM", "Quality", "Process Manager"),
  async (req: Request, res: Response) => {
    try {
      const connection = await pool.getConnection();

      const [bottlenecks] = await connection.query(
        `
        WITH stage_counts AS (
          SELECT
            cfe.process_type,
            cfe.funnel_stage,
            COUNT(DISTINCT cfe.id) as stage_entries,
            ROW_NUMBER() OVER (PARTITION BY cfe.process_type ORDER BY COUNT(DISTINCT cfe.id) DESC) as stage_rank
          FROM conversion_funnel_event cfe
          WHERE cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY cfe.process_type, cfe.funnel_stage
        ),
        drop_off AS (
          SELECT
            sc1.process_type,
            sc1.funnel_stage,
            sc1.stage_entries,
            ROUND(100.0 * (1 - sc1.stage_entries / LAG(sc1.stage_entries) OVER (PARTITION BY sc1.process_type ORDER BY sc1.stage_rank)), 2) as drop_off_pct
          FROM stage_counts sc1
        )
        SELECT
          process_type,
          funnel_stage,
          stage_entries,
          drop_off_pct,
          CASE
            WHEN drop_off_pct > 50 THEN 'CRITICAL'
            WHEN drop_off_pct > 30 THEN 'WARNING'
            ELSE 'NORMAL'
          END as severity
        FROM drop_off
        WHERE drop_off_pct IS NOT NULL
        ORDER BY process_type, drop_off_pct DESC
        `
      );

      connection.release();

      res.json({
        success: true,
        bottlenecks,
      });
    } catch (error) {
      console.error("Error fetching bottlenecks:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch bottleneck analysis",
      });
    }
  }
);

export default router;

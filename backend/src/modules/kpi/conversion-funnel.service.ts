import { db as pool } from "../../db/mysql.js";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { randomUUID as uuidv4 } from "crypto";

interface ConversionFunnelEvent extends RowDataPacket {
  id: string;
  process_type: "inbound" | "outbound" | "chat" | "email";
  funnel_stage: string;
  contact_id: string;
  employee_id?: string;
  process_master_id?: string;
  customer_id?: string;
  stage_entered_at: Date;
  stage_exited_at?: Date;
  stage_duration_secs?: number;
  status: "pending" | "completed" | "abandoned" | "converted";
  conversion_flag: 0 | 1;
}

interface InboundFunnelDetail extends RowDataPacket {
  id: string;
  conversion_funnel_event_id: string;
  call_initiated_at?: Date;
  call_connected_at?: Date;
  concern_identified_at?: Date;
  offer_presented_at?: Date;
  sale_completed_at?: Date;
  sale_amount?: number;
}

export class ConversionFunnelService {
  /**
   * Record an inbound call conversion event
   */
  static async recordInboundEvent(data: {
    contact_id: string;
    employee_id?: string;
    customer_id?: string;
    call_initiated_at: Date;
    call_connected_at?: Date;
    concern_identified_at?: Date;
    offer_presented_at?: Date;
    sale_completed_at?: Date;
    sale_amount?: number;
    iq_score?: number;
    csat_score?: number;
  }): Promise<string> {
    const connection = await pool.getConnection();
    const funnelEventId = uuidv4();
    const detailId = uuidv4();

    try {
      await connection.beginTransaction();

      // Determine current stage and conversion
      let currentStage = "call_connect";
      let conversionFlag = 0;

      if (data.sale_completed_at) {
        currentStage = "sale_completed";
        conversionFlag = 1;
      } else if (data.offer_presented_at) {
        currentStage = "offer_presented";
      } else if (data.offer_presented_at) {
        currentStage = "offer_prepared";
      } else if (data.concern_identified_at) {
        currentStage = "concern_identified";
      }

      const stageDuration = data.call_connected_at
        ? Math.floor(
            (Date.now() - new Date(data.call_connected_at).getTime()) / 1000
          )
        : 0;

      // Insert main funnel event
      await connection.query(
        `
        INSERT INTO conversion_funnel_event
        (id, process_type, funnel_stage, contact_id, employee_id, customer_id,
         stage_entered_at, stage_duration_secs, status, conversion_flag)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
          funnelEventId,
          "inbound",
          currentStage,
          data.contact_id,
          data.employee_id,
          data.customer_id,
          stageDuration,
          data.sale_completed_at ? "completed" : "pending",
          conversionFlag,
        ]
      );

      // Insert inbound detail
      await connection.query(
        `
        INSERT INTO inbound_funnel_detail
        (id, conversion_funnel_event_id, call_initiated_at, call_connected_at,
         concern_identified_at, offer_presented_at, sale_completed_at, sale_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          detailId,
          funnelEventId,
          data.call_initiated_at,
          data.call_connected_at,
          data.concern_identified_at,
          data.offer_presented_at,
          data.sale_completed_at,
          data.sale_amount,
        ]
      );

      await connection.commit();
      return funnelEventId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Record an outbound call conversion event
   */
  static async recordOutboundEvent(data: {
    contact_id: string;
    employee_id?: string;
    customer_id?: string;
    dial_initiated_at: Date;
    connection_established_at?: Date;
    talk_start_at?: Date;
    talk_end_at?: Date;
    talk_duration_secs?: number;
    sale_completed_at?: Date;
    sale_amount?: number;
    attempt_number?: number;
  }): Promise<string> {
    const connection = await pool.getConnection();
    const funnelEventId = uuidv4();
    const detailId = uuidv4();

    try {
      await connection.beginTransaction();

      // Determine current stage and conversion
      let currentStage = "dial_initiated";
      let conversionFlag = 0;

      if (data.sale_completed_at) {
        currentStage = "sale_completed";
        conversionFlag = 1;
      } else if (
        data.talk_duration_secs &&
        data.talk_duration_secs > 30
      ) {
        currentStage = "talk_30s";
      } else if (data.connection_established_at) {
        currentStage = "call_connected";
      }

      const stageDuration = data.dial_initiated_at
        ? Math.floor(
            (Date.now() - new Date(data.dial_initiated_at).getTime()) / 1000
          )
        : 0;

      // Insert main funnel event
      await connection.query(
        `
        INSERT INTO conversion_funnel_event
        (id, process_type, funnel_stage, contact_id, employee_id, customer_id,
         stage_entered_at, stage_duration_secs, status, conversion_flag)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
          funnelEventId,
          "outbound",
          currentStage,
          data.contact_id,
          data.employee_id,
          data.customer_id,
          stageDuration,
          data.sale_completed_at ? "completed" : "pending",
          conversionFlag,
        ]
      );

      // Insert outbound detail
      await connection.query(
        `
        INSERT INTO outbound_funnel_detail
        (id, conversion_funnel_event_id, dial_initiated_at, connection_established_at,
         talk_start_at, talk_end_at, talk_duration_secs, sale_completed_at, sale_amount, attempt_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          detailId,
          funnelEventId,
          data.dial_initiated_at,
          data.connection_established_at,
          data.talk_start_at,
          data.talk_end_at,
          data.talk_duration_secs,
          data.sale_completed_at,
          data.sale_amount,
          data.attempt_number || 1,
        ]
      );

      await connection.commit();
      return funnelEventId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Record a chat conversion event
   */
  static async recordChatEvent(data: {
    contact_id: string;
    employee_id?: string;
    customer_id?: string;
    chat_initiated_at: Date;
    first_response_at?: Date;
    resolution_accepted_at?: Date;
    upsell_accepted_at?: Date;
    sale_completed_at?: Date;
    sale_amount?: number;
    message_count?: number;
    csat_score?: number;
  }): Promise<string> {
    const connection = await pool.getConnection();
    const funnelEventId = uuidv4();
    const detailId = uuidv4();

    try {
      await connection.beginTransaction();

      let currentStage = "chat_initiated";
      let conversionFlag = 0;

      if (data.sale_completed_at) {
        currentStage = "sale_completed";
        conversionFlag = 1;
      } else if (data.upsell_accepted_at) {
        currentStage = "upsell_offered";
      } else if (data.resolution_accepted_at) {
        currentStage = "issue_resolved";
      } else if (data.first_response_at) {
        currentStage = "first_response";
      }

      const stageDuration = data.chat_initiated_at
        ? Math.floor(
            (Date.now() - new Date(data.chat_initiated_at).getTime()) / 1000
          )
        : 0;

      await connection.query(
        `
        INSERT INTO conversion_funnel_event
        (id, process_type, funnel_stage, contact_id, employee_id, customer_id,
         stage_entered_at, stage_duration_secs, status, conversion_flag)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
          funnelEventId,
          "chat",
          currentStage,
          data.contact_id,
          data.employee_id,
          data.customer_id,
          stageDuration,
          data.sale_completed_at ? "completed" : "pending",
          conversionFlag,
        ]
      );

      const firstResponseTime = data.first_response_at
        ? Math.floor(
            (new Date(data.first_response_at).getTime() -
              new Date(data.chat_initiated_at).getTime()) /
              1000
          )
        : null;

      await connection.query(
        `
        INSERT INTO chat_funnel_detail
        (id, conversion_funnel_event_id, chat_initiated_at, first_response_at,
         first_response_time_secs, resolution_accepted_at, upsell_accepted_at,
         sale_completed_at, sale_amount, message_count, csat_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          detailId,
          funnelEventId,
          data.chat_initiated_at,
          data.first_response_at,
          firstResponseTime,
          data.resolution_accepted_at,
          data.upsell_accepted_at,
          data.sale_completed_at,
          data.sale_amount,
          data.message_count,
          data.csat_score,
        ]
      );

      await connection.commit();
      return funnelEventId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Record an email conversion event
   */
  static async recordEmailEvent(data: {
    contact_id: string;
    employee_id?: string;
    customer_id?: string;
    email_received_at: Date;
    email_subject?: string;
    first_response_at?: Date;
    resolution_provided_at?: Date;
    upsell_offered_at?: Date;
    sale_completed_at?: Date;
    sale_amount?: number;
    email_exchange_count?: number;
  }): Promise<string> {
    const connection = await pool.getConnection();
    const funnelEventId = uuidv4();
    const detailId = uuidv4();

    try {
      await connection.beginTransaction();

      let currentStage = "email_received";
      let conversionFlag = 0;

      if (data.sale_completed_at) {
        currentStage = "sale_completed";
        conversionFlag = 1;
      } else if (data.upsell_offered_at) {
        currentStage = "upsell_offered";
      } else if (data.resolution_provided_at) {
        currentStage = "issue_resolved";
      } else if (data.first_response_at) {
        currentStage = "first_response";
      }

      const stageDuration = data.email_received_at
        ? Math.floor(
            (Date.now() - new Date(data.email_received_at).getTime()) / 1000
          )
        : 0;

      await connection.query(
        `
        INSERT INTO conversion_funnel_event
        (id, process_type, funnel_stage, contact_id, employee_id, customer_id,
         stage_entered_at, stage_duration_secs, status, conversion_flag)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
          funnelEventId,
          "email",
          currentStage,
          data.contact_id,
          data.employee_id,
          data.customer_id,
          stageDuration,
          data.sale_completed_at ? "completed" : "pending",
          conversionFlag,
        ]
      );

      const responseTime = data.first_response_at
        ? Math.floor(
            (new Date(data.first_response_at).getTime() -
              new Date(data.email_received_at).getTime()) /
              3600000
          )
        : null;

      await connection.query(
        `
        INSERT INTO email_funnel_detail
        (id, conversion_funnel_event_id, email_received_at, email_subject,
         first_response_at, response_time_hours, resolution_provided_at,
         upsell_offered_at, sale_completed_at, sale_amount, email_exchange_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          detailId,
          funnelEventId,
          data.email_received_at,
          data.email_subject,
          data.first_response_at,
          responseTime,
          data.resolution_provided_at,
          data.upsell_offered_at,
          data.sale_completed_at,
          data.sale_amount,
          data.email_exchange_count,
        ]
      );

      await connection.commit();
      return funnelEventId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get funnel metrics for a specific process type
   */
  static async getFunnelMetrics(
    processType: "inbound" | "outbound" | "chat" | "email",
    daysBack: number = 30
  ): Promise<any> {
    const connection = await pool.getConnection();

    try {
      const [rows] = await connection.query(
        `
        SELECT
          cfe.funnel_stage,
          COUNT(DISTINCT cfe.id) as stage_count,
          COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) as conversions,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) /
                NULLIF(COUNT(DISTINCT cfe.id), 0), 2) as conversion_pct,
          ROUND(AVG(cfe.stage_duration_secs), 0) as avg_duration_secs
        FROM conversion_funnel_event cfe
        WHERE cfe.process_type = ?
          AND cfe.stage_entered_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY cfe.funnel_stage
        ORDER BY fsc.stage_sequence ASC
        `,
        [processType, daysBack]
      );

      return rows;
    } finally {
      connection.release();
    }
  }

  /**
   * Update funnel daily snapshot for reporting
   */
  static async updateDailySnapshot(processType: string): Promise<void> {
    const connection = await pool.getConnection();

    try {
      await connection.query(
        `
        INSERT INTO funnel_daily_snapshot
        (id, snapshot_date, process_type, funnel_stage, total_entries, completed_entries,
         abandoned_entries, converted_entries, conversion_pct, avg_stage_duration_secs)
        SELECT
          UUID(),
          CURDATE(),
          cfe.process_type,
          cfe.funnel_stage,
          COUNT(DISTINCT cfe.id),
          COUNT(DISTINCT CASE WHEN cfe.status = 'completed' THEN cfe.id END),
          COUNT(DISTINCT CASE WHEN cfe.status = 'abandoned' THEN cfe.id END),
          COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END),
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN cfe.conversion_flag = 1 THEN cfe.id END) /
                NULLIF(COUNT(DISTINCT cfe.id), 0), 2),
          ROUND(AVG(cfe.stage_duration_secs), 0)
        FROM conversion_funnel_event cfe
        WHERE cfe.process_type = ? AND DATE(cfe.stage_entered_at) = CURDATE()
        GROUP BY cfe.process_type, cfe.funnel_stage
        ON DUPLICATE KEY UPDATE
          total_entries = VALUES(total_entries),
          converted_entries = VALUES(converted_entries),
          conversion_pct = VALUES(conversion_pct),
          avg_stage_duration_secs = VALUES(avg_stage_duration_secs)
        `,
        [processType]
      );
    } finally {
      connection.release();
    }
  }
}

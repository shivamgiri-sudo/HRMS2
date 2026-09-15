import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * gnc_chat -- writes into db_masmis.gnc_chat (sql/1774). Source: GNC Chat.xlsx
 * (a Kwikengage chatbot/CS-ticket export). Columns confirmed directly
 * against the real file, not guessed.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importGncChatBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "TicketId");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "TicketId" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.gnc_chat
           (ticket_id, ticket_status, channel, inbox_name, agent_name, customer_email, customer_phone, customer_name, first_agent_name, first_assigned_at, first_agent_message_time, last_agent_message_time, first_bot_message_time, last_bot_message_time, first_customer_message_time, last_customer_message_time, last_resolution_agent_name, last_resolution_time, agent_frt_s, bot_frt_s, bot_turns, agent_turns, customer_turns, is_handled_by_bot, is_handoff, is_resolved, is_closed, is_escalated, ticket_closed_at, ticket_queued_at, first_queued_at, ticket_to_waiting_at, queue_time_s, wait_time_s, is_checkout_created, query_text, query_category, error_instance, error_at, code_error, tags, customer_tags, bot_failure_instances, query_resolved, company_resolution_time_min, customer_frt_min, customer_resolution_time_min, chat_flow, last_customer_message, last_customer_intent, first_customer_message, first_customer_intent, created_at_src, updated_at_src, response_time_hrs, reopen_count, contextualisation, contextualisation_category, follow_up_time_min, csat_rating, csat_review, csat_created_at, csat_updated_at, overall_sentiment, primary_category, secondary_category, churn_risk, urgency_level, product_name, payment_method, order_amount, order_id, price_sensitivity, resolution_confidence, ai_summary, ticket_link, ticket_in_office_hours, phone_number, report_date, unique_flag, frt_in_tat, qrc, response_in_tat, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requiredVal,
          n(data, "TicketStatus"),
          n(data, "Channel"),
          n(data, "InboxName"),
          n(data, "AgentName"),
          n(data, "CustomerEmail"),
          n(data, "CustomerPhone"),
          n(data, "CustomerName"),
          n(data, "FirstAgentName"),
          n(data, "FirstAssignedAt"),
          n(data, "FirstAgentMessageTime"),
          n(data, "LastAgentMessageTime"),
          n(data, "FirstBotMessageTime"),
          n(data, "LastBotMessageTime"),
          n(data, "FirstCustomerMessageTime"),
          n(data, "LastCustomerMessageTime"),
          n(data, "LastResolutionAgentName"),
          n(data, "LastResolutionTime"),
          n(data, "AgentFRT (s)"),
          n(data, "BotFRT (s)"),
          n(data, "BotTurns"),
          n(data, "AgentTurns"),
          n(data, "CustomerTurns"),
          n(data, "IsHandledByBot"),
          n(data, "IsHandoff"),
          n(data, "IsResolved"),
          n(data, "IsClosed"),
          n(data, "IsEscalated"),
          n(data, "TicketClosedAt"),
          n(data, "TicketQueuedAt"),
          n(data, "FirstQueuedAt"),
          n(data, "TicketToWaitingAt"),
          n(data, "QueueTime (s)"),
          n(data, "WaitTime (s)"),
          n(data, "IsCheckoutCreated"),
          n(data, "Query"),
          n(data, "QueryCategory"),
          n(data, "ErrorInstance"),
          n(data, "ErrorAt"),
          n(data, "CodeError"),
          n(data, "Tags"),
          n(data, "CustomerTags"),
          n(data, "BotFailureInstances"),
          n(data, "QueryResolved"),
          n(data, "CompanyResolutionTime (min)"),
          n(data, "CustomerFRT (min)"),
          n(data, "CustomerResolutionTime (min)"),
          n(data, "ChatFlow"),
          n(data, "LastCustomerMessage"),
          n(data, "LastCustomerIntent"),
          n(data, "FirstCustomerMessage"),
          n(data, "FirstCustomerIntent"),
          n(data, "CreatedAt"),
          n(data, "UpdatedAt"),
          n(data, "ResponseTime (hrs)"),
          n(data, "ReopenCount"),
          n(data, "Contextualisation"),
          n(data, "ContextualisationCategory"),
          n(data, "FollowUpTime (min)"),
          n(data, "CSATRating"),
          n(data, "CSATReview"),
          n(data, "CSATCreatedAt"),
          n(data, "CSATUpdatedAt"),
          n(data, "OverallSentiment"),
          n(data, "PrimaryCategory"),
          n(data, "SecondaryCategory"),
          n(data, "ChurnRisk"),
          n(data, "UrgencyLevel"),
          n(data, "ProductName"),
          n(data, "PaymentMethod"),
          n(data, "OrderAmount"),
          n(data, "OrderId"),
          n(data, "PriceSensitivity"),
          n(data, "ResolutionConfidence"),
          n(data, "AISummary"),
          n(data, "TicketLink"),
          n(data, "TicketInOfficeHours"),
          n(data, "Phone Number"),
          n(data, "Date"),
          n(data, "Unique"),
          n(data, "FRT (IN TAT)"),
          n(data, "QRC"),
          n(data, "Response (IN TAT)"),
          uploadedByInt, batchId,
        ] as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'gnc_chat', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
    );
  }

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}

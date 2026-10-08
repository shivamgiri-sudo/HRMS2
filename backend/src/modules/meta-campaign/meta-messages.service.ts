/**
 * WhatsApp conversation thread service for META campaign leads.
 *
 * Persists every outbound (system/HR) and inbound (candidate) message so Branch HR
 * can see the full thread and reply from the HRMS inbox page.
 *
 * Branch scoping: Branch HR only sees leads whose requisition maps to their branch.
 * Super admin, admin, and hr roles see all branches.
 */

import { randomUUID } from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { fetchMessageDeliveryStatus, isWassengerConfigured, type DeliveryStatus } from './wassenger.provider.js';
import type { BranchScope } from './meta-access.js';

export interface LeadMessage {
  id: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  messageText: string;
  senderType: 'system' | 'hr' | 'candidate';
  senderId: string | null;
  senderName: string | null;
  wassengerMessageId: string | null;
  deliveryStatus: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxConversation {
  leadId: string;
  parsedName: string | null;
  parsedPhone: string | null;
  screeningResult: string;
  branchName: string | null;
  designationName: string | null;
  campaignName: string | null;
  requisitionId: string | null;
  requisitionCode: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  lastDirection: 'inbound' | 'outbound' | null;
  unreadCount: number;
}

export async function saveMessage(params: {
  leadId: string;
  direction: 'inbound' | 'outbound';
  messageText: string;
  senderType: 'system' | 'hr' | 'candidate';
  senderId?: string | null;
  senderName?: string | null;
  wassengerMessageId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  // Wassenger accepting a message only means it is queued; the webhook / reconcile step advances it.
  const deliveryStatus = params.direction === 'outbound' && params.wassengerMessageId ? 'queued' : null;
  await db.execute(
    `INSERT INTO meta_lead_messages
       (id, lead_id, direction, message_text, sender_type, sender_id, sender_name, wassenger_message_id,
        delivery_status, delivery_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${deliveryStatus ? 'NOW()' : 'NULL'})`,
    [
      id,
      params.leadId,
      params.direction,
      params.messageText,
      params.senderType,
      params.senderId ?? null,
      params.senderName ?? null,
      params.wassengerMessageId ?? null,
      deliveryStatus,
    ]
  );
  return id;
}

const FORWARD_ONLY_SQL = `(delivery_status IS NULL OR delivery_status = 'queued'
  OR (delivery_status = 'sent' AND ? IN ('delivered', 'read', 'failed'))
  OR (delivery_status = 'delivered' AND ? = 'read'))`;

/** Advance an outbound message's delivery state. Never moves backwards (queued < sent < delivered < read). */
export async function updateDeliveryStatus(wassengerMessageId: string, status: DeliveryStatus): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE meta_lead_messages
        SET delivery_status = ?, delivery_updated_at = NOW()
      WHERE wassenger_message_id = ? AND direction = 'outbound' AND NOT (delivery_status <=> ?)
        AND ${FORWARD_ONLY_SQL}`,
    [status, wassengerMessageId, status, status, status]
  );
  return res.affectedRows > 0;
}

/**
 * Catch delivery states a missed webhook never delivered, and fill in messages saved before
 * delivery tracking existed. Bounded per run so a large backlog cannot stall the sync.
 */
export async function reconcileDeliveryStatuses(limit = 100): Promise<{ checked: number; updated: number; stillQueued: number }> {
  if (!isWassengerConfigured()) return { checked: 0, updated: 0, stillQueued: 0 };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wassenger_message_id FROM meta_lead_messages
      WHERE direction = 'outbound' AND wassenger_message_id IS NOT NULL AND wassenger_message_id <> 'sent'
        AND (delivery_status IS NULL OR delivery_status IN ('queued', 'sent'))
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY created_at DESC LIMIT ${Number(limit)}`
  );
  let updated = 0;
  let stillQueued = 0;
  for (const row of rows) {
    const id = String(row.wassenger_message_id);
    try {
      const status = await fetchMessageDeliveryStatus(id);
      if (!status) continue;
      if (status === 'queued') stillQueued += 1;
      if (await updateDeliveryStatus(id, status)) updated += 1;
    } catch {
      // One unreachable message must not stop the rest; it is retried on the next run.
    }
  }
  return { checked: rows.length, updated, stillQueued };
}

export async function getThread(leadId: string): Promise<LeadMessage[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, lead_id, direction, message_text, sender_type, sender_id, sender_name,
            wassenger_message_id, delivery_status, read_at, created_at
       FROM meta_lead_messages
      WHERE lead_id = ?
      ORDER BY created_at ASC`,
    [leadId]
  );
  return rows.map(toMessage);
}

export async function markThreadRead(leadId: string): Promise<void> {
  await db.execute(
    `UPDATE meta_lead_messages
        SET read_at = NOW()
      WHERE lead_id = ? AND direction = 'inbound' AND read_at IS NULL`,
    [leadId]
  );
}

export async function getInbox(opts: {
  scope: BranchScope;
  search?: string;
  requisitionId?: string;
}): Promise<InboxConversation[]> {
  // Fail closed: a branch-scoped user with no resolvable branch sees nothing.
  if (!opts.scope.all && !opts.scope.branchName) return [];

  let branchFilter = '';
  const params: unknown[] = [];
  if (!opts.scope.all) {
    branchFilter = `AND jr.branch_name = ?`;
    params.push(opts.scope.branchName);
  }

  const searchFilter = opts.search ? `AND (ml.parsed_name LIKE ? OR ml.parsed_phone LIKE ?)` : '';
  if (opts.search) {
    const like = `%${opts.search}%`;
    params.push(like, like);
  }

  const requisitionIdFilter = opts.requisitionId ? `AND ml.requisition_id = ?` : '';
  if (opts.requisitionId) {
    params.push(opts.requisitionId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ml.id                               AS leadId,
       ml.parsed_name                      AS parsedName,
       ml.parsed_phone                     AS parsedPhone,
       ml.screening_result                 AS screeningResult,
       jr.branch_name                      AS branchName,
       jr.designation_name                 AS designationName,
       mc.campaign_name                    AS campaignName,
       ml.requisition_id                   AS requisitionId,
       jr.requisition_code                 AS requisitionCode,
       (SELECT m2.message_text FROM meta_lead_messages m2
         WHERE m2.lead_id = ml.id ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS lastMessageText,
       lm.last_message_at                  AS lastMessageAt,
       (SELECT m3.direction FROM meta_lead_messages m3
         WHERE m3.lead_id = ml.id ORDER BY m3.created_at DESC, m3.id DESC LIMIT 1)  AS lastDirection,
       COALESCE(lm.unread_count, 0)        AS unreadCount
     FROM meta_lead_raw ml
     INNER JOIN (
       SELECT lead_id,
              MAX(created_at)          AS last_message_at,
              SUM(CASE WHEN direction = 'inbound' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
         FROM meta_lead_messages
         GROUP BY lead_id
     ) lm ON lm.lead_id = ml.id
     LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
     INNER JOIN meta_campaign mc ON mc.id = ml.campaign_id AND mc.campaign_status IN ('active', 'draft')
     WHERE 1=1
       ${branchFilter}
       ${searchFilter}
       ${requisitionIdFilter}
     ORDER BY lm.last_message_at DESC
     LIMIT 200`,
    params
  );

  return rows.map((r) => ({
    leadId: String(r.leadId),
    parsedName: (r.parsedName as string | null) ?? null,
    parsedPhone: (r.parsedPhone as string | null) ?? null,
    screeningResult: String(r.screeningResult ?? 'pending'),
    branchName: (r.branchName as string | null) ?? null,
    designationName: (r.designationName as string | null) ?? null,
    campaignName: (r.campaignName as string | null) ?? null,
    requisitionId: (r.requisitionId as string | null) ?? null,
    requisitionCode: (r.requisitionCode as string | null) ?? null,
    lastMessageText: (r.lastMessageText as string | null) ?? null,
    lastMessageAt: (r.lastMessageAt as string | null) ?? null,
    lastDirection: ((r.lastDirection as string | null) ?? null) as 'inbound' | 'outbound' | null,
    unreadCount: Number(r.unreadCount ?? 0),
  }));
}

/**
 * Total unread count across all conversations the user can see.
 * Used for the notification badge in the nav.
 */
export async function getTotalUnread(opts: { scope: BranchScope }): Promise<number> {
  if (!opts.scope.all && !opts.scope.branchName) return 0;

  let branchFilter = '';
  const params: unknown[] = [];
  if (!opts.scope.all) {
    branchFilter = `AND jr.branch_name = ?`;
    params.push(opts.scope.branchName);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM meta_lead_messages mlm
       JOIN meta_lead_raw ml ON ml.id = mlm.lead_id
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
       INNER JOIN meta_campaign mc ON mc.id = ml.campaign_id AND mc.campaign_status IN ('active', 'draft')
      WHERE mlm.direction = 'inbound' AND mlm.read_at IS NULL
        ${branchFilter}`,
    params
  );

  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Notify Branch HR users about an inbound candidate question.
 * Inserts into work_inbox_item for every HR/Branch Head employee in the lead's branch.
 */
export async function notifyBranchHrOfInboundMessage(
  leadId: string,
  candidateName: string | null,
  messageSnippet: string
): Promise<void> {
  // Find the branch for this lead
  const [leadRows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.branch_name
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE ml.id = ? LIMIT 1`,
    [leadId]
  );

  const branchName = leadRows[0]?.branch_name as string | null;
  if (!branchName) return;

  // Find auth_user IDs for HR-role employees in that branch
  const [hrRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.user_id
       FROM employees e
       JOIN branch_master bm ON bm.id = e.branch_id
       JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
      WHERE bm.branch_name = ?
        AND ur.role_key IN ('recruitment_hr', 'hr', 'branch_head', 'admin', 'super_admin', 'branch_admin')
        AND e.active_status = 1`,
    [branchName]
  );

  if (!hrRows.length) return;

  const snippet = messageSnippet.length > 80 ? messageSnippet.slice(0, 77) + '...' : messageSnippet;
  const title = `WhatsApp: ${candidateName ?? 'Candidate'} replied`;
  const description = snippet;
  const actionUrl = `/ats/whatsapp-inbox`;
  const entityId = leadId;

  for (const row of hrRows) {
    await db.execute(
      `INSERT INTO work_inbox_item
         (id, user_id, type, title, description, entity_type, entity_id, action_url, priority, is_read, is_actioned, created_at)
       VALUES (UUID(), ?, 'meta_whatsapp_reply', ?, ?, 'meta_lead', ?, ?, 'high', 0, 0, NOW())`,
      [row.user_id, title, description, entityId, actionUrl]
    ).catch(() => { /* best-effort — don't let notification failure break webhook ACK */ });
  }
}

function toMessage(r: RowDataPacket): LeadMessage {
  return {
    id: String(r.id),
    leadId: String(r.lead_id),
    direction: r.direction as 'inbound' | 'outbound',
    messageText: String(r.message_text),
    senderType: r.sender_type as 'system' | 'hr' | 'candidate',
    senderId: (r.sender_id as string | null) ?? null,
    senderName: (r.sender_name as string | null) ?? null,
    wassengerMessageId: (r.wassenger_message_id as string | null) ?? null,
    deliveryStatus: (r.delivery_status as LeadMessage['deliveryStatus']) ?? null,
    readAt: (r.read_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

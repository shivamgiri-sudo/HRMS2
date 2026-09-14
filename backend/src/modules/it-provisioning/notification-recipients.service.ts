/**
 * Who receives a branch's provisioning notifications.
 *
 * Configuration is the authority; the derived lookup is the fallback. Before
 * this, recipients were inferred from three tables with different meanings and
 * no stated intent, so a wrong routing was invisible until someone noticed the
 * mail arriving at the wrong desk — which is how NOIDA-2's admin task went to a
 * Training & Quality employee, and how one joiner's tasks reached 51 people.
 *
 * Only this table and the derived chain are consulted. branch_wfm_spoc_config
 * and notification_event_config.recipient_spec are earlier attempts at the same
 * idea that were never adopted (0 rows and 53 disabled rows respectively);
 * reading them too would recreate the competing-sources problem this is meant
 * to end.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

export type ConfiguredRecipient = {
  id: string;
  branchId: string;
  eventCode: string;
  recipientType: "to" | "cc";
  employeeId: string | null;
  email: string | null;
  /** Resolved address — an employee's login email, or the free-text one. */
  resolvedEmail: string | null;
  name: string | null;
  employeeCode: string | null;
  remarks: string | null;
  active: boolean;
  /** Present when the row links an employee with a login — needed for the inbox item. */
  userId: string | null;
};

/**
 * The provisioning events that can be configured today.
 *
 * Keyed by event_code rather than role, so a new notification type is a new
 * constant here plus rows — not a schema change.
 */
export const CONFIGURABLE_EVENTS = [
  { code: "IT_EMAIL_DOMAIN_ASSET", label: "IT — domain account, official email, assets", fallbackRole: "it" },
  { code: "ADMIN_BIOMETRIC_ID_CARD", label: "Admin — biometric enrolment and ID card", fallbackRole: "admin" },
  { code: "WFM_PROCESS_ALIGNMENT", label: "WFM — process and roster alignment", fallbackRole: "wfm" },
  { code: "APPOINTMENT_LETTER_ESIGN", label: "HR — appointment letter issue and eSign", fallbackRole: "hr" },
  { code: "JOB_REQUISITION_RAISED", label: "Recruitment — requisition raised for approval", fallbackRole: "branch_head" },
] as const;

export type ConfigurableEventCode = (typeof CONFIGURABLE_EVENTS)[number]["code"];

/** True when the table exists — it may not, since migrations are applied by hand. */
let tablePresent: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (tablePresent !== null) return tablePresent;
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_notification_recipient'`,
  ).catch(() => [[{ n: 0 }]] as unknown as [RowDataPacket[]]);
  tablePresent = Number(r[0]?.n ?? 0) > 0;
  return tablePresent;
}

const SELECT_SQL = `
  SELECT r.id, r.branch_id, r.event_code, r.recipient_type, r.employee_id, r.email,
         r.remarks, r.active_status,
         e.employee_code, e.full_name,
         COALESCE(NULLIF(TRIM(r.email), ''), au.email) AS resolved_email,
         au.id AS user_id
    FROM branch_notification_recipient r
    LEFT JOIN employees e ON e.id = r.employee_id
    LEFT JOIN auth_user au ON au.id = e.user_id`;

function mapRow(x: RowDataPacket): ConfiguredRecipient {
  return {
    id: String(x.id),
    branchId: String(x.branch_id),
    eventCode: String(x.event_code),
    recipientType: String(x.recipient_type) === "cc" ? "cc" : "to",
    employeeId: x.employee_id ? String(x.employee_id) : null,
    email: x.email ? String(x.email) : null,
    resolvedEmail: x.resolved_email ? String(x.resolved_email) : null,
    name: x.full_name ? String(x.full_name) : null,
    employeeCode: x.employee_code ? String(x.employee_code) : null,
    remarks: x.remarks ? String(x.remarks) : null,
    active: Number(x.active_status) === 1,
    userId: x.user_id ? String(x.user_id) : null,
  };
}

/** Everything configured for a branch, for the admin screen. */
export async function listBranchRecipients(branchId: string): Promise<ConfiguredRecipient[]> {
  if (!(await hasTable())) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `${SELECT_SQL} WHERE r.branch_id = ? ORDER BY r.event_code, r.recipient_type, e.full_name`,
    [branchId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return rows.map(mapRow);
}

/**
 * The configured recipients actually used for a dispatch.
 *
 * Returns null — not an empty list — when nothing is configured, so the caller
 * can tell "no configuration, fall back" apart from "configured to nobody".
 */
export async function getConfiguredRecipients(
  branchId: string | null,
  eventCode: string,
): Promise<{ to: Array<{ userId: string | null; email: string }>; cc: string[] } | null> {
  if (!branchId || !(await hasTable())) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `${SELECT_SQL} WHERE r.branch_id = ? AND r.event_code = ? AND r.active_status = 1`,
    [branchId, eventCode],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const all = rows.map(mapRow).filter((r) => r.resolvedEmail && r.resolvedEmail.includes("@"));
  if (all.length === 0) return null;

  // userId is carried through so a configured employee still gets an in-app
  // inbox item, not only an email. Shared mailboxes have none, and get email
  // only — which is correct, since nobody logs in as one.
  const seen = new Set<string>();
  const to: Array<{ userId: string | null; email: string }> = [];
  for (const r of all.filter((x) => x.recipientType === "to")) {
    if (seen.has(r.resolvedEmail!)) continue;
    seen.add(r.resolvedEmail!);
    to.push({ userId: r.userId, email: r.resolvedEmail! });
  }
  const toEmails = to.map((t) => t.email);
  const cc = [...new Set(all.filter((r) => r.recipientType === "cc").map((r) => r.resolvedEmail!))]
    .filter((e) => !toEmails.includes(e));

  // A branch configured with CC only and no TO is a misconfiguration, not an
  // instruction to send to nobody. Fall back so the task still reaches someone.
  if (to.length === 0) return null;
  return { to, cc };
}

export async function upsertRecipient(input: {
  branchId: string;
  eventCode: string;
  recipientType: "to" | "cc";
  employeeId?: string | null;
  email?: string | null;
  remarks?: string | null;
  actorUserId: string | null;
}): Promise<{ id: string }> {
  if (!(await hasTable())) {
    throw Object.assign(new Error("Recipient configuration is not available on this environment yet."),
      { statusCode: 503 });
  }
  const employeeId = input.employeeId || null;
  const email = (input.email ?? "").trim() || null;
  if (!employeeId && !email) {
    throw Object.assign(new Error("Choose an employee or enter an email address."), { statusCode: 400 });
  }
  if (email && !email.includes("@")) {
    throw Object.assign(new Error(`"${email}" is not an email address.`), { statusCode: 400 });
  }
  if (!CONFIGURABLE_EVENTS.some((e) => e.code === input.eventCode)) {
    throw Object.assign(new Error(`Unknown notification event "${input.eventCode}".`), { statusCode: 400 });
  }

  const id = randomUUID();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO branch_notification_recipient
       (id, branch_id, event_code, recipient_type, employee_id, email, remarks, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       active_status = 1, remarks = VALUES(remarks),
       updated_by = VALUES(updated_by), updated_at = NOW()`,
    [id, input.branchId, input.eventCode, input.recipientType, employeeId, email,
     input.remarks ?? null, input.actorUserId, input.actorUserId],
  );
  // affectedRows is 2 on an update, 1 on an insert.
  return { id: res.affectedRows === 1 ? id : id };
}

export async function removeRecipient(id: string, actorUserId: string | null): Promise<void> {
  if (!(await hasTable())) return;
  // Deactivated, not deleted: who used to receive a notification is part of the
  // audit trail for anything that was sent.
  await db.execute(
    `UPDATE branch_notification_recipient
        SET active_status = 0, updated_by = ?, updated_at = NOW()
      WHERE id = ?`,
    [actorUserId, id],
  );
}

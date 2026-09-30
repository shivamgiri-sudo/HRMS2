/** Process Dashboard alerts -- persistence (process_dashboard_alert_rule / _alert_event / _digest). Every statement is parameterized; ids are UUIDs checked by the routes. */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { PdError } from "../pd.source.js";
import type { Comparator } from "./alerts.evaluator.js";
import { MAX_RULES_PER_PROCESS, type AlertEvent, type AlertRule, type Channel, type Digest, type Frequency, type RecipientSpec, type RuleDraft, type Severity } from "./alerts.types.js";

const asJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};
const iso = (ts: unknown): string | null => { const n = Number(ts); return ts === null || ts === undefined || !Number.isFinite(n) ? null : new Date(n * 1000).toISOString(); };
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const specOf = (v: unknown): RecipientSpec => { const o = asJson<Partial<RecipientSpec>>(v, {}); return { roles: o.roles ?? [], tls: o.tls ?? [], employeeIds: o.employeeIds ?? [] }; };

const RULE_COLS = `r.*, UNIX_TIMESTAMP(r.last_evaluated_at) AS eval_ts, UNIX_TIMESTAMP(r.last_fired_at) AS fired_ts, UNIX_TIMESTAMP(r.created_at) AS created_ts, UNIX_TIMESTAMP(r.updated_at) AS updated_ts`;
export const rowToRule = (r: RowDataPacket): AlertRule => ({
  id: String(r.id), processId: String(r.process_id), name: String(r.name), metricKey: String(r.metric_key), comparator: r.comparator as Comparator, threshold: Number(r.threshold),
  windowDays: Number(r.window_days), consecutiveDays: Number(r.consecutive_days), scopeTl: r.scope_tl ?? null, scopeLob: r.scope_lob ?? null, severity: r.severity as Severity,
  recipients: specOf(r.recipients), channels: asJson<Channel[]>(r.channels, ["in_app"]), cooldownMinutes: Number(r.cooldown_minutes), enabled: Number(r.enabled) === 1,
  lastEvaluatedAt: iso(r.eval_ts), lastFiredAt: iso(r.fired_ts), createdBy: r.created_by ?? null, createdAt: iso(r.created_ts), updatedAt: iso(r.updated_ts),
});

export async function listRules(processId: string): Promise<AlertRule[]> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${RULE_COLS} FROM process_dashboard_alert_rule r WHERE r.process_id = ? ORDER BY r.created_at DESC LIMIT ${MAX_RULES_PER_PROCESS + 10}`, [processId]);
  return rows.map(rowToRule);
}
export async function getRule(processId: string, id: string): Promise<AlertRule | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${RULE_COLS} FROM process_dashboard_alert_rule r WHERE r.process_id = ? AND r.id = ? LIMIT 1`, [processId, id]);
  return rows.length ? rowToRule(rows[0]) : null;
}
/** Enabled rules of every process whose dashboard is enabled (worker input). */
export async function listEnabledRules(): Promise<AlertRule[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${RULE_COLS} FROM process_dashboard_alert_rule r JOIN process_dashboard_config c ON c.process_id = r.process_id
      WHERE r.enabled = 1 AND c.enabled = 1 ORDER BY r.process_id, r.created_at LIMIT 5000`);
  return rows.map(rowToRule);
}
export async function countRules(processId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM process_dashboard_alert_rule WHERE process_id = ?`, [processId]);
  return Number(rows[0]?.n ?? 0);
}
const ruleParams = (d: RuleDraft): unknown[] => [d.name, d.metricKey, d.comparator, d.threshold, d.windowDays, d.consecutiveDays, d.scopeTl, d.scopeLob, d.severity, JSON.stringify(d.recipients), JSON.stringify(d.channels), d.cooldownMinutes, d.enabled ? 1 : 0];
export async function insertRule(processId: string, userId: string, d: RuleDraft): Promise<AlertRule> {
  if ((await countRules(processId)) >= MAX_RULES_PER_PROCESS) throw new PdError(409, "TOO_MANY_RULES", `A process can have at most ${MAX_RULES_PER_PROCESS} alert rules`);
  const id = randomUUID();
  await db.execute(
    `INSERT INTO process_dashboard_alert_rule (id, process_id, name, metric_key, comparator, threshold, window_days, consecutive_days, scope_tl, scope_lob, severity, recipients, channels, cooldown_minutes, enabled, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, processId, ...ruleParams(d), userId]);
  return (await getRule(processId, id))!;
}
export async function updateRule(processId: string, id: string, d: RuleDraft): Promise<AlertRule | null> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE process_dashboard_alert_rule SET name = ?, metric_key = ?, comparator = ?, threshold = ?, window_days = ?, consecutive_days = ?, scope_tl = ?, scope_lob = ?, severity = ?,
            recipients = ?, channels = ?, cooldown_minutes = ?, enabled = ? WHERE process_id = ? AND id = ?`, [...ruleParams(d), processId, id]);
  return res.affectedRows ? getRule(processId, id) : null;
}
export async function deleteRule(processId: string, id: string): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(`DELETE FROM process_dashboard_alert_rule WHERE process_id = ? AND id = ?`, [processId, id]);
  return res.affectedRows > 0;
}
export async function touchEvaluated(id: string): Promise<void> { await db.execute(`UPDATE process_dashboard_alert_rule SET last_evaluated_at = NOW() WHERE id = ?`, [id]); }
export async function disableRule(id: string): Promise<void> { await db.execute(`UPDATE process_dashboard_alert_rule SET enabled = 0 WHERE id = ?`, [id]); }

/* ---------------- events ---------------- */
const EVENT_SELECT = `e.*, r.name AS rule_name, DATE_FORMAT(e.data_date, '%Y-%m-%d') AS d, UNIX_TIMESTAMP(e.fired_at) AS fired_ts, UNIX_TIMESTAMP(e.notified_at) AS notified_ts, UNIX_TIMESTAMP(e.acknowledged_at) AS ack_ts`;
const rowToEvent = (r: RowDataPacket): AlertEvent => ({
  id: String(r.id), ruleId: String(r.rule_id), ruleName: r.rule_name ?? null, processId: String(r.process_id), dataDate: String(r.d), firedAt: iso(r.fired_ts) ?? "", metricKey: String(r.metric_key),
  metricValue: num(r.metric_value), threshold: num(r.threshold), severity: r.severity as Severity, message: String(r.message), context: asJson<unknown>(r.context, null),
  notified: Number(r.notified) === 1, notifiedAt: iso(r.notified_ts), notifySummary: asJson<unknown>(r.notify_summary, null), acknowledgedBy: r.acknowledged_by ?? null, acknowledgedAt: iso(r.ack_ts),
});
export async function listEvents(processId: string, opts: { status?: "open" | "acknowledged" | "all"; limit?: number; offset?: number } = {}): Promise<{ rows: AlertEvent[]; total: number; open: number }> {
  const status = opts.status ?? "all";
  const where = status === "open" ? "AND e.acknowledged_at IS NULL" : status === "acknowledged" ? "AND e.acknowledged_at IS NOT NULL" : "";
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50)); const offset = Math.max(0, opts.offset ?? 0);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${EVENT_SELECT} FROM process_dashboard_alert_event e LEFT JOIN process_dashboard_alert_rule r ON r.id = e.rule_id
      WHERE e.process_id = ? ${where} ORDER BY e.fired_at DESC, e.id LIMIT ${limit} OFFSET ${offset}`, [processId]);
  const [cnt] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(acknowledged_at IS NULL) AS open FROM process_dashboard_alert_event e WHERE e.process_id = ? ${where}`, [processId]);
  const [openRow] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM process_dashboard_alert_event WHERE process_id = ? AND acknowledged_at IS NULL`, [processId]);
  return { rows: rows.map(rowToEvent), total: Number(cnt[0]?.total ?? 0), open: Number(openRow[0]?.n ?? 0) };
}
export async function openCount(processId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM process_dashboard_alert_event WHERE process_id = ? AND acknowledged_at IS NULL`, [processId]);
  return Number(rows[0]?.n ?? 0);
}
export async function getEvent(processId: string, id: string): Promise<AlertEvent | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${EVENT_SELECT} FROM process_dashboard_alert_event e LEFT JOIN process_dashboard_alert_rule r ON r.id = e.rule_id WHERE e.process_id = ? AND e.id = ? LIMIT 1`, [processId, id]);
  return rows.length ? rowToEvent(rows[0]) : null;
}
/** Epoch ms of the rule's most recent event (cooldown input), or null. */
export async function lastFiredMs(ruleId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT UNIX_TIMESTAMP(MAX(fired_at)) AS ts FROM process_dashboard_alert_event WHERE rule_id = ?`, [ruleId]);
  const ts = rows[0]?.ts; return ts === null || ts === undefined ? null : Number(ts) * 1000;
}
export interface NewEvent { ruleId: string; processId: string; dataDate: string; metricKey: string; metricValue: number | null; threshold: number | null; severity: Severity; message: string; context: unknown }
/** INSERT IGNORE on uq_pdae_rule_date: returns the new event id, or null when this rule already fired for that data date (dedupe). */
export async function insertEvent(e: NewEvent): Promise<string | null> {
  const id = randomUUID();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO process_dashboard_alert_event (id, rule_id, process_id, data_date, metric_key, metric_value, threshold, severity, message, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, e.ruleId, e.processId, e.dataDate, e.metricKey, e.metricValue, e.threshold, e.severity, e.message.slice(0, 500), JSON.stringify(e.context ?? null)]);
  if (!res.affectedRows) return null;
  await db.execute(`UPDATE process_dashboard_alert_rule SET last_fired_at = NOW() WHERE id = ?`, [e.ruleId]);
  return id;
}
export async function markNotified(id: string, summary: unknown, notified: boolean): Promise<void> {
  await db.execute(`UPDATE process_dashboard_alert_event SET notified = ?, notified_at = ${notified ? "NOW()" : "NULL"}, notify_summary = ? WHERE id = ?`, [notified ? 1 : 0, JSON.stringify(summary), id]);
}
/** Idempotent: a second acknowledge keeps the first actor and time. Returns false when the event does not exist in this process. */
export async function acknowledgeEvent(processId: string, id: string, userId: string): Promise<boolean> {
  await db.execute(`UPDATE process_dashboard_alert_event SET acknowledged_by = ?, acknowledged_at = NOW() WHERE process_id = ? AND id = ? AND acknowledged_at IS NULL`, [userId, processId, id]);
  return (await getEvent(processId, id)) !== null;
}

/* ---------------- digests ---------------- */
const rowToDigest = (r: RowDataPacket): Digest => ({ id: String(r.id), processId: String(r.process_id), frequency: r.frequency as Frequency, sendTime: String(r.send_time), recipients: specOf(r.recipients), enabled: Number(r.enabled) === 1, lastSentAt: iso(r.sent_ts) });
const DIGEST_SELECT = `d.*, UNIX_TIMESTAMP(d.last_sent_at) AS sent_ts`;
export async function listDigests(processId: string): Promise<Digest[]> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${DIGEST_SELECT} FROM process_dashboard_digest d WHERE d.process_id = ? ORDER BY d.frequency`, [processId]);
  return rows.map(rowToDigest);
}
export async function listEnabledDigests(): Promise<Digest[]> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${DIGEST_SELECT} FROM process_dashboard_digest d JOIN process_dashboard_config c ON c.process_id = d.process_id WHERE d.enabled = 1 AND c.enabled = 1 LIMIT 2000`);
  return rows.map(rowToDigest);
}
export async function upsertDigest(processId: string, userId: string, d: { frequency: Frequency; sendTime: string; recipients: RecipientSpec; enabled: boolean }): Promise<Digest> {
  await db.execute(
    `INSERT INTO process_dashboard_digest (id, process_id, frequency, send_time, recipients, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE send_time = VALUES(send_time), recipients = VALUES(recipients), enabled = VALUES(enabled)`,
    [randomUUID(), processId, d.frequency, d.sendTime, JSON.stringify(d.recipients), d.enabled ? 1 : 0, userId]);
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${DIGEST_SELECT} FROM process_dashboard_digest d WHERE d.process_id = ? AND d.frequency = ? LIMIT 1`, [processId, d.frequency]);
  return rowToDigest(rows[0]);
}
export async function markDigestSent(id: string): Promise<void> { await db.execute(`UPDATE process_dashboard_digest SET last_sent_at = NOW() WHERE id = ?`, [id]); }

/** Outbound source config (process_outbound_source_config, sql/1961): field catalogue, pure parsing/suggestions, load + save. */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { logger } from "../../../logger.js";
import { invalidateProcess } from "../pd.cache.js";
import { PdError, listColumns } from "../pd.source.js";
import { asJson, parseSource, strList, verifyExtMap, type ExtField, type ExtFilter } from "../shared/ext.source.js";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export const OUTBOUND_FIELDS: ExtField[] = [
  { key: "date", label: "Call date", kind: "date", required: true, synonyms: ["call_date", "calldate", "date", "start_time", "call_time", "created_at", "call_datetime", "timestamp", "dial_time", "start_stamp", "call_start", "call_start_time", "start_datetime", "dialed_at", "call_dt"] },
  { key: "agent_code", label: "Agent code", kind: "text", required: true, synonyms: ["agent_code", "agent_id", "agentid", "emp_id", "employee_code", "emp_code", "mas_id", "user", "user_id", "agent"] },
  { key: "disposition", label: "Disposition", kind: "text", required: true, synonyms: ["disposition", "dispo", "call_status", "status", "disconnect_reason", "disconnby", "call_result", "hangup_cause", "outcome", "sub_disposition"] },
  { key: "duration_sec", label: "Call duration (sec)", kind: "number", required: false, synonyms: ["duration_sec", "duration", "call_duration", "callduration", "callDurationSecond", "billsec", "length_in_sec", "duration_seconds"] },
  { key: "talk_time", label: "Talk time (sec)", kind: "number", required: false, synonyms: ["talk_time", "talktime", "talk_sec", "talk_seconds", "talk_duration"] },
  { key: "lead_id", label: "Lead id", kind: "text", required: false, synonyms: ["lead_id", "leadid", "lead_no", "customer_id", "contact_id", "record_id", "list_id", "account_id", "lead_ref"] },
  { key: "campaign", label: "Campaign", kind: "text", required: false, synonyms: ["campaign", "campaign_id", "campaign_name", "campaignname", "queue", "process", "list_name"] },
  { key: "tl_name", label: "Team leader", kind: "text", required: false, synonyms: ["tl_name", "tl", "team_leader", "supervisor", "team_lead"] },
  { key: "call_time", label: "Call time of day (optional)", kind: "time", required: false, synonyms: ["time", "call_time_of_day", "start_clock", "call_clock", "dial_clock"] },
  { key: "unique_lead_flag", label: "First-attempt flag (0/1, optional)", kind: "number", required: false, synonyms: ["unique_lead", "unique_flag", "is_unique", "first_attempt", "new_lead", "unique_lead_flag", "is_first", "uniqueleads"] },
];

export interface OutboundConfig {
  processId: string; cdrSchema: string; cdrTable: string; columnMap: Record<string, string>; connectedDispositions: string[]; uniqueLeadFlagColumn: string | null;
  filter: ExtFilter | null; refreshSeconds: number; enabled: boolean; updatedAt: string | null;
}
export type OutboundDraft = Omit<OutboundConfig, "processId" | "updatedAt">;

/** Pure shape validation. The unique-lead flag travels as columnMap.unique_lead_flag internally and as its own column in storage. */
export function parseOutboundInput(input: Record<string, unknown>): { draft: OutboundDraft; problems: string[] } {
  const problems: string[] = [];
  let cdrSchema = ""; let cdrTable = ""; let filter: ExtFilter | null = null;
  try { const s = parseSource(input.cdrSchema, input.cdrTable, input.filter); cdrSchema = s.schema; cdrTable = s.table; filter = s.filter; } catch (e) { problems.push((e as Error).message); }
  const columnMap: Record<string, string> = {};
  if (typeof input.columnMap !== "object" || input.columnMap === null || Array.isArray(input.columnMap)) problems.push("columnMap must be an object of field -> column");
  else for (const [k, c] of Object.entries(input.columnMap as Record<string, unknown>)) {
    if (c === null || c === undefined || String(c).trim() === "") continue;
    if (!OUTBOUND_FIELDS.some((f) => f.key === k)) { problems.push(`unknown columnMap field "${k}"`); continue; }
    const col = String(c).trim();
    if (col.includes(".") || col.includes("`") || col.length > 64) { problems.push(`column for ${k} is not a plain column name`); continue; }
    columnMap[k] = col;
  }
  if (typeof input.uniqueLeadFlagColumn === "string" && input.uniqueLeadFlagColumn.trim()) columnMap.unique_lead_flag = input.uniqueLeadFlagColumn.trim();
  for (const f of OUTBOUND_FIELDS) if (f.required && !columnMap[f.key]) problems.push(`${f.label} must be mapped`);
  const connectedDispositions = strList(input.connectedDispositions);
  if (!connectedDispositions.length) problems.push("Choose at least one disposition that counts as a connect");
  const refresh = input.refreshSeconds === undefined || input.refreshSeconds === null ? 60 : Number(input.refreshSeconds);
  if (!Number.isInteger(refresh) || refresh < 10 || refresh > 3600) problems.push("refreshSeconds must be an integer 10-3600");
  const enabled = input.enabled === true || input.enabled === 1 || input.enabled === "1";
  const { unique_lead_flag: flag, ...rest } = columnMap;
  return { draft: { cdrSchema, cdrTable, columnMap: rest, connectedDispositions, uniqueLeadFlagColumn: flag ?? null, filter, refreshSeconds: refresh, enabled }, problems };
}

/** The map the read path uses: columnMap plus the flag column. */
export const effectiveMap = (d: Pick<OutboundDraft, "columnMap" | "uniqueLeadFlagColumn">): Record<string, string> =>
  (d.uniqueLeadFlagColumn ? { ...d.columnMap, unique_lead_flag: d.uniqueLeadFlagColumn } : { ...d.columnMap });

/* ---------- pure suggestions from distinct dispositions ---------- */
const NOT_RE = /(no.?answer|noanswer|busy|switch|unreach|not.?reach|voice.?mail|vm\b|fail|abandon|drop|invalid|congest|ring|unanswer|ncr|coverage|wrong.?number|not.?exist|dead|disconnect|blocked|dnd|out of)/i;
const CONN_RE = /(connect|answer|interest|call.?back|callback|sale|convert|ptp|rpc|success|follow|happy|lead|cnv|booked|agree|promise|confirm|talk|human|\bcx\b|customer)/i;
export function guessConnected(v: string): boolean {
  if (!v.trim() || NOT_RE.test(v)) return /^(connected|answered|human)$/i.test(v.trim());
  return CONN_RE.test(v);
}
export const suggestConnected = (values: string[]): string[] => values.filter(guessConnected);

/* ---------- storage ---------- */
const toConfig = (r: RowDataPacket): OutboundConfig => ({
  processId: String(r.process_id), cdrSchema: String(r.cdr_schema), cdrTable: String(r.cdr_table), columnMap: asJson<Record<string, string>>(r.column_map, {}),
  connectedDispositions: asJson<string[]>(r.connected_dispositions, []), uniqueLeadFlagColumn: r.unique_lead_flag_column ? String(r.unique_lead_flag_column) : null,
  filter: r.filter_column && r.filter_value !== null ? { column: String(r.filter_column), value: String(r.filter_value) } : null,
  refreshSeconds: Number(r.refresh_seconds ?? 60), enabled: Number(r.enabled) === 1, updatedAt: r.updated_at ? String(r.updated_at) : null,
});

export async function getOutboundConfig(processId: string): Promise<OutboundConfig | null> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM process_outbound_source_config WHERE process_id = ? LIMIT 1`, [processId]).catch((err: { code?: string }) => {
    if (err?.code === "ER_NO_SUCH_TABLE") return [[] as RowDataPacket[]] as unknown as [RowDataPacket[]];
    throw err;
  });
  return rows.length ? toConfig(rows[0]) : null;
}

export async function validateOutboundDraft(draft: OutboundDraft): Promise<OutboundDraft> {
  const cols = await listColumns(draft.cdrSchema, draft.cdrTable);
  const v = verifyExtMap(effectiveMap(draft), cols, OUTBOUND_FIELDS, draft.filter);
  if (v.problems.length) throw new PdError(400, "INVALID_CONFIG", v.problems.map((p) => `${p.field}: ${p.message}`).join("; "));
  const { unique_lead_flag: flag, ...rest } = v.map;
  return { ...draft, columnMap: rest, uniqueLeadFlagColumn: flag ?? null, filter: draft.filter && v.filterColumn ? { ...draft.filter, column: v.filterColumn } : null };
}

export async function saveOutboundConfig(userId: string, processId: string, input: Record<string, unknown>): Promise<OutboundConfig> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const { draft: shape, problems } = parseOutboundInput(input);
  if (problems.length) throw new PdError(400, "INVALID_CONFIG", problems.join("; "));
  const [p] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  if (!p.length) throw new PdError(404, "PROCESS_NOT_FOUND", "Process not found");
  const d = await validateOutboundDraft(shape);
  await db.execute(
    `INSERT INTO process_outbound_source_config
       (id, process_id, cdr_schema, cdr_table, column_map, connected_dispositions, unique_lead_flag_column, filter_column, filter_value, refresh_seconds, enabled, configured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE cdr_schema = VALUES(cdr_schema), cdr_table = VALUES(cdr_table), column_map = VALUES(column_map), connected_dispositions = VALUES(connected_dispositions),
       unique_lead_flag_column = VALUES(unique_lead_flag_column), filter_column = VALUES(filter_column), filter_value = VALUES(filter_value),
       refresh_seconds = VALUES(refresh_seconds), enabled = VALUES(enabled), configured_by = VALUES(configured_by)`,
    [randomUUID(), processId, d.cdrSchema, d.cdrTable, JSON.stringify(d.columnMap), JSON.stringify(d.connectedDispositions), d.uniqueLeadFlagColumn, d.filter?.column ?? null, d.filter?.value ?? null,
      d.refreshSeconds, d.enabled ? 1 : 0, userId]);
  invalidateProcess(processId);
  logger.info({ processId, userId, table: `${d.cdrSchema}.${d.cdrTable}`, enabled: d.enabled }, "[process-dashboard] outbound source saved");
  return (await getOutboundConfig(processId))!;
}

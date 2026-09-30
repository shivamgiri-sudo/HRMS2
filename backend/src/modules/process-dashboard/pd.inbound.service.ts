/**
 * Process Dashboard -- admin side of the support/inbound dialer source (process_inbound_config, sql/1952).
 * An admin picks a dialer cdr_in_* table, pattern and campaigns for a process; the shared loader (call-master/inbound-projects.ts)
 * then serves /api/inbound-insights/:projectKey for it. Everything read from the dialer is SELECT inside a READ ONLY transaction, the
 * table name is regex-checked AND confirmed in dialer_db's information_schema before it reaches SQL text, all values are bound.
 */
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import {
  DIALER_SCHEMA, REQUIRED_DIALER_COLUMNS, SAFE_DIALER_TABLE_RE, SAFE_PROJECT_KEY_RE, STATIC_PROJECTS, getInboundProject, invalidateInboundProjects,
  loadDialerTables, parseInboundInput, projectKeyFromCode, withDialerReadOnly, type InboundInput,
} from "../call-master/inbound-projects.js";
import { PdError } from "./pd.source.js";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export interface CandidateTable { table: string; rows: number | null; complete: boolean; missingColumns: string[]; usedBy: string[] }

/** cdr_in_* tables of the dialer DB with whether each has every column the inbound dashboard reads. */
export async function listCandidateTables(): Promise<CandidateTable[]> {
  const tables = await loadDialerTables(true);
  if (!tables) throw new PdError(503, "DIALER_UNAVAILABLE", "The dialer database could not be reached");
  const names = [...tables];
  if (!names.length) return [];
  const rows = await withDialerReadOnly(async (conn) => {
    const [t] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) LIMIT 5000`, [DIALER_SCHEMA, names]);
    const [c] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) AND COLUMN_NAME IN (?) LIMIT 200000`,
      [DIALER_SCHEMA, names, [...REQUIRED_DIALER_COLUMNS]]);
    return { t, c };
  });
  const cols = new Map<string, Set<string>>();
  for (const r of rows.c) { const k = String(r.table_name ?? r.TABLE_NAME); (cols.get(k) ?? cols.set(k, new Set()).get(k)!).add(String(r.column_name ?? r.COLUMN_NAME).toLowerCase()); }
  const cfgRows = await db.execute<RowDataPacket[]>(`SELECT project_key, dialer_table FROM process_inbound_config WHERE enabled = 1 LIMIT 500`).then(([r]) => r).catch(() => [] as RowDataPacket[]);
  const used = new Map<string, Set<string>>();
  for (const s of STATIC_PROJECTS) (used.get(s.table) ?? used.set(s.table, new Set()).get(s.table)!).add(s.key);
  for (const r of cfgRows) (used.get(String(r.dialer_table)) ?? used.set(String(r.dialer_table), new Set()).get(String(r.dialer_table))!).add(String(r.project_key));
  return rows.t.map((r) => {
    const table = String(r.table_name ?? r.TABLE_NAME);
    const have = cols.get(table) ?? new Set<string>();
    const missing = REQUIRED_DIALER_COLUMNS.filter((c) => !have.has(c.toLowerCase()));
    return { table, rows: (r.table_rows ?? r.TABLE_ROWS) == null ? null : Number(r.table_rows ?? r.TABLE_ROWS), complete: missing.length === 0, missingColumns: missing, usedBy: [...(used.get(table) ?? [])].sort() };
  }).sort((a, b) => a.table.localeCompare(b.table, undefined, { numeric: true }));
}

/** The table name reaches SQL text only after the regex AND the dialer's information_schema both vouch for it. */
export async function assertDialerTable(table: string): Promise<string> {
  if (!SAFE_DIALER_TABLE_RE.test(table) || table.length > 64) throw new PdError(400, "BAD_IDENTIFIER", "dialerTable must look like cdr_in_<number>");
  const tables = await loadDialerTables();
  if (!tables) throw new PdError(503, "DIALER_UNAVAILABLE", "The dialer database could not be reached");
  if (!tables.has(table)) { const fresh = await loadDialerTables(true); if (!fresh?.has(table)) throw new PdError(404, "TABLE_NOT_FOUND", `${table} does not exist in the dialer database`); }
  return table;
}

async function assertRequiredColumns(table: string): Promise<void> {
  const missing = await withDialerReadOnly(async (conn) => {
    const [c] = await conn.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 600`, [DIALER_SCHEMA, table]);
    const have = new Set(c.map((r) => String(r.column_name ?? r.COLUMN_NAME).toLowerCase()));
    return REQUIRED_DIALER_COLUMNS.filter((x) => !have.has(x.toLowerCase()));
  });
  if (missing.length) throw new PdError(400, "TABLE_INCOMPLETE", `${table} lacks the columns the inbound dashboard needs: ${missing.join(", ")}`);
}

const maskPhone = (v: unknown): string => { const d = String(v ?? "").replace(/\D/g, ""); return d.length <= 4 ? "••••" : `${"•".repeat(Math.max(d.length - 4, 3))}${d.slice(-4)}`; };

export interface InboundPreview {
  table: string; campaignsAvailable: Array<{ campaign: string; calls: number; lastCall: string | null }>;
  detectedPattern: { pattern: "A" | "B"; reason: string };
  totals: { offered: number; answered: number; abandoned: number; from: string | null; to: string | null } | null;
  sample: Array<Record<string, unknown>>;
  problems: Array<{ severity: "error" | "warn"; code: string; message: string }>;
}

/** Looks at the table + chosen campaigns and reports what the dashboard would see. Writes nothing. */
export async function previewInbound(processId: string, input: InboundInput): Promise<InboundPreview> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const table = await assertDialerTable(typeof input.dialerTable === "string" ? input.dialerTable.trim() : "");
  const problems: InboundPreview["problems"] = [];
  const parsed = parseInboundInput({ ...input, dialerTable: table, campaigns: Array.isArray(input.campaigns) ? input.campaigns : [] });
  const wanted = parsed.draft.campaigns;
  const t = `\`${DIALER_SCHEMA}\`.\`${table}\``; // table verified above: ^cdr_in_[0-9_]+$ and present in information_schema
  const out = await withDialerReadOnly(async (conn) => {
    const [camp] = await conn.query<RowDataPacket[]>(
      `SELECT /*+ MAX_EXECUTION_TIME(20000) */ CampaignName AS c, COUNT(*) AS n, DATE_FORMAT(MAX(CallDate), '%Y-%m-%d') AS last_call
         FROM ${t} WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND CampaignName IS NOT NULL AND CampaignName <> ''
        GROUP BY CampaignName ORDER BY n DESC LIMIT 200`);
    const [hold] = await conn.query<RowDataPacket[]>(
      wanted.length
        ? `SELECT /*+ MAX_EXECUTION_TIME(20000) */ COUNT(*) AS n FROM ${t} WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND DisconnBy = 'HOLDTIME' AND CampaignName IN (?)`
        : `SELECT /*+ MAX_EXECUTION_TIME(20000) */ COUNT(*) AS n FROM ${t} WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND DisconnBy = 'HOLDTIME'`,
      wanted.length ? [wanted] : []);
    let totals: RowDataPacket | null = null; let sample: RowDataPacket[] = [];
    if (wanted.length) {
      const holdFilter = parsed.draft.pattern === "A" ? " AND DisconnBy != 'HOLDTIME'" : "";
      const [tot] = await conn.query<RowDataPacket[]>(
        `SELECT /*+ MAX_EXECUTION_TIME(20000) */ COUNT(*) AS offered, SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
                DATE_FORMAT(MIN(CallDate), '%Y-%m-%d') AS d0, DATE_FORMAT(MAX(CallDate), '%Y-%m-%d') AS d1
           FROM ${t} WHERE CampaignName IN (?)${holdFilter}`, [wanted]);
      totals = tot[0] ?? null;
      const [smp] = await conn.query<RowDataPacket[]>(
        `SELECT /*+ MAX_EXECUTION_TIME(20000) */ DATE_FORMAT(CallDate, '%Y-%m-%d') AS date, DATE_FORMAT(\`Time\`, '%H:%i:%s') AS time, CampaignName AS campaign, AgentId AS agent_id,
                PhoneNumber AS phone, DisconnBy AS disconnected_by, TIME_TO_SEC(QueueDuration) AS wait_sec, CallDurationSecond AS duration_sec
           FROM ${t} WHERE CampaignName IN (?)${holdFilter} ORDER BY CallDate DESC, id DESC LIMIT 20`, [wanted]);
      sample = smp;
    }
    return { camp, holdN: Number(hold[0]?.n ?? 0), totals, sample };
  });
  const available = out.camp.map((r) => ({ campaign: String(r.c), calls: Number(r.n), lastCall: r.last_call ? String(r.last_call) : null }));
  const known = new Set(available.map((c) => c.campaign));
  for (const m of parsed.problems) if (!/at least one campaign/.test(m)) problems.push({ severity: "error", code: "INVALID_CONFIG", message: m });
  if (!wanted.length) problems.push({ severity: "warn", code: "NO_CAMPAIGNS", message: "Choose at least one campaign to see totals and sample rows" });
  for (const c of wanted) if (!known.has(c)) problems.push({ severity: "warn", code: "CAMPAIGN_QUIET", message: `No calls for "${c}" in the last 90 days` });
  const offered = Number(out.totals?.offered ?? 0);
  if (wanted.length && offered === 0) problems.push({ severity: "error", code: "NO_ROWS", message: "The chosen campaigns have no calls in this table" });
  return {
    table, campaignsAvailable: available,
    detectedPattern: out.holdN > 0
      ? { pattern: "A", reason: `${out.holdN.toLocaleString("en-IN")} HOLDTIME rows in the last 30 days: IVR-routed table (pattern A excludes them)` }
      : { pattern: "B", reason: "No HOLDTIME rows in the last 30 days: plain queue table (pattern B)" },
    totals: out.totals ? { offered, answered: Number(out.totals.answered ?? 0), abandoned: offered - Number(out.totals.answered ?? 0), from: out.totals.d0 ?? null, to: out.totals.d1 ?? null } : null,
    sample: out.sample.map((r) => ({ ...r, phone: maskPhone(r.phone) })),
    problems,
  };
}

export interface StoredInbound {
  processId: string; projectKey: string; dialerTable: string; pattern: "A" | "B"; campaigns: string[]; mandate: number; required: number;
  hasFcr: boolean; fcrClientId: number | null; slSeconds: number | null; enabled: boolean; updatedAt: string | null;
}
const asArr = (v: unknown): string[] => { const x = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v; return Array.isArray(x) ? x.map(String) : []; };
const toStored = (r: RowDataPacket): StoredInbound => ({
  processId: String(r.process_id), projectKey: String(r.project_key), dialerTable: String(r.dialer_table), pattern: r.pattern === "A" ? "A" : "B", campaigns: asArr(r.campaigns),
  mandate: Number(r.mandate), required: Number(r.required), hasFcr: Number(r.has_fcr) === 1, fcrClientId: r.fcr_client_id === null ? null : Number(r.fcr_client_id),
  slSeconds: r.sl_seconds === null ? null : Number(r.sl_seconds), enabled: Number(r.enabled) === 1, updatedAt: r.updated_at ? String(r.updated_at) : null,
});

export async function getInboundConfig(processId: string): Promise<StoredInbound | null> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM process_inbound_config WHERE process_id = ? LIMIT 1`, [processId]).catch((err: { code?: string }) => {
    if (err?.code === "ER_NO_SUCH_TABLE") return [[] as RowDataPacket[]] as unknown as [RowDataPacket[]];
    throw err;
  });
  return rows.length ? toStored(rows[0]) : null;
}

export async function saveInboundConfig(userId: string, processId: string, input: InboundInput): Promise<StoredInbound> {
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const { draft, problems } = parseInboundInput(input);
  if (problems.length) throw new PdError(400, "INVALID_CONFIG", problems.join("; "));
  const [p] = await db.execute<RowDataPacket[]>(`SELECT id, process_code FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  if (!p.length) throw new PdError(404, "PROCESS_NOT_FOUND", "Process not found");
  await assertDialerTable(draft.dialerTable);
  await assertRequiredColumns(draft.dialerTable);
  const existing = await getInboundConfig(processId);
  const key = existing?.projectKey ?? projectKeyFromCode(String(p[0].process_code), processId);
  if (!SAFE_PROJECT_KEY_RE.test(key)) throw new PdError(400, "BAD_KEY", "Could not derive a project key for this process");
  if (!existing) {
    const [clash] = await db.execute<RowDataPacket[]>(`SELECT process_id FROM process_inbound_config WHERE project_key = ? LIMIT 1`, [key]);
    if (clash.length) throw new PdError(409, "KEY_TAKEN", `Project key "${key}" is already used by another process`);
  }
  await db.execute(
    `INSERT INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled, configured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE dialer_table = VALUES(dialer_table), pattern = VALUES(pattern), campaigns = VALUES(campaigns), mandate = VALUES(mandate),
       required = VALUES(required), has_fcr = VALUES(has_fcr), fcr_client_id = VALUES(fcr_client_id), sl_seconds = VALUES(sl_seconds), enabled = VALUES(enabled), configured_by = VALUES(configured_by)`,
    [randomUUID(), processId, key, draft.dialerTable, draft.pattern, JSON.stringify(draft.campaigns), draft.mandate, draft.required, draft.hasFcr ? 1 : 0,
      draft.hasFcr ? draft.fcrClientId : null, draft.slSeconds, draft.enabled ? 1 : 0, userId]);
  invalidateInboundProjects();
  logger.info({ processId, userId, projectKey: key, table: draft.dialerTable, campaigns: draft.campaigns.length, enabled: draft.enabled }, "[process-dashboard] inbound config saved");
  return (await getInboundConfig(processId))!;
}

/** What the generic page needs: does this process have a live inbound dashboard, and under which key? (Viewer-safe: no table names.) */
export async function getInboundTab(processId: string): Promise<{ projectKey: string; name: string } | null> {
  const cfg = await getInboundConfig(processId);
  if (!cfg?.enabled) return null;
  const p = await getInboundProject(cfg.projectKey);
  return p && p.processId === processId ? { projectKey: p.key, name: p.name } : null;
}

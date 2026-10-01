/**
 * Shared inbound project registry -- the ONE place that knows which dialer table / campaigns / pattern an inbound project uses.
 * Used by call-master/inbound.service.ts, call-master/inbound-insights.service.ts and quality-dashboard/inbound-ops.service.ts
 * (the last two used to carry their own near-duplicate lists).
 *
 * Two sources are merged, DB winning:
 *   1. STATIC_PROJECTS -- the hard-coded inbound companies (unchanged; also the fallback when the DB row is missing, disabled, unsafe,
 *      or process_inbound_config does not exist yet);
 *   2. process_inbound_config (sql/1952) -- rows an admin saved through Dashboard Setup for a support/inbound process.
 *
 * Identifier safety (dialer_table is interpolated into SQL text by the consumers, so it is never trusted from the row):
 *   - must match SAFE_DIALER_TABLE_RE (cdr_in_<digits>[_<digits>...] -- every existing table name fits);
 *   - must exist in dialer_db's information_schema (one cached lookup), unless it is the very table the static entry of the same
 *     key already uses (static names are code, so trusted; this keeps the seeded rows working when the dialer is unreachable);
 *   - campaigns are values and are always bound as parameters.
 * A row that fails any check is skipped (the static entry, if any, keeps serving) and logged.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import { logger } from "../../logger.js";

export interface InboundProject {
  key: string;
  name: string;
  icon: string;
  color: string;
  table: string;
  pattern: "A" | "B";
  campaigns: string[];
  mandate: number;
  required: number;
  hasFCR: boolean;
  fcrClientId?: number;
  clientId?: string;
  /** Service-level threshold in seconds; absent = the pattern default (A 20s, B 30s). */
  slSeconds?: number;
}
export type ResolvedInboundProject = InboundProject & { source: "static" | "db"; processId?: string };

export const DIALER_SCHEMA = "dialer_db";
export const SAFE_DIALER_TABLE_RE = /^cdr_in_[0-9]+(?:_[0-9]+)*$/;
export const SAFE_PROJECT_KEY_RE = /^[a-z0-9]{1,40}$/;
export const MAX_CAMPAIGNS = 200;
export const MAX_CAMPAIGN_LEN = 100;
/** Columns every dialer cdr_in_* table must have for the inbound queries to run. */
export const REQUIRED_DIALER_COLUMNS = [
  "id", "CallDate", "Time", "HoursSlot", "AgentId", "AgentName", "CampaignName", "PhoneNumber", "Disposition", "DisconnBy",
  "CallDurationSecond", "QueueDuration", "HoldTime", "Talkduration", "Acwduration", "CallTransferId",
] as const;
/** Same audience the /api/inbound-insights routes have always had. */
export const INBOUND_INSIGHT_ROLES = ["super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst"];

export const STATIC_PROJECTS: InboundProject[] = [
  { key: "gnc",         name: "GNC",          icon: "🛒", color: "#2E86C1", table: "cdr_in_4",     pattern: "A",
    campaigns: ["GNC_Order_Related","GNC_Product_Quality","GNC_Other_Queries","GNC_Product_Info","GNC_Offer_Order","GNC_Authentication"],
    mandate: 8, required: 6, hasFCR: false, clientId: "409" },
  { key: "bellavita",   name: "Bellavita",     icon: "🌸", color: "#E67E22", table: "cdr_in_11_5",  pattern: "A",
    // Kenaz (Ken_Existing_Order / Kenaz_New_Order) and Guzz (Guz_Existing_Order / Guzz_New_Order)
    // campaigns were missing from this list entirely -- confirmed live in dialer_db.cdr_in_11_5
    // 2026-09-30 that both carry real volume (H_Ken_Existing_Order alone: 4,724 calls/45 days),
    // just never queried, so they showed zero everywhere in this dashboard. RotoresN (8 calls/45
    // days) is deliberately left out per explicit user direction -- it has no assigned LOB.
    // (tausif-mis 7d02a4ee4; an enabled DB inbound-config row for "bellavita" still overrides this list.)
    campaigns: ["H_Bellavita_Luxury","E_Bellavita_Organic","E_Bellavita_Luxury","H_Bellavita_Organic","H_Bevzilla_Complaint",
                "H_Bevzilla_CC_Agent","E_Bevzilla_CC_Agent","H_Bevzilla_Order","E_Bevzilla_Order","E_Bevzilla_Complaint",
                "E_Emb_Existing_Order","H_Bevzilla_Product","H_Emb_New_Order","H_Emb_Existing_Order","E_Bevzilla_Product","E_Emb_New_Order",
                "H_Ken_Existing_Order","E_Ken_Existing_Order","H_Kenaz_New_Order","E_Kenaz_New_Order",
                "E_Guzz_New_Order","E_Guz_Existing_Order","H_Guz_Existing_Order","H_Guzz_New_Order"],
    mandate: 14, required: 12, hasFCR: false, clientId: "375" },
  { key: "clovia",      name: "Clovia",        icon: "👗", color: "#27AE60", table: "cdr_in_250",   pattern: "A",
    campaigns: ["Clovia_English","Clovia_Hindi"], mandate: 7, required: 6, hasFCR: false, clientId: "468" },
  { key: "neemans",     name: "Neemans",       icon: "👟", color: "#8E44AD", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Neemans_IB"], mandate: 10, required: 10, hasFCR: true, fcrClientId: 475, clientId: "475" },
  { key: "viega",       name: "Viega",         icon: "🚰", color: "#E74C3C", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Viega"], mandate: 2, required: 2, hasFCR: false, clientId: "352" },
  { key: "exicom",      name: "Exicom",        icon: "⚡", color: "#3498DB", table: "cdr_in_9",     pattern: "B",
    campaigns: ["Exicom_TC_Battery","Exicom_EV_Battery","EV_Charger833"], mandate: 5, required: 5, hasFCR: false, clientId: "326" },
  { key: "dubangladesh",name: "DU Bangladesh", icon: "🇧🇩", color: "#F39C12", table: "cdr_in_4",   pattern: "B",
    campaigns: ["DU_Bangladesh_Bangla","DU_Bangladesh_Eng","DU_Bangladesh_Hindi"], mandate: 3, required: 3, hasFCR: false, clientId: "380" },
  // Live on cdr_in_249 (10 language-variant campaigns), confirmed live 2026-09-15:
  // ~1,700 calls/30 days, active through today. required/mandate set to 9 --
  // the observed daily distinct-agent-login count (8-9 over the last 14 days),
  // not an invented target, since no contractual mandate figure exists for this
  // process anywhere in this codebase.
  { key: "dalmia",      name: "Dalmia",        icon: "🏭", color: "#16A085", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Dalmia_Hindi","Dalmia_English","Dalmia_Kannada","Dalmia_Tamil","Dalmia_Bengoli","Dalmia_Malayalam","Dalmia_Odiya","Dalmia_Marathi","Dalmia_Telugu","Dalmia_Assamese"],
    mandate: 9, required: 9, hasFCR: false },
];

/** Default look for a DB-only project (the static ones keep theirs). */
export const DEFAULT_ICON = "📞";
export const DEFAULT_COLOR = "#2563EB";

export interface InboundConfigRow {
  processId: string; projectKey: string; dialerTable: string; pattern: string; campaigns: unknown;
  mandate: unknown; required: unknown; hasFcr: unknown; fcrClientId: unknown; slSeconds: unknown; enabled: unknown; processName?: string | null;
}

export class InboundConfigError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const asInt = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export interface InboundInput { dialerTable?: unknown; pattern?: unknown; campaigns?: unknown; mandate?: unknown; required?: unknown; hasFcr?: unknown; fcrClientId?: unknown; slSeconds?: unknown; enabled?: unknown }
export interface InboundDraft { dialerTable: string; pattern: "A" | "B"; campaigns: string[]; mandate: number; required: number; hasFcr: boolean; fcrClientId: number | null; slSeconds: number | null; enabled: boolean }

/** Pure shape + safety validation (no DB). Returns the clean draft and every problem found. */
export function parseInboundInput(input: InboundInput): { draft: InboundDraft; problems: string[] } {
  const problems: string[] = [];
  const dialerTable = typeof input.dialerTable === "string" ? input.dialerTable.trim() : "";
  if (!SAFE_DIALER_TABLE_RE.test(dialerTable) || dialerTable.length > 64) problems.push("dialerTable must look like cdr_in_<number> (letters, symbols and dots are not allowed)");
  const pattern = input.pattern === "A" || input.pattern === "B" ? input.pattern : null;
  if (!pattern) problems.push("pattern must be A or B");
  const campaigns: string[] = [];
  if (!Array.isArray(input.campaigns)) problems.push("campaigns must be a list");
  else {
    for (const c of input.campaigns) {
      if (typeof c !== "string" || !c.trim()) { problems.push("campaign names must be non-empty text"); break; }
      const name = c.trim();
      if (name.length > MAX_CAMPAIGN_LEN) { problems.push(`campaign name too long (max ${MAX_CAMPAIGN_LEN})`); break; }
      if (!campaigns.includes(name)) campaigns.push(name);
    }
    if (campaigns.length === 0) problems.push("choose at least one campaign");
    if (campaigns.length > MAX_CAMPAIGNS) problems.push(`too many campaigns (max ${MAX_CAMPAIGNS})`);
  }
  const mandate = input.mandate === undefined || input.mandate === null || input.mandate === "" ? 0 : asInt(input.mandate, 0, 100000);
  if (mandate === null) problems.push("mandate must be a whole number 0-100000");
  const required = input.required === undefined || input.required === null || input.required === "" ? 0 : asInt(input.required, 0, 100000);
  if (required === null) problems.push("required must be a whole number 0-100000");
  const hasFcr = input.hasFcr === true || input.hasFcr === 1 || input.hasFcr === "1";
  const fcrClientId = asInt(input.fcrClientId, 1, 2_000_000_000);
  if (input.fcrClientId !== undefined && input.fcrClientId !== null && input.fcrClientId !== "" && fcrClientId === null) problems.push("fcrClientId must be a positive whole number");
  if (hasFcr && fcrClientId === null) problems.push("fcrClientId is required when FCR is on");
  const slSeconds = asInt(input.slSeconds, 1, 3600);
  if (input.slSeconds !== undefined && input.slSeconds !== null && input.slSeconds !== "" && slSeconds === null) problems.push("slSeconds must be a whole number 1-3600");
  const enabled = input.enabled === undefined ? true : input.enabled === true || input.enabled === 1 || input.enabled === "1";
  return {
    draft: { dialerTable, pattern: pattern ?? "B", campaigns, mandate: mandate ?? 0, required: required ?? 0, hasFcr, fcrClientId, slSeconds, enabled },
    problems,
  };
}

/** Sanitize a process code into a project key ([a-z0-9], max 40). */
export function projectKeyFromCode(code: string, fallbackId: string): string {
  const k = code.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  return k || `p${fallbackId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12)}`;
}

/**
 * Pure merge: static list + DB rows -> resolved list. `existingTables` is the dialer's table set (null = could not be read).
 * A DB row is used only when it is enabled, well-formed, and its table is safe and verified; otherwise the static entry (if any) stays.
 */
export function mergeInboundProjects(
  staticList: InboundProject[], rows: InboundConfigRow[], existingTables: Set<string> | null,
  onSkip: (row: InboundConfigRow, reason: string) => void = () => undefined,
): ResolvedInboundProject[] {
  const byKey = new Map<string, ResolvedInboundProject>(staticList.map((p) => [p.key, { ...p, source: "static" as const }]));
  const extras: ResolvedInboundProject[] = [];
  const seenKeys = new Set<string>();
  for (const r of rows) {
    if (Number(r.enabled) !== 1 && r.enabled !== true) continue;
    const key = String(r.projectKey ?? "");
    if (!SAFE_PROJECT_KEY_RE.test(key)) { onSkip(r, "unsafe project_key"); continue; }
    if (seenKeys.has(key)) { onSkip(r, "duplicate project_key"); continue; }
    let campaigns: unknown = r.campaigns;
    if (typeof campaigns === "string") { try { campaigns = JSON.parse(campaigns); } catch { campaigns = null; } }
    const { draft, problems } = parseInboundInput({
      dialerTable: r.dialerTable, pattern: r.pattern, campaigns, mandate: r.mandate, required: r.required, hasFcr: r.hasFcr,
      fcrClientId: r.fcrClientId, slSeconds: r.slSeconds, enabled: true,
    });
    if (problems.length) { onSkip(r, problems.join("; ")); continue; }
    const st = byKey.get(key);
    const trustedStaticTable = st?.source === "static" && st.table === draft.dialerTable;
    if (!trustedStaticTable && !(existingTables && existingTables.has(draft.dialerTable))) { onSkip(r, existingTables ? `dialer table ${draft.dialerTable} does not exist` : `dialer table ${draft.dialerTable} could not be verified`); continue; }
    seenKeys.add(key);
    const merged: ResolvedInboundProject = {
      ...(st ?? { key, name: String(r.processName ?? key), icon: DEFAULT_ICON, color: DEFAULT_COLOR }),
      key, table: draft.dialerTable, pattern: draft.pattern, campaigns: draft.campaigns, mandate: draft.mandate, required: draft.required,
      hasFCR: draft.hasFcr, source: "db", processId: String(r.processId),
    } as ResolvedInboundProject;
    if (draft.hasFcr && draft.fcrClientId !== null) merged.fcrClientId = draft.fcrClientId; else delete merged.fcrClientId;
    if (draft.slSeconds !== null) merged.slSeconds = draft.slSeconds; else delete merged.slSeconds;
    if (st) byKey.set(key, merged); else extras.push(merged);
  }
  return [...byKey.values(), ...extras.sort((a, b) => a.name.localeCompare(b.name))];
}

/* ---------------- dialer read helpers (read-only) ---------------- */

type DialerConn = Awaited<ReturnType<Awaited<ReturnType<typeof getDialerPool>>["getConnection"]>>;
/** Run fn on a dialer connection inside START TRANSACTION READ ONLY (rolled back afterwards). */
export async function withDialerReadOnly<T>(fn: (conn: DialerConn) => Promise<T>): Promise<T> {
  const pool = await getDialerPool();
  const conn = await pool.getConnection();
  try {
    await conn.query("START TRANSACTION READ ONLY");
    try { return await fn(conn); } finally { await conn.query("ROLLBACK").catch(() => undefined); }
  } finally { conn.release(); }
}

const TABLES_TTL_MS = 5 * 60_000;
let tablesCache: { at: number; tables: Set<string> } | null = null;
/** cdr_in_* tables that exist in the dialer DB right now (cached 5 min; force=true bypasses). null when the dialer cannot be read. */
export async function loadDialerTables(force = false): Promise<Set<string> | null> {
  if (!force && tablesCache && Date.now() - tablesCache.at < TABLES_TTL_MS) return tablesCache.tables;
  try {
    const tables = await withDialerReadOnly(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'cdr\\_in\\_%' LIMIT 5000`, [DIALER_SCHEMA]);
      return new Set(rows.map((r) => String(r.table_name ?? r.TABLE_NAME)).filter((t) => SAFE_DIALER_TABLE_RE.test(t)));
    });
    tablesCache = { at: Date.now(), tables };
    return tables;
  } catch (err) {
    logger.warn({ err }, "[inbound-projects] could not list dialer tables");
    return null;
  }
}

/* ---------------- cached loader ---------------- */

const LOAD_TTL_MS = 30_000;
const FAIL_TTL_MS = 5_000;
let loaded: { at: number; ttl: number; list: ResolvedInboundProject[] } | null = null;
let inflight: Promise<ResolvedInboundProject[]> | null = null;

async function readRows(): Promise<InboundConfigRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.process_id, c.project_key, c.dialer_table, c.pattern, c.campaigns, c.mandate, c.required, c.has_fcr, c.fcr_client_id, c.sl_seconds, c.enabled, p.process_name
       FROM process_inbound_config c JOIN process_master p ON p.id = c.process_id WHERE c.enabled = 1 ORDER BY c.project_key LIMIT 500`);
  return rows.map((r) => ({
    processId: String(r.process_id), projectKey: String(r.project_key), dialerTable: String(r.dialer_table), pattern: String(r.pattern), campaigns: r.campaigns,
    mandate: r.mandate, required: r.required, hasFcr: r.has_fcr, fcrClientId: r.fcr_client_id, slSeconds: r.sl_seconds, enabled: r.enabled, processName: r.process_name,
  }));
}

async function compute(): Promise<{ list: ResolvedInboundProject[]; ttl: number }> {
  let rows: InboundConfigRow[];
  try { rows = await readRows(); } catch (err) {
    // Table missing (migration not run) or DB hiccup: the static list alone is always a valid answer.
    logger.warn({ err }, "[inbound-projects] process_inbound_config unreadable -- serving static list");
    return { list: mergeInboundProjects(STATIC_PROJECTS, [], null), ttl: FAIL_TTL_MS };
  }
  if (rows.length === 0) return { list: mergeInboundProjects(STATIC_PROJECTS, [], null), ttl: LOAD_TTL_MS };
  const tables = await loadDialerTables();
  const list = mergeInboundProjects(STATIC_PROJECTS, rows, tables, (row, reason) =>
    logger.warn({ projectKey: row.projectKey, processId: row.processId, reason }, "[inbound-projects] skipped DB inbound config"));
  return { list, ttl: tables ? LOAD_TTL_MS : FAIL_TTL_MS };
}

/** Merged project list: static order first (DB-overridden in place), then DB-only projects by name. Cached 30 s, shared in flight. */
export async function getInboundProjects(opts: { includeDbOnly?: boolean } = {}): Promise<ResolvedInboundProject[]> {
  const includeDbOnly = opts.includeDbOnly ?? true;
  let list: ResolvedInboundProject[];
  if (loaded && Date.now() - loaded.at < loaded.ttl) list = loaded.list;
  else {
    inflight ??= compute().then((r) => { loaded = { at: Date.now(), ttl: r.ttl, list: r.list }; return r.list; }).finally(() => { inflight = null; });
    list = await inflight;
  }
  return includeDbOnly ? list : list.filter((p) => p.source === "static" || STATIC_PROJECTS.some((s) => s.key === p.key));
}

export async function getInboundProject(key: string): Promise<ResolvedInboundProject | undefined> {
  if (!SAFE_PROJECT_KEY_RE.test(key)) return undefined;
  return (await getInboundProjects()).find((p) => p.key === key);
}

/** Call after saving / deleting a process_inbound_config row. */
export function invalidateInboundProjects(): void { loaded = null; tablesCache = null; }
/** Test hook. */
export function __resetInboundProjectsForTest(): void { loaded = null; inflight = null; tablesCache = null; }

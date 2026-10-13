import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";

/**
 * Agent master for Housing Owner and Housing Premium.
 *
 * Owner keys agents by MASID (owner_agent_details.mas_id); Premium by employee ID
 * (pre_agent_details.emp_id). Each process keeps its own table in db_masmis, which the dashboards
 * read. Premium's AM lives in mas_hrms.pre_agent_am because db_masmis.pre_agent_details has no AM
 * column and the app user cannot add one.
 *
 * Every change to name, TL, AM, target or status writes a row to mas_hrms.agent_target_change_log
 * with the old and new value. Uploads go through upsertAgent(), which updates an existing agent
 * only where a value has changed and never deletes one.
 */

export type ProcessKey = "housing_owner" | "housing_premium";
export const PROCESS_KEYS: readonly ProcessKey[] = ["housing_owner", "housing_premium"];

interface ProcessConfig {
  table: string;
  key: string;
  name: string;
  tl: string;
  target: string;
  status: string;
  /** Owner keeps AM in its own table; Premium keeps it in mas_hrms.pre_agent_am. */
  amColumn: string | null;
  extra: string[];
}

const CONFIG: Record<ProcessKey, ProcessConfig> = {
  housing_owner: {
    table: "db_masmis.owner_agent_details", key: "mas_id", name: "name", tl: "tl_name",
    target: "monthly_target", status: "status", amColumn: "am", extra: ["crm_id", "overall", "doj", "bucket"],
  },
  housing_premium: {
    table: "db_masmis.pre_agent_details", key: "emp_id", name: "agent_name", tl: "tl_name",
    target: "target", status: "status", amColumn: null, extra: ["center", "doj"],
  },
};

export interface AgentInput {
  key: string;
  name?: string | null;
  tl?: string | null;
  am?: string | null;
  target?: number | null;
  status?: string | null;
}

export interface AgentRecord {
  key: string;
  name: string | null;
  tl: string | null;
  am: string | null;
  target: number | null;
  status: string | null;
}

export const isProcessKey = (v: string): v is ProcessKey => (PROCESS_KEYS as readonly string[]).includes(v);

const clean = (v: unknown, max = 200): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};
const money = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" || typeof b === "number") {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    return Math.abs(Number(a) - Number(b)) < 0.005;
  }
  return (a ?? null) === (b ?? null);
};

async function logChange(
  process: ProcessKey, agentKey: string, field: string, oldValue: unknown, newValue: unknown,
  source: "manual" | "upload", by: string | null, batchId: string | null,
): Promise<void> {
  await db.execute(
    `INSERT INTO mas_hrms.agent_target_change_log
       (id, process_key, agent_key, field_name, old_value, new_value, source, batch_id, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), process, agentKey, field, oldValue === null || oldValue === undefined ? null : String(oldValue),
      newValue === null || newValue === undefined ? null : String(newValue), source, batchId, by],
  );
}

async function setAm(process: ProcessKey, key: string, am: string | null, by: string | null): Promise<void> {
  if (CONFIG[process].amColumn) {
    await db.execute(`UPDATE ${CONFIG[process].table} SET ${CONFIG[process].amColumn} = ? WHERE ${CONFIG[process].key} = ?`, [am, key]);
    return;
  }
  await db.execute(
    `INSERT INTO mas_hrms.pre_agent_am (emp_id, am, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE am = VALUES(am), updated_by = VALUES(updated_by)`,
    [key, am, by],
  );
}

function selectSql(process: ProcessKey): string {
  const c = CONFIG[process];
  const am = c.amColumn ? `t.${c.amColumn}` : "a.am";
  const join = c.amColumn ? "" : "LEFT JOIN mas_hrms.pre_agent_am a ON a.emp_id = t.emp_id";
  return `SELECT t.${c.key} AS agent_key, t.${c.name} AS name, t.${c.tl} AS tl, ${am} AS am,
            t.${c.target} AS target, t.${c.status} AS status, ${c.extra.map((x) => `t.${x}`).join(", ")}
          FROM ${c.table} t ${join}`;
}

function toRecord(r: RowDataPacket): AgentRecord & Record<string, unknown> {
  return {
    key: String(r.agent_key),
    name: (r.name as string | null) ?? null,
    tl: (r.tl as string | null) ?? null,
    am: (r.am as string | null) ?? null,
    target: r.target === null || r.target === undefined ? null : Number(r.target),
    status: (r.status as string | null) ?? null,
    ...Object.fromEntries(CONFIG[(r as any).__process as ProcessKey]?.extra.map((x) => [x, r[x] ?? null]) ?? []),
  } as AgentRecord & Record<string, unknown>;
}

export async function listAgents(process: ProcessKey): Promise<AgentRecord[]> {
  const [rows] = await db.execute<RowDataPacket[]>(`${selectSql(process)} ORDER BY t.${CONFIG[process].key}`);
  return rows.map((r) => toRecord(Object.assign(r, { __process: process })));
}

export async function getAgent(process: ProcessKey, key: string) {
  const [rows] = await db.execute<RowDataPacket[]>(`${selectSql(process)} WHERE t.${CONFIG[process].key} = ?`, [key]);
  if (!rows[0]) return null;
  const agent = toRecord(Object.assign(rows[0], { __process: process }));
  const [changes] = await db.execute<RowDataPacket[]>(
    `SELECT field_name, old_value, new_value, source, changed_by, changed_at
       FROM mas_hrms.agent_target_change_log WHERE process_key = ? AND agent_key = ?
      ORDER BY changed_at DESC LIMIT 50`,
    [process, key],
  );
  return { agent, changes: changes.map((c) => ({
    field: c.field_name, from: c.old_value, to: c.new_value, source: c.source, by: c.changed_by,
    at: c.changed_at instanceof Date ? c.changed_at.toISOString().slice(0, 19).replace("T", " ") : String(c.changed_at),
  })) };
}

/** Writes the editable fields of one agent and logs each one that changed. */
async function applyChanges(
  process: ProcessKey, key: string, input: Partial<AgentInput>, source: "manual" | "upload", by: string | null, batchId: string | null,
): Promise<string[]> {
  const c = CONFIG[process];
  const [cur] = await db.execute<RowDataPacket[]>(`${selectSql(process)} WHERE t.${c.key} = ?`, [key]);
  if (!cur[0]) throw new Error(`Agent ${key} does not exist`);
  const before = toRecord(Object.assign(cur[0], { __process: process }));
  const wanted: Array<[string, string, unknown, unknown]> = [];
  if (input.name !== undefined) wanted.push(["name", c.name, before.name, clean(input.name)]);
  if (input.tl !== undefined) wanted.push(["tl", c.tl, before.tl, clean(input.tl)]);
  if (input.target !== undefined) wanted.push(["target", c.target, before.target, money(input.target)]);
  if (input.status !== undefined) wanted.push(["status", c.status, before.status, clean(input.status, 50)]);
  const changed: string[] = [];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [field, column, from, to] of wanted) {
    if (same(from, to)) continue;
    sets.push(`${column} = ?`);
    vals.push(to);
    changed.push(field);
    await logChange(process, key, field, from, to, source, by, batchId);
  }
  if (sets.length) await db.execute(`UPDATE ${c.table} SET ${sets.join(", ")} WHERE ${c.key} = ?`, [...vals, key]);
  if (input.am !== undefined && !same(before.am, clean(input.am))) {
    await logChange(process, key, "am", before.am, clean(input.am), source, by, batchId);
    await setAm(process, key, clean(input.am), by);
    changed.push("am");
  }
  return changed;
}

export async function createAgent(process: ProcessKey, input: AgentInput, by: string | null) {
  const c = CONFIG[process];
  const key = clean(input.key, 50);
  if (!key) throw new Error("Agent ID is required");
  const [exists] = await db.execute<RowDataPacket[]>(`SELECT 1 FROM ${c.table} WHERE ${c.key} = ?`, [key]);
  if (exists.length) throw new Error(`Agent ${key} already exists`);
  const status = clean(input.status, 50) ?? "Active";
  const target = money(input.target);
  if (process === "housing_owner") {
    await db.execute(
      `INSERT INTO ${c.table} (${c.key}, ${c.name}, ${c.tl}, am, ${c.target}, ${c.status}, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [key, clean(input.name), clean(input.tl), clean(input.am), target, status],
    );
  } else {
    await db.execute(
      `INSERT INTO ${c.table} (${c.key}, ${c.name}, ${c.tl}, ${c.target}, ${c.status}, uploaded_by) VALUES (?, ?, ?, ?, ?, NULL)`,
      [key, clean(input.name), clean(input.tl), target, status],
    );
    await setAm(process, key, clean(input.am), by);
  }
  await logChange(process, key, "created", null, `${clean(input.name) ?? ""} | TL ${clean(input.tl) ?? ""} | AM ${clean(input.am) ?? ""} | target ${target ?? ""}`, "manual", by, null);
  return key;
}

export async function updateAgent(process: ProcessKey, key: string, input: Partial<AgentInput>, by: string | null) {
  return applyChanges(process, key, input, "manual", by, null);
}

export async function setStatus(process: ProcessKey, key: string, status: "Active" | "Inactive", by: string | null) {
  return applyChanges(process, key, { status }, "manual", by, null);
}

/**
 * Upload path, used by both the Owner and Premium agent-details importers. Matches by key:
 * a new agent is inserted; an existing one is updated only where a value differs, and each
 * difference is logged. Nothing is deleted.
 */
export async function upsertAgent(
  process: ProcessKey, input: AgentInput, batchId: string, by: string | null,
  insertFullRow?: () => Promise<void>,
): Promise<"inserted" | "updated" | "unchanged"> {
  const key = clean(input.key, 50);
  if (!key) throw new Error("Agent ID is required");
  const c = CONFIG[process];
  const [exists] = await db.execute<RowDataPacket[]>(`SELECT 1 FROM ${c.table} WHERE ${c.key} = ?`, [key]);
  if (!exists.length) {
    // The importer passes its full-row insert, so columns the agent master does not edit are kept.
    if (insertFullRow) {
      await insertFullRow();
      if (input.am !== undefined) await setAm(process, key, clean(input.am), by);
      await logChange(process, key, "created", null, `${clean(input.name) ?? ""} | TL ${clean(input.tl) ?? ""} | AM ${clean(input.am) ?? ""} | target ${money(input.target) ?? ""}`, "upload", by, batchId);
    } else {
      await createAgent(process, input, by);
    }
    return "inserted";
  }
  const changed = await applyChanges(process, key, input, "upload", by, batchId);
  return changed.length ? "updated" : "unchanged";
}

export { CONFIG };

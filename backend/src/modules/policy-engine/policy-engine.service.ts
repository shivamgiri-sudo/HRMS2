import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { invalidatePolicyCache } from "./policy-engine.cache.js";
import type {
  PolicyDomain,
  DomainSummary,
  PolicySection,
  ConfigItem,
  HistoryEntry,
  PolicyUpdateItem,
} from "./policy-engine.types.js";

// ── Domain registry ──────────────────────────────────────────────────────────

interface DomainMeta {
  label: string;
  description: string;
  icon: string;
  is_editable: boolean;
}

const DOMAIN_REGISTRY: Record<string, DomainMeta> = {
  payroll:    { label: "Payroll",          description: "Working days, week-off eligibility slabs, readiness scoring",  icon: "Banknote",       is_editable: true  },
  leave:      { label: "Leave",            description: "CL/ML monthly cap, EL policy rules",                          icon: "CalendarOff",    is_editable: true  },
  operations: { label: "Operations",       description: "Shrinkage thresholds, AHT benchmarks",                        icon: "BarChart3",      is_editable: true  },
  rta:        { label: "RTA / Adherence",  description: "Login adherence thresholds, break breach alerts",             icon: "Activity",       is_editable: true  },
  ats:        { label: "ATS / Hiring",     description: "Offer letter defaults — notice period, probation",            icon: "UserPlus",       is_editable: true  },
  roster:     { label: "Roster",           description: "Acknowledgement governance thresholds",                       icon: "CalendarRange",  is_editable: true  },
  statutory:  { label: "Statutory",        description: "PF, ESIC, PT slabs — managed via Statutory Config module",    icon: "Scale",          is_editable: false },
  attendance: { label: "Attendance Rules", description: "Grace minutes, late-mark rules — managed via Org Masters",   icon: "Clock",          is_editable: false },
  break:      { label: "Break Settings",   description: "Break quotas and durations — managed via WFM Config",         icon: "Coffee",         is_editable: false },
  password:   { label: "Password Policy",  description: "Auth password rules — managed via Security Center",          icon: "Lock",           is_editable: false },
  tax_fy:     { label: "Tax FY Config",    description: "Financial year slabs — managed via Payroll Tax Config",       icon: "Receipt",        is_editable: false },
};

const SECTION_LABELS: Record<string, Record<string, string>> = {
  payroll:    { weekoff_eligibility: "Week-off Eligibility", calculation: "Calculation Defaults", readiness: "Branch Readiness" },
  leave:      { cl_ml_policy: "CL / ML Policy" },
  operations: { shrinkage: "Shrinkage", call_quality: "Call Quality" },
  rta:        { login_adherence: "Login Adherence", break_management: "Break Management" },
  ats:        { offer_defaults: "Offer Letter Defaults" },
  roster:     { governance: "Roster Governance" },
};

// ── Row interfaces ────────────────────────────────────────────────────────────

interface BpcRow extends RowDataPacket {
  section_key: string;
  config_key: string;
  label: string;
  description: string | null;
  value_type: string;
  config_value: string;
  default_value: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  is_readonly: number;
  effective_from: string;
  updated_at: string;
  updated_by: string | null;
}

interface HistoryRow extends RowDataPacket {
  id: string;
  domain_key: string;
  section_key: string;
  config_key: string;
  old_value: string | null;
  new_value: string;
  reason: string | null;
  changed_by: string | null;
  actor_name: string | null;
  changed_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupIntoSections(rows: BpcRow[], domainKey: string): PolicySection[] {
  const map = new Map<string, ConfigItem[]>();
  for (const row of rows) {
    if (!map.has(row.section_key)) map.set(row.section_key, []);
    map.get(row.section_key)!.push({
      config_key:    row.config_key,
      label:         row.label,
      description:   row.description,
      value_type:    row.value_type as ConfigItem["value_type"],
      current_value: row.config_value,
      default_value: row.default_value,
      unit:          row.unit,
      min_value:     row.min_value,
      max_value:     row.max_value,
      is_readonly:   row.is_readonly === 1,
      effective_from: String(row.effective_from).split("T")[0],
      updated_at:    String(row.updated_at),
      updated_by:    row.updated_by,
    });
  }
  const sections: PolicySection[] = [];
  for (const [sk, configs] of map) {
    sections.push({
      section_key:   sk,
      section_label: SECTION_LABELS[domainKey]?.[sk] ?? sk,
      configs,
    });
  }
  return sections;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getDomains(): Promise<DomainSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT domain_key, COUNT(*) AS config_count,
            COUNT(DISTINCT section_key) AS section_count
     FROM business_policy_config
     WHERE active_status = 1
     GROUP BY domain_key`
  );
  const countMap = new Map<string, { config_count: number; section_count: number }>();
  for (const row of rows as RowDataPacket[]) {
    countMap.set(row.domain_key as string, {
      config_count: Number(row.config_count),
      section_count: Number(row.section_count),
    });
  }

  return Object.entries(DOMAIN_REGISTRY).map(([dk, meta]) => ({
    domain_key:    dk,
    label:         meta.label,
    description:   meta.description,
    icon:          meta.icon,
    is_editable:   meta.is_editable,
    section_count: countMap.get(dk)?.section_count ?? 0,
    config_count:  countMap.get(dk)?.config_count  ?? 0,
  }));
}

export async function getDomainDetail(domainKey: string): Promise<PolicyDomain | null> {
  const meta = DOMAIN_REGISTRY[domainKey];
  if (!meta) return null;

  let sections: PolicySection[] = [];

  if (meta.is_editable) {
    const [rows] = await db.execute<BpcRow[]>(
      `SELECT section_key, config_key, label, description, value_type,
              config_value, default_value, unit, min_value, max_value,
              is_readonly, effective_from, updated_at, updated_by
       FROM business_policy_config
       WHERE domain_key = ? AND active_status = 1
       ORDER BY section_key, config_key`,
      [domainKey]
    );
    sections = groupIntoSections(rows, domainKey);
  } else {
    sections = await getPassThroughSections(domainKey);
  }

  return {
    domain_key:  domainKey,
    label:       meta.label,
    description: meta.description,
    icon:        meta.icon,
    is_editable: meta.is_editable,
    sections,
  };
}

async function getPassThroughSections(domainKey: string): Promise<PolicySection[]> {
  try {
    if (domainKey === "statutory") {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT config_key, config_value, effective_from FROM statutory_config
         WHERE active_status = 1 ORDER BY config_key LIMIT 50`
      );
      return [{
        section_key: "statutory_config",
        section_label: "Statutory Configuration",
        configs: (rows as RowDataPacket[]).map((r) => ({
          config_key:    String(r.config_key),
          label:         String(r.config_key).replace(/_/g, " "),
          description:   null,
          value_type:    "string" as const,
          current_value: String(r.config_value),
          default_value: "",
          unit:          null,
          min_value:     null,
          max_value:     null,
          is_readonly:   true,
          effective_from: String(r.effective_from ?? "").split("T")[0],
          updated_at:    "",
          updated_by:    null,
        })),
      }];
    }

    if (domainKey === "attendance") {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT config_key, config_value FROM attendance_rule_config
         WHERE active_status = 1 ORDER BY config_key LIMIT 50`
      );
      return [{
        section_key: "attendance_rule_config",
        section_label: "Attendance Rule Configuration",
        configs: (rows as RowDataPacket[]).map((r) => ({
          config_key:    String(r.config_key),
          label:         String(r.config_key).replace(/_/g, " "),
          description:   null,
          value_type:    "string" as const,
          current_value: String(r.config_value),
          default_value: "",
          unit:          null,
          min_value:     null,
          max_value:     null,
          is_readonly:   true,
          effective_from: "",
          updated_at:    "",
          updated_by:    null,
        })),
      }];
    }

    if (domainKey === "password") {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM auth_password_policy LIMIT 1`
      );
      if (!rows[0]) return [];
      const row = rows[0] as RowDataPacket;
      return [{
        section_key: "auth_password_policy",
        section_label: "Password Policy",
        configs: Object.entries(row)
          .filter(([k]) => !["id", "created_at", "updated_at"].includes(k))
          .map(([k, v]) => ({
            config_key:    k,
            label:         k.replace(/_/g, " "),
            description:   null,
            value_type:    "string" as const,
            current_value: String(v),
            default_value: "",
            unit:          null,
            min_value:     null,
            max_value:     null,
            is_readonly:   true,
            effective_from: "",
            updated_at:    "",
            updated_by:    null,
          })),
      }];
    }
  } catch {
    // table may not exist yet
  }

  return [];
}

export async function updateDomain(
  domainKey: string,
  updates: PolicyUpdateItem[],
  reason: string,
  actorId: string,
  req: { ip?: string }
): Promise<void> {
  const meta = DOMAIN_REGISTRY[domainKey];
  if (!meta || !meta.is_editable) {
    throw new Error(`Domain '${domainKey}' is not editable`);
  }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    for (const upd of updates) {
      const [existing] = await conn.execute(
        `SELECT id, config_value FROM business_policy_config
         WHERE domain_key = ? AND section_key = ? AND config_key = ? AND active_status = 1
         LIMIT 1`,
        [domainKey, upd.section_key, upd.config_key]
      ) as [BpcRow[], unknown];
      const row = existing[0];
      if (!row) continue;

      const oldValue = row.config_value;

      await conn.execute(
        `UPDATE business_policy_config
         SET config_value = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [upd.new_value, actorId, row.id]
      );

      await conn.execute(
        `INSERT INTO business_policy_config_history
           (id, domain_key, section_key, config_key, old_value, new_value, reason, changed_by, changed_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [domainKey, upd.section_key, upd.config_key, oldValue, upd.new_value, reason, actorId]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  invalidatePolicyCache(domainKey);

  logSensitiveAction({
    actor_id:    actorId,
    action_type: "POLICY_UPDATED",
    module_key:  "policy_engine",
    target_id:   domainKey,
    old_data:    JSON.stringify(updates.map((u) => ({ key: `${u.section_key}.${u.config_key}` }))),
    new_data:    JSON.stringify(updates),
    reason,
    ip_address:  req.ip ?? null,
  } as any).catch(() => {});
}

export async function getDomainHistory(domainKey: string): Promise<HistoryEntry[]> {
  const [rows] = await db.execute<HistoryRow[]>(
    `SELECT h.id, h.domain_key, h.section_key, h.config_key,
            h.old_value, h.new_value, h.reason, h.changed_by, h.changed_at,
            h.changed_by AS actor_name
     FROM business_policy_config_history h
     WHERE h.domain_key = ?
     ORDER BY h.changed_at DESC
     LIMIT 30`,
    [domainKey]
  );
  return rows.map((r) => ({
    id:          r.id,
    domain_key:  r.domain_key,
    section_key: r.section_key,
    config_key:  r.config_key,
    old_value:   r.old_value,
    new_value:   r.new_value,
    reason:      r.reason,
    changed_by:  r.changed_by,
    actor_name:  r.actor_name,
    changed_at:  String(r.changed_at),
  }));
}

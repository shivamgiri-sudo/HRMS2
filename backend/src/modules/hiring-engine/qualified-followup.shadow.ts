/**
 * What a dry_run journey would have sent, for the shadow comparison with the engine and legacy sends (one row per row+step+verdict per
 * IST day). The read side compares, per person and IST day, the shadow's would_send steps with what the engine (he_message not sent by
 * the follow-up worker) and the legacy Meta outreach (notification_sent_at, meta_lead_messages outbound) actually sent to the same
 * shadowed (dry_run) people. Samples carry masked numbers only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { istDayBounds } from "./followup-guards.service.js";
import type { FollowupRow } from "./qualified-followup.context.js";
import { maskMobile } from "./qualified-followup.rules.js";

export async function recordShadow(row: FollowupRow, step: string, verdict: string, templateKey: string | null, at: Date): Promise<void> {
  const [start] = istDayBounds(at);
  await db.execute(
    `INSERT INTO followup_shadow (followup_id, mobile10, requisition_id, source_type, step, template_key, verdict, would_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM followup_shadow s WHERE s.followup_id = ? AND s.step = ? AND s.verdict = ? AND s.would_at >= ?)`,
    [row.id, row.mobile10, row.requisitionId, row.sourceType, step, templateKey, verdict.slice(0, 40), at, row.id, step, verdict.slice(0, 40), start]);
}

export interface ShadowComparison {
  /** Person-days where the shadow would have sent and another path did send. */
  matched: number;
  /** would_send steps with nothing sent by another path that day, by step. */
  unifiedOnly: Record<string, number>;
  /** Person-days another path sent and the shadow would not have: by the shadow's reason (no_step_due when it had none). */
  legacyOnly: Record<"engine" | "legacy_meta", Record<string, number>>;
  samples: string[];
}

export interface ShadowRead { mobile10: string; day: string; step: string; verdict: string; template_key?: string | null }
export interface EngineSendRead { mobile10: string; day: string; k: string | null }
export interface LegacySendRead { mobile10: string; day: string }

const SAMPLE_CAP = 10;
const IST_MS = 5.5 * 3600_000;
const C = "COLLATE utf8mb4_unicode_ci";
const wall = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");
const keyOf = (m: unknown, d: unknown) => `${String(m ?? "")}|${String(d ?? "").slice(0, 10)}`;
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

export function compareShadow(shadow: ShadowRead[], engine: EngineSendRead[], legacy: LegacySendRead[]): ShadowComparison {
  const would = new Map<string, Set<string>>();
  const reason = new Map<string, string>();
  for (const r of shadow) {
    const k = keyOf(r.mobile10, r.day);
    if (r.verdict === "would_send") (would.get(k) ?? would.set(k, new Set()).get(k)!).add(String(r.step));
    else if (!reason.has(k)) reason.set(k, String(r.verdict));
  }
  const engineBy = new Map<string, string>();
  for (const e of engine) { const k = keyOf(e.mobile10, e.day); if (!engineBy.has(k)) engineBy.set(k, String(e.k ?? "unknown")); }
  const legacyBy = new Set(legacy.map((l) => keyOf(l.mobile10, l.day)));
  const out: ShadowComparison = { matched: 0, unifiedOnly: {}, legacyOnly: { engine: {}, legacy_meta: {} }, samples: [] };
  const sample = (k: string, text: string) => {
    if (out.samples.length >= SAMPLE_CAP) return;
    const [m, d] = k.split("|");
    out.samples.push(`${maskMobile(m)} ${d} ${text}`);
  };
  for (const [k, steps] of would) {
    if (engineBy.has(k) || legacyBy.has(k)) { out.matched++; continue; }
    for (const st of steps) bump(out.unifiedOnly, st);
    sample(k, `unified-only ${[...steps].join("+")}`);
  }
  for (const [k, tk] of engineBy) {
    if (would.has(k)) continue;
    const why = reason.get(k) ?? "no_step_due";
    bump(out.legacyOnly.engine, why);
    sample(k, `engine-only ${tk} (${why})`);
  }
  for (const k of legacyBy) {
    if (would.has(k)) continue;
    const why = reason.get(k) ?? "no_step_due";
    bump(out.legacyOnly.legacy_meta, why);
    sample(k, `legacy-only (${why})`);
  }
  return out;
}

const LEGACY_MOBILE = "RIGHT(REGEXP_REPLACE(COALESCE(r.parsed_phone, ''), '[^0-9]', ''), 10)";
const SHADOWED = (mobileExpr: string) => `EXISTS (SELECT 1 FROM qualified_followup q WHERE q.mobile10 ${C} = ${mobileExpr} ${C} AND q.mode_at_enqueue = 'dry_run')`;

/** Throws on a read failure; the report shows the section as unavailable. */
export async function collectShadowComparison(from: Date, to: Date): Promise<ShadowComparison> {
  const f = wall(from);
  const t = wall(to);
  const [shadow] = await db.execute<RowDataPacket[]>(
    `SELECT s.mobile10, DATE(s.would_at) AS day, s.step, s.verdict, s.template_key FROM followup_shadow s
      WHERE s.would_at >= ? AND s.would_at < ? ORDER BY s.would_at LIMIT 20000`, [f, t]);
  const [engine] = await db.execute<RowDataPacket[]>(
    `SELECT m.mobile10, DATE(m.created_at) AS day, SUBSTRING_INDEX(m.template_key, ':', 1) AS k FROM he_message m
      WHERE m.direction = 'out' AND (m.sent_by IS NULL OR m.sent_by <> 'followup') AND COALESCE(m.delivery_status, '') <> 'failed'
        AND m.created_at >= ? AND m.created_at < ? AND ${SHADOWED("m.mobile10")} ORDER BY m.created_at LIMIT 20000`, [f, t]);
  const [legacy] = await db.execute<RowDataPacket[]>(
    `SELECT ${LEGACY_MOBILE} AS mobile10, DATE(r.notification_sent_at) AS day FROM meta_lead_raw r
      WHERE r.notification_sent_at >= ? AND r.notification_sent_at < ? AND ${SHADOWED(LEGACY_MOBILE)}
     UNION
     SELECT ${LEGACY_MOBILE} AS mobile10, DATE(mm.created_at) AS day FROM meta_lead_messages mm JOIN meta_lead_raw r ON r.id ${C} = mm.lead_id ${C}
      WHERE mm.direction = 'outbound' AND mm.created_at >= ? AND mm.created_at < ? AND ${SHADOWED(LEGACY_MOBILE)}
     LIMIT 20000`, [f, t, f, t]);
  return compareShadow(shadow as ShadowRead[], engine as EngineSendRead[], legacy as LegacySendRead[]);
}

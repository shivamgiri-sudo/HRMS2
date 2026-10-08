/**
 * Daily report, the unified method's part (Task 15): one section per source and row tag (stage A and stage B counts, held by reason,
 * stops including ineligible_*, guard skips, WhatsApp failures by Meta code), the shared WhatsApp budget, the multi-path check (people
 * the follow-up worker messaged who also got a message from another path in the window; target 0), Pinbot inbound health and the shadow
 * comparison. Covers every tag in one report. Counts and masked numbers only. Each part fails on its own (shown as unavailable).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { waInboundHealth } from "./followup-optout.service.js";
import type { FollowupSwitches, RowTag } from "./qualified-followup.policy.js";
import { maskMobile, metaErrorCode, waDailyBudget, type PinbotQuality } from "./qualified-followup.rules.js";
import { collectShadowComparison, type ShadowComparison } from "./qualified-followup.shadow.js";
import type { SourceMode, SourceType } from "./qualified-followup.types.js";

export type { ShadowComparison } from "./qualified-followup.shadow.js";

export interface SourceDayReport {
  source: SourceType; tag: RowTag | SourceMode; enrolled: number; booked: number; held: Record<string, number>;
  stageA: { email: number; whatsapp: number; call: number; callFile: number; t9: number };
  stageB: { replied: number; confirmed: number; t2: number; d1: number; t4: number; arrived: number; noShow: number; t6: number; reinvited: number; t7: number };
  stopped: Record<string, number>; waFailuresByCode: Array<{ code: string; count: number }>; skips: Record<string, number>;
}

export interface UnifiedReport {
  day: string; enrolled: number; sent: number; sources: SourceDayReport[];
  budget: { max: number; configuredMax: number; quality: PinbotQuality | null; used: number; transactional: number } | null;
  multiPath: { people: number; samples: string[] } | null;
  inbound: { lastInboundAt: string | null; inbound7d: number; verified: boolean } | null;
  shadow: ShadowComparison | null;
}

const C = "COLLATE utf8mb4_unicode_ci";
const IST_MS = 5.5 * 3600_000;
const SOURCES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const TRANSACTIONAL = ["he_walkin_confirmed", "he_reschedule_offer", "he_optout_ack"];
const SAMPLE_CAP = 10;
const wall = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");
const num = (v: unknown) => Number(v ?? 0) || 0;
// Phone-like runs only (10+ digits, +91 prefixed, or 5+5 groups); dates and times ("2026-10-09 12:54:30") stay readable.
const clean = (t: unknown) => String(t ?? "").replace(/[^\s@]+@[^\s@]+/g, "[email]").replace(/\+?\d{10,}|\+?91[\s-]?\d{10}|\b\d{5}[\s-]\d{5}\b/g, "[phone]");

export function emptySourceDay(source: SourceType, tag: SourceDayReport["tag"]): SourceDayReport {
  return {
    source, tag, enrolled: 0, booked: 0, held: {},
    stageA: { email: 0, whatsapp: 0, call: 0, callFile: 0, t9: 0 },
    stageB: { replied: 0, confirmed: 0, t2: 0, d1: 0, t4: 0, arrived: 0, noShow: 0, t6: 0, reinvited: 0, t7: 0 },
    stopped: {}, waFailuresByCode: [], skips: {},
  };
}

async function part<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (err) {
    logger.warn({ err: clean((err as Error)?.message).slice(0, 255) }, `[qualified-followup] daily report: ${what} unavailable`);
    return null;
  }
}

async function rows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [r] = await db.execute<RowDataPacket[]>(sql, params);
  return r ?? [];
}

async function readSources(f: string, t: string): Promise<{ sections: SourceDayReport[]; sent: number }> {
  const w = (col: string) => `(${col} >= ? AND ${col} < ?)`;
  const win = [f, t];
  const [agg, msgs, held, stops, wafail, skips] = await Promise.all([
    rows(`/* uf:rows */ SELECT qf.source_type, qf.mode_at_enqueue AS tag, SUM(${w("qf.created_at")}) AS enrolled,
            SUM(qf.match_id IS NOT NULL AND ${w("qf.updated_at")}) AS booked, SUM(${w("qf.email_sent_at")}) AS email,
            SUM(${w("qf.wa_sent_at")}) AS whatsapp, SUM(${w("qf.called_at")}) AS calls, SUM(qf.call_state = 'in_file' AND ${w("qf.updated_at")}) AS call_file,
            SUM(EXISTS (SELECT 1 FROM he_message i WHERE i.mobile10 ${C} = qf.mobile10 ${C} AND i.direction = 'in' AND ${w("i.created_at")})) AS replied,
            SUM(qf.journey_state IN ('confirmed','reminded','arrived') AND ${w("qf.updated_at")}) AS confirmed,
            SUM(qf.journey_state = 'arrived' AND ${w("qf.updated_at")}) AS arrived, SUM(qf.journey_state = 'no_show' AND ${w("qf.updated_at")}) AS no_show
       FROM qualified_followup qf WHERE qf.updated_at >= ? OR qf.created_at >= ? GROUP BY qf.source_type, qf.mode_at_enqueue`,
      [...win, ...win, ...win, ...win, ...win, ...win, ...win, ...win, ...win, ...win, f, f]),
    rows(`/* uf:msgs */ SELECT x.source_type, x.tag, x.k, COUNT(*) AS n FROM (
            SELECT DISTINCT m.id, q.source_type, q.mode_at_enqueue AS tag, SUBSTRING_INDEX(m.template_key, ':', 1) AS k
              FROM he_message m JOIN qualified_followup q ON q.mobile10 ${C} = m.mobile10 ${C} AND q.requisition_id ${C} = m.requisition_id ${C}
             WHERE m.direction = 'out' AND m.sent_by = 'followup' AND COALESCE(m.delivery_status, '') <> 'failed' AND ${w("m.created_at")}) x
          GROUP BY x.source_type, x.tag, x.k`, win),
    rows(`/* uf:held */ SELECT qf.source_type, qf.mode_at_enqueue AS tag,
            CASE WHEN qf.journey_state IN ('held_manual','held_best_offer') THEN qf.journey_state ELSE qf.held_reason END AS reason, COUNT(*) AS n
       FROM qualified_followup qf WHERE (qf.held_reason IS NOT NULL OR qf.journey_state IN ('held_manual','held_best_offer'))
        AND qf.journey_state NOT IN ('stopped','declined') GROUP BY 1, 2, 3`, []),
    rows(`/* uf:stops */ SELECT qf.source_type, qf.mode_at_enqueue AS tag, qf.stopped_reason AS reason, COUNT(*) AS n FROM qualified_followup qf
      WHERE qf.stopped_reason IS NOT NULL AND ${w("qf.stopped_at")} GROUP BY 1, 2, 3`, win),
    rows(`/* uf:wafail */ SELECT qf.source_type, qf.mode_at_enqueue AS tag, qf.wa_error FROM qualified_followup qf
      WHERE qf.wa_status = 'failed' AND ${w("qf.updated_at")} LIMIT 5000`, win),
    rows(`/* uf:skips */ SELECT q.source_type, q.mode_at_enqueue AS tag, SUBSTRING_INDEX(e.detail, ':', -1) AS reason, COUNT(*) AS n
       FROM he_lead_event e JOIN qualified_followup q ON q.id ${C} = JSON_UNQUOTE(JSON_EXTRACT(e.meta_json, '$.followupId')) ${C}
      WHERE e.event_type = 'followup_skip' AND ${w("e.created_at")} GROUP BY 1, 2, 3`, win),
  ]);
  const map = new Map<string, SourceDayReport>();
  const at = (source: unknown, tag: unknown) => {
    const k = `${String(source)}|${String(tag)}`;
    if (!map.has(k)) map.set(k, emptySourceDay(String(source) as SourceType, String(tag) as RowTag));
    return map.get(k)!;
  };
  for (const a of agg) {
    const x = at(a.source_type, a.tag);
    x.enrolled = num(a.enrolled); x.booked = num(a.booked);
    x.stageA = { ...x.stageA, email: num(a.email), whatsapp: num(a.whatsapp), call: num(a.calls), callFile: num(a.call_file) };
    x.stageB = { ...x.stageB, replied: num(a.replied), confirmed: num(a.confirmed), arrived: num(a.arrived), noShow: num(a.no_show) };
  }
  let sent = 0;
  for (const m of msgs) {
    const x = at(m.source_type, m.tag);
    const n = num(m.n);
    sent += n;
    switch (String(m.k)) {
      case "he_missed_call": x.stageA.t9 += n; break;
      case "he_walkin_confirmed": x.stageB.t2 += n; break;
      case "he_reminder_1d": x.stageB.d1 += n; break;
      case "he_reminder_2h_location": x.stageB.t4 += n; break;
      case "he_no_show_recovery": x.stageB.t6 += n; break;
      case "he_reinvite": x.stageB.reinvited += n; break;
      case "he_other_role_offer": x.stageB.t7 += n; break;
      default: break;
    }
  }
  for (const h of held) if (h.reason) at(h.source_type, h.tag).held[String(h.reason)] = num(h.n);
  for (const s of stops) at(s.source_type, s.tag).stopped[String(s.reason)] = num(s.n);
  for (const s of skips) at(s.source_type, s.tag).skips[String(s.reason)] = num(s.n);
  const byCode = new Map<string, Map<string, number>>();
  for (const e of wafail) {
    const k = `${String(e.source_type)}|${String(e.tag)}`;
    at(e.source_type, e.tag);
    const g = byCode.get(k) ?? byCode.set(k, new Map()).get(k)!;
    const code = metaErrorCode(e.wa_error);
    g.set(code, (g.get(code) ?? 0) + 1);
  }
  for (const [k, g] of byCode) map.get(k)!.waFailuresByCode = [...g].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { sections: [...map.values()], sent };
}

const LEGACY_MOBILE = "RIGHT(REGEXP_REPLACE(COALESCE(r.parsed_phone, ''), '[^0-9]', ''), 10)";

async function readMultiPath(f: string, t: string): Promise<UnifiedReport["multiPath"]> {
  const ps = await rows(`/* uf:multipath */ SELECT DISTINCT w.mobile10 FROM he_message w
     WHERE w.direction = 'out' AND w.sent_by = 'followup' AND COALESCE(w.delivery_status, '') <> 'failed' AND w.created_at >= ? AND w.created_at < ?
       AND (EXISTS (SELECT 1 FROM he_message o WHERE o.mobile10 = w.mobile10 AND o.direction = 'out' AND (o.sent_by IS NULL OR o.sent_by <> 'followup')
                      AND COALESCE(o.delivery_status, '') <> 'failed' AND o.created_at >= ? AND o.created_at < ?)
         OR EXISTS (SELECT 1 FROM meta_lead_raw r WHERE r.notification_sent_at >= ? AND r.notification_sent_at < ? AND ${LEGACY_MOBILE} ${C} = w.mobile10 ${C})
         OR EXISTS (SELECT 1 FROM meta_lead_messages mm JOIN meta_lead_raw r ON r.id ${C} = mm.lead_id ${C}
                     WHERE mm.direction = 'outbound' AND mm.created_at >= ? AND mm.created_at < ? AND ${LEGACY_MOBILE} ${C} = w.mobile10 ${C}))
     LIMIT 1000`, [f, t, f, t, f, t, f, t]);
  return { people: ps.length, samples: ps.slice(0, SAMPLE_CAP).map((p) => maskMobile(String(p.mobile10))) };
}

async function readBudget(f: string, t: string, s: FollowupSwitches, quality: PinbotQuality | null): Promise<UnifiedReport["budget"]> {
  const tx = TRANSACTIONAL.map((k) => `template_key LIKE '${k}:%'`).join(" OR ");
  const [b] = await rows(`/* uf:budget */ SELECT SUM(NOT (${tx})) AS used, SUM(${tx}) AS transactional FROM he_message
     WHERE direction = 'out' AND channel = 'whatsapp' AND COALESCE(delivery_status, '') <> 'failed' AND created_at >= ? AND created_at < ?`, [f, t]);
  return { max: waDailyBudget(quality, s.waDailyMax), configuredMax: s.waDailyMax, quality, used: num(b?.used), transactional: num(b?.transactional) };
}

export async function collectUnifiedReport(from: Date, to: Date, s: FollowupSwitches, quality: PinbotQuality | null): Promise<UnifiedReport> {
  const f = wall(from);
  const t = wall(to);
  const [src, budget, multiPath, inbound, shadow] = await Promise.all([
    part("per-source counts", () => readSources(f, t)),
    part("budget", () => readBudget(f, t, s, quality)),
    part("multi-path", () => readMultiPath(f, t)),
    part("inbound health", async () => {
      const h = await waInboundHealth(to);
      const last = h.lastInboundAt ? wall(h.lastInboundAt) : null;
      return { lastInboundAt: last, inbound7d: h.inbound7d, verified: h.verified };
    }),
    part("shadow comparison", () => collectShadowComparison(from, to)),
  ]);
  const sections = src?.sections ?? [];
  const order = (x: SourceDayReport) => SOURCES.indexOf(x.source) * 10 + ["live", "canary", "test", "dry_run"].indexOf(String(x.tag));
  for (const so of SOURCES) if (!sections.some((x) => x.source === so)) sections.push(emptySourceDay(so, s.sourceModes[so]));
  sections.sort((a, b) => order(a) - order(b) || String(a.tag).localeCompare(String(b.tag)));
  return {
    day: new Date(to.getTime() + IST_MS).toISOString().slice(0, 10), enrolled: sections.reduce((a, x) => a + x.enrolled, 0), sent: src?.sent ?? 0,
    sources: sections, budget, multiPath, inbound, shadow,
  };
}

export function unifiedSubject(u: UnifiedReport): string {
  return `Follow-up daily report ${u.day} — ${u.enrolled} enrolled, ${u.sent} sent, multi-path ${u.multiPath ? u.multiPath.people : "unavailable"}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const kv = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

function sourceLines(x: SourceDayReport): string[] {
  const a = x.stageA;
  const b = x.stageB;
  return [
    `Enrolled ${x.enrolled}, booked ${x.booked}`,
    `Stage A: email ${a.email}, WhatsApp ${a.whatsapp}, calls ${a.call}, calling file ${a.callFile}, T9 missed call ${a.t9}`,
    `Stage B: replied ${b.replied}, confirmed ${b.confirmed}, T2 ${b.t2}, D-1 reminder ${b.d1}, T4 ${b.t4}, arrived ${b.arrived}, no-show ${b.noShow}, T6 ${b.t6}, re-invited ${b.reinvited}, T7 ${b.t7}`,
    `held: ${kv(x.held)}`,
    `stopped: ${kv(x.stopped)}`,
    `skipped by guard: ${kv(x.skips)}`,
    `WhatsApp failures: ${x.waFailuresByCode.map((f) => `${f.code} x${f.count}`).join(", ") || "-"}`,
  ];
}

function otherLines(u: UnifiedReport): Array<{ head: string; lines: string[] }> {
  const bu = u.budget;
  const mp = u.multiPath;
  const ib = u.inbound;
  const sh = u.shadow;
  return [
    { head: "WhatsApp budget", lines: [bu
      ? `WhatsApp budget: ${bu.used} of ${bu.max} used (quality ${bu.quality ?? "unknown"}, configured ${bu.configuredMax}); transactional ${bu.transactional} (not counted)`
      : "WhatsApp budget: unavailable"] },
    { head: "Multi-path", lines: mp
      ? [`Multi-path: ${mp.people} people messaged by the follow-up worker and another path (target 0)`, ...mp.samples.map((m) => `  ${m}`)]
      : ["Multi-path: unavailable"] },
    { head: "Pinbot inbound", lines: [ib
      ? `Pinbot inbound: ${ib.verified ? "verified" : "not verified"}; last inbound ${ib.lastInboundAt ?? "never"}, ${ib.inbound7d} in 7 days`
      : "Pinbot inbound: unavailable"] },
    { head: "Shadow comparison", lines: sh
      ? [`matched ${sh.matched}`, `unified-only: ${kv(sh.unifiedOnly)}`, `engine-only: ${kv(sh.legacyOnly.engine)}`, `legacy-only: ${kv(sh.legacyOnly.legacy_meta)}`, ...sh.samples.map((m) => `  ${m}`)]
      : ["Shadow comparison: unavailable"] },
  ];
}

/** Rendered sections; every number is masked by construction and the text is scrubbed once more as a last line of defence. */
export function unifiedLines(u: UnifiedReport): { html: string; text: string[] } {
  const parts = [...u.sources.map((x) => ({ head: `${x.source} (${x.tag})`, lines: sourceLines(x) })), ...otherLines(u)];
  const html = `<h3>Follow-up method by source</h3>${parts.map((p) => `<h4>${esc(clean(p.head))}</h4><ul>${p.lines.map((l) => `<li>${esc(clean(l.trim()))}</li>`).join("")}</ul>`).join("")}`;
  const text = ["Follow-up method by source", ...parts.flatMap((p) => ["", p.head, ...p.lines.map(clean)])];
  return { html, text };
}

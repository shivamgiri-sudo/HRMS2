/** Process Dashboard alerts -- evaluation, backtest, sweep and test sends. Orchestrates the pure evaluator over the dashboard's own dataset. */
import { randomUUID } from "node:crypto";
import { logger } from "../../../logger.js";
import { PdError } from "../pd.source.js";
import { METRIC_BY_KEY } from "../pd.fields.js";
import { loadConfigOrThrow } from "../pd.dataset.js";
import { anomaliesAt, lastDates, loadAlertContext, metricSeries, scopedData, type AlertContext } from "./alerts.data.js";
import { buildDigestData, digestDue, renderDigest } from "./alerts.digest.js";
import { buildAlertEmail, dashboardLink, formatMetric } from "./alerts.email.js";
import { anomalyTypeOf, dedupeKey, evaluateAnomalyCount, evaluateSeries, inCooldown, isAnomalyKey, simulateFirings, COMPARATOR_LABEL, type Evaluation } from "./alerts.evaluator.js";
import { emptySummary, notifyAlert, publicBaseUrl, sendEmails, ALERT_EVENT_CODE, DIGEST_EVENT_CODE, INBOX_ENTITY, INBOX_TYPE } from "./alerts.notify.js";
import { officialEmailOf, resolvePeople, type Person } from "./alerts.recipients.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import * as repo from "./alerts.repo.js";
import type { AlertRule, Digest, RuleDraft } from "./alerts.types.js";
import { inboxService } from "../../inbox/inbox.service.js";

export const BACKTEST_DAYS = 14;
type RuleLike = Pick<AlertRule, "metricKey" | "comparator" | "threshold" | "windowDays" | "consecutiveDays" | "scopeTl" | "scopeLob" | "cooldownMinutes" | "name" | "severity">;

const metricLabel = (key: string): { label: string; unit?: string } => {
  if (isAnomalyKey(key)) { const t = anomalyTypeOf(key); return { label: t === "any" ? "Agent anomalies" : `${t.replace(/_/g, " ")} anomalies` }; }
  const d = METRIC_BY_KEY.get(key); return { label: d?.label ?? key, unit: d?.unit };
};

export interface RuleEval { ev: Evaluation; anomalies?: Array<{ agentCode: string; name: string | null; detail: string }> }
/** One evaluation of a rule as of `asOf` against an already-loaded context. */
export function evaluateRule(rule: RuleLike, ctx: AlertContext, asOf: string): RuleEval {
  const { rows, qa } = scopedData(ctx.ds, { tl: rule.scopeTl ?? undefined, lob: rule.scopeLob ?? undefined });
  if (isAnomalyKey(rule.metricKey)) {
    const { count, items } = anomaliesAt(rows, qa, asOf, rule.metricKey);
    return { ev: evaluateAnomalyCount(count, rule.threshold), anomalies: items.slice(0, 10).map((a) => ({ agentCode: a.agentCode, name: a.name, detail: a.detail })) };
  }
  const dates = lastDates(asOf, rule.consecutiveDays);
  const series = metricSeries(rows, qa, ctx.loaded.resolved.mapped, rule.metricKey, rule.windowDays, dates);
  return { ev: evaluateSeries(series, asOf, rule.comparator, rule.threshold, rule.consecutiveDays) };
}

export function describeFiring(rule: RuleLike, r: RuleEval, asOf: string): { message: string; context: Record<string, unknown> } {
  const m = metricLabel(rule.metricKey);
  if (isAnomalyKey(rule.metricKey)) {
    return { message: `${rule.name}: ${r.ev.value} agent${r.ev.value === 1 ? "" : "s"} flagged (${m.label}) on ${asOf}`, context: { asOf, agents: r.anomalies ?? [] } };
  }
  const span = rule.consecutiveDays > 1 ? ` for ${rule.consecutiveDays} days in a row` : "";
  const win = rule.windowDays > 1 ? ` (${rule.windowDays}-day window)` : "";
  return { message: `${rule.name}: ${m.label} is ${formatMetric(r.ev.value, m.unit)}${win}, ${COMPARATOR_LABEL[rule.comparator]} ${formatMetric(rule.threshold, m.unit)}${span}, as of ${asOf}`,
    context: { asOf, streakDates: r.ev.dates, windowDays: rule.windowDays, scope: { tl: rule.scopeTl, lob: rule.scopeLob } } };
}

/* ---------------- backtest ---------------- */
export interface BacktestResult { days: number; fired: number; suppressedByCooldown: number; evaluatedDays: number; asOf: string | null; timeline: Array<{ date: string; value: number | null; fired: boolean; suppressedByCooldown: boolean }>; sample: Array<{ date: string; message: string }> }
/** "Would have fired N times in the last 14 data days" -- the same evaluateRule + cooldown the worker uses, replayed day by day. Writes nothing. */
export async function backtestRule(processId: string, draft: RuleLike, days = BACKTEST_DAYS): Promise<BacktestResult> {
  const lookback = days + Math.max(draft.windowDays, 1) + Math.max(draft.consecutiveDays, 1) + 20;
  const ctx = await loadAlertContext(processId, lookback);
  if (!ctx) return { days, fired: 0, suppressedByCooldown: 0, evaluatedDays: 0, asOf: null, timeline: [], sample: [] };
  const dates = lastDates(ctx.asOf, days); const cache = new Map<string, RuleEval>();
  const at = (d: string) => { let r = cache.get(d); if (!r) { r = evaluateRule(draft, ctx, d); cache.set(d, r); } return r; };
  const sim = simulateFirings(dates, (d) => at(d).ev, draft.cooldownMinutes);
  const fmtV = (v: number | null) => v;
  return {
    days, fired: sim.fired, suppressedByCooldown: sim.days.filter((x) => x.suppressedByCooldown).length, evaluatedDays: sim.days.filter((x) => x.value !== null).length, asOf: ctx.asOf,
    timeline: sim.days.map((x) => ({ date: x.date, value: fmtV(x.value), fired: x.fired, suppressedByCooldown: x.suppressedByCooldown })),
    sample: sim.days.filter((x) => x.fired).slice(-5).map((x) => ({ date: x.date, message: describeFiring(draft, at(x.date), x.date).message })),
  };
}

/* ---------------- sweep (worker) ---------------- */
export interface SweepStats { rules: number; processes: number; evaluated: number; fired: number; deduped: number; cooledDown: number; noData: number; notified: number; errors: number }
export async function runAlertSweep(now = new Date()): Promise<SweepStats> {
  const stats: SweepStats = { rules: 0, processes: 0, evaluated: 0, fired: 0, deduped: 0, cooledDown: 0, noData: 0, notified: 0, errors: 0 };
  const rules = await repo.listEnabledRules(); stats.rules = rules.length;
  const byProcess = new Map<string, AlertRule[]>();
  for (const r of rules) { const a = byProcess.get(r.processId); if (a) a.push(r); else byProcess.set(r.processId, [r]); }
  stats.processes = byProcess.size;
  for (const [processId, list] of byProcess) {
    let ctx: AlertContext | null = null;
    try {
      const widest = Math.max(...list.map((r) => r.windowDays + r.consecutiveDays)) + 20;
      ctx = await loadAlertContext(processId, Math.min(120, widest + BACKTEST_DAYS));
    } catch (err) { if (!(err instanceof PdError)) { stats.errors++; logger.error({ err, processId }, "[pd-alerts] could not load process data"); } continue; }
    if (!ctx) { stats.noData += list.length; continue; }
    const label = ctx.loaded.cfg.label ?? "Process";
    for (const rule of list) {
      try {
        stats.evaluated++;
        const r = evaluateRule(rule, ctx, ctx.asOf);
        await repo.touchEvaluated(rule.id);
        if (r.ev.reason === "no_data") { stats.noData++; continue; }
        if (!r.ev.fired) continue;
        const lastMs = await repo.lastFiredMs(rule.id);
        if (inCooldown(lastMs === null ? null : new Date(lastMs), now, rule.cooldownMinutes)) { stats.cooledDown++; continue; }
        const { message, context } = describeFiring(rule, r, ctx.asOf);
        const eventId = await repo.insertEvent({ ruleId: rule.id, processId, dataDate: ctx.asOf, metricKey: rule.metricKey, metricValue: r.ev.value, threshold: rule.threshold, severity: rule.severity, message, context });
        if (!eventId) { stats.deduped++; continue; } // same rule + data date already fired (dedupeKey)
        stats.fired++;
        const m = metricLabel(rule.metricKey);
        const mail = buildAlertEmail({ processLabel: label, ruleName: rule.name, severity: rule.severity, message, metricLabel: m.label, metricValue: formatMetric(r.ev.value, m.unit), comparator: isAnomalyKey(rule.metricKey) ? undefined : rule.comparator,
          threshold: isAnomalyKey(rule.metricKey) ? undefined : formatMetric(rule.threshold, m.unit), dataDate: ctx.asOf, link: dashboardLink(publicBaseUrl(), processId, "alerts") });
        const summary = await notifyAlert(rule.recipients, { processId, eventId, title: `${label}: ${rule.name}`, body: message, severity: rule.severity, channels: rule.channels, mail });
        await repo.markNotified(eventId, summary, summary.inApp + summary.email > 0);
        if (summary.inApp + summary.email > 0) stats.notified++;
      } catch (err) { stats.errors++; logger.error({ err, ruleId: rule.id }, "[pd-alerts] rule evaluation failed"); }
    }
  }
  return stats;
}

export async function sendDigest(digest: Pick<Digest, "id" | "processId" | "frequency" | "recipients">, opts: { isTest?: boolean } = {}): Promise<{ sent: boolean; summary: ReturnType<typeof emptySummary>; html?: string; subject?: string }> {
  const loaded = await loadConfigOrThrow(digest.processId, { requireEnabled: true });
  const data = await buildDigestData(loaded, digest.frequency, publicBaseUrl(), await repo.openCount(digest.processId), !!opts.isTest);
  const summary = emptySummary();
  if (!data) return { sent: false, summary };
  const mail = renderDigest(data);
  const { people, dropped } = await resolvePeople(digest.processId, digest.recipients);
  summary.recipients = people.length; summary.dropped = dropped;
  await sendEmails(DIGEST_EVENT_CODE, people, mail, summary);
  return { sent: summary.email > 0, summary, html: mail.html, subject: mail.subject };
}

export interface DigestSweepStats { due: number; sent: number; errors: number }
export async function runDigestSweep(now = new Date()): Promise<DigestSweepStats> {
  const stats: DigestSweepStats = { due: 0, sent: 0, errors: 0 };
  for (const d of await repo.listEnabledDigests()) {
    try {
      const last = d.lastSentAt ? Date.parse(d.lastSentAt) : null;
      if (!digestDue(d, last, now)) continue;
      stats.due++;
      const r = await sendDigest(d);
      // Mark sent even with zero deliverable addresses so an unreachable list is not retried every poll; a transport failure (emailFailed) retries next poll.
      if (r.sent || r.summary.emailFailed === 0) { await repo.markDigestSent(d.id); if (r.sent) stats.sent++; }
    } catch (err) { if (err instanceof PdError) { await repo.markDigestSent(d.id).catch(() => undefined); continue; } stats.errors++; logger.error({ err, digestId: d.id }, "[pd-alerts] digest failed"); }
  }
  return stats;
}

/** "Send test": a clearly-labelled notification to the requesting user only (in-app and e-mail per the rule's channels), never to the rule's recipients. */
export async function sendTestForRule(processId: string, rule: AlertRule, userId: string): Promise<ReturnType<typeof emptySummary>> {
  const loaded = await loadConfigOrThrow(processId, { requireEnabled: false });
  const label = loaded.cfg.label ?? "Process"; const m = metricLabel(rule.metricKey);
  const message = `Test of "${rule.name}". No threshold has been breached; this only checks delivery.`;
  const mail = buildAlertEmail({ processLabel: label, ruleName: rule.name, severity: rule.severity, message, metricLabel: m.label, metricValue: "—", comparator: isAnomalyKey(rule.metricKey) ? undefined : rule.comparator,
    threshold: isAnomalyKey(rule.metricKey) ? undefined : formatMetric(rule.threshold, m.unit), dataDate: new Date().toISOString().slice(0, 10), link: dashboardLink(publicBaseUrl(), processId, "alerts"), isTest: true });
  const summary = emptySummary();
  const me = await resolveSelf(userId);
  summary.recipients = 1;
  if (rule.channels.includes("in_app")) {
    await inboxService.createItem({ user_id: userId, type: INBOX_TYPE, title: `[Test] ${label}: ${rule.name}`, description: message, entity_type: INBOX_ENTITY, entity_id: randomUUID(), action_url: `/performance/process-dashboard/${processId}?view=alerts`, priority: "normal" });
    summary.inApp = 1;
  }
  if (rule.channels.includes("email")) await sendEmails(ALERT_EVENT_CODE, [me], mail, summary);
  return summary;
}
async function resolveSelf(userId: string): Promise<Person> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT e.id AS employee_id, COALESCE(NULLIF(TRIM(e.full_name),''), e.employee_code) AS name, e.official_email, e.office_email FROM employees e WHERE e.user_id = ? AND e.active_status = 1 LIMIT 1`, [userId]);
  const r = rows[0];
  return { employeeId: r ? String(r.employee_id) : userId, userId, name: r ? String(r.name ?? "") : "You", email: r ? officialEmailOf(r) : null };
}

export async function sendTestDigest(processId: string, frequency: Digest["frequency"], userId: string): Promise<{ summary: ReturnType<typeof emptySummary>; html?: string; subject?: string }> {
  const loaded = await loadConfigOrThrow(processId, { requireEnabled: false });
  const data = await buildDigestData(loaded, frequency, publicBaseUrl(), await repo.openCount(processId), true);
  const summary = emptySummary();
  if (!data) return { summary };
  const mail = renderDigest(data);
  const me = await resolveSelf(userId); summary.recipients = 1;
  await sendEmails(DIGEST_EVENT_CODE, [me], mail, summary);
  return { summary, html: mail.html, subject: mail.subject };
}

export { dedupeKey };
export type { RuleDraft };

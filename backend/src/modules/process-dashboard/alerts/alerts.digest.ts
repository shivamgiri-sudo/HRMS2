/** Process Dashboard alerts -- digest builder. Numbers come from getOverview (the dashboard's own payload), nothing is recomputed. */
import { getFreshness, type Loaded } from "../pd.dataset.js";
import { getOverview } from "../pd.service.js";
import { addDaysIso } from "./alerts.evaluator.js";
import { buildDigestEmail, dashboardLink, formatMetric, type DigestData } from "./alerts.email.js";
import type { Digest, Frequency } from "./alerts.types.js";

/** The period a digest covers: the latest data day (daily) or the 7 days ending on it (weekly). null when the process has no data. */
export async function digestRange(l: Loaded, frequency: Frequency): Promise<{ from: string; to: string } | null> {
  const fresh = await getFreshness(l);
  if (!fresh.latestDate) return null;
  return { from: frequency === "weekly" ? addDaysIso(fresh.latestDate, -6) : fresh.latestDate, to: fresh.latestDate };
}

export async function buildDigestData(l: Loaded, frequency: Frequency, baseUrl: string, openAlerts: number, isTest = false): Promise<DigestData | null> {
  const range = await digestRange(l, frequency);
  if (!range) return null;
  const ov = await getOverview(l, { from: range.from, to: range.to });
  const rank = ov.categoryProfile.kpis.find((k) => k.key === ov.categoryProfile.rankMetric) ?? ov.categoryProfile.columns.find((k) => k.key === ov.categoryProfile.rankMetric);
  const fmt = (v: number | null) => formatMetric(v, rank?.unit);
  const name = (a: { agentCode: string; name: string | null }) => (a.name ? `${a.name} (${a.agentCode})` : a.agentCode);
  return {
    processLabel: l.cfg.label ?? ov.label ?? "Process", frequency, range, link: dashboardLink(baseUrl, l.cfg.processId), openAlerts, isTest,
    kpis: ov.kpis.filter((k) => k.available).map((k) => ({ label: k.label, value: formatMetric(k.value, k.unit), deltaPct: k.deltaPct, status: k.status, direction: k.direction as "higher" | "lower" })),
    anomalies: ov.anomalies.slice(0, 10).map((a) => ({ severity: a.severity, agent: a.name ? `${a.name} (${a.agentCode})` : a.agentCode, detail: a.detail })),
    top: ov.topBottom.top.map((t) => ({ agent: name(t), value: fmt(t.value) })), bottom: ov.topBottom.bottom.map((t) => ({ agent: name(t), value: fmt(t.value) })),
    rankLabel: rank?.label ?? ov.categoryProfile.rankMetric,
  };
}
export const renderDigest = (d: DigestData) => buildDigestEmail(d);

/** Is this digest due at `now` (server local time)? Daily: today's send time has passed and it has not gone out since. Weekly: same, on Mondays. Pure. */
export function digestDue(d: Pick<Digest, "frequency" | "sendTime" | "enabled">, lastSentMs: number | null, now: Date): boolean {
  if (!d.enabled) return false;
  const [hh, mm] = d.sendTime.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  if (d.frequency === "weekly" && now.getDay() !== 1) return false;
  const slot = new Date(now); slot.setHours(hh, mm, 0, 0);
  if (now.getTime() < slot.getTime()) return false;
  return lastSentMs === null || lastSentMs < slot.getTime();
}

/** Process Dashboard -- anomaly detection (pure). Each agent's day is compared with THEIR OWN previous 14 days, plus hard rules. */
import { addRow, computeMetrics, emptyAcc, type NormRow, type QaBucket } from "./pd.metrics.js";

export interface Anomaly { type: "login_drop" | "aht_spike" | "qa_fatal" | "zero_calls_while_logged_in"; severity: "warn" | "bad"; date: string; agentCode: string; name: string | null; detail: string }

export const BASELINE_DAYS = 14;
export const MIN_BASELINE_POINTS = 5;

export const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
export function stdev(v: number[]): number { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); }
/** z-score of x against samples; the spread is floored at 10% of the mean so a near-constant baseline cannot turn noise into a spike. null when < 2 samples. */
export function zScore(x: number, samples: number[]): number | null {
  if (samples.length < 2) return null;
  const m = mean(samples);
  const sd = Math.max(stdev(samples), Math.abs(m) * 0.1, 1e-9);
  return (x - m) / sd;
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export function detectAnomalies(rows: NormRow[], qa: QaBucket[], asOf: string, limit = 100): Anomaly[] {
  const lo = addDays(asOf, -BASELINE_DAYS);
  const byAgentDay = new Map<string, Map<string, ReturnType<typeof emptyAcc>>>();
  const names = new Map<string, string | null>();
  for (const r of rows) {
    if (r.date < lo || r.date > asOf) continue;
    let days = byAgentDay.get(r.agent_code); if (!days) { days = new Map(); byAgentDay.set(r.agent_code, days); }
    let a = days.get(r.date); if (!a) { a = emptyAcc(); days.set(r.date, a); }
    addRow(a, r);
    if (r.agent_name) names.set(r.agent_code, r.agent_name); else if (!names.has(r.agent_code)) names.set(r.agent_code, null);
  }
  const out: Anomaly[] = [];
  for (const [agent, days] of byAgentDay) {
    const today = days.get(asOf);
    if (!today) continue;
    const t = computeMetrics(today);
    const name = names.get(agent) ?? null;
    const hist = [...days.entries()].filter(([d]) => d < asOf).map(([, a]) => ({ m: computeMetrics(a), a }));

    const loginToday = today.sum.login_sec;
    const logins = hist.map((h) => h.a.sum.login_sec).filter((v): v is number => v !== null);
    if (loginToday !== null && logins.length >= MIN_BASELINE_POINTS) {
      const base = mean(logins); const z = zScore(loginToday, logins);
      if (base >= 1800 && loginToday < base * 0.6 && z !== null && z <= -1.5) {
        out.push({ type: "login_drop", severity: loginToday < base * 0.3 ? "bad" : "warn", date: asOf, agentCode: agent, name,
          detail: `Login ${(loginToday / 3600).toFixed(1)}h vs own ${logins.length}-day average ${(base / 3600).toFixed(1)}h (z ${z.toFixed(1)})` });
      }
    }
    const ahts = hist.map((h) => h.m.aht).filter((v): v is number => v !== null);
    if (t.aht !== null && ahts.length >= MIN_BASELINE_POINTS) {
      const base = mean(ahts); const z = zScore(t.aht, ahts);
      if (base > 0 && t.aht > base * 1.3 && z !== null && z >= 2) {
        out.push({ type: "aht_spike", severity: t.aht > base * 1.6 || z >= 3 ? "bad" : "warn", date: asOf, agentCode: agent, name,
          detail: `AHT ${Math.round(t.aht)}s vs own ${ahts.length}-day average ${Math.round(base)}s (z ${z.toFixed(1)})` });
      }
    }
    if (today.sum.calls === 0 && loginToday !== null && loginToday >= 900) {
      out.push({ type: "zero_calls_while_logged_in", severity: "bad", date: asOf, agentCode: agent, name,
        detail: `0 calls with ${(loginToday / 3600).toFixed(1)}h logged in` });
    }
  }
  const from = addDays(asOf, -6);
  for (const q of qa) {
    if (q.fatal > 0 && q.date >= from && q.date <= asOf) {
      out.push({ type: "qa_fatal", severity: "bad", date: q.date, agentCode: q.agentCode, name: names.get(q.agentCode) ?? null,
        detail: `${q.fatal} fatal QA audit${q.fatal > 1 ? "s" : ""} on ${q.date}` });
    }
  }
  const sev = (s: string) => (s === "bad" ? 0 : 1);
  return out.sort((a, b) => sev(a.severity) - sev(b.severity) || b.date.localeCompare(a.date) || a.type.localeCompare(b.type) || a.agentCode.localeCompare(b.agentCode)).slice(0, limit);
}

// Opt-in owner alert for the lead pipeline health checks. No-op unless PIPELINE_HEALTH_ALERTS=true.
// Dedupe state lives in memory only, so a process restart can repeat one alert. That is accepted.
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import type { HealthCheck } from "./he-pipeline-health.js";
import { getPipelineHealth } from "./he-pipeline-health.service.js";

const INTERVAL_MS = 30 * 60 * 1000;
const REALERT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TO = "shivam.giri@teammas.in";

let timer: NodeJS.Timeout | undefined;
const alerted = new Map<string, number>();

/** Critical checks not alerted in the last 6 hours; records them in `prev`. */
export function shouldAlert(prev: Map<string, number>, checks: HealthCheck[], nowMs: number): HealthCheck[] {
  const out: HealthCheck[] = [];
  for (const c of checks) {
    if (c.level !== "critical") continue;
    const last = prev.get(c.key);
    if (last !== undefined && nowMs - last < REALERT_MS) continue;
    prev.set(c.key, nowMs);
    out.push(c);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runHealthAlertOnce(prev: Map<string, number> = alerted, nowMs: number = Date.now()): Promise<void> {
  try {
    const health = await getPipelineHealth();
    const fresh = shouldAlert(prev, health.checks, nowMs);
    if (fresh.length === 0) return;
    const text = fresh.map((c) => `${c.label}: ${c.detail}`).join("\n");
    const html = `<ul>${fresh.map((c) => `<li><b>${esc(c.label)}</b>: ${esc(c.detail)}</li>`).join("")}</ul>`;
    await emailService.send({
      to: process.env.PIPELINE_HEALTH_ALERT_TO || DEFAULT_TO,
      subject: `[HRMS] Pipeline health: ${fresh.length} critical`,
      html,
      text,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[pipeline-health] alert failed");
  }
}

export function startPipelineHealthAlerts(): void {
  if (process.env.PIPELINE_HEALTH_ALERTS !== "true") return;
  if (timer) return;
  timer = setInterval(() => { void runHealthAlertOnce(); }, INTERVAL_MS);
  timer.unref();
}

export function stopPipelineHealthAlerts(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

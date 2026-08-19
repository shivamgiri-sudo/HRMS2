/**
 * Helpdesk SLA Breach Cron
 *
 * D-SLA-01: refreshSlaBreachFlags() used to run inline on every GET /dashboard
 * hit (a full-table UPDATE on helpdesk_ticket per page load). Commit 4829f0a6
 * removed that inline call to stop the per-request UPDATE, but never added a
 * replacement — so sla_breached flags (and the Support Command Center's SLA
 * breach badges) have been frozen at whatever they were at that commit.
 *
 * This restores the flag refresh as a standalone poll, same shape as
 * ats-reminders.cron.ts's scheduler bootstrap, but on a short fixed interval
 * (5 min) like walkin-sla.cron.ts rather than a once-daily clock time — SLA
 * breaches need to surface within minutes, not by next morning.
 */

import { refreshSlaBreachFlags } from "./helpdesk-sla.service.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _timer: ReturnType<typeof setInterval> | null = null;

async function run(): Promise<void> {
  await refreshSlaBreachFlags();
}

export function startHelpdeskSlaCron(): void {
  if (_timer) return;

  void run().catch((e: unknown) => console.error("[helpdesk-sla] initial run error:", e));
  _timer = setInterval(() => {
    void run().catch((e: unknown) => console.error("[helpdesk-sla] tick error:", e));
  }, CHECK_INTERVAL_MS);

  console.log(`[helpdesk-sla] scheduler started (every ${CHECK_INTERVAL_MS / 60000} min)`);
}

export function stopHelpdeskSlaCron(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log("[helpdesk-sla] scheduler stopped");
}

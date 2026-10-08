import type { RowDataPacket } from "mysql2";
import { db } from "../../../../db/mysql.js";
import { num, one, rows } from "../helpers.js";
import {
  ageStatus, formatAge, formatUptime, rateStatus, ratePct, worstStatus,
  type SystemRow, type SystemStatus,
} from "./superAdminLogic.js";

/**
 * One probe per platform system. Every probe is independent and self-contained: if it throws the
 * caller records the system as "unknown" with the reason — a light is never green because a probe
 * failed to run.
 *
 * Ages are TIMESTAMPDIFF(…, NOW()): the pool pins the session to IST and every writer
 * (app, workers, sync engine) stores IST wall-clock, so the two sides share a zone.
 */
export type Probe = () => Promise<SystemRow>;

const OK_DELIVERED = "('sent','delivered','opened','clicked')";

function row(partial: Omit<SystemRow, "age_min"> & { age_min?: number | null }): SystemRow {
  return { age_min: null, ...partial } as SystemRow;
}

export const probeApi: Probe = async () => {
  const up = Math.floor(process.uptime());
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1_048_576);
  // A process that restarted in the last 10 minutes is worth a glance (crash loop?) but is not down.
  const status: SystemStatus = up < 600 ? "warn" : "ok";
  return row({
    id: "api", name: "API server", group: "core", status,
    headline: `up ${formatUptime(up)}`,
    detail: `${up < 600 ? "Restarted recently. " : ""}Process uptime since last restart · RSS ${mb(mem.rss)} MB · heap ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB`,
    href: "/security-center",
  });
};

export const probeDb: Probe = async () => {
  const t0 = Date.now();
  await db.query("SELECT 1");
  const ms = Date.now() - t0;
  let connected: number | null = null;
  let max: number | null = null;
  let running: number | null = null;
  try {
    const [st] = await db.query<RowDataPacket[]>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running')");
    for (const r of st) {
      if (r.Variable_name === "Threads_connected") connected = num(r.Value);
      if (r.Variable_name === "Threads_running") running = num(r.Value);
    }
    const [mx] = await db.query<RowDataPacket[]>("SHOW VARIABLES LIKE 'max_connections'");
    max = num(mx[0]?.Value);
  } catch { /* status privileges are optional; latency alone still judges the light */ }
  const usage = connected !== null && max ? (connected / max) * 100 : null;
  // Round-trip includes the network hop to the DB host, so the bands are generous.
  const status = worstStatus(
    ms > 1500 ? "down" : ms > 500 ? "warn" : "ok",
    usage === null ? "ok" : usage >= 90 ? "down" : usage >= 75 ? "warn" : "ok",
  );
  return row({
    id: "db", name: "Database", group: "core", status,
    headline: `${ms} ms`,
    detail: `Round-trip for SELECT 1${connected !== null ? ` · ${connected}${max ? `/${max}` : ""} connections` : ""}${running !== null ? ` · ${running} running` : ""}`,
    href: "/security-center",
  });
};

export const probeCosec: Probe = async () => {
  const [latest, day, unmapped] = await Promise.all([
    one(`SELECT status, TIMESTAMPDIFF(MINUTE, COALESCE(completed_at, started_at), NOW()) AS age_min, records_read, records_failed,
                LEFT(error_summary, 140) AS note
           FROM integration_sync_run WHERE integration_key = 'cosec' ORDER BY started_at DESC LIMIT 1`),
    one(`SELECT COUNT(*) AS runs, COALESCE(SUM(status = 'failed'), 0) AS failed
           FROM integration_sync_run WHERE integration_key = 'cosec' AND started_at >= NOW() - INTERVAL 1 DAY`),
    one(`SELECT records_read AS users FROM integration_sync_run WHERE integration_key = 'cosec_unmapped' ORDER BY started_at DESC LIMIT 1`),
  ]);
  if (!latest) return row({ id: "cosec", name: "COSEC biometric", group: "integration", status: "unknown", headline: "no runs", detail: "No sync run has ever been recorded.", href: "/wfm/cosec-monitoring" });
  const age = num(latest.age_min);
  const failedLast = String(latest.status) === "failed";
  // Sync runs every ~5 minutes: 30 min of silence is a miss, 3 hours is an outage.
  const status = worstStatus(ageStatus(age, 30, 180), failedLast ? "down" : "ok");
  const failed24 = num(day?.failed) ?? 0;
  return row({
    id: "cosec", name: "COSEC biometric", group: "integration", status, age_min: age,
    headline: formatAge(age),
    detail: `${num(day?.runs) ?? 0} runs / 24h · ${failed24} failed${num(unmapped?.users) ? ` · ${num(unmapped?.users)} unmapped users` : ""}${failedLast ? ` · last run FAILED` : ""}`,
    href: "/wfm/cosec-monitoring",
  });
};

export const probeDialer: Probe = async () => {
  const [done, last, day] = await Promise.all([
    one(`SELECT integration_key, TIMESTAMPDIFF(MINUTE, COALESCE(completed_at, started_at), NOW()) AS age_min, rows_fetched, LEFT(error_message, 100) AS note
           FROM integration_connector_run
          WHERE integration_key LIKE 'dialer%' AND status IN ('complete', 'completed', 'success')
          ORDER BY started_at DESC LIMIT 1`),
    one(`SELECT status FROM integration_connector_run WHERE integration_key LIKE 'dialer%' ORDER BY started_at DESC LIMIT 1`),
    one(`SELECT COUNT(*) AS runs, COALESCE(SUM(status = 'failed'), 0) AS failed
           FROM integration_connector_run WHERE integration_key LIKE 'dialer%' AND started_at >= NOW() - INTERVAL 1 DAY`),
  ]);
  if (!done) return row({ id: "dialer", name: "Dialer sync", group: "integration", status: "unknown", headline: "no runs", detail: "No completed dialer sync on record.", href: "/integration-hub" });
  const age = num(done.age_min);
  // Hourly schedule, each run ~7 minutes.
  const status = worstStatus(ageStatus(age, 150, 480), String(last?.status) === "failed" ? "warn" : "ok");
  const failed24 = num(day?.failed) ?? 0;
  return row({
    id: "dialer", name: "Dialer sync", group: "integration", status, age_min: age,
    headline: formatAge(age),
    detail: `${String(done.integration_key)} · ${num(done.rows_fetched) ?? 0} rows last run · ${failed24} failed / 24h${done.note ? ` · ${String(done.note)}` : ""}`,
    href: "/integration-hub",
  });
};

export const probeEmail: Probe = async () => {
  const [agg, top] = await Promise.all([
    one(`SELECT COALESCE(SUM(status IN ${OK_DELIVERED}), 0) AS ok, COALESCE(SUM(status IN ('failed', 'bounced')), 0) AS bad,
                COALESCE(SUM(status = 'skipped'), 0) AS skipped,
                TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN status IN ${OK_DELIVERED} THEN created_at END), NOW()) AS last_ok_min
           FROM dispatch_log WHERE channel = 'email' AND created_at >= NOW() - INTERVAL 1 DAY`),
    one(`SELECT LEFT(error_message, 90) AS msg, COUNT(*) AS c FROM dispatch_log
          WHERE channel = 'email' AND status = 'failed' AND created_at >= NOW() - INTERVAL 1 DAY
          GROUP BY msg ORDER BY c DESC LIMIT 1`),
  ]);
  const ok = num(agg?.ok) ?? 0;
  const bad = num(agg?.bad) ?? 0;
  const total = ok + bad;
  const rate = ratePct(bad, total);
  const status = total === 0 ? "unknown" : rateStatus(bad, total, 5, 20);
  return row({
    id: "email", name: "Email delivery", group: "comms", status, age_min: num(agg?.last_ok_min),
    headline: rate === null ? "no volume" : `${rate}% failed`,
    detail: total === 0 ? "No email attempted in the last 24h."
      : `${bad} of ${total} email attempts failed in 24h${top?.msg ? ` · top error: ${String(top.msg)}` : ""} · last delivered ${formatAge(num(agg?.last_ok_min))}`,
    href: "/wfm/notification-hub",
  });
};

export const probeMessaging: Probe = async () => {
  const r = await rows(
    `SELECT channel, COALESCE(SUM(status IN ${OK_DELIVERED}), 0) AS ok, COALESCE(SUM(status IN ('failed', 'bounced')), 0) AS bad,
            COALESCE(SUM(status = 'skipped'), 0) AS skipped
       FROM dispatch_log WHERE channel IN ('whatsapp', 'sms') AND created_at >= NOW() - INTERVAL 1 DAY GROUP BY channel`,
  );
  const by = new Map(r.map((x) => [String(x.channel), x]));
  const wa = by.get("whatsapp");
  const sms = by.get("sms");
  const ok = (num(wa?.ok) ?? 0) + (num(sms?.ok) ?? 0);
  const bad = (num(wa?.bad) ?? 0) + (num(sms?.bad) ?? 0);
  const status = ok + bad === 0 ? "unknown" : rateStatus(bad, ok + bad, 5, 20);
  return row({
    id: "messaging", name: "WhatsApp & SMS", group: "comms", status,
    headline: ok + bad === 0 ? "no sends" : `${ok} sent`,
    detail: `WhatsApp ${num(wa?.ok) ?? 0} sent / ${num(wa?.bad) ?? 0} failed · SMS ${num(sms?.ok) ?? 0} sent / ${num(sms?.bad) ?? 0} failed / ${num(sms?.skipped) ?? 0} skipped (24h)`,
    href: "/wfm/notification-hub",
  });
};

export const probeBgv: Probe = async () => {
  const [agg, top] = await Promise.all([
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(success_flag = 1), 0) AS ok,
                TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN success_flag = 1 THEN created_at END), NOW()) AS last_ok_min
           FROM candidate_bgv_api_request_log WHERE created_at >= NOW() - INTERVAL 1 DAY`),
    one(`SELECT provider_key, error_code, COUNT(*) AS c FROM candidate_bgv_api_request_log
          WHERE created_at >= NOW() - INTERVAL 1 DAY AND success_flag = 0
          GROUP BY provider_key, error_code ORDER BY c DESC LIMIT 1`),
  ]);
  const n = num(agg?.n) ?? 0;
  const bad = n - (num(agg?.ok) ?? 0);
  const rate = ratePct(bad, n);
  return row({
    id: "bgv", name: "BGV vendor APIs", group: "integration",
    status: n === 0 ? "unknown" : rateStatus(bad, n, 20, 50, 5), age_min: num(agg?.last_ok_min),
    headline: rate === null ? "no calls" : `${rate}% errors`,
    detail: n === 0 ? "No vendor call in the last 24h."
      : `${bad} of ${n} vendor calls failed in 24h${top ? ` · ${String(top.error_code ?? "error")} via ${String(top.provider_key)}` : ""} · last success ${formatAge(num(agg?.last_ok_min))}`,
    href: "/ats/bgv-api-monitor",
  });
};

export const probeAts: Probe = async () => {
  const [cand, mail] = await Promise.all([
    one(`SELECT TIMESTAMPDIFF(MINUTE, MAX(created_at), NOW()) AS age_min FROM ats_candidate`),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(status = 'failed'), 0) AS bad FROM ats_email_log WHERE sent_at >= NOW() - INTERVAL 7 DAY`),
  ]);
  const day = await one(`SELECT COUNT(*) AS n FROM ats_candidate WHERE created_at >= NOW() - INTERVAL 1 DAY`);
  const age = num(cand?.age_min);
  // Candidates arrive through the working day only: two days without one is a gap, a week is an outage.
  const status = worstStatus(ageStatus(age, 48 * 60, 7 * 1440), rateStatus(num(mail?.bad) ?? 0, num(mail?.n) ?? 0, 10, 30, 20));
  return row({
    id: "ats", name: "ATS intake", group: "integration", status, age_min: age,
    headline: `${num(day?.n) ?? 0} new / 24h`,
    detail: `Last candidate registered ${formatAge(age)} · candidate emails ${num(mail?.bad) ?? 0} failed of ${num(mail?.n) ?? 0} (7d)`,
    href: "/ats/dashboard",
  });
};

export const probeJobs: Probe = async () => {
  const a = await one(
    `SELECT COUNT(DISTINCT worker_name) AS workers, COALESCE(SUM(status = 'failed'), 0) AS failed,
            COALESCE(SUM(status = 'completed'), 0) AS done,
            TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN status = 'completed' THEN COALESCE(completed_at, started_at) END), NOW()) AS last_ok_min
       FROM worker_job_run WHERE started_at >= NOW() - INTERVAL 1 DAY`,
  );
  const failed = num(a?.failed) ?? 0;
  const lastOk = num(a?.last_ok_min);
  const status = worstStatus(failed >= 5 ? "down" : failed > 0 ? "warn" : "ok", ageStatus(lastOk, 120, 360));
  return row({
    id: "jobs", name: "Scheduled jobs", group: "jobs", status, age_min: lastOk,
    headline: `${failed} failed / 24h`,
    detail: `${num(a?.workers) ?? 0} jobs ran · ${num(a?.done) ?? 0} completed · last success ${formatAge(lastOk)}`,
    href: "/integration-hub",
  });
};

export const probeConnections: Probe = async () => {
  const a = await one(
    `SELECT COALESCE(SUM(active_status = 1), 0) AS active, COALESCE(SUM(active_status = 1 AND test_ok = 0), 0) AS failing,
            COALESCE(SUM(active_status = 1 AND test_ok IS NULL), 0) AS untested,
            TIMESTAMPDIFF(DAY, MAX(test_at), NOW()) AS test_age_d
       FROM integration_config`,
  );
  const failing = num(a?.failing) ?? 0;
  return row({
    id: "connections", name: "Integration connections", group: "integration",
    status: failing > 0 ? "warn" : "ok",
    headline: `${failing} failing`,
    detail: `${num(a?.active) ?? 0} active configs · ${failing} failed their last connection test · ${num(a?.untested) ?? 0} never tested${num(a?.test_age_d) !== null ? ` · newest test ${num(a?.test_age_d)}d ago` : ""}`,
    href: "/integration-hub",
  });
};

export const PROBES: Array<{ id: string; name: string; group: SystemRow["group"]; href: string; run: Probe }> = [
  { id: "api", name: "API server", group: "core", href: "/security-center", run: probeApi },
  { id: "db", name: "Database", group: "core", href: "/security-center", run: probeDb },
  { id: "cosec", name: "COSEC biometric", group: "integration", href: "/wfm/cosec-monitoring", run: probeCosec },
  { id: "dialer", name: "Dialer sync", group: "integration", href: "/integration-hub", run: probeDialer },
  { id: "bgv", name: "BGV vendor APIs", group: "integration", href: "/ats/bgv-api-monitor", run: probeBgv },
  { id: "ats", name: "ATS intake", group: "integration", href: "/ats/dashboard", run: probeAts },
  { id: "connections", name: "Integration connections", group: "integration", href: "/integration-hub", run: probeConnections },
  { id: "email", name: "Email delivery", group: "comms", href: "/wfm/notification-hub", run: probeEmail },
  { id: "messaging", name: "WhatsApp & SMS", group: "comms", href: "/wfm/notification-hub", run: probeMessaging },
  { id: "jobs", name: "Scheduled jobs", group: "jobs", href: "/integration-hub", run: probeJobs },
];

/** Runs every probe in parallel; a throwing probe becomes an "unknown" light carrying the reason. */
export async function runProbes(): Promise<SystemRow[]> {
  return Promise.all(PROBES.map(async (p): Promise<SystemRow> => {
    try {
      return await p.run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { id: p.id, name: p.name, group: p.group, status: "unknown", headline: "unavailable", detail: `Probe failed: ${reason.slice(0, 140)}`, age_min: null, href: p.href };
    }
  }));
}

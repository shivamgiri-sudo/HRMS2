import { empScope, lastDays, num, one, pct, rows, severityFor } from "../helpers.js";
import type { InsightContext, InsightKpi, InsightSection, InsightSeries, InsightSignal, InsightTable } from "../types.js";
import {
  fillDays, formatAge, gapSeverity, integrationState, ratePct, rateStatus, systemSignals, systemsHealth, toTone,
} from "./superAdminLogic.js";
import { runProbes } from "./superAdminSystems.js";

const OK_DELIVERED = "('sent','delivered','opened','clicked')";

/** Systems grid: ten status lights + the composite health score. */
export async function systems(): Promise<InsightSection> {
  const sys = await runProbes();
  const h = systemsHealth(sys);
  const table: InsightTable = {
    key: "systems", title: "Systems",
    columns: [{ key: "name", label: "System" }, { key: "status", label: "Status" }, { key: "headline", label: "Signal" }, { key: "detail", label: "Detail" }],
    rows: sys,
  };
  return { healthScore: h.score, healthBasis: h.basis, tables: [table], signals: systemSignals(sys) };
}

/** Registry of every configured integration with its freshest run, so a stale feed cannot hide. */
export async function integrations(): Promise<InsightSection> {
  const [cfg, conn, sync] = await Promise.all([
    rows(`SELECT integration_key, integration_name, integration_type, active_status, test_ok,
                 TIMESTAMPDIFF(DAY, test_at, NOW()) AS test_age_d
            FROM integration_config ORDER BY integration_name`),
    rows(`SELECT r.integration_key, r.status, TIMESTAMPDIFF(MINUTE, r.started_at, NOW()) AS age_min
            FROM integration_connector_run r
            JOIN (SELECT integration_key, MAX(started_at) AS m FROM integration_connector_run GROUP BY integration_key) x
              ON x.integration_key = r.integration_key AND x.m = r.started_at`),
    rows(`SELECT r.integration_key, r.status, TIMESTAMPDIFF(MINUTE, r.started_at, NOW()) AS age_min
            FROM integration_sync_run r
            JOIN (SELECT integration_key, MAX(started_at) AS m FROM integration_sync_run GROUP BY integration_key) x
              ON x.integration_key = r.integration_key AND x.m = r.started_at`),
  ]);
  // Keys differ only by case between the config and the run tables ("Cosec" vs "cosec").
  const latest = new Map<string, { status: string; age: number }>();
  for (const r of [...conn, ...sync]) {
    const k = String(r.integration_key).toLowerCase();
    const age = num(r.age_min);
    if (age === null) continue;
    const prev = latest.get(k);
    if (!prev || age < prev.age) latest.set(k, { status: String(r.status), age });
  }
  const order = { down: 0, warn: 1, idle: 2, ok: 3, off: 4 } as const;
  const list = cfg.map((c) => {
    const run = latest.get(String(c.integration_key).toLowerCase());
    const st = integrationState({
      active: Number(c.active_status) === 1, testOk: num(c.test_ok), testAgeDays: num(c.test_age_d),
      lastRunAgeMin: run?.age ?? null, lastRunStatus: run?.status ?? null,
    });
    return {
      integration: String(c.integration_name ?? c.integration_key), type: String(c.integration_type), state: st.state,
      reason: st.reason, last_run: run ? formatAge(run.age) : "—", href: "/integration-hub",
    };
  }).sort((a, b) => order[a.state] - order[b.state]);
  const count = (s: string) => list.filter((x) => x.state === s).length;
  return {
    tables: [{
      key: "integrations", title: "Integration registry",
      columns: [{ key: "integration", label: "Integration" }, { key: "state", label: "State" }, { key: "reason", label: "Why" }, { key: "last_run", label: "Last run" }],
      rows: list, href: "/integration-hub",
    }],
    kpis: [{
      key: "integrations_failing", label: "Integrations needing attention", value: count("down") + count("warn"), unit: "count",
      higherIsBetter: false, tone: count("down") ? "red" : count("warn") ? "amber" : "green", href: "/integration-hub",
      helper: `${count("ok")} healthy · ${count("idle")} never run · ${count("off")} switched off`,
      formula: "Active integrations whose latest run failed, or whose last connection test failed.",
    }],
  };
}

/** Per-job health from worker_job_run (7 days) plus enabled workers that logged nothing. */
export async function jobs(ctx: InsightContext): Promise<InsightSection> {
  const [runs, cfg, daily] = await Promise.all([
    rows(`SELECT worker_name, COALESCE(SUM(status = 'completed'), 0) AS ok, COALESCE(SUM(status = 'failed'), 0) AS failed,
                 TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN status = 'completed' THEN COALESCE(completed_at, started_at) END), NOW()) AS last_ok_min,
                 TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN status = 'failed' THEN started_at END), NOW()) AS last_fail_min,
                 ROUND(AVG(CASE WHEN status = 'completed' THEN duration_ms END)) AS avg_ms
            FROM worker_job_run WHERE started_at >= NOW() - INTERVAL 7 DAY
           GROUP BY worker_name ORDER BY failed DESC, worker_name`),
    rows(`SELECT worker_name FROM worker_config WHERE enabled = 1`),
    rows(`SELECT DATE_FORMAT(started_at, '%Y-%m-%d') AS d, COALESCE(SUM(status = 'completed'), 0) AS ok, COALESCE(SUM(status = 'failed'), 0) AS failed
            FROM worker_job_run WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY d`),
  ]);
  const seen = new Set(runs.map((r) => String(r.worker_name)));
  const list: Array<Record<string, string | number | null>> = runs.map((r) => {
    const failed = num(r.failed) ?? 0;
    const lastOk = num(r.last_ok_min);
    const lastFail = num(r.last_fail_min);
    const state = failed > 0 ? (lastOk === null || (lastFail !== null && lastFail < lastOk) ? "down" : "warn") : "ok";
    return {
      worker: String(r.worker_name), state, runs_ok: num(r.ok), failed_7d: failed, last_success: formatAge(lastOk),
      avg_seconds: num(r.avg_ms) === null ? null : Math.round((num(r.avg_ms) as number) / 100) / 10,
    };
  });
  const silent = cfg.map((c) => String(c.worker_name)).filter((w) => !seen.has(w));
  for (const w of silent) list.push({ worker: w, state: "silent", runs_ok: 0, failed_7d: 0, last_success: "no run logged (7d)", avg_seconds: null });
  const byDay = new Map(daily.map((d) => [String(d.d), { ok: num(d.ok) ?? 0, failed: num(d.failed) ?? 0 }]));
  const failed7 = list.reduce((s, r) => s + (Number(r.failed_7d) || 0), 0);
  const series: InsightSeries = {
    key: "job_runs", title: "Scheduled job runs", subtitle: "Completed vs failed, last 7 days", kind: "stacked", unit: "count",
    keys: [{ key: "ok", label: "Completed", tone: "green" }, { key: "failed", label: "Failed", tone: "red" }],
    points: fillDays(lastDays(ctx.today, 7), byDay, ["ok", "failed"]),
  };
  return {
    tables: [{
      key: "jobs", title: "Scheduled job health",
      columns: [{ key: "worker", label: "Job" }, { key: "state", label: "State" }, { key: "runs_ok", label: "OK runs (7d)", align: "right" }, { key: "failed_7d", label: "Failed (7d)", align: "right" }, { key: "last_success", label: "Last success" }],
      rows: list,
    }],
    series: [series],
    kpis: [{
      key: "jobs_failed_7d", label: "Job failures (7d)", value: failed7, unit: "count", higherIsBetter: false,
      tone: failed7 ? "amber" : "green", href: "/integration-hub",
      helper: `${silent.length} enabled job${silent.length === 1 ? "" : "s"} logged no run in 7d`,
      formula: "worker_job_run rows with status = failed in the last 7 days.",
    }],
  };
}

/** Error rates with a 7-day spark so "is this new?" is answerable at a glance. */
export async function errorRates(ctx: InsightContext): Promise<InsightSection> {
  const days = lastDays(ctx.today, 7);
  const [mail, bgv, fail24] = await Promise.all([
    rows(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COALESCE(SUM(status IN ${OK_DELIVERED}), 0) AS ok, COALESCE(SUM(status IN ('failed','bounced')), 0) AS failed
            FROM dispatch_log WHERE channel = 'email' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY d`),
    rows(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n, COALESCE(SUM(success_flag = 0), 0) AS failed
            FROM candidate_bgv_api_request_log WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY d`),
    one(`SELECT
           (SELECT COUNT(*) FROM integration_sync_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 1 DAY)
         + (SELECT COUNT(*) FROM integration_connector_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 1 DAY) AS integrations,
           (SELECT COUNT(*) FROM worker_job_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 1 DAY) AS jobs`),
  ]);
  const m = new Map(mail.map((r) => [String(r.d), { ok: num(r.ok) ?? 0, failed: num(r.failed) ?? 0 }]));
  const b = new Map(bgv.map((r) => [String(r.d), { n: num(r.n) ?? 0, failed: num(r.failed) ?? 0 }]));
  // null (no volume that day) is skipped from the spark rather than drawn as a perfect 0% day.
  const mailRates = days.map((d) => { const x = m.get(d); return x ? ratePct(x.failed, x.ok + x.failed) : null; });
  const bgvRates = days.map((d) => { const x = b.get(d); return x ? ratePct(x.failed, x.n) : null; });
  const spark = (a: Array<number | null>) => a.filter((v): v is number => v !== null);
  const last = (a: Array<number | null>) => [...a].reverse().find((v) => v !== null) ?? null;
  const prev = (a: Array<number | null>) => { const nn = a.filter((v): v is number => v !== null); return nn.length > 1 ? nn[nn.length - 2] : null; };
  const mailNow = last(mailRates);
  const bgvNow = last(bgvRates);
  const mailTone = toTone(mailNow === null ? "unknown" : rateStatus(mailNow, 100, 5, 20, 1));
  const bgvTone = toTone(bgvNow === null ? "unknown" : rateStatus(bgvNow, 100, 20, 50, 1));
  const kpis: InsightKpi[] = [
    {
      key: "email_failure_rate", label: "Email failure rate", value: mailNow, unit: "percent", higherIsBetter: false, tone: mailTone,
      delta: mailNow !== null && prev(mailRates) !== null ? Math.round((mailNow - (prev(mailRates) as number)) * 10) / 10 : null,
      deltaLabel: "vs previous day with volume", spark: spark(mailRates), href: "/wfm/notification-hub",
      helper: "Latest day with email volume", formula: "failed or bounced ÷ (delivered + failed) email rows in dispatch_log; skipped rows excluded.",
      unavailable: mailNow === null ? "No email volume in 7 days" : null,
    },
    {
      key: "bgv_error_rate", label: "BGV vendor error rate", value: bgvNow, unit: "percent", higherIsBetter: false, tone: bgvTone,
      delta: bgvNow !== null && prev(bgvRates) !== null ? Math.round((bgvNow - (prev(bgvRates) as number)) * 10) / 10 : null,
      deltaLabel: "vs previous day with calls", spark: spark(bgvRates), href: "/ats/bgv-api-monitor",
      helper: "Latest day with vendor calls", formula: "candidate_bgv_api_request_log rows with success_flag = 0 ÷ all rows.",
      unavailable: bgvNow === null ? "No vendor calls in 7 days" : null,
    },
    {
      key: "integration_failures_24h", label: "Integration run failures (24h)", value: num(fail24?.integrations), unit: "count", higherIsBetter: false,
      tone: (num(fail24?.integrations) ?? 0) > 0 ? "red" : "green", href: "/integration-hub",
      formula: "integration_sync_run + integration_connector_run rows with status = failed in the last 24 hours.",
    },
    {
      key: "job_failures_24h", label: "Job failures (24h)", value: num(fail24?.jobs), unit: "count", higherIsBetter: false,
      tone: (num(fail24?.jobs) ?? 0) > 0 ? "red" : "green", href: "/integration-hub",
      formula: "worker_job_run rows with status = failed in the last 24 hours.",
    },
  ];
  const series: InsightSeries[] = [{
    key: "email_delivery", title: "Email delivery", subtitle: "Delivered vs failed, last 7 days", kind: "stacked", unit: "count",
    keys: [{ key: "ok", label: "Delivered", tone: "green" }, { key: "failed", label: "Failed", tone: "red" }],
    points: fillDays(days, m, ["ok", "failed"]), href: "/wfm/notification-hub",
  }];
  const signals: InsightSignal[] = [];
  if (mailNow !== null && mailNow >= 20) signals.push({ tone: "bad", title: "Email delivery is failing", detail: `${mailNow}% of email attempts failed on the latest day with volume.`, value: `${mailNow}%`, href: "/wfm/notification-hub" });
  if (bgvNow !== null && bgvNow >= 50) signals.push({ tone: "bad", title: "BGV vendor is mostly erroring", detail: `${bgvNow}% of vendor API calls failed on the latest day with calls.`, value: `${bgvNow}%`, href: "/ats/bgv-api-monitor" });
  return { kpis, series, signals };
}

/** Anything that pages a platform owner: one merged, newest-first feed across sources. */
export async function incidents(): Promise<InsightSection> {
  const r = await rows(
    `SELECT DATE_FORMAT(ts, '%d %b %H:%i') AS at_txt, TIMESTAMPDIFF(MINUTE, ts, NOW()) AS age_min, source, severity, title, detail FROM (
       (SELECT created_at AS ts, 'security' AS source, CAST(severity AS CHAR) AS severity,
               CAST(CONCAT(event_type, COALESCE(CONCAT(' — ', title), '')) AS CHAR) AS title, CAST(LEFT(COALESCE(description, ''), 140) AS CHAR) AS detail
          FROM security_audit_event WHERE severity IN ('high', 'critical') AND created_at >= NOW() - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 8)
       UNION ALL
       (SELECT started_at, 'integration', 'high', CAST(CONCAT(integration_key, ' sync failed') AS CHAR), CAST(LEFT(COALESCE(error_summary, ''), 140) AS CHAR)
          FROM integration_sync_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 7 DAY ORDER BY started_at DESC LIMIT 5)
       UNION ALL
       (SELECT started_at, 'integration', 'high', CAST(CONCAT(integration_key, ' run failed') AS CHAR), CAST(LEFT(COALESCE(error_message, ''), 140) AS CHAR)
          FROM integration_connector_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 7 DAY ORDER BY started_at DESC LIMIT 5)
       UNION ALL
       (SELECT started_at, 'job', 'high', CAST(CONCAT(worker_name, ' failed') AS CHAR), CAST(LEFT(COALESCE(error_message, ''), 140) AS CHAR)
          FROM worker_job_run WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 7 DAY ORDER BY started_at DESC LIMIT 5)
       UNION ALL
       (SELECT created_at, 'bgv', 'medium', CAST(CONCAT(provider_key, ' vendor error ', COALESCE(error_code, '')) AS CHAR), CAST(LEFT(COALESCE(error_message, ''), 140) AS CHAR)
          FROM candidate_bgv_api_request_log WHERE success_flag = 0 AND created_at >= NOW() - INTERVAL 1 DAY ORDER BY created_at DESC LIMIT 4)
     ) feed ORDER BY ts DESC LIMIT 14`,
  );
  const hrefFor = (s: string) => (s === "security" ? "/security-center" : s === "bgv" ? "/ats/bgv-api-monitor" : "/integration-hub");
  return {
    tables: [{
      key: "incident_feed", title: "Incident feed",
      columns: [{ key: "at_txt", label: "When" }, { key: "source", label: "Source" }, { key: "severity", label: "Severity" }, { key: "title", label: "Event" }, { key: "detail", label: "Detail" }],
      rows: r.map((x) => ({
        at_txt: String(x.at_txt), age_min: num(x.age_min), source: String(x.source), severity: String(x.severity),
        title: String(x.title), detail: String(x.detail ?? ""), href: hrefFor(String(x.source)),
      })),
      href: "/security-center",
    }],
  };
}

/** Core-field completeness for every active employee, plus orphans that no field check can see. */
export async function dataQuality(ctx: InsightContext): Promise<InsightSection> {
  const sc = empScope(ctx);
  const [agg, orphanLogin, exitedMgr, mapEx, unmapped] = await Promise.all([
    one(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(e.branch_id IS NULL), 0) AS no_branch, COALESCE(SUM(e.process_id IS NULL), 0) AS no_process,
              COALESCE(SUM(e.department_id IS NULL), 0) AS no_department, COALESCE(SUM(e.designation_id IS NULL), 0) AS no_designation,
              COALESCE(SUM(COALESCE(e.reporting_manager_id, e.manager_id) IS NULL), 0) AS no_manager,
              COALESCE(SUM(COALESCE(NULLIF(e.mobile, ''), NULLIF(e.personal_phone, '')) IS NULL), 0) AS no_mobile,
              COALESCE(SUM(COALESCE(NULLIF(e.official_email, ''), NULLIF(e.email, '')) IS NULL), 0) AS no_email,
              COALESCE(SUM(e.date_of_birth IS NULL), 0) AS no_dob, COALESCE(SUM(e.user_id IS NULL), 0) AS no_login,
              COALESCE(SUM(e.branch_id IS NULL OR e.process_id IS NULL OR e.department_id IS NULL OR e.designation_id IS NULL
                 OR COALESCE(e.reporting_manager_id, e.manager_id) IS NULL OR e.date_of_birth IS NULL
                 OR COALESCE(NULLIF(e.mobile, ''), NULLIF(e.personal_phone, '')) IS NULL), 0) AS any_gap
         FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${sc.sql}`, sc.params),
    one(`SELECT COUNT(*) AS n FROM auth_user u WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id)`),
    one(
      `SELECT COUNT(*) AS n FROM employees e JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
        WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE() AND m.active_status = 0${sc.sql}`, sc.params),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM integration_mapping_exception WHERE status = 'open'`),
    one(`SELECT records_read AS n FROM integration_sync_run WHERE integration_key = 'cosec_unmapped' ORDER BY started_at DESC LIMIT 1`),
  ]);
  const total = num(agg?.total);
  const gaps: Array<[string, string, number | null, string, string]> = [
    ["no_manager", "No reporting manager", num(agg?.no_manager), "Approvals and escalations have nobody to route to.", "/employees"],
    ["no_process", "No process assigned", num(agg?.no_process), "Invisible to every process-scoped dashboard and P&L.", "/employees"],
    ["no_department", "No department", num(agg?.no_department), "Excluded from department headcount and cost splits.", "/employees"],
    ["no_designation", "No designation", num(agg?.no_designation), "Payroll grade and org chart cannot place them.", "/employees"],
    ["no_branch", "No branch", num(agg?.no_branch), "Falls outside every branch-scoped view.", "/employees"],
    ["no_mobile", "No mobile number", num(agg?.no_mobile), "OTP and WhatsApp notifications cannot reach them.", "/employees"],
    ["no_email", "No email", num(agg?.no_email), "No email notifications.", "/employees"],
    ["no_dob", "No date of birth", num(agg?.no_dob), "Statutory forms and birthday greetings need it.", "/employees"],
    ["no_login", "Active employee without a login", num(agg?.no_login), "Cannot reach self-service.", "/settings/access-control"],
  ];
  const tableRows: InsightTable["rows"] = gaps.map(([key, check, count, hint, href]) => ({
    key, check, count, total, pct: pct(count, total), severity: gapSeverity(count, total), hint, href,
  }));
  tableRows.push(
    { key: "orphan_login", check: "Login accounts with no employee record", count: num(orphanLogin?.n), total: null, pct: null, severity: severityFor(num(orphanLogin?.n), 1, 500), hint: "Orphan auth_user rows: shared, test or left-over accounts.", href: "/settings/access-control" },
    { key: "exited_manager", check: "Reports to an exited manager", count: num(exitedMgr?.n), total, pct: pct(num(exitedMgr?.n), total), severity: gapSeverity(num(exitedMgr?.n), total), hint: "Manager is inactive: approvals route into a dead inbox.", href: "/employees" },
    { key: "cosec_unmapped", check: "COSEC users not mapped to an employee", count: num(unmapped?.n), total: null, pct: null, severity: severityFor(num(unmapped?.n), 1, 100), hint: "Punches from these badge IDs are not credited to anyone (latest sync).", href: "/wfm/cosec-monitoring" },
    { key: "mapping_exceptions", check: "Open integration mapping exceptions", count: num(mapEx?.n), total: null, pct: null, severity: severityFor(num(mapEx?.n), 1, 20), hint: num(mapEx?.oldest) !== null ? `Oldest open ${num(mapEx?.oldest)}d.` : "", href: "/integration-hub" },
  );
  const complete = total !== null ? total - (num(agg?.any_gap) ?? 0) : null;
  const kpis: InsightKpi[] = [{
    key: "profile_completeness", label: "Profile completeness", value: pct(complete, total), unit: "percent", tone: (pct(complete, total) ?? 0) >= 95 ? "green" : (pct(complete, total) ?? 0) >= 85 ? "amber" : "red",
    helper: `${(num(agg?.any_gap) ?? 0).toLocaleString("en-IN")} of ${(total ?? 0).toLocaleString("en-IN")} active employees have a core gap`,
    formula: "Active employees with branch, process, department, designation, manager, date of birth and a mobile number ÷ all active employees.",
    href: "/employees", unavailable: total === null ? "Employee table unreachable" : null,
  }];
  return { kpis, tables: [{ key: "data_quality", title: "Data quality gaps", columns: [{ key: "check", label: "Check" }, { key: "count", label: "Records", align: "right" }, { key: "pct", label: "Share %", align: "right" }], rows: tableRows }] };
}

/** Where the sensitive activity happened in the last 24h, and who drove it. */
export async function audit(ctx: InsightContext): Promise<InsightSection> {
  const [byDay, mods, actors] = await Promise.all([
    // Index-only scan on acted_at: filtering by module_key forced a read of every JSON-heavy row (1.1s vs 0.1s).
    rows(`SELECT DATE_FORMAT(acted_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM sensitive_action_log
           WHERE acted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY d`),
    rows(`SELECT module_key, COUNT(*) AS n FROM sensitive_action_log
           WHERE acted_at >= NOW() - INTERVAL 1 DAY AND module_key <> 'AUTH' GROUP BY module_key ORDER BY n DESC LIMIT 8`),
    rows(`SELECT COALESCE(u.email, 'system') AS actor, COUNT(*) AS n FROM sensitive_action_log s
            LEFT JOIN auth_user u ON u.id = s.actor_user_id
           WHERE s.acted_at >= NOW() - INTERVAL 1 DAY AND s.module_key <> 'AUTH' GROUP BY actor ORDER BY n DESC LIMIT 6`),
  ]);
  const m = new Map(byDay.map((r) => [String(r.d), num(r.n) ?? 0]));
  const days = lastDays(ctx.today, 7);
  const spark = days.map((d) => m.get(d) ?? 0);
  const today = spark[spark.length - 1];
  const prior = spark.slice(0, -1);
  const avg = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : null;
  return {
    kpis: [{
      key: "audit_events_today", label: "Audit-log entries today", value: today, unit: "count", spark, tone: "violet", href: "/audit-log",
      delta: avg === null ? null : Math.round(today - avg), deltaLabel: "vs 6-day average",
      helper: "Includes sign-ins and sign-outs", formula: "sensitive_action_log rows dated today (the table behind the Audit Log page).",
    }],
    series: [{
      key: "audit_modules", title: "Audit activity by module", subtitle: "Sensitive actions, last 24h (excl. login)", kind: "ranked", unit: "count", href: "/audit-log",
      points: mods.map((r) => ({ label: String(r.module_key), value: num(r.n) })),
    }],
    tables: [{
      key: "audit_actors", title: "Most active actors (24h)", columns: [{ key: "actor", label: "Actor" }, { key: "n", label: "Sensitive actions", align: "right" }],
      rows: actors.map((r) => ({ actor: String(r.actor), n: num(r.n), href: "/audit-log" })), href: "/audit-log",
    }],
  };
}

/**
 * Which branches carry the open attendance blockers that stop payroll.
 *
 * Done as two index-only reads joined in memory: the SQL join of ~17k issue rows to employees took
 * ~4s against the remote DB, whereas grouping issues by employee_id (covering index) and mapping
 * employee -> branch from the 1k active employees takes ~1s.
 */
export async function branchRisk(ctx: InsightContext): Promise<InsightSection> {
  const sc = empScope(ctx);
  const [issues, emps, branches] = await Promise.all([
    rows(`SELECT employee_id, COUNT(*) AS n FROM attendance_reconciliation_issue
           WHERE resolved_at IS NULL AND severity = 'blocker' AND issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND employee_id IS NOT NULL
           GROUP BY employee_id`),
    rows(`SELECT e.id, e.branch_id FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${sc.sql}`, sc.params),
    rows(`SELECT id, branch_name FROM branch_master`),
  ]);
  const branchOf = new Map(emps.map((e) => [String(e.id), e.branch_id ? String(e.branch_id) : ""]));
  const headcount = new Map<string, number>();
  for (const b of branchOf.values()) headcount.set(b, (headcount.get(b) ?? 0) + 1);
  const blockers = new Map<string, number>();
  for (const i of issues) {
    const b = branchOf.get(String(i.employee_id));
    if (b !== undefined) blockers.set(b, (blockers.get(b) ?? 0) + (num(i.n) ?? 0));
  }
  const names = new Map(branches.map((b) => [String(b.id), String(b.branch_name)]));
  const list = [...blockers.entries()]
    .map(([id, n]) => {
      const h = headcount.get(id) ?? 0;
      return { branch: names.get(id) ?? "No branch", headcount: h, blockers: n, per_100: h ? Math.round((n / h) * 1000) / 10 : null, href: "/wfm/attendance-exceptions" };
    })
    .sort((a, b) => b.blockers - a.blockers).slice(0, 10);
  return {
    series: [{
      key: "blockers_by_branch", title: "Open attendance blockers by branch", subtitle: "Unresolved blocker-severity issues, last 30 days", kind: "ranked", unit: "count",
      href: "/wfm/attendance-exceptions", points: list.map((r) => ({ label: r.branch, value: r.blockers })),
      unavailable: list.length ? null : "No open blockers attributable to an active employee",
    }],
    tables: [{
      key: "branch_risk", title: "Branch risk board",
      columns: [{ key: "branch", label: "Branch" }, { key: "headcount", label: "Active staff", align: "right" }, { key: "blockers", label: "Open blockers", align: "right" }, { key: "per_100", label: "Per 100 staff", align: "right" }],
      rows: list, href: "/wfm/attendance-exceptions",
    }],
  };
}

import type { InsightAction, InsightKpi, InsightProvider, InsightSectionFn, InsightSignal } from "../types.js";
import { empScope, num, one, rows, severityFor, toneFor } from "../helpers.js";
import { allowedPageCodes, pickHref } from "./pageAccess.js";
import { ageBuckets, classifyTask, slaCompliance, type QueueTask } from "./itLogic.js";

const CODE = "IT_MANAGER_DASHBOARD";
const drill = (m: string) => `/dashboards/drill/${CODE}/${m}`;
const OPEN_TICKET = "('resolved','closed','cancelled')";

/** Pending IT-assigned provisioning tasks (join + exit), scoped, with employee state. Memoised per request. */
const memo = new WeakMap<object, Promise<QueueTask[]>>();
function loadQueue(ctx: Parameters<InsightSectionFn>[0]): Promise<QueueTask[]> {
  let p = memo.get(ctx);
  if (!p) {
    const sc = empScope(ctx, "e");
    p = rows(
      `SELECT ipr.request_type, ipr.task_code, ipr.status, ipr.requested_at, ipr.sla_due_at,
              e.employee_code, e.active_status, e.date_of_joining, e.legacy_emp_id
         FROM it_provisioning_request ipr JOIN employees e ON e.id = ipr.employee_id
        WHERE ipr.assigned_role IN ('it', 'branch_it') AND ipr.status IN ('pending', 'pending_unassigned')
          AND e.legacy_emp_id IS NULL${sc.sql}`,
      sc.params,
    ).then((r) => r.map((x) => ({
      requestType: String(x.request_type) as "join" | "exit", taskCode: String(x.task_code), requestedAt: String(x.requested_at),
      slaDueAt: x.sla_due_at ? String(x.sla_due_at) : null, employeeCode: String(x.employee_code), employeeActive: Number(x.active_status) === 1,
    })));
    memo.set(ctx, p);
  }
  return p;
}
const nowIso = () => new Date().toISOString();

const queue: InsightSectionFn = async (ctx) => {
  const [tasks, allowed] = await Promise.all([loadQueue(ctx), allowedPageCodes(ctx)]);
  const href = pickHref(allowed, ["/provisioning/it", "/it-provisioning"], drill("ONBOARDING"));
  const now = Date.now();
  const joins = tasks.filter((t) => t.requestType === "join" && t.employeeActive);
  const staleJoins = tasks.filter((t) => t.requestType === "join" && !t.employeeActive);
  const exits = tasks.filter((t) => t.requestType === "exit");
  const overdue = (xs: QueueTask[]) => xs.filter((t) => t.slaDueAt && Date.parse(t.slaDueAt) < now).length;
  const oldest = (xs: QueueTask[]) => (xs.length ? Math.max(...xs.map((t) => Math.floor((now - Date.parse(t.requestedAt)) / 86_400_000))) : null);
  const distinct = (xs: QueueTask[]) => new Set(xs.map((t) => t.employeeCode)).size;
  const byType = new Map<string, number>();
  for (const t of joins) byType.set(classifyTask(t.taskCode), (byType.get(classifyTask(t.taskCode)) ?? 0) + 1);
  const actions: InsightAction[] = [
    { id: "it_joiner_setup", label: "Joiner setup (email, domain, asset)", count: joins.length, severity: overdue(joins) ? "critical" : severityFor(joins.length, 5, 15), oldestDays: oldest(joins), overdue: overdue(joins), href, hint: `${distinct(joins)} joiner(s); overdue = past SLA due time`, group: "Provisioning" },
    { id: "it_exit_deprov", label: "Exit deprovisioning (domain + email delete)", count: exits.length, severity: severityFor(exits.length, 10, 40), oldestDays: oldest(exits), overdue: exits.filter((t) => (Math.floor((now - Date.parse(t.requestedAt)) / 86_400_000)) > 7).length, href, hint: `${distinct(exits)} leaver(s); no SLA is set on exit tasks, overdue = older than 7 days`, group: "Provisioning" },
    { id: "it_stale_joins", label: "Join tasks for inactive employees (clean up)", count: staleJoins.length, severity: severityFor(staleJoins.length, 5, 20), oldestDays: oldest(staleJoins), href, hint: "employee already left or never joined; waive or close", group: "Hygiene" },
  ];
  const buckets = ageBuckets([...joins, ...exits].map((t) => Math.floor((now - Date.parse(t.requestedAt)) / 86_400_000)));
  return {
    actions,
    kpis: [
      { key: "pending_joiner_tasks", label: "Joiner tasks pending", value: joins.length, unit: "count", higherIsBetter: false, tone: toneFor(joins.length, 0, 5, false), href, helper: `${distinct(joins)} joiner(s)`, formula: "IT-assigned join tasks in pending / pending_unassigned for ACTIVE employees (tasks, not people). Exit tasks and tasks of inactive employees are counted separately; the old single 'pending_total' mixed joiners and leavers." },
      { key: "sla_overdue", label: "SLA breached", value: overdue(joins), unit: "count", higherIsBetter: false, tone: toneFor(overdue(joins), 0, 3, false), href, helper: "joiner tasks past SLA due time", formula: "Pending joiner tasks with sla_due_at in the past. Same unit (tasks) as the pending count, so overdue can never exceed pending." },
      { key: "pending_exit_tasks", label: "Exit tasks pending", value: exits.length, unit: "count", higherIsBetter: false, tone: toneFor(exits.length, 0, 10, false), href, helper: `${distinct(exits)} leaver(s) still have access`, formula: "IT-assigned exit tasks (domain_delete, email_delete) still pending: accounts of leavers that are not yet revoked." },
    ],
    series: [
      { key: "queue_by_task", title: "Joiner queue by task", kind: "ranked", href, unit: "count", points: [...byType].map(([label, value]) => ({ label, value })) },
      { key: "queue_age", title: "Queue age (joiner + exit tasks)", subtitle: "days since the task was raised", kind: "bar", href, unit: "count", points: buckets },
    ],
    signals: [
      ...(overdue(joins) ? [{ tone: "bad", title: `${overdue(joins)} joiner task(s) past SLA`, detail: "New joiners are waiting on accounts or devices beyond the committed time.", value: overdue(joins), href } as InsightSignal] : []),
      ...(exits.length ? [{ tone: exits.length > 20 ? "bad" : "watch", title: `${distinct(exits)} leaver(s) still have live domain/email access`, detail: "Security exposure: revoke accounts and recover assets.", value: distinct(exits), href } as InsightSignal] : []),
    ],
  };
};

const joiners: InsightSectionFn = async (ctx) => {
  const sc = empScope(ctx, "e");
  const allowed = await allowedPageCodes(ctx);
  const href = pickHref(allowed, ["/provisioning/it", "/it-provisioning"], drill("ONBOARDING"));
  const r = await rows(
    `SELECT e.employee_code, e.full_name, e.date_of_joining,
            (SELECT ipr.status FROM it_provisioning_request ipr WHERE ipr.employee_id = e.id AND ipr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
              ORDER BY ipr.created_at DESC LIMIT 1) AS it_status,
            (SELECT 1 FROM asset_assignment aa WHERE aa.employee_id = e.id AND aa.returned_date IS NULL LIMIT 1) AS has_asset
       FROM employees e
      WHERE e.active_status IN (0, 1) AND e.legacy_emp_id IS NULL AND e.date_of_joining >= ? AND e.date_of_joining <= DATE_ADD(?, INTERVAL 7 DAY)${sc.sql}
      ORDER BY e.date_of_joining LIMIT 200`,
    [ctx.today, ctx.today, ...sc.params],
  );
  const open = r.filter((x) => !["actioned", "confirmed", "waived"].includes(String(x.it_status ?? "")));
  const noAsset = r.filter((x) => !x.has_asset);
  return {
    actions: [{ id: "it_joiners_week", label: "Joiners in next 7 days without IT setup", count: open.length, severity: severityFor(open.length, 3, 10), href, hint: `${r.length} joining in 7 days, ${noAsset.length} with no asset assigned`, group: "Provisioning" }],
    kpis: [{ key: "joiners_week", label: "Joining in 7 days", value: r.length, unit: "count", tone: "violet", href, helper: `${open.length} still need IT setup`, formula: "Employees whose date of joining is today to today+7 (employee records are created at offer approval). Needs-setup = latest IT_EMAIL_DOMAIN_ASSET task not actioned/confirmed/waived." }],
    tables: [{ key: "joiners_next", title: "Joiners needing IT setup", href, columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "doj", label: "Joins" }, { key: "it", label: "IT task" }, { key: "asset", label: "Asset" }],
      rows: open.slice(0, 10).map((x) => ({ code: x.employee_code, name: x.full_name, doj: String(x.date_of_joining).slice(0, 10), it: x.it_status ?? "no task", asset: x.has_asset ? "assigned" : "none", href })) }],
  };
};

const assets: InsightSectionFn = async (ctx) => {
  const href = pickHref(await allowedPageCodes(ctx), ["/assets-manager"], drill("HEADCOUNT"));
  const sc = ctx.scope.level === "ORG_ALL" ? { sql: "1=1", params: [] as string[] } : ctx.scope.branchIds.length ? { sql: `branch_id IN (${ctx.scope.branchIds.map(() => "?").join(",")})`, params: ctx.scope.branchIds } : { sql: "1=0", params: [] as string[] };
  const [c, w] = await Promise.all([
    rows(`SELECT status, COUNT(*) AS n FROM asset_master WHERE active_status = 1 AND ${sc.sql} GROUP BY status`, sc.params),
    one(`SELECT SUM(warranty_expiry < ?) AS expired, SUM(warranty_expiry >= ? AND warranty_expiry <= DATE_ADD(?, INTERVAL 30 DAY)) AS d30,
                SUM(warranty_expiry > DATE_ADD(?, INTERVAL 30 DAY) AND warranty_expiry <= DATE_ADD(?, INTERVAL 90 DAY)) AS d90, SUM(warranty_expiry IS NULL) AS nodate
           FROM asset_master WHERE active_status = 1 AND ${sc.sql}`, [ctx.today, ctx.today, ctx.today, ctx.today, ctx.today, ...sc.params]),
  ]);
  const by: Record<string, number> = Object.fromEntries(c.map((x) => [String(x.status), Number(x.n)]));
  const total = Object.values(by).reduce((s, n) => s + n, 0);
  const thin = total < 20;
  const unavailable = total === 0 ? "asset register is empty" : null;
  const k = (key: string, label: string, v: number | null, tone: InsightKpi["tone"], hi = true): InsightKpi => ({ key, label, value: unavailable ? null : v, unit: "count", tone, higherIsBetter: hi, href, unavailable, helper: thin && !unavailable ? `register holds only ${total} asset(s): likely not populated` : undefined });
  return {
    kpis: [
      k("assets_total", "Assets registered", total, "blue"),
      k("assets_available", "Available", by.available ?? 0, "green"),
      k("assets_assigned", "Assigned", by.assigned ?? 0, "blue"),
      k("assets_repair", "In repair / maintenance", (by.repair ?? 0) + (by.maintenance ?? 0), "amber", false),
      k("assets_lost", "Lost", by.lost ?? 0, "red", false),
      k("warranty_30d", "Warranty expiring (30d)", num(w?.d30), "amber", false),
    ],
    series: [{ key: "asset_status", title: "Asset inventory by status", kind: "donut", href, unit: "count", unavailable, points: Object.entries(by).map(([label, value]) => ({ label, value })) }],
    signals: [
      ...(thin ? [{ tone: "watch", title: "Asset register looks unpopulated", detail: `Only ${total} asset(s) are recorded for a workforce of hundreds; inventory, warranty and AMC figures cannot be trusted until devices are loaded.`, value: total, href } as InsightSignal] : []),
      ...(num(w?.expired) ? [{ tone: "bad", title: `${num(w?.expired)} asset(s) out of warranty`, detail: "Warranty end date has passed.", value: num(w?.expired), href } as InsightSignal] : []),
    ],
  };
};

const tickets: InsightSectionFn = async (ctx) => {
  const sc = empScope(ctx, "e");
  const href = pickHref(await allowedPageCodes(ctx), ["/helpdesk"], drill("HEADCOUNT"));
  const base = `FROM helpdesk_ticket t JOIN employees e ON e.id = t.employee_id WHERE t.category = 'it'${sc.sql}`;
  const [s, byPrio] = await Promise.all([
    one(
      `SELECT COUNT(*) AS total, SUM(t.status NOT IN ${OPEN_TICKET}) AS open_n,
              SUM(t.status NOT IN ${OPEN_TICKET} AND t.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)) AS aged3,
              SUM(t.status NOT IN ${OPEN_TICKET} AND t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()) AS past_sla_open,
              SUM(t.status IN ('resolved','closed')) AS resolved_n,
              SUM(t.status IN ('resolved','closed') AND t.reopened_count = 0) AS fcr_n,
              SUM(t.status IN ('resolved','closed') AND t.sla_due_at IS NOT NULL AND t.sla_breached = 0) AS met_sla,
              SUM(t.status IN ('resolved','closed') AND t.sla_due_at IS NOT NULL) AS with_sla,
              AVG(CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END) AS avg_min,
              MIN(CASE WHEN t.status NOT IN ${OPEN_TICKET} THEN t.created_at END) AS oldest
         ${base}`, sc.params),
    rows(`SELECT t.priority AS label, COUNT(*) AS value ${base} AND t.status NOT IN ${OPEN_TICKET} GROUP BY t.priority`, sc.params),
  ]);
  const open = num(s?.open_n) ?? 0, total = num(s?.total) ?? 0;
  const aged = num(s?.aged3) ?? 0, pastSla = num(s?.past_sla_open) ?? 0;
  const oldestDays = s?.oldest ? Math.max(0, Math.floor((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${String(s.oldest).slice(0, 10)}T00:00:00Z`)) / 86_400_000)) : null;
  const sla = slaCompliance(num(s?.met_sla), num(s?.with_sla));
  const fcr = (num(s?.resolved_n) ?? 0) > 0 ? Math.round(((num(s?.fcr_n) ?? 0) / (num(s?.resolved_n) as number)) * 1000) / 10 : null;
  const avgH = s?.avg_min == null ? null : Math.round((Number(s.avg_min) / 60) * 10) / 10;
  return {
    actions: [
      { id: "it_tickets_open", label: "Open IT tickets", count: open, severity: pastSla ? "critical" : severityFor(open, 5, 15), oldestDays, overdue: pastSla, href, hint: `${aged} open more than 3 days; overdue = past SLA due`, group: "Helpdesk" },
    ],
    kpis: [
      { key: "open_tickets", label: "Open IT tickets", value: open, unit: "count", higherIsBetter: false, tone: toneFor(open, 3, 10, false), href, helper: `${total} IT ticket(s) all-time`, formula: "helpdesk_ticket category = it, status not resolved/closed/cancelled, raised by an employee in scope." },
      { key: "tickets_aged", label: "Open > 3 days", value: aged, unit: "count", higherIsBetter: false, tone: toneFor(aged, 0, 3, false), href },
      { key: "tickets_sla", label: "SLA met (resolved)", value: sla, unit: "percent", tone: toneFor(sla, 90, 75), href, unavailable: sla === null ? "no resolved ticket carries an SLA due time" : null, formula: "Resolved/closed IT tickets that have an SLA due time and were not breached / resolved tickets with an SLA. The previous tile divided by ALL tickets (open included), understating compliance." },
      { key: "tickets_fcr", label: "First-contact resolution", value: fcr, unit: "percent", tone: toneFor(fcr, 80, 60), href, unavailable: fcr === null ? "no resolved tickets" : null, formula: "Resolved/closed IT tickets never reopened (reopened_count = 0) / resolved tickets. Proxy: the helpdesk records no first-contact flag." },
      { key: "tickets_avg_res", label: "Avg resolution", value: avgH, unit: "hours", higherIsBetter: false, tone: toneFor(avgH, 8, 24, false), href, unavailable: avgH === null ? "no resolved tickets" : null },
    ],
    series: [{ key: "tickets_by_priority", title: "Open tickets by priority", kind: "ranked", href, unit: "count", points: byPrio.map((r) => ({ label: String(r.label), value: Number(r.value) })) }],
  };
};

const biometric: InsightSectionFn = async (ctx) => {
  const href = pickHref(await allowedPageCodes(ctx), ["/provisioning/it"], drill("HEADCOUNT"));
  const [d, e] = await Promise.all([
    one(`SELECT COUNT(*) AS n, SUM(is_active = 1) AS active FROM biometric_device_master`),
    one(`SELECT COUNT(*) AS n, MAX(last_sync_at) AS last_sync FROM employee_biometric_enrollment WHERE is_active = 1`),
  ]);
  const devices = num(d?.n) ?? 0;
  return {
    kpis: [
      { key: "biometric_devices", label: "Biometric devices", value: devices ? num(d?.active) : null, unit: "count", tone: "slate", href, unavailable: devices ? null : "no devices registered in the device master (device health cannot be monitored)", helper: devices ? `${devices} registered` : undefined },
      { key: "biometric_enrolled", label: "Active biometric enrolments", value: num(e?.n), unit: "count", tone: "blue", href, helper: e?.last_sync ? `last sync ${String(e.last_sync).slice(0, 10)}` : "never synced" },
    ],
    signals: devices ? [] : [{ tone: "watch", title: "No biometric devices on record", detail: "biometric_device_master is empty, so device uptime and failures are not visible here.", href }],
  };
};

const provider: InsightProvider = { sections: { queue, joiners, assets, tickets, biometric } };
export default provider;
export { nowIso };

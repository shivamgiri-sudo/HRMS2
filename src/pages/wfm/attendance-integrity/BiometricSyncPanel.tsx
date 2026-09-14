// src/pages/wfm/attendance-integrity/BiometricSyncPanel.tsx
//
// Read-only COSEC biometric sync health panel, extracted for the merged
// attendance-integrity console (Task 4). Replaces NativeCosecSyncMonitoring.tsx, which
// wrapped PeopleOSDataPage — a generic JSON dumper that rendered one KPI and the latest
// run as JSON.stringify in a black <pre>, plus a date picker whose from/to the endpoint
// ignored. None of the four endpoints below accept a date range, so this panel has no
// date filter — a manual Refresh is the only control, and there is nothing to write:
// all four calls are GET.
//
// Panel, not a page: no required props, matching ExceptionsPanel / MismatchesPanel /
// BillingRulesPanel. The console shell (Task 5) owns page chrome and tab selection.
//
// --- The role asymmetry this panel exists to handle -------------------------------
// Task 2 widened /sync-status, /sync-runs and /sync-errors to the full WFM_LIVE_TRACKER
// role union (super_admin, branch_head, branch_wfm, manager, process_manager, wfm, admin,
// hr, ceo) because those three are run/device health with no per-employee rows.
// /latest-punches DOES join to employees and return per-employee rows, so it keeps the
// narrower list (admin, hr, ceo, wfm, super_admin) — a branch-scoped role that clears the
// router-level gate for the first three still gets 403 on the fourth.
//
// So this panel loads two independent groups and gives each its own loading / empty /
// error / forbidden state:
//   - "core"    = sync-status + sync-runs + sync-errors (shared role gate, loaded together
//                 since a 403 on one router-level gate means 403 on all three)
//   - "punches" = latest-punches (narrower role gate, loaded and rendered independently)
// A 403 on `punches` must never blank the core KPIs/tables, and vice versa — that is
// exactly the branch-scoped-role case this merge exists to serve.
//
// Two KPI tiles (Punch-Log Freshness, Devices Seen) are derived from `punches` data, so
// they degrade individually to a "Not available for your role" note when that group is
// forbidden, while the other three KPI tiles (fed by `core`) keep working.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Fingerprint,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";

// --- Types, matching backend/src/modules/peopleos/peopleos.service.ts exactly ------

type SyncRunStatus = "running" | "success" | "warning" | "failed";

type SyncRun = {
  id: string;
  integration_key: string;
  run_type: string;
  status: SyncRunStatus;
  started_at: string | null;
  completed_at: string | null;
  records_read: number | null;
  records_written: number | null;
  records_failed: number | null;
  error_summary: string | null;
  metadata_json: unknown;
  created_by: string | null;
  created_at: string | null;
};

type SyncErrorRow = {
  id: string;
  started_at: string | null;
  completed_at: string | null;
  status: SyncRunStatus;
  error_summary: string | null;
  records_failed: number | null;
};

type DataConfidence = {
  confidence_score: number;
  missing_items: string[];
  risk_level: "low" | "medium" | "high" | "critical";
};

type SyncStatusResponse = {
  status: string;
  latest_run: SyncRun | null;
  data_confidence: DataConfidence;
};

// Per-day rollup — NOT individual punches. See getCosecLatestPunches in
// peopleos.service.ts: first punch in, last punch out, total punch count and raw
// minutes, one row per employee per day.
type PunchRollup = {
  employee_code: string | null;
  employee_name: string | null;
  cosec_user_id: string | null;
  punch_date: string | null;
  first_punch_in: string | null;
  last_punch_out: string | null;
  total_punches: number | null;
  raw_minutes: number | null;
  device_id: string | null;
  source_system: string | null;
};

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: { status: number | null; message: string } | null;
};

const INITIAL_STATE = <T,>(): LoadState<T> => ({ data: null, loading: true, error: null });

// --- Formatting helpers -------------------------------------------------------------

function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
}

function relativeAge(value: string | null | undefined): string {
  if (!value) return "no data";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "no data";
  const ms = Date.now() - d.getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function durationLabel(started: string | null, completed: string | null): string {
  if (!started || !completed) return "—";
  const s = new Date(started.replace(" ", "T")).getTime();
  const c = new Date(completed.replace(" ", "T")).getTime();
  if (Number.isNaN(s) || Number.isNaN(c) || c < s) return "—";
  const secs = Math.round((c - s) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m`;
}

function statusBadge(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s === "success") return <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Success</Badge>;
  if (s === "warning") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Warning</Badge>;
  if (s === "failed") return <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50">Failed</Badge>;
  if (s === "running") return <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">Running</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">{status || "—"}</Badge>;
}

function riskBadge(risk: DataConfidence["risk_level"]) {
  const colors: Record<DataConfidence["risk_level"], string> = {
    low: "bg-emerald-50 text-emerald-700",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-orange-100 text-orange-800",
    critical: "bg-rose-50 text-rose-700",
  };
  return <Badge className={colors[risk] ?? "bg-slate-100 text-slate-600"}>{risk} confidence</Badge>;
}

// --- Small building blocks -----------------------------------------------------------

/**
 * One KPI tile. When `forbidden` is set, the tile shows an amber "restricted" note
 * instead of a value — used by the two punches-derived tiles (Freshness, Devices) so a
 * branch-scoped role sees why those two specifically are blank, while the other three
 * (fed by the wider-role `core` group) keep showing real numbers alongside it.
 */
function KpiCard({
  label, value, sublabel, icon, tone, forbidden,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  icon: React.ReactNode;
  tone?: string;
  forbidden?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            {forbidden ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                Not available for your role
              </p>
            ) : (
              <>
                <p className={`mt-2 text-2xl font-black ${tone ?? "text-slate-950"}`}>{value}</p>
                {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
              </>
            )}
          </div>
          {!forbidden && icon}
        </div>
      </CardContent>
    </Card>
  );
}

function ForbiddenCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="flex items-start gap-3 p-5">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
        <div>
          <p className="font-bold text-amber-900">Your role can open this page but not view this data</p>
          <p className="mt-1 text-sm text-amber-800">{children}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-red-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {message}
      </CardContent>
    </Card>
  );
}

function TableLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
    </div>
  );
}

function TableEmpty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon}
      <p className="text-base font-bold text-slate-900">{title}</p>
      <p className="max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

// --- Panel ----------------------------------------------------------------------------

export default function BiometricSyncPanel() {
  const [core, setCore] = useState<LoadState<{ status: SyncStatusResponse; runs: SyncRun[]; errors: SyncErrorRow[] }>>(
    INITIAL_STATE,
  );
  const [punches, setPunches] = useState<LoadState<PunchRollup[]>>(INITIAL_STATE);

  const loadCore = useCallback(async () => {
    setCore((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [statusRes, runsRes, errorsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: SyncStatusResponse }>("/api/integrations/cosec/sync-status"),
        hrmsApi.get<{ success: boolean; data: SyncRun[] }>("/api/integrations/cosec/sync-runs"),
        hrmsApi.get<{ success: boolean; data: SyncErrorRow[] }>("/api/integrations/cosec/sync-errors"),
      ]);
      setCore({
        data: { status: statusRes.data, runs: runsRes.data ?? [], errors: errorsRes.data ?? [] },
        loading: false,
        error: null,
      });
    } catch (err) {
      setCore({
        data: null,
        loading: false,
        error: {
          status: getHrmsApiErrorStatus(err),
          message: err instanceof Error ? err.message : "Unable to load COSEC sync health",
        },
      });
    }
  }, []);

  const loadPunches = useCallback(async () => {
    setPunches((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PunchRollup[] }>(
        "/api/integrations/cosec/latest-punches",
      );
      setPunches({ data: res.data ?? [], loading: false, error: null });
    } catch (err) {
      setPunches({
        data: null,
        loading: false,
        error: {
          status: getHrmsApiErrorStatus(err),
          message: err instanceof Error ? err.message : "Unable to load biometric day rollups",
        },
      });
    }
  }, []);

  const refresh = useCallback(() => {
    void loadCore();
    void loadPunches();
  }, [loadCore, loadPunches]);

  useEffect(() => { refresh(); }, [refresh]);

  const coreForbidden = core.error?.status === 403;
  const punchesForbidden = punches.error?.status === 403;
  const anyLoading = core.loading || punches.loading;

  // Run-status breakdown over the loaded window (sync-runs returns the most recent 50).
  // A single "warning" status KPI is uninformative when 2,051 of 2,067 live runs carry
  // it — the breakdown is what makes the number mean something.
  const breakdown = useMemo(() => {
    const runs = core.data?.runs ?? [];
    const counts = { success: 0, warning: 0, failed: 0, running: 0 };
    for (const r of runs) {
      if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
    }
    return { ...counts, total: runs.length };
  }, [core.data]);

  // Device surfacing — the point of this task. The CEO/WFM dashboards link to this
  // surface labelled "Devices" and there was previously no device information on it.
  const deviceCount = useMemo(() => {
    const rows = punches.data ?? [];
    const ids = new Set(rows.map((r) => r.device_id).filter((id): id is string => !!id));
    return ids.size;
  }, [punches.data]);

  const latestPunchDate = punches.data?.[0]?.punch_date ?? null;
  const latestRun = core.data?.status.latest_run ?? null;
  const failedRunCount = core.data?.errors.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Integrations</p>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            COSEC biometric device sync health — run status, failures, and per-day punch
            rollups (first in / last out, not individual punches) by device and employee.
          </p>
        </div>
        <Button onClick={refresh} disabled={anyLoading}>
          {anyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* KPI row — always rendered in shape; individual tiles degrade to a forbidden
          note rather than the whole row disappearing. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Last Sync"
          value={core.loading ? <Skeleton className="h-7 w-24" /> : fmtDateTime(latestRun?.completed_at ?? latestRun?.started_at)}
          sublabel={core.loading ? undefined : relativeAge(latestRun?.completed_at ?? latestRun?.started_at)}
          icon={<Clock className="h-5 w-5 text-blue-500" />}
          forbidden={coreForbidden}
        />
        <KpiCard
          label="Run Status (last 50)"
          value={
            core.loading ? (
              <Skeleton className="h-7 w-32" />
            ) : (
              <span className="flex flex-wrap items-center gap-1.5 text-base">
                <Badge className="bg-emerald-50 text-emerald-700">{breakdown.success} ok</Badge>
                <Badge className="bg-amber-100 text-amber-800">{breakdown.warning} warn</Badge>
                <Badge className="bg-rose-50 text-rose-700">{breakdown.failed} failed</Badge>
              </span>
            )
          }
          icon={<Activity className="h-5 w-5 text-slate-400" />}
          forbidden={coreForbidden}
        />
        <KpiCard
          label="Failed Runs"
          value={core.loading ? <Skeleton className="h-7 w-12" /> : fmtNum(failedRunCount)}
          sublabel="status = failed, or records_failed > 0 (last 50)"
          tone={failedRunCount > 0 ? "text-rose-600" : "text-slate-950"}
          icon={<XCircle className="h-5 w-5 text-rose-500" />}
          forbidden={coreForbidden}
        />
        <KpiCard
          label="Punch-Log Freshness"
          value={punches.loading ? <Skeleton className="h-7 w-20" /> : relativeAge(latestPunchDate)}
          sublabel={punches.loading ? undefined : `latest rollup date: ${latestPunchDate ?? "—"}`}
          icon={<Fingerprint className="h-5 w-5 text-blue-500" />}
          forbidden={punchesForbidden}
        />
        <KpiCard
          label="Devices Seen"
          value={punches.loading ? <Skeleton className="h-7 w-10" /> : fmtNum(deviceCount)}
          sublabel="distinct device_id, last 100 rollups"
          icon={<MonitorSmartphone className="h-5 w-5 text-slate-400" />}
          forbidden={punchesForbidden}
        />
      </div>

      {/* Core group: sync-status / sync-runs / sync-errors — shared role gate */}
      {coreForbidden ? (
        <ForbiddenCard>
          COSEC run health (sync status, recent runs, failed runs) is restricted to Super
          Admin, Branch Head, Branch WFM, Manager, Process Manager, WFM, Admin, HR and CEO
          roles. Ask your administrator for access if you need it.
        </ForbiddenCard>
      ) : (
        <>
          {core.error && <ErrorCard message={core.error.message} />}

          {!core.loading && core.data && (
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-700">Overall status: {statusBadge(core.data.status.status)}</p>
              {riskBadge(core.data.status.data_confidence.risk_level)}
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Recent Sync Runs
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {core.data ? `(${core.data.runs.length} of last 50)` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {core.loading ? (
                <TableLoading />
              ) : !core.data || core.data.runs.length === 0 ? (
                <TableEmpty
                  icon={<Clock className="h-10 w-10 text-slate-300" />}
                  title="No sync runs recorded yet."
                  description="The COSEC sync worker has not logged a run against integration_sync_run yet."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Read</TableHead>
                        <TableHead className="text-right">Written</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {core.data.runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(run.started_at)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(run.completed_at)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-slate-600">
                            {durationLabel(run.started_at, run.completed_at)}
                          </TableCell>
                          <TableCell>{statusBadge(run.status)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(run.records_read)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(run.records_written)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={(run.records_failed ?? 0) > 0 ? "font-semibold text-rose-600" : ""}>
                              {fmtNum(run.records_failed)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Failed / Partially Failed Runs
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {core.data ? `(${core.data.errors.length} of last 50)` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {core.loading ? (
                <TableLoading />
              ) : !core.data || core.data.errors.length === 0 ? (
                <TableEmpty
                  icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" />}
                  title="No failed runs."
                  description="No sync run in the last 50 carries status = failed or a non-zero records_failed count."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Records Failed</TableHead>
                        <TableHead>Error Summary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {core.data.errors.map((err) => (
                        <TableRow key={err.id}>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(err.started_at)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(err.completed_at)}</TableCell>
                          <TableCell>{statusBadge(err.status)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-rose-600">
                            {fmtNum(err.records_failed)}
                          </TableCell>
                          <TableCell className="max-w-[360px]">
                            <p className="truncate text-sm text-slate-700" title={err.error_summary ?? ""}>
                              {err.error_summary || "—"}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Punches group: latest-punches — narrower role gate, independent of core above */}
      {punchesForbidden ? (
        <ForbiddenCard>
          Per-employee biometric day rollups are restricted to Admin, HR, CEO, WFM and
          Super Admin roles because this endpoint joins to individual employee records.
          Run health above is not affected by this restriction.
        </ForbiddenCard>
      ) : (
        <>
          {punches.error && <ErrorCard message={punches.error.message} />}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Per-Employee Day Rollups
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {punches.data ? `(${punches.data.length} of last 100)` : ""}
                </span>
              </CardTitle>
              <p className="text-xs text-slate-500">
                First punch in, last punch out and total punch count per employee per day —
                not individual punches.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {punches.loading ? (
                <TableLoading />
              ) : !punches.data || punches.data.length === 0 ? (
                <TableEmpty
                  icon={<Fingerprint className="h-10 w-10 text-slate-300" />}
                  title="No day rollups recorded yet."
                  description="No rows found in biometric_attendance_log for a mapped employee."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead>First In</TableHead>
                        <TableHead>Last Out</TableHead>
                        <TableHead className="text-right">Total Punches</TableHead>
                        <TableHead className="text-right">Raw Minutes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {punches.data.map((row, i) => (
                        <TableRow key={`${row.employee_code ?? row.cosec_user_id ?? "row"}-${row.punch_date ?? i}`}>
                          <TableCell className="whitespace-nowrap text-sm">{row.punch_date ?? "—"}</TableCell>
                          <TableCell>
                            <p className="text-sm font-medium text-slate-900">
                              {row.employee_name?.trim() || <span className="text-slate-400">Unmapped</span>}
                            </p>
                            <p className="text-xs text-slate-500">{row.employee_code || row.cosec_user_id || "—"}</p>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-slate-100 text-slate-700">{row.device_id || "—"}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(row.first_punch_in)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(row.last_punch_out)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(row.total_punches)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(row.raw_minutes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

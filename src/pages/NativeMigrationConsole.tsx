import { useState, useEffect, useCallback } from "react";
import {
  Database, CheckCircle2, RefreshCcw, AlertCircle, ArrowRight,
  Server, FileCheck, Users, ShieldAlert, Eye, Clock, XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useWorkforceAccess } from "@/hooks/useUserRole";

interface ModuleStatus {
  module: string;
  mysql_count: number;
  status: "empty" | "has_data";
}

interface LegacyStatus {
  employees_migrated?: number;
  employee_statutory_info?: number;
  employee_salary_snapshot?: number;
  employee_client_mapping?: number;
  employee_legacy_meta?: number;
  [key: string]: number | undefined;
}

interface PendingMigration {
  filename: string;
  pending: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    has_data: "bg-emerald-50 text-emerald-700 border-emerald-200",
    empty: "bg-gray-100 text-gray-500 border-gray-200",
    unknown: "bg-amber-50 text-amber-600 border-amber-200",
  };
  const labels: Record<string, string> = {
    has_data: "Has Data",
    empty: "Empty",
    unknown: "Unknown",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${map[status] ?? map["unknown"]}`}>
      {status === "has_data" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {labels[status] ?? status}
    </span>
  );
}

export default function NativeMigrationConsole() {
  const { roleKeys } = useWorkforceAccess();
  const isAdmin = roleKeys.some(r => ["admin", "super_admin"].includes(r));

  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [legacyStatus, setLegacyStatus] = useState<LegacyStatus>({});
  const [pendingMigrations, setPendingMigrations] = useState<PendingMigration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPending, setLoadingPending] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"offline" | "online" | "checking">("checking");

  const [syncingStatutory, setSyncingStatutory] = useState(false);
  const [syncingChecklists, setSyncingChecklists] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [employeeCodeFilter, setEmployeeCodeFilter] = useState("");

  const [confirmDialog, setConfirmDialog] = useState<null | "statutory" | "checklists">(null);
  const [errorDetail, setErrorDetail] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [showPending, setShowPending] = useState(false);

  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setBackendStatus("checking");
    try {
      const [statusRes, legacyRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ModuleStatus[] }>("/api/migration/status"),
        hrmsApi.get<{ success: boolean; data: LegacyStatus }>("/api/migration/legacy-status"),
      ]);
      if (statusRes.data && Array.isArray(statusRes.data)) {
        setModules(statusRes.data);
        setBackendStatus("online");
      } else {
        setBackendStatus("offline");
      }
      if (legacyRes.data) {
        setLegacyStatus(legacyRes.data);
      }
    } catch {
      setBackendStatus("offline");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadPendingMigrations = async () => {
    setLoadingPending(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PendingMigration[] }>("/api/migration/pending");
      if (res.data && Array.isArray(res.data)) {
        setPendingMigrations(res.data);
        setShowPending(true);
      }
    } catch (err: any) {
      toast({ title: "Error loading pending migrations", description: err.message, variant: "destructive" });
    }
    setLoadingPending(false);
  };

  const handleSyncStatutory = async () => {
    setConfirmDialog(null);
    setSyncingStatutory(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { scanned: number; matched: number; updated: number; skipped: number; errors: string[] } }>(
        "/api/migration/sync-statutory-from-db-bill",
        { dryRun, employeeCode: employeeCodeFilter.trim() || undefined }
      );
      if (res.success && res.data) {
        toast({
          title: dryRun ? "Dry Run Preview" : "Statutory Data Sync Complete",
          description: `Scanned: ${res.data.scanned}, Matched: ${res.data.matched}, Updated: ${res.data.updated}, Skipped: ${res.data.skipped}${res.data.errors.length > 0 ? `, Errors: ${res.data.errors.length}` : ""}`,
        });
        if (res.data.errors.length > 0) setErrorDetail(res.data.errors);
        if (!dryRun) fetchData();
      }
    } catch (err: any) {
      toast({ title: "Sync Error", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setSyncingStatutory(false);
    }
  };

  const handleCreateChecklists = async () => {
    setConfirmDialog(null);
    setSyncingChecklists(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { created: number; skipped: number } }>(
        "/api/migration/create-legacy-checklists", {}
      );
      if (res.success && res.data) {
        toast({ title: "Legacy Checklists Created", description: `Created: ${res.data.created}, Skipped: ${res.data.skipped}` });
        fetchData();
      }
    } catch (err: any) {
      toast({ title: "Checklist Error", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setSyncingChecklists(false);
    }
  };

  const totalMysql = modules.reduce((s, m) => s + (m.mysql_count ?? 0), 0);
  const populated = modules.filter(m => m.mysql_count > 0).length;
  const pendingCount = pendingMigrations.filter(p => p.pending).length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5">
              <Database className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Migration Console</h1>
              <p className="text-sm text-gray-500">MySQL module data status and sync operations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={loadPendingMigrations} disabled={loadingPending}>
                <Clock className={`h-4 w-4 mr-1.5 ${loadingPending ? "animate-spin" : ""}`} />
                Pending Migrations
              </Button>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Non-admin warning */}
        {!isAdmin && (
          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span className="text-sm">You have read-only access. Data sync operations require admin privileges.</span>
            </div>
          </div>
        )}

        {/* Legacy Migration KPI cards */}
        {Object.keys(legacyStatus).length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Legacy Migration Health</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { key: "employees_migrated", label: "Employees Migrated", icon: Users, color: "indigo" },
                { key: "employee_statutory_info", label: "Statutory Info", icon: FileCheck, color: "emerald" },
                { key: "employee_salary_snapshot", label: "Salary Snapshots", icon: ArrowRight, color: "blue" },
                { key: "employee_client_mapping", label: "Client Mappings", icon: Database, color: "violet" },
                { key: "employee_legacy_meta", label: "Legacy Meta", icon: Server, color: "gray" },
              ].map(({ key, label, icon: Icon, color }) => {
                const val = legacyStatus[key];
                return (
                  <div key={key} className="rounded-3xl border bg-white p-4 shadow-sm">
                    <div className={`rounded-xl p-2 mb-2 bg-${color}-50 inline-flex`}>
                      <Icon className={`h-4 w-4 text-${color}-600`} />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">
                      {val === -1 ? "N/A" : val?.toLocaleString() ?? "—"}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border bg-white p-5 shadow-sm flex items-center gap-4">
            <div className={`rounded-xl p-2.5 ${backendStatus === "online" ? "bg-emerald-50" : "bg-gray-100"}`}>
              <Server className={`h-5 w-5 ${backendStatus === "online" ? "text-emerald-600" : "text-gray-400"}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Backend (MySQL)</p>
              <p className="text-sm font-semibold text-gray-900">
                {backendStatus === "checking" ? "Checking..." : backendStatus === "online" ? "Online" : "Offline"}
              </p>
              <p className="text-xs text-gray-400">{backendStatus === "offline" ? "API unreachable" : "API reachable"}</p>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm flex items-center gap-4">
            <div className="rounded-xl bg-blue-50 p-2.5">
              <ArrowRight className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">MySQL Total</p>
              <p className="text-2xl font-bold text-gray-900">{loading ? "—" : totalMysql.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{populated} of {modules.length} modules populated</p>
            </div>
          </div>
        </div>

        {backendStatus === "offline" && !loading && (
          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">Backend is offline — MySQL row counts unavailable.</span>
            </div>
          </div>
        )}

        {/* Data Sync Operations */}
        {backendStatus === "online" && isAdmin && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Data Sync Operations</h2>

            {/* Dry Run + Employee Filter controls */}
            <div className="rounded-3xl border bg-blue-50 border-blue-100 p-4 flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-sm font-medium text-blue-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={e => setDryRun(e.target.checked)}
                  className="rounded border-blue-300"
                />
                Dry Run (preview only — no changes written)
              </label>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-blue-700">Employee Code (optional):</label>
                <input
                  type="text"
                  value={employeeCodeFilter}
                  onChange={e => setEmployeeCodeFilter(e.target.value)}
                  placeholder="e.g. MAS-001"
                  className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              {dryRun && (
                <span className="text-xs text-blue-600 bg-blue-100 px-2.5 py-1 rounded-full font-medium">
                  Safe preview mode — sync will show what would change without writing to DB
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Sync Statutory Data */}
              <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-blue-50 p-2.5 shrink-0">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900">Sync Statutory Data from db_bill</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Copy UAN, EPF, PAN, ESIC, and bank details from db_bill.masjclrentry for employees with missing data.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Only updates NULL/empty fields. Existing data is never overwritten.</p>
                  </div>
                </div>
                {errorDetail.length > 0 && (
                  <button
                    onClick={() => setShowErrors(true)}
                    className="flex items-center gap-1.5 text-xs text-amber-700 font-medium hover:underline"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    View {errorDetail.length} errors from last run
                  </button>
                )}
                <Button
                  onClick={() => dryRun ? handleSyncStatutory() : setConfirmDialog("statutory")}
                  disabled={syncingStatutory || loading}
                  className="w-full"
                  variant={dryRun ? "outline" : "default"}
                >
                  {syncingStatutory ? (
                    <><RefreshCcw className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
                  ) : (
                    <><ArrowRight className="h-4 w-4 mr-2" />{dryRun ? "Preview Sync" : "Sync Statutory Data"}</>
                  )}
                </Button>
              </div>

              {/* Create Legacy Checklists */}
              <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-emerald-50 p-2.5 shrink-0">
                    <FileCheck className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900">Create Legacy Joining Checklists</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Create placeholder verified checklist entries for employees with 0 checklist items.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Only affects employees with no existing checklist entries.</p>
                  </div>
                </div>
                <Button
                  onClick={() => setConfirmDialog("checklists")}
                  disabled={syncingChecklists || loading}
                  className="w-full"
                  variant="default"
                >
                  {syncingChecklists ? (
                    <><RefreshCcw className="h-4 w-4 mr-2 animate-spin" />Creating...</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 mr-2" />Create Checklists</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Module status table — data-driven from API */}
        <div className="rounded-3xl border bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]" aria-label="Module migration status">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Module</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">MySQL Rows</th>
                <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-gray-200" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-16 rounded bg-gray-200 ml-auto" /></td>
                      <td className="px-6 py-4 text-center"><div className="mx-auto h-6 w-20 rounded-full bg-gray-200" /></td>
                    </tr>
                  ))
                : modules.map(m => (
                    <tr key={m.module} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-800 capitalize">{m.module.replace(/_/g, " ")}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-gray-600">
                        {m.mysql_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <StatusBadge status={m.status} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {/* Pending Migrations section */}
        {showPending && (
          <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Pending SQL Migrations</h2>
                <p className="text-xs text-gray-500 mt-0.5">{pendingCount} unexecuted migration file{pendingCount !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={() => setShowPending(false)} className="text-gray-400 hover:text-gray-600 text-xs">Close</button>
            </div>
            <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {pendingMigrations
                .filter(p => p.pending)
                .map(p => (
                  <div key={p.filename} className="px-6 py-3 flex items-center gap-3">
                    <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-sm font-mono text-gray-700">{p.filename}</span>
                    <span className="ml-auto text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">Pending</span>
                  </div>
                ))}
              {pendingMigrations.filter(p => p.pending).length === 0 && (
                <div className="px-6 py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">All migrations have been executed</p>
                </div>
              )}
            </div>
            {/* Show recently executed migrations */}
            {pendingMigrations.filter(p => !p.pending).length > 0 && (
              <details className="border-t">
                <summary className="px-6 py-3 text-xs text-gray-500 cursor-pointer hover:bg-gray-50">
                  Show {pendingMigrations.filter(p => !p.pending).length} executed migrations
                </summary>
                <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {pendingMigrations.filter(p => !p.pending).slice(-20).map(p => (
                    <div key={p.filename} className="px-6 py-2 flex items-center gap-3">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="text-xs font-mono text-gray-500">{p.filename}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Error detail modal */}
        <Dialog open={showErrors} onOpenChange={setShowErrors}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Sync Errors ({errorDetail.length})
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {errorDetail.map((e, i) => (
                <div key={i} className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs font-mono text-red-700">
                  {e}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowErrors(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirmation dialog */}
        <Dialog open={confirmDialog !== null} onOpenChange={() => setConfirmDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-700">
                <ShieldAlert className="h-5 w-5" />
                Confirm {confirmDialog === "statutory" ? "Statutory Sync" : "Create Checklists"}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              {confirmDialog === "statutory" ? (
                <p className="text-sm text-gray-600">
                  This will scan all employees with missing statutory fields (UAN, EPF, PAN, ESIC, bank details) and update them from db_bill. This operation touches up to hundreds of employee records.
                  {employeeCodeFilter && ` Filter applied: employee code "${employeeCodeFilter}".`}
                  <strong className="block mt-2 text-gray-800">This cannot be undone. Proceed?</strong>
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  This will create placeholder checklist entries for all employees who currently have zero checklist items. Existing entries are not modified.
                  <strong className="block mt-2 text-gray-800">Proceed?</strong>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
              <Button
                variant="default"
                onClick={() => confirmDialog === "statutory" ? handleSyncStatutory() : handleCreateChecklists()}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Legend */}
        {!loading && (
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Status Legend</p>
            <div className="flex flex-wrap gap-3 items-center">
              <StatusBadge status="has_data" /><span className="text-xs text-gray-500">MySQL has data</span>
              <StatusBadge status="empty" /><span className="text-xs text-gray-500">No data in MySQL</span>
              <StatusBadge status="unknown" /><span className="text-xs text-gray-500">Status unavailable</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

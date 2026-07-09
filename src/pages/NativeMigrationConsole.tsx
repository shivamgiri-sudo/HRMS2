import { useState, useEffect, useCallback } from "react";
import { Database, CheckCircle2, RefreshCcw, AlertCircle, ArrowRight, Server, FileCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// MySQL migration endpoints only.
const mysqlMigrationOnly = true;

interface TableEntry {
  key: string;
  label: string;
  module: string;
}

interface RowCounts {
  mysql: number | null;
}

type CountMap = Record<string, RowCounts>;

const TRACKED_TABLES: TableEntry[] = [
  { key: "employees", label: "Employees", module: "HRMS" },
  { key: "departments", label: "Departments", module: "HRMS" },
  { key: "leave_requests", label: "Leave Requests", module: "Leave" },
  { key: "leave_types", label: "Leave Types", module: "Leave" },
  { key: "user_roles", label: "User Roles", module: "Auth" },
  { key: "attendance_records", label: "Attendance Records", module: "Attendance" },
  { key: "payroll_records", label: "Payroll Records", module: "Payroll" },
  { key: "assets", label: "Assets", module: "Assets" },
];

function migrationStatus(mysqlCount: number | null): string {
  if (mysqlCount === null) return "unknown";
  if (mysqlCount > 0) return "migrated";
  return "empty";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    migrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
    empty: "bg-gray-100 text-gray-500 border-gray-200",
    unknown: "bg-amber-50 text-amber-600 border-amber-200",
  };
  const labels: Record<string, string> = {
    migrated: "Migrated",
    empty: "Empty",
    unknown: "Unknown",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
        map[status] ?? map["unknown"]
      }`}
    >
      {status === "migrated" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {labels[status] ?? status}
    </span>
  );
}

export default function NativeMigrationConsole() {
  const [counts, setCounts] = useState<CountMap>({});
  const [loading, setLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<"offline" | "online" | "checking">("checking");
  const [syncingStatutory, setSyncingStatutory] = useState(false);
  const [syncingChecklists, setSyncingChecklists] = useState(false);
  const { toast } = useToast();

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    setBackendStatus("checking");

    const newCounts: CountMap = {};
    TRACKED_TABLES.forEach((t) => {
      newCounts[t.key] = { mysql: null };
    });

    // Try backend for MySQL counts
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { module: string; mysql_count: number }[] }>(
        "/api/migration/status"
      );
      if (res.data && Array.isArray(res.data)) {
        const mysqlMap: Record<string, number> = {};
        res.data.forEach((item) => {
          mysqlMap[item.module] = item.mysql_count;
        });
        TRACKED_TABLES.forEach((t) => {
          if (mysqlMap[t.key] !== undefined) {
            newCounts[t.key] = { mysql: mysqlMap[t.key] };
          }
        });
        setBackendStatus("online");
      } else {
        setBackendStatus("offline");
      }
    } catch {
      setBackendStatus("offline");
    }

    setCounts(newCounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleSyncStatutory = async () => {
    setSyncingStatutory(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { scanned: number; matched: number; updated: number; skipped: number; errors: string[] } }>(
        "/api/migration/sync-statutory-from-db-bill",
        { dryRun: false }
      );
      if (res.success && res.data) {
        toast({
          title: "Statutory Data Sync Complete",
          description: `Scanned: ${res.data.scanned}, Matched: ${res.data.matched}, Updated: ${res.data.updated}, Skipped: ${res.data.skipped}${res.data.errors.length > 0 ? `, Errors: ${res.data.errors.length}` : ""}`,
        });
      } else {
        toast({
          title: "Sync Failed",
          description: "Check console for details",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Sync Error",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingStatutory(false);
    }
  };

  const handleCreateChecklists = async () => {
    setSyncingChecklists(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { created: number; skipped: number; templateId: string } }>(
        "/api/migration/create-legacy-checklists",
        {}
      );
      if (res.success && res.data) {
        toast({
          title: "Legacy Checklists Created",
          description: `Created: ${res.data.created}, Skipped: ${res.data.skipped}`,
        });
      } else {
        toast({
          title: "Checklist Creation Failed",
          description: "Check console for details",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Checklist Error",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSyncingChecklists(false);
    }
  };

  const tablesWithMysqlData = TRACKED_TABLES.filter((t) => (counts[t.key]?.mysql ?? 0) > 0).length;
  const totalMysql = TRACKED_TABLES.reduce((s, t) => s + (counts[t.key]?.mysql ?? 0), 0);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5">
              <Database className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Migration Console</h1>
              <p className="text-sm text-gray-500">MySQL data status per module</p>
            </div>
          </div>
          <button
            onClick={fetchCounts}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* MySQL migration notice */}
        {mysqlMigrationOnly && (
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-blue-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">
                Using MySQL migration endpoints only.
              </span>
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
              <p className="text-xs text-gray-400">
                {backendStatus === "offline" ? "mas-hrms-backend not deployed" : "API reachable"}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm flex items-center gap-4">
            <div className="rounded-xl bg-blue-50 p-2.5">
              <ArrowRight className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">MySQL Total</p>
              <p className="text-2xl font-bold text-gray-900">{loading ? "—" : totalMysql.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{tablesWithMysqlData} of {TRACKED_TABLES.length} tables populated</p>
            </div>
          </div>
        </div>

        {/* Backend offline notice */}
        {backendStatus === "offline" && !loading && (
          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">
                Backend is offline — MySQL row counts unavailable. Deploy mas-hrms-backend and restart to see MySQL data.
              </span>
            </div>
          </div>
        )}

        {/* Data Sync Operations */}
        {backendStatus === "online" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Data Sync Operations</h2>
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
                      Copy UAN, EPF, PAN, ESIC, and bank details from db_bill.masjclrentry to mas_hrms.employees for employees with missing data.
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      Only updates NULL/empty fields. Existing data is never overwritten.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleSyncStatutory}
                  disabled={syncingStatutory || loading}
                  className="w-full"
                  variant="default"
                >
                  {syncingStatutory ? (
                    <>
                      <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Sync Statutory Data
                    </>
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
                      Create placeholder "verified" checklist entries for employees with 0 checklist items so they don't show "pending documents".
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      Only affects employees with no existing checklist entries.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleCreateChecklists}
                  disabled={syncingChecklists || loading}
                  className="w-full"
                  variant="default"
                >
                  {syncingChecklists ? (
                    <>
                      <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Create Checklists
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Module table */}
        <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Module
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Table
                </th>
                {backendStatus === "online" && (
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    MySQL Rows
                  </th>
                )}
                <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? TRACKED_TABLES.map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="h-4 w-20 rounded bg-gray-200" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-36 rounded bg-gray-200" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="mx-auto h-6 w-28 rounded-full bg-gray-200" />
                      </td>
                    </tr>
                  ))
                  : TRACKED_TABLES.map((t) => {
                    const mysql = counts[t.key]?.mysql ?? null;
                    const status = migrationStatus(mysql);
                    return (
                      <tr key={t.key} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {t.module}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-800">{t.label}</td>
                        {backendStatus === "online" && (
                          <td className="px-6 py-4 text-right tabular-nums text-gray-600">
                            {mysql !== null ? mysql.toLocaleString() : <span className="text-gray-300">—</span>}
                          </td>
                        )}
                        <td className="px-6 py-4 text-center">
                          <StatusBadge status={status} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        {!loading && (
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Status Legend</p>
            <div className="flex flex-wrap gap-3">
              <StatusBadge status="migrated" />
              <span className="text-xs text-gray-500 self-center">MySQL has data</span>
              <StatusBadge status="empty" />
              <span className="text-xs text-gray-500 self-center">No data in MySQL</span>
              <StatusBadge status="unknown" />
              <span className="text-xs text-gray-500 self-center">Status unavailable</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

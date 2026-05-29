import { useState, useEffect, useCallback } from "react";
import { Database, CheckCircle2, RefreshCcw, AlertCircle, ArrowRight, Server } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { hrmsApi } from "@/lib/hrmsApi";

const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlYm1pbnhvcWRqenpmaG5yc2dlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODUxMjg3MCwiZXhwIjoyMDk0MDg4ODcwfQ.NdLGsPpJ2vYoWLs6I-z4utVVGHU5kGDk02-qdotY6Pg";
const SUPABASE_URL = "https://bebminxoqdjzzfhnrsge.supabase.co";

interface TableEntry {
  key: string;
  label: string;
  module: string;
}

interface RowCounts {
  supabase: number | null;
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

async function countTable(table: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const range = res.headers.get("content-range");
  if (range) {
    const match = range.match(/\/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data.length;
  return 0;
}

function migrationStatus(sbCount: number | null, mysqlCount: number | null): string {
  if (sbCount === null) return "unknown";
  if (mysqlCount === null) return sbCount > 0 ? "seeded" : "empty";
  if (sbCount > 0 && mysqlCount === 0) return "ready";
  if (mysqlCount > 0) return "migrated";
  return "empty";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    migrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ready: "bg-blue-50 text-blue-700 border-blue-200",
    seeded: "bg-indigo-50 text-indigo-700 border-indigo-200",
    empty: "bg-gray-100 text-gray-500 border-gray-200",
    unknown: "bg-amber-50 text-amber-600 border-amber-200",
  };
  const labels: Record<string, string> = {
    migrated: "Migrated",
    ready: "Ready to migrate",
    seeded: "Has Supabase data",
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
  const [mysqlData, setMysqlData] = useState<Record<string, number> | null>(null);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    setBackendStatus("checking");

    // Fetch Supabase row counts in parallel
    const supabaseResults = await Promise.allSettled(
      TRACKED_TABLES.map((t) => countTable(t.key))
    );

    const newCounts: CountMap = {};
    TRACKED_TABLES.forEach((t, i) => {
      const result = supabaseResults[i];
      newCounts[t.key] = {
        supabase: result.status === "fulfilled" ? result.value : null,
        mysql: null,
      };
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
        setMysqlData(mysqlMap);
        TRACKED_TABLES.forEach((t) => {
          if (mysqlMap[t.key] !== undefined) {
            newCounts[t.key] = { ...newCounts[t.key], mysql: mysqlMap[t.key] };
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

  const totalSupabase = TRACKED_TABLES.reduce((s, t) => s + (counts[t.key]?.supabase ?? 0), 0);
  const tablesWithData = TRACKED_TABLES.filter((t) => (counts[t.key]?.supabase ?? 0) > 0).length;

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
              <p className="text-sm text-gray-500">Supabase vs MySQL data status per module</p>
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

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm flex items-center gap-4">
            <div className="rounded-xl bg-indigo-50 p-2.5">
              <Database className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Supabase Total</p>
              <p className="text-2xl font-bold text-gray-900">{loading ? "—" : totalSupabase.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{tablesWithData} of {TRACKED_TABLES.length} tables populated</p>
            </div>
          </div>

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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Migration State</p>
              <p className="text-sm font-semibold text-gray-900">
                {backendStatus === "online" ? "Side-by-side view active" : "Supabase-only view"}
              </p>
              <p className="text-xs text-gray-400">
                {backendStatus === "offline" ? "Deploy backend to see MySQL data" : "Comparing counts"}
              </p>
            </div>
          </div>
        </div>

        {/* Backend offline notice */}
        {backendStatus === "offline" && !loading && (
          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">
                Backend is offline — showing Supabase row counts only. Deploy mas-hrms-backend and restart to see MySQL comparison.
              </span>
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
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Supabase Rows
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
                      <td className="px-6 py-4 text-right">
                        <div className="ml-auto h-4 w-16 rounded bg-gray-200" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="mx-auto h-6 w-28 rounded-full bg-gray-200" />
                      </td>
                    </tr>
                  ))
                : TRACKED_TABLES.map((t) => {
                    const sb = counts[t.key]?.supabase ?? null;
                    const mysql = counts[t.key]?.mysql ?? null;
                    const status = migrationStatus(sb, mysql);
                    return (
                      <tr key={t.key} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {t.module}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-800">{t.label}</td>
                        <td className="px-6 py-4 text-right tabular-nums text-gray-600">
                          {sb !== null ? sb.toLocaleString() : <span className="text-gray-300">—</span>}
                        </td>
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
              <StatusBadge status="ready" />
              <span className="text-xs text-gray-500 self-center">Supabase has data, MySQL empty</span>
              <StatusBadge status="seeded" />
              <span className="text-xs text-gray-500 self-center">Supabase data present (no MySQL info)</span>
              <StatusBadge status="empty" />
              <span className="text-xs text-gray-500 self-center">No data anywhere</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

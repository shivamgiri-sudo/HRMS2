/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { NoticePeriodDrawer } from "@/components/exit/NoticePeriodDrawer";
import { hrmsApi } from "@/lib/hrmsApi";

// ─────────────────────────────────────────────────────────────────────────────
// Notice Period Tab
// ─────────────────────────────────────────────────────────────────────────────
type NoticeRow = {
  id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  department_name?: string;
  designation_name?: string;
  manager_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  exit_reason_category?: string;
  notice_period_days: number;
  notice_start_date?: string;
  notice_end_date?: string;
  last_working_day_proposed?: string;
  last_working_day_confirmed?: string;
  days_remaining?: number | null;
  days_served?: number;
  status: string;
  submitted_at?: string;
};

const fmtDate = (v?: string | null) =>
  v ? v.slice(0, 10).split("-").reverse().join("/") : "—";

export function NoticePeriodTab() {
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [drawerExitId, setDrawerExitId] = useState<string | null>(null);

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: NoticeRow[] }>(
        "/api/manpower-risk/notice-period",
      )
      .then((res) => setRows(res.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.employee_name ?? "").toLowerCase().includes(q) ||
        (r.employee_code ?? "").toLowerCase().includes(q) ||
        (r.branch_name ?? "").toLowerCase().includes(q) ||
        (r.process_name ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const urgentCount = rows.filter(
    (r) => (r.days_remaining ?? Infinity) <= 7,
  ).length;
  const soonCount = rows.filter((r) => {
    const d = r.days_remaining ?? Infinity;
    return d > 7 && d <= 14;
  }).length;

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 p-4">
          <p className="text-xs font-black uppercase text-cyan-700">
            In Notice
          </p>
          <p className="mt-2 text-2xl font-black text-cyan-800">
            {rows.length}
          </p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-4">
          <p className="text-xs font-black uppercase text-red-600">
            Ending ≤ 7 days
          </p>
          <p className="mt-2 text-2xl font-black text-red-700">{urgentCount}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
          <p className="text-xs font-black uppercase text-amber-600">
            Ending 8–14 days
          </p>
          <p className="mt-2 text-2xl font-black text-amber-700">{soonCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          placeholder="Search name, code, branch, process…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-cyan-400 transition-colors bg-white"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Employee",
                  "Branch / Process",
                  "Manager",
                  "Notice Period",
                  "Days Served",
                  "Days Remaining",
                  "LWD",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <Loader2 className="mx-auto h-7 w-7 animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-16 text-center text-slate-400 text-sm font-semibold"
                  >
                    {search
                      ? "No results match your search."
                      : "No employees currently in notice period."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const daysLeft = r.days_remaining ?? null;
                  const urgent = daysLeft !== null && daysLeft <= 7;
                  const soon =
                    daysLeft !== null && daysLeft > 7 && daysLeft <= 14;
                  const pct =
                    r.notice_period_days > 0 && r.days_served != null
                      ? Math.min(
                          100,
                          Math.round(
                            (r.days_served / r.notice_period_days) * 100,
                          ),
                        )
                      : null;
                  return (
                    <tr
                      key={r.id}
                      className="border-t hover:bg-slate-50/80 transition-colors cursor-pointer"
                      onClick={() => setDrawerExitId(r.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {r.employee_name ?? r.id}
                        </p>
                        <p className="font-mono text-xs text-slate-400">
                          {r.employee_code}
                        </p>
                        <p className="text-xs text-slate-400 capitalize mt-0.5">
                          {(r.exit_type ?? "").replace(/_/g, " ")}
                          {r.exit_reason_category
                            ? ` · ${r.exit_reason_category.replace(/_/g, " ")}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p>{r.branch_name ?? "—"}</p>
                        <p className="text-xs text-slate-400">
                          {r.process_name ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-sm">
                        {r.manager_name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-800">
                          {r.notice_period_days} days
                        </p>
                        {pct !== null && (
                          <div className="mt-1.5 h-1.5 w-24 rounded-full bg-slate-200">
                            <div
                              className={`h-1.5 rounded-full ${urgent ? "bg-red-500" : soon ? "bg-amber-400" : "bg-cyan-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-slate-700">
                          {r.days_served ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-black ${
                            urgent
                              ? "bg-red-100 text-red-700"
                              : soon
                                ? "bg-amber-100 text-amber-700"
                                : "bg-cyan-100 text-cyan-700"
                          }`}
                        >
                          {daysLeft !== null ? `${daysLeft} days` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {fmtDate(
                          r.last_working_day_confirmed ??
                            r.last_working_day_proposed,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerExitId(r.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 transition-colors cursor-pointer"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down drawer */}
      {drawerExitId && (
        <NoticePeriodDrawer
          exitId={drawerExitId}
          onClose={() => setDrawerExitId(null)}
        />
      )}
    </div>
  );
}

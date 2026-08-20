/**
 * Roster — see who is working what.
 *
 * One table: an employee per row, the week across, with the context needed to read it without
 * looking anything up (reporting manager, process, branch, cost centre). Filter by branch,
 * process or cost centre, or search a person.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { RefreshCw, Users } from "lucide-react";

interface ViewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reportingManager: string | null;
  processName: string | null;
  branchName: string | null;
  costCentre: string | null;
  days: Record<string, string>;
}

/** Monday of the current week, so the page opens on something useful. */
function weekStart(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const ALL = "__all__";

export default function RosterViewPage() {
  const [fromDate, setFromDate] = useState(weekStart());
  const [toDate, setToDate] = useState(addDays(weekStart(), 6));
  const [branchId, setBranchId] = useState(ALL);
  const [processId, setProcessId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState(0);

  const { data: branchData } = useQuery({
    queryKey: ["roster-view", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });
  const { data: processData } = useQuery({
    queryKey: ["roster-view", "processes"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; process_name: string }> }>("/api/processes?limit=300"),
  });

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["roster-view", "table", fromDate, toDate, branchId, processId, search, applied],
    queryFn: () => {
      const p = new URLSearchParams({ fromDate, toDate, limit: "200" });
      if (branchId !== ALL) p.set("branchId", branchId);
      if (processId !== ALL) p.set("processId", processId);
      if (search.trim()) p.set("search", search.trim());
      return hrmsApi.get<{ rows: ViewRow[]; dates: string[]; total: number }>(
        `/api/wfm/roster-imports/view/table?${p.toString()}`,
      );
    },
  });

  const rows = data?.rows ?? [];
  const dates = data?.dates ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Roster</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who is working what, and when. Filter by branch, process or person.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">FROM</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">TO</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-semibold text-slate-500">BRANCH</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {(branchData?.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[190px]">
            <label className="mb-1 block text-xs font-semibold text-slate-500">PROCESS</label>
            <Select value={processId} onValueChange={setProcessId}>
              <SelectTrigger><SelectValue placeholder="All processes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All processes</SelectItem>
                {(processData?.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[190px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-500">EMPLOYEE</label>
            <Input
              placeholder="Code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setApplied((n) => n + 1)}
            />
          </div>
          <Button onClick={() => setApplied((n) => n + 1)} disabled={isFetching}>
            {isFetching ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Show"}
          </Button>
        </div>

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {(error as Error).message}
          </div>
        )}

        {!isError && (
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm text-slate-600">
              <Users className="h-4 w-4 text-slate-400" />
              <span className="font-semibold">{data?.total ?? 0}</span> employees
              {rows.length < (data?.total ?? 0) && (
                <span className="text-slate-400">· showing first {rows.length}</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Reporting manager</th>
                    <th className="px-3 py-2 text-left">Process</th>
                    <th className="px-3 py-2 text-left">Branch</th>
                    <th className="px-3 py-2 text-left">Cost centre</th>
                    {dates.map((d) => (
                      <th key={d} className="whitespace-nowrap px-3 py-2 text-center">
                        {new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        <div className="font-normal normal-case text-slate-400">
                          {new Date(`${d}T00:00:00`).toLocaleDateString("en", { weekday: "short" })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.employeeId} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-mono text-xs">{r.employeeCode}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.employeeName}</td>
                      <td className="px-3 py-2 text-slate-600">{r.reportingManager ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{r.processName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{r.branchName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{r.costCentre ?? "—"}</td>
                      {dates.map((d) => {
                        const v = r.days[d] ?? "·";
                        const off = v === "WO" || v === "Leave" || v === "Holiday";
                        return (
                          <td
                            key={d}
                            className={`whitespace-nowrap px-3 py-2 text-center text-xs ${
                              off ? "bg-slate-100 text-slate-400" : "text-slate-700"
                            }`}
                          >
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {rows.length === 0 && !isFetching && (
                    <tr>
                      <td colSpan={6 + dates.length} className="px-4 py-10 text-center text-slate-400">
                        No roster found for these dates and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

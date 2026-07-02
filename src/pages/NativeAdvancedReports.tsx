import { useEffect, useState } from "react";
import {
  AlertTriangle, BarChart3, Calendar, Download,
  Loader, RefreshCcw, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  branch_id: string | null;
  designation_id: string | null;
  joining_date: string | null;
  employment_status: string;
}

interface WfmSession {
  id: string;
  employee_id: string;
  employee_name?: string;
  login_time: string;
  logout_time: string | null;
  date: string;
}

interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name?: string;
  leave_type_id: string;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  department_id?: string | null;
}

interface PayrollRun {
  id: string;
  run_code: string;
  period_label: string;
  month: number;
  year: number;
  status: string;
}

interface PayrollLine {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  gross_pay: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  net_pay: number;
  total_deductions: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

function StatCard({ title, value, sub, icon, tone }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string;
}) {
  return (
    <div className="glass-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-3xl border bg-white p-4 shadow-sm">
      {children}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[160px]">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLS = "rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors bg-slate-50";

// ─── Tab: Headcount Reports ────────────────────────────────────────────────────

function HeadcountReportsTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (branchFilter) params.set("branch_id", branchFilter);
      if (deptFilter)   params.set("department_id", deptFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search)        params.set("search", search);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: Employee[]; total?: number }>(
        `/api/employees${query}`
      );
      setEmployees(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [branchFilter, deptFilter, statusFilter]);

  // Derived breakdowns
  const byBranch = employees.reduce<Record<string, number>>((acc, e) => {
    const k = e.branch_id ?? "Unassigned";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const byDept = employees.reduce<Record<string, number>>((acc, e) => {
    const k = e.department_id ?? "Unassigned";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.full_name, e.employee_code, e.branch_id, e.department_id].join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <FilterRow>
        <FilterField label="Branch ID">
          <input value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} placeholder="Filter branch…" className={INPUT_CLS} />
        </FilterField>
        <FilterField label="Department ID">
          <input value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} placeholder="Filter dept…" className={INPUT_CLS} />
        </FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={INPUT_CLS}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </FilterField>
        <FilterField label="Search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code…" className={INPUT_CLS} />
        </FilterField>
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 self-end"
        >
          <RefreshCcw className="h-4 w-4" />
          Load
        </button>
      </FilterRow>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Total Employees" value={employees.length} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Branches" value={Object.keys(byBranch).length} icon={<BarChart3 className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
        <StatCard title="Departments" value={Object.keys(byDept).length} icon={<BarChart3 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <h3 className="font-black text-slate-950">By Branch</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left font-semibold">Branch ID</th>
                <th className="p-3 text-right font-semibold">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byBranch).map(([k, v]) => (
                <tr key={k} className="border-t hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono text-xs text-slate-600">{k}</td>
                  <td className="p-3 text-right font-bold text-slate-950">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <h3 className="font-black text-slate-950">By Department</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left font-semibold">Department ID</th>
                <th className="p-3 text-right font-semibold">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byDept).map(([k, v]) => (
                <tr key={k} className="border-t hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono text-xs text-slate-600">{k}</td>
                  <td className="p-3 text-right font-bold text-slate-950">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5 flex items-center justify-between">
          <div>
            <h2 className="font-black text-slate-950">Employee List</h2>
            <p className="text-sm text-slate-500">{filtered.length} records</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No employees match the filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Code", "Name", "Joining Date", "Department", "Branch", "Designation", "Status"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-xs text-slate-500">{e.employee_code}</td>
                    <td className="p-4 font-bold text-slate-950">{e.full_name}</td>
                    <td className="p-4 font-mono text-slate-600">{e.joining_date?.slice(0, 10) ?? "—"}</td>
                    <td className="p-4 text-slate-600">{e.department_id ?? "—"}</td>
                    <td className="p-4 text-slate-600">{e.branch_id ?? "—"}</td>
                    <td className="p-4 text-slate-600">{e.designation_id ?? "—"}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        e.employment_status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {e.employment_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Attendance Reports ───────────────────────────────────────────────────

function AttendanceReportsTab() {
  const [sessions, setSessions] = useState<WfmSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const currentYear  = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const [month, setMonth] = useState(`${currentYear}-${currentMonth}`);
  const [empFilter, setEmpFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [year, mon] = month.split("-");
      const fromDate = `${year}-${mon}-01`;
      const lastDay  = new Date(parseInt(year, 10), parseInt(mon, 10), 0).getDate();
      const toDate   = `${year}-${mon}-${String(lastDay).padStart(2, "0")}`;
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (empFilter) params.set("employee_id", empFilter);
      const res = await hrmsApi.get<{ success: boolean; data: WfmSession[] }>(
        `/api/wfm/sessions?${params.toString()}`
      );
      setSessions(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month]);

  // Per-employee aggregates
  const byEmployee = sessions.reduce<Record<string, { sessions: number; name: string }>>((acc, s) => {
    const k = s.employee_id;
    if (!acc[k]) acc[k] = { sessions: 0, name: s.employee_name ?? k.slice(0, 8) };
    acc[k].sessions += 1;
    return acc;
  }, {});

  const uniqueEmployees = Object.keys(byEmployee).length;

  // Simple late arrival heuristic: login after 09:30
  const lateArrivals = sessions.filter((s) => {
    const t = new Date(s.login_time);
    return t.getHours() > 9 || (t.getHours() === 9 && t.getMinutes() > 30);
  }).length;

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <FilterRow>
        <FilterField label="Month">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLS} />
        </FilterField>
        <FilterField label="Employee ID">
          <input value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} placeholder="Filter employee…" className={INPUT_CLS} />
        </FilterField>
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 self-end"
        >
          <RefreshCcw className="h-4 w-4" />
          Load
        </button>
      </FilterRow>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Total Sessions" value={sessions.length} icon={<Calendar className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Unique Employees" value={uniqueEmployees} icon={<Users className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
        <StatCard title="Late Arrivals" value={lateArrivals} sub="After 09:30" icon={<AlertTriangle className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
        <StatCard title="Avg Sessions/Emp" value={uniqueEmployees ? Math.round(sessions.length / uniqueEmployees) : 0} icon={<BarChart3 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Per-Employee Attendance</h2>
          <p className="text-sm text-slate-500">{uniqueEmployees} employees</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : Object.keys(byEmployee).length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Calendar className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No sessions found for this period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Employee</th>
                  <th className="p-4 font-semibold text-right">Days Present</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byEmployee).map(([empId, data]) => (
                  <tr key={empId} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{data.name}</div>
                      <div className="font-mono text-xs text-slate-400">{empId.slice(0, 12)}…</div>
                    </td>
                    <td className="p-4 text-right font-bold text-slate-950">{data.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Leave Reports ────────────────────────────────────────────────────────

function LeaveReportsTab() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [empFilter, setEmpFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (fromDate)   params.set("from_date", fromDate);
      if (toDate)     params.set("to_date", toDate);
      if (empFilter)  params.set("employee_id", empFilter);
      if (typeFilter) params.set("leave_type_id", typeFilter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: LeaveRequest[] }>(
        `/api/leave/requests${query}`
      );
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const approved = requests.filter((r) => r.status === "approved");
  const totalDays = approved.reduce((sum, r) => sum + (r.days ?? 0), 0);

  const byType = approved.reduce<Record<string, number>>((acc, r) => {
    const k = r.leave_type_name ?? r.leave_type_id;
    acc[k] = (acc[k] ?? 0) + (r.days ?? 0);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <FilterRow>
        <FilterField label="From Date">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={INPUT_CLS} />
        </FilterField>
        <FilterField label="To Date">
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={INPUT_CLS} />
        </FilterField>
        <FilterField label="Employee ID">
          <input value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} placeholder="Filter employee…" className={INPUT_CLS} />
        </FilterField>
        <FilterField label="Leave Type ID">
          <input value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="Filter type…" className={INPUT_CLS} />
        </FilterField>
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 self-end"
        >
          <RefreshCcw className="h-4 w-4" />
          Load
        </button>
      </FilterRow>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Total Requests" value={requests.length} icon={<Calendar className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Approved" value={approved.length} icon={<Users className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
        <StatCard title="Days Consumed" value={totalDays} icon={<BarChart3 className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <h3 className="font-black text-slate-950">Days by Leave Type (Approved)</h3>
          </div>
          {Object.keys(byType).length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No approved leaves</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3 text-left font-semibold">Type</th>
                  <th className="p-3 text-right font-semibold">Days</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byType).map(([k, v]) => (
                  <tr key={k} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 text-slate-700">{k}</td>
                    <td className="p-3 text-right font-bold text-slate-950">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Leave Requests</h2>
            <p className="text-sm text-slate-500">{requests.length} records</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : requests.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No leave requests found.</div>
          ) : (
            <div className="overflow-y-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 sticky top-0">
                  <tr>
                    <th className="p-3 font-semibold">Employee</th>
                    <th className="p-3 font-semibold">Type</th>
                    <th className="p-3 font-semibold">Days</th>
                    <th className="p-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-mono text-xs text-slate-600">
                        {r.employee_name ?? r.employee_id.slice(0, 8)}
                      </td>
                      <td className="p-3 text-slate-700">{r.leave_type_name ?? r.leave_type_id}</td>
                      <td className="p-3 font-bold text-slate-950">{r.days ?? "—"}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          r.status === "approved" ? "bg-emerald-50 text-emerald-700" :
                          r.status === "rejected" ? "bg-red-50 text-red-700" :
                          "bg-amber-50 text-amber-700"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Payroll Reports ──────────────────────────────────────────────────────

function PayrollReportsTab() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [linesLoading, setLinesLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const loadRuns = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PayrollRun[] }>("/api/payroll/runs");
      const data = Array.isArray(res.data) ? res.data : [];
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load payroll runs");
    } finally {
      setLoading(false);
    }
  };

  const loadLines = async (runId: string) => {
    if (!runId) return;
    setLinesLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PayrollLine[] }>(
        `/api/payroll/runs/${runId}/lines`
      );
      setLines(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load payroll lines");
    } finally {
      setLinesLoading(false);
    }
  };

  useEffect(() => { void loadRuns(); }, []);
  useEffect(() => { if (selectedRunId) void loadLines(selectedRunId); }, [selectedRunId]);

  const totalGross      = lines.reduce((s, l) => s + (l.gross_pay ?? 0), 0);
  const totalDeductions = lines.reduce((s, l) => s + (l.total_deductions ?? 0), 0);
  const totalNet        = lines.reduce((s, l) => s + (l.net_pay ?? 0), 0);

  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      <FilterRow>
        <FilterField label="Payroll Run">
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <Loader className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          ) : (
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className={`${INPUT_CLS} min-w-[220px]`}
            >
              <option value="">Select run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.period_label ?? `${r.year}-${String(r.month).padStart(2, "0")}`} — {r.run_code}
                </option>
              ))}
            </select>
          )}
        </FilterField>
        <button
          onClick={() => { void loadRuns(); }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 self-end"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </FilterRow>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Total Gross" value={fmtCurrency(totalGross)} icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        <StatCard title="Total Deductions" value={fmtCurrency(totalDeductions)} icon={<BarChart3 className="h-5 w-5" />} tone="bg-red-50 text-red-700" />
        <StatCard title="Total Net Pay" value={fmtCurrency(totalNet)} icon={<BarChart3 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
        <StatCard title="Employees" value={lines.length} icon={<Users className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" />
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5 flex items-center justify-between">
          <div>
            <h2 className="font-black text-slate-950">Payslip Summary</h2>
            <p className="text-sm text-slate-500">{lines.length} employees</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-xs text-slate-500">
            <Download className="h-3.5 w-3.5" />
            Download full payroll export from payroll module
          </div>
        </div>
        {linesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : lines.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">Select a payroll run to view payslip summary.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Employee", "Gross Pay", "PF", "ESIC", "Prof Tax", "Total Deductions", "Net Pay"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-950">{l.employee_name ?? "—"}</div>
                      <div className="font-mono text-xs text-slate-400">{l.employee_code ?? l.employee_id.slice(0, 8)}</div>
                    </td>
                    <td className="p-4 font-semibold text-slate-950">{fmtCurrency(l.gross_pay ?? 0)}</td>
                    <td className="p-4 text-slate-600">{fmtCurrency(l.pf_employee ?? 0)}</td>
                    <td className="p-4 text-slate-600">{fmtCurrency(l.esic_employee ?? 0)}</td>
                    <td className="p-4 text-slate-600">{fmtCurrency(l.professional_tax ?? 0)}</td>
                    <td className="p-4 text-red-600 font-semibold">{fmtCurrency(l.total_deductions ?? 0)}</td>
                    <td className="p-4 font-black text-emerald-700">{fmtCurrency(l.net_pay ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 font-bold text-sm">
                <tr>
                  <td className="p-4 text-slate-700">Totals</td>
                  <td className="p-4 text-slate-950">{fmtCurrency(totalGross)}</td>
                  <td className="p-4 text-slate-600">—</td>
                  <td className="p-4 text-slate-600">—</td>
                  <td className="p-4 text-slate-600">—</td>
                  <td className="p-4 text-red-600">{fmtCurrency(totalDeductions)}</td>
                  <td className="p-4 text-emerald-700">{fmtCurrency(totalNet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "headcount" | "attendance" | "leave" | "payroll";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "headcount",  label: "Headcount Reports" },
  { key: "attendance", label: "Attendance Reports" },
  { key: "leave",      label: "Leave Reports" },
  { key: "payroll",    label: "Payroll Reports" },
];

export default function NativeAdvancedReports() {
  const [activeTab, setActiveTab] = useState<Tab>("headcount");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Analytics</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Advanced Reports</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Comprehensive reporting across headcount, attendance, leave, and payroll data.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              label={t.label}
              active={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
            />
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "headcount"  && <HeadcountReportsTab />}
        {activeTab === "attendance" && <AttendanceReportsTab />}
        {activeTab === "leave"      && <LeaveReportsTab />}
        {activeTab === "payroll"    && <PayrollReportsTab />}
      </div>
    </DashboardLayout>
  );
}

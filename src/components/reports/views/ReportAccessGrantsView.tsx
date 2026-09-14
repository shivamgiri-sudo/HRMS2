import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Trash2, Users, ShieldCheck, AlertCircle,
  RefreshCw, Download, Eye,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogEntry { code: string; name: string; category: string }
interface UserGrant {
  id: number; report_code: string; report_name: string;
  can_view: number; can_export: number;
  granted_at: string; expires_at: string | null; granted_by_name: string;
}
interface RoleGrant {
  id: number; role_key: string; report_code: string; report_name: string;
  can_view: number; can_export: number;
  granted_at: string; granted_by_name: string;
}
interface EmployeeRow { id: number; user_id: number; first_name: string; last_name: string; employee_id: string; designation: string }

const ROLE_OPTIONS = [
  { key: "employee",          label: "Employee" },
  { key: "team_leader",       label: "Team Leader" },
  { key: "assistant_manager", label: "Assistant Manager" },
  { key: "process_manager",   label: "Process Manager" },
  { key: "branch_head",       label: "Branch Head" },
  { key: "hr",                label: "HR" },
  { key: "recruiter",         label: "Recruiter" },
  { key: "wfm",               label: "WFM" },
  { key: "qa",                label: "Quality Analyst" },
  { key: "trainer",           label: "Trainer" },
  { key: "finance",           label: "Finance" },
  { key: "payroll",           label: "Payroll" },
  { key: "admin",             label: "Admin" },
  { key: "ceo",               label: "CEO" },
  { key: "client_user",       label: "Client User" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function Badge({ label, variant }: { label: string; variant: "green" | "slate" | "amber" }) {
  const cls = {
    green: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    slate: "bg-slate-100 text-slate-500 border border-slate-200",
    amber: "bg-amber-100 text-amber-700 border border-amber-200",
  }[variant];
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

// ── Employee search ───────────────────────────────────────────────────────────

function EmployeeSearchBox({ onSelect }: { onSelect: (emp: EmployeeRow) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery<{ data: EmployeeRow[] }>({
    queryKey: ["emp-search", q],
    queryFn: () => hrmsApi.get(`/api/employees?search=${encodeURIComponent(q)}&limit=10`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
  const results = data?.data ?? [];

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          className="flex-1 text-sm outline-none placeholder:text-slate-400"
          placeholder="Search by name or employee ID…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map(emp => (
            <button
              key={emp.id}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => { onSelect(emp); setQ(""); }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                {emp.first_name[0]}{emp.last_name[0]}
              </div>
              <div>
                <div className="font-medium text-slate-800">{emp.first_name} {emp.last_name}</div>
                <div className="text-xs text-slate-500">{emp.employee_id} · {emp.designation}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grant picker modal ────────────────────────────────────────────────────────

function GrantPickerModal({
  mode, target, targetLabel, onClose,
}: { mode: "user" | "role"; target: string | number; targetLabel: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [canExport, setCanExport] = useState(false);

  const { data: catalogData } = useQuery<{ data: CatalogEntry[] }>({
    queryKey: ["report-grant-catalog"],
    queryFn: () => hrmsApi.get("/api/reports/access-grants/catalog"),
    staleTime: 60_000,
  });
  const catalog = catalogData?.data ?? [];

  const filtered = catalog.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.category.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase())
  );

  const addMutation = useMutation({
    mutationFn: (code: string) => mode === "user"
      ? hrmsApi.post("/api/reports/access-grants/user", { userId: target, reportCode: code, canExport })
      : hrmsApi.post("/api/reports/access-grants/role", { roleKey: target, reportCode: code, canExport }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-grants"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Add Report Access</p>
            <p className="text-sm font-semibold text-slate-800">{targetLabel}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">✕</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Search reports…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={canExport} onChange={e => setCanExport(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            <Download className="h-3.5 w-3.5 text-slate-400" />
            Allow XLSX download (export)
          </label>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-50 rounded-lg border border-slate-100">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">No reports found</p>
            )}
            {filtered.map(r => (
              <div key={r.code} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.category} · {r.code}</p>
                </div>
                <button
                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  onClick={() => addMutation.mutate(r.code)}
                  disabled={addMutation.isPending}
                >
                  <Plus className="h-3 w-3" /> Grant
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Per-employee panel ────────────────────────────────────────────────────────

function EmployeeGrantsPanel() {
  const qc = useQueryClient();
  const [selectedEmp, setSelectedEmp] = useState<EmployeeRow | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const { data, isLoading, isError } = useQuery<{ data: UserGrant[] }>({
    queryKey: ["report-grants", "user", selectedEmp?.user_id],
    queryFn: () => hrmsApi.get(`/api/reports/access-grants/user?userId=${selectedEmp!.user_id}`),
    enabled: !!selectedEmp?.user_id,
  });
  const grants = data?.data ?? [];

  const revoke = useMutation({
    mutationFn: (id: number) => hrmsApi.delete(`/api/reports/access-grants/user/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-grants"] }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Select Employee</p>
        <EmployeeSearchBox onSelect={setSelectedEmp} />
        {selectedEmp && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-200 text-xs font-bold text-indigo-700">
                {selectedEmp.first_name[0]}{selectedEmp.last_name[0]}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{selectedEmp.first_name} {selectedEmp.last_name}</p>
                <p className="text-xs text-slate-500">{selectedEmp.employee_id}</p>
              </div>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              onClick={() => setShowPicker(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add Report
            </button>
          </div>
        )}
      </div>

      {selectedEmp && (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Assigned Reports</p>
          </div>
          {isLoading && <div className="py-8 text-center text-sm text-slate-400">Loading…</div>}
          {isError && <div className="py-8 text-center text-sm text-red-500">Failed to load grants</div>}
          {!isLoading && grants.length === 0 && (
            <div className="py-10 text-center">
              <AlertCircle className="mx-auto mb-2 h-6 w-6 text-slate-300" />
              <p className="text-sm text-slate-400">No individual report grants yet</p>
              <p className="text-xs text-slate-300 mt-1">Role-based grants are inherited automatically</p>
            </div>
          )}
          {grants.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left">Report</th>
                  <th className="px-4 py-2 text-center">View</th>
                  <th className="px-4 py-2 text-center">Export</th>
                  <th className="px-4 py-2 text-left">Granted</th>
                  <th className="px-4 py-2 text-left">Expires</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {grants.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{g.report_name}</p>
                      <p className="text-xs text-slate-400">{g.report_code}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {g.can_view ? <Eye className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {g.can_export ? <Download className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(g.granted_at)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {g.expires_at
                        ? <Badge label={fmtDate(g.expires_at)} variant={new Date(g.expires_at) < new Date() ? "amber" : "green"} />
                        : <Badge label="Never" variant="slate" />}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => revoke.mutate(g.id)}
                        disabled={revoke.isPending}
                        className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                        title="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showPicker && selectedEmp && (
        <GrantPickerModal
          mode="user"
          target={selectedEmp.user_id}
          targetLabel={`${selectedEmp.first_name} ${selectedEmp.last_name} (${selectedEmp.employee_id})`}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ── Per-role panel ────────────────────────────────────────────────────────────

function RoleGrantsPanel() {
  const qc = useQueryClient();
  const [selectedRole, setSelectedRole] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const { data, isLoading } = useQuery<{ data: RoleGrant[] }>({
    queryKey: ["report-grants", "role", selectedRole],
    queryFn: () => hrmsApi.get(`/api/reports/access-grants/role?roleKey=${selectedRole}`),
    enabled: !!selectedRole,
  });
  const grants = data?.data ?? [];

  const revoke = useMutation({
    mutationFn: (id: number) => hrmsApi.delete(`/api/reports/access-grants/role/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-grants"] }),
  });

  const roleLabel = ROLE_OPTIONS.find(r => r.key === selectedRole)?.label ?? selectedRole;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Select Role</p>
        <div className="flex items-center gap-3">
          <select
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
          >
            <option value="">— Pick a role —</option>
            {ROLE_OPTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {selectedRole && (
            <button
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              onClick={() => setShowPicker(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add Report
            </button>
          )}
        </div>
      </div>

      {selectedRole && (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Reports assigned to <span className="text-indigo-600">{roleLabel}</span>
            </p>
            <Badge label={`${grants.length} grants`} variant="slate" />
          </div>
          {isLoading && <div className="py-8 text-center text-sm text-slate-400">Loading…</div>}
          {!isLoading && grants.length === 0 && (
            <div className="py-10 text-center">
              <AlertCircle className="mx-auto mb-2 h-6 w-6 text-slate-300" />
              <p className="text-sm text-slate-400">No extra reports assigned to this role</p>
              <p className="text-xs text-slate-300 mt-1">Role's catalog access (viewRoles) is separate from these grants</p>
            </div>
          )}
          {grants.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left">Report</th>
                  <th className="px-4 py-2 text-center">View</th>
                  <th className="px-4 py-2 text-center">Export</th>
                  <th className="px-4 py-2 text-left">Granted</th>
                  <th className="px-4 py-2 text-left">Granted By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {grants.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{g.report_name}</p>
                      <p className="text-xs text-slate-400">{g.report_code}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {g.can_view ? <Eye className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {g.can_export ? <Download className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(g.granted_at)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{g.granted_by_name || "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => revoke.mutate(g.id)}
                        disabled={revoke.isPending}
                        className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                        title="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showPicker && selectedRole && (
        <GrantPickerModal
          mode="role"
          target={selectedRole}
          targetLabel={`Role: ${roleLabel}`}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function ReportAccessGrantsView() {
  const [tab, setTab] = useState<"role" | "employee">("role");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">Report Access Grants</h2>
          <p className="text-xs text-slate-500">Assign specific reports to roles or individual employees, beyond their default role access</p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {([
          { key: "role", label: "By Role", Icon: ShieldCheck },
          { key: "employee", label: "By Employee", Icon: Users },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              tab === t.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "role" ? <RoleGrantsPanel /> : <EmployeeGrantsPanel />}
    </div>
  );
}
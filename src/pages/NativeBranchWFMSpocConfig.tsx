import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Check, X, Loader2, ShieldCheck, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

type Branch = { id: string; branch_name: string };
type Employee = { id: string; first_name: string; last_name?: string; employee_code?: string };
type SpocConfig = {
  id: number;
  branch_id: string;
  branch_name: string;
  primary_spoc_user_id: string;
  primary_spoc_name: string;
  backup_spoc_user_id: string | null;
  backup_spoc_name: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
};

function unwrap<T>(res: any): T[] {
  return (res?.data ?? res ?? []) as T[];
}

function empLabel(e: Employee) {
  return `${e.first_name} ${e.last_name ?? ""}`.trim() + (e.employee_code ? ` (${e.employee_code})` : "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  branch_id: "",
  primary_spoc_user_id: "",
  backup_spoc_user_id: "",
  effective_from: today(),
  effective_to: "",
};

export default function NativeBranchWFMSpocConfig() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [branchFilter, setBranchFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [empSearch, setEmpSearch] = useState("");
  const [empSearchBackup, setEmpSearchBackup] = useState("");

  const branchesQ = useQuery({
    queryKey: ["branches-all"],
    queryFn: async () => unwrap<Branch>(await hrmsApi.get("/api/org/branches?active_status=1&limit=500")),
  });

  const configsQ = useQuery({
    queryKey: ["branch-spoc-configs", branchFilter],
    queryFn: async () => {
      const qs = branchFilter ? `?branchId=${branchFilter}` : "";
      return unwrap<SpocConfig>(await hrmsApi.get(`/api/wfm/branch-spoc-config${qs}`));
    },
  });

  const primaryEmpQ = useQuery({
    queryKey: ["emp-search-primary", empSearch],
    enabled: empSearch.length >= 2,
    queryFn: async () =>
      unwrap<Employee>(await hrmsApi.get(`/api/employees?search=${encodeURIComponent(empSearch)}&limit=20`)),
  });

  const backupEmpQ = useQuery({
    queryKey: ["emp-search-backup", empSearchBackup],
    enabled: empSearchBackup.length >= 2,
    queryFn: async () =>
      unwrap<Employee>(await hrmsApi.get(`/api/employees?search=${encodeURIComponent(empSearchBackup)}&limit=20`)),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      hrmsApi.post("/api/wfm/branch-spoc-config", {
        ...data,
        backup_spoc_user_id: data.backup_spoc_user_id || null,
        effective_to: data.effective_to || null,
      }),
    onSuccess: () => {
      toast({ title: "SPOC configuration saved." });
      void qc.invalidateQueries({ queryKey: ["branch-spoc-configs"] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.response?.data?.message ?? e.message }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof form> }) =>
      hrmsApi.patch(`/api/wfm/branch-spoc-config/${id}`, {
        ...data,
        backup_spoc_user_id: data.backup_spoc_user_id || null,
        effective_to: data.effective_to || null,
      }),
    onSuccess: () => {
      toast({ title: "SPOC configuration updated." });
      void qc.invalidateQueries({ queryKey: ["branch-spoc-configs"] });
      setEditId(null);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Update failed", description: e?.response?.data?.message ?? e.message }),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: number) => hrmsApi.patch(`/api/wfm/branch-spoc-config/${id}`, { is_active: 0 }),
    onSuccess: () => {
      toast({ title: "Configuration deactivated." });
      void qc.invalidateQueries({ queryKey: ["branch-spoc-configs"] });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Failed", description: e?.response?.data?.message ?? e.message }),
  });

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setEmpSearch("");
    setEmpSearchBackup("");
    setShowForm(true);
  }

  function openEdit(c: SpocConfig) {
    setEditId(c.id);
    setForm({
      branch_id: c.branch_id,
      primary_spoc_user_id: c.primary_spoc_user_id,
      backup_spoc_user_id: c.backup_spoc_user_id ?? "",
      effective_from: c.effective_from.slice(0, 10),
      effective_to: c.effective_to ? c.effective_to.slice(0, 10) : "",
    });
    setEmpSearch(c.primary_spoc_name ?? "");
    setEmpSearchBackup(c.backup_spoc_name ?? "");
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.branch_id || !form.primary_spoc_user_id || !form.effective_from) {
      toast({ variant: "destructive", title: "Branch, Primary SPOC and Effective From are required." });
      return;
    }
    if (editId) {
      updateMut.mutate({ id: editId, data: form });
    } else {
      createMut.mutate(form);
    }
  }

  const branches = branchesQ.data ?? [];
  const configs = configsQ.data ?? [];
  const primaryEmps = primaryEmpQ.data ?? [];
  const backupEmps = backupEmpQ.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-r from-violet-600 to-purple-700 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-violet-200">WFM · Access Control</p>
          <h1 className="mt-2 text-3xl font-black">Branch WFM SPOC Configuration</h1>
          <p className="mt-2 text-sm opacity-90">
            Assign a Single Point of Contact per branch who has final approval authority over attendance regularization requests.
            SPOC enforcement ensures only the designated WFM officer (or backup) can give final approval.
          </p>
        </header>

        {/* Filter + Add */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
          >
            <option value="">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </select>
          <button
            onClick={openAdd}
            className="ml-auto flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-violet-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add SPOC Config
          </button>
        </div>

        {/* Add / Edit Form */}
        {showForm && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-violet-800">
              {editId ? "Edit SPOC Configuration" : "New SPOC Configuration"}
            </h2>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Branch */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Branch *</label>
                <select
                  required
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  value={form.branch_id}
                  onChange={e => setForm({ ...form, branch_id: e.target.value })}
                >
                  <option value="">Select branch…</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.branch_name}</option>
                  ))}
                </select>
              </div>

              {/* Primary SPOC */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Primary SPOC *</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search employee…"
                    value={empSearch}
                    onChange={e => { setEmpSearch(e.target.value); if (!e.target.value) setForm({ ...form, primary_spoc_user_id: "" }); }}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                {primaryEmps.length > 0 && !form.primary_spoc_user_id && (
                  <ul className="z-10 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                    {primaryEmps.map(e => (
                      <li
                        key={e.id}
                        className="cursor-pointer px-3 py-2 text-sm hover:bg-violet-50"
                        onClick={() => { setForm({ ...form, primary_spoc_user_id: e.id }); setEmpSearch(empLabel(e)); }}
                      >
                        {empLabel(e)}
                      </li>
                    ))}
                  </ul>
                )}
                {form.primary_spoc_user_id && (
                  <p className="text-xs text-violet-700 font-medium mt-1 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Selected
                  </p>
                )}
              </div>

              {/* Backup SPOC */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Backup SPOC (optional)</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search employee…"
                    value={empSearchBackup}
                    onChange={e => { setEmpSearchBackup(e.target.value); if (!e.target.value) setForm({ ...form, backup_spoc_user_id: "" }); }}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                {backupEmps.length > 0 && !form.backup_spoc_user_id && (
                  <ul className="z-10 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                    {backupEmps.map(e => (
                      <li
                        key={e.id}
                        className="cursor-pointer px-3 py-2 text-sm hover:bg-violet-50"
                        onClick={() => { setForm({ ...form, backup_spoc_user_id: e.id }); setEmpSearchBackup(empLabel(e)); }}
                      >
                        {empLabel(e)}
                      </li>
                    ))}
                  </ul>
                )}
                {form.backup_spoc_user_id && (
                  <p className="text-xs text-violet-700 font-medium mt-1 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Selected
                  </p>
                )}
              </div>

              {/* Effective From */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Effective From *</label>
                <input
                  required
                  type="date"
                  value={form.effective_from}
                  onChange={e => setForm({ ...form, effective_from: e.target.value })}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Effective To */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-600">Effective To (blank = indefinite)</label>
                <input
                  type="date"
                  value={form.effective_to}
                  onChange={e => setForm({ ...form, effective_to: e.target.value })}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                <button
                  type="submit"
                  disabled={createMut.isPending || updateMut.isPending}
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-violet-700 disabled:opacity-60 transition-colors"
                >
                  {(createMut.isPending || updateMut.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editId ? "Update" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditId(null); }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Configs Table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">
              Configured SPOCs
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{configs.length}</span>
            </h2>
          </div>

          {configsQ.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : configs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
              <ShieldCheck className="h-10 w-10 opacity-30" />
              <p className="text-sm">No SPOC configurations yet.</p>
              <p className="text-xs opacity-70">Add one above to enforce branch-scoped final approval.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Branch</th>
                    <th className="px-4 py-3 text-left">Primary SPOC</th>
                    <th className="px-4 py-3 text-left">Backup SPOC</th>
                    <th className="px-4 py-3 text-left">Effective From</th>
                    <th className="px-4 py-3 text-left">Effective To</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {configs.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{c.branch_name}</td>
                      <td className="px-4 py-3 text-slate-700">{c.primary_spoc_name}</td>
                      <td className="px-4 py-3 text-slate-500">{c.backup_spoc_name ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{c.effective_from.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-slate-600">{c.effective_to ? c.effective_to.slice(0, 10) : <span className="text-slate-300">Indefinite</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          c.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                        }`}>
                          {c.is_active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          {c.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(c)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {c.is_active === 1 && (
                            <button
                              onClick={() => deactivateMut.mutate(c.id)}
                              disabled={deactivateMut.isPending}
                              className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              title="Deactivate"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

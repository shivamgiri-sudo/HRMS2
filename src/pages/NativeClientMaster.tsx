import { useEffect, useState } from "react";
import {
  AlertTriangle, Building2, Edit2, Loader, Plus,
  RefreshCcw, Search, ShieldCheck, Users, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ──────────────────────────────────────────────────────────────────

type Process = {
  id: string;
  process_name: string;
  client_id: string;
  description?: string;
  is_active: boolean;
  created_at: string;
};

type PortalUser = {
  id: string;
  name: string;
  email: string;
  client_id: string;
  process_ids: string[];
  is_active: boolean;
  created_at: string;
};

type AddUserForm = {
  email: string;
  name: string;
  client_id: string;
  process_ids_raw: string; // comma-separated input
};

type AddProcessForm = {
  process_name: string;
  client_id: string;
  description: string;
};

type EditProcessForm = AddProcessForm & { id: string };

// ── Helpers ────────────────────────────────────────────────────────────────

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
        active
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

const EMPTY_USER_FORM: AddUserForm = {
  email: "",
  name: "",
  client_id: "",
  process_ids_raw: "",
};

const EMPTY_PROCESS_FORM: AddProcessForm = {
  process_name: "",
  client_id: "",
  description: "",
};

// ── Main Component ─────────────────────────────────────────────────────────

export default function NativeClientMaster() {
  const [activeTab, setActiveTab] = useState<"users" | "processes">("users");
  const [message, setMessage] = useState("");

  // Processes state
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processSearch, setProcessSearch] = useState("");
  const [showAddProcess, setShowAddProcess] = useState(false);
  const [showEditProcess, setShowEditProcess] = useState(false);
  const [addProcessForm, setAddProcessForm] = useState<AddProcessForm>(EMPTY_PROCESS_FORM);
  const [editProcessForm, setEditProcessForm] = useState<EditProcessForm>({ id: "", ...EMPTY_PROCESS_FORM });
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [submittingProcess, setSubmittingProcess] = useState(false);

  // Portal users state
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState<AddUserForm>(EMPTY_USER_FORM);
  const [submittingUser, setSubmittingUser] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────

  const loadProcesses = async () => {
    setProcessLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Process[] }>(
        "/api/processes"
      );
      setProcesses(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load processes.");
    } finally {
      setProcessLoading(false);
    }
  };

  const loadPortalUsers = async () => {
    setUsersLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PortalUser[] }>(
        "/api/portal/internal/client-users"
      );
      setPortalUsers(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load portal users.");
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    void loadProcesses();
    void loadPortalUsers();
  }, []);

  // ── Process actions ────────────────────────────────────────────────────

  const handleAddProcess = async () => {
    if (!addProcessForm.process_name.trim()) {
      setMessage("Process name is required.");
      return;
    }
    if (!addProcessForm.client_id.trim()) {
      setMessage("Client ID is required.");
      return;
    }
    setSubmittingProcess(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/processes", {
        process_name: addProcessForm.process_name.trim(),
        client_id: addProcessForm.client_id.trim(),
        description: addProcessForm.description.trim() || null,
      });
      setShowAddProcess(false);
      setAddProcessForm(EMPTY_PROCESS_FORM);
      setMessage("Process created successfully.");
      await loadProcesses();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create process.");
    } finally {
      setSubmittingProcess(false);
    }
  };

  const handleEditProcess = async () => {
    if (!editProcessForm.process_name.trim()) {
      setMessage("Process name is required.");
      return;
    }
    setSubmittingProcess(true);
    setMessage("");
    try {
      await hrmsApi.put(`/api/processes/${editProcessForm.id}`, {
        process_name: editProcessForm.process_name.trim(),
        client_id: editProcessForm.client_id.trim(),
        description: editProcessForm.description.trim() || null,
      });
      setShowEditProcess(false);
      setMessage("Process updated successfully.");
      await loadProcesses();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update process.");
    } finally {
      setSubmittingProcess(false);
    }
  };

  const handleToggleStatus = async (process: Process) => {
    setTogglingId(process.id);
    setMessage("");
    try {
      await hrmsApi.patch(`/api/processes/${process.id}/status`, {
        is_active: !process.is_active,
      });
      setMessage(
        `Process "${process.process_name}" ${!process.is_active ? "activated" : "deactivated"}.`
      );
      await loadProcesses();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to toggle status.");
    } finally {
      setTogglingId(null);
    }
  };

  const openEditModal = (process: Process) => {
    setEditProcessForm({
      id: process.id,
      process_name: process.process_name,
      client_id: process.client_id,
      description: process.description ?? "",
    });
    setShowEditProcess(true);
  };

  // ── Portal user actions ────────────────────────────────────────────────

  const handleAddUser = async () => {
    if (!addUserForm.email.trim()) {
      setMessage("Email is required.");
      return;
    }
    if (!addUserForm.client_id.trim()) {
      setMessage("Client ID is required.");
      return;
    }
    setSubmittingUser(true);
    setMessage("");
    try {
      const process_ids = addUserForm.process_ids_raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await hrmsApi.post("/api/portal/internal/client-users", {
        email: addUserForm.email.trim(),
        name: addUserForm.name.trim() || null,
        client_id: addUserForm.client_id.trim(),
        process_ids,
      });
      setShowAddUser(false);
      setAddUserForm(EMPTY_USER_FORM);
      setMessage("Portal user created. They can log in via OTP at /portal/login.");
      await loadPortalUsers();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create portal user.");
    } finally {
      setSubmittingUser(false);
    }
  };

  // ── Filtered lists ─────────────────────────────────────────────────────

  const filteredProcesses = processes.filter((p) => {
    const q = processSearch.trim().toLowerCase();
    if (!q) return true;
    return [p.process_name, p.client_id, p.description].join(" ").toLowerCase().includes(q);
  });

  const filteredUsers = portalUsers.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return [u.name, u.email, u.client_id, ...(u.process_ids ?? [])].join(" ").toLowerCase().includes(q);
  });

  // ── Unique client IDs from process list for user form dropdown ─────────

  const clientOptions = Array.from(new Set(processes.map((p) => p.client_id))).sort();

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              Portal Administration
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Client Master
            </h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Manage client processes and grant portal access to client-side users.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void loadProcesses();
                void loadPortalUsers();
              }}
              disabled={processLoading || usersLoading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            {activeTab === "users" ? (
              <button
                onClick={() => setShowAddUser(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add Portal User
              </button>
            ) : (
              <button
                onClick={() => setShowAddProcess(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add Process
              </button>
            )}
          </div>
        </div>

        {/* Message banner */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{message}</span>
            <button
              onClick={() => setMessage("")}
              className="cursor-pointer text-blue-500 hover:text-blue-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {(["users", "processes"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-colors cursor-pointer ${
                activeTab === tab
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab === "users" ? (
                <Users className="h-4 w-4" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
              {tab === "users" ? "Client Portal Users" : "Processes"}
            </button>
          ))}
        </div>

        {/* ── Tab: Portal Users ── */}
        {activeTab === "users" && (
          <div className="space-y-4">
            {/* OTP notice */}
            <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 text-violet-500" />
              Portal users log in via OTP at{" "}
              <span className="font-mono font-semibold">/portal/login</span>
            </div>

            {/* Search */}
            <div className="rounded-3xl border bg-white p-4 shadow-sm">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name, email, client…"
                  className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Portal User Accounts</h2>
                <p className="text-sm text-slate-500">{filteredUsers.length} users</p>
              </div>
              {usersLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No portal users found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Name / Email", "Client ID", "Process Access", "Status", "Created"].map(
                          (h) => (
                            <th key={h} className="p-4 font-semibold">
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr
                          key={u.id}
                          className="border-t hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="p-4">
                            <div className="font-bold text-slate-950">
                              {u.name || "—"}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">
                              {u.email}
                            </div>
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-700">
                            {u.client_id}
                          </td>
                          <td className="p-4">
                            {u.process_ids?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {u.process_ids.map((pid) => (
                                  <span
                                    key={pid}
                                    className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 font-mono"
                                  >
                                    {pid}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">All processes</span>
                            )}
                          </td>
                          <td className="p-4">
                            <Badge active={u.is_active} />
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-400">
                            {u.created_at?.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Processes ── */}
        {activeTab === "processes" && (
          <div className="space-y-4">
            {/* Search */}
            <div className="rounded-3xl border bg-white p-4 shadow-sm">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={processSearch}
                  onChange={(e) => setProcessSearch(e.target.value)}
                  placeholder="Search process name, client…"
                  className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Processes</h2>
                <p className="text-sm text-slate-500">
                  {filteredProcesses.length} processes
                </p>
              </div>
              {processLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : filteredProcesses.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Building2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No processes found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Process Name", "Client ID", "Description", "Status", "Created", "Actions"].map(
                          (h) => (
                            <th key={h} className="p-4 font-semibold">
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProcesses.map((p) => (
                        <tr
                          key={p.id}
                          className="border-t hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="p-4">
                            <div className="font-bold text-slate-950">
                              {p.process_name}
                            </div>
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-700">
                            {p.client_id}
                          </td>
                          <td className="p-4 max-w-[220px]">
                            <p className="truncate text-slate-500 text-xs">
                              {p.description || "—"}
                            </p>
                          </td>
                          <td className="p-4">
                            <Badge active={p.is_active} />
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-400">
                            {p.created_at?.slice(0, 10)}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openEditModal(p)}
                                className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <Edit2 className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                onClick={() => void handleToggleStatus(p)}
                                disabled={togglingId === p.id}
                                className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                  p.is_active
                                    ? "border border-rose-200 text-rose-600 hover:bg-rose-50"
                                    : "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                }`}
                              >
                                {togglingId === p.id ? (
                                  <Loader className="h-3 w-3 animate-spin" />
                                ) : p.is_active ? (
                                  "Deactivate"
                                ) : (
                                  "Activate"
                                )}
                              </button>
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
        )}
      </div>

      {/* ── Add Portal User Modal ── */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Add Portal User</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  User will receive an OTP to log in at /portal/login
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddUser(false);
                  setAddUserForm(EMPTY_USER_FORM);
                }}
                className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={(e) =>
                    setAddUserForm({ ...addUserForm, email: e.target.value })
                  }
                  placeholder="client@example.com"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  value={addUserForm.name}
                  onChange={(e) =>
                    setAddUserForm({ ...addUserForm, name: e.target.value })
                  }
                  placeholder="John Smith"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Client ID <span className="text-rose-500">*</span>
                </label>
                {clientOptions.length > 0 ? (
                  <select
                    value={addUserForm.client_id}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, client_id: e.target.value })
                    }
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
                  >
                    <option value="">— Select client —</option>
                    {clientOptions.map((cid) => (
                      <option key={cid} value={cid}>
                        {cid}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={addUserForm.client_id}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, client_id: e.target.value })
                    }
                    placeholder="client-uuid or client code"
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Process IDs
                  <span className="ml-1 text-xs text-slate-400 font-normal">
                    (comma-separated; leave blank for all)
                  </span>
                </label>
                <input
                  value={addUserForm.process_ids_raw}
                  onChange={(e) =>
                    setAddUserForm({ ...addUserForm, process_ids_raw: e.target.value })
                  }
                  placeholder="proc-id-1, proc-id-2"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors font-mono"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => {
                  setShowAddUser(false);
                  setAddUserForm(EMPTY_USER_FORM);
                }}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAddUser()}
                disabled={submittingUser}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {submittingUser && <Loader className="h-4 w-4 animate-spin" />}
                Create Portal User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Process Modal ── */}
      {showAddProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Process</h2>
              <button
                onClick={() => {
                  setShowAddProcess(false);
                  setAddProcessForm(EMPTY_PROCESS_FORM);
                }}
                className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Process Name <span className="text-rose-500">*</span>
                </label>
                <input
                  value={addProcessForm.process_name}
                  onChange={(e) =>
                    setAddProcessForm({ ...addProcessForm, process_name: e.target.value })
                  }
                  placeholder="e.g. Outbound Sales"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Client ID <span className="text-rose-500">*</span>
                </label>
                <input
                  value={addProcessForm.client_id}
                  onChange={(e) =>
                    setAddProcessForm({ ...addProcessForm, client_id: e.target.value })
                  }
                  placeholder="client-uuid or client code"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Description
                </label>
                <textarea
                  value={addProcessForm.description}
                  onChange={(e) =>
                    setAddProcessForm({ ...addProcessForm, description: e.target.value })
                  }
                  placeholder="Brief description of this process…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => {
                  setShowAddProcess(false);
                  setAddProcessForm(EMPTY_PROCESS_FORM);
                }}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAddProcess()}
                disabled={submittingProcess}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {submittingProcess && <Loader className="h-4 w-4 animate-spin" />}
                Create Process
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Process Modal ── */}
      {showEditProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Edit Process</h2>
              <button
                onClick={() => setShowEditProcess(false)}
                className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Process Name <span className="text-rose-500">*</span>
                </label>
                <input
                  value={editProcessForm.process_name}
                  onChange={(e) =>
                    setEditProcessForm({ ...editProcessForm, process_name: e.target.value })
                  }
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Client ID <span className="text-rose-500">*</span>
                </label>
                <input
                  value={editProcessForm.client_id}
                  onChange={(e) =>
                    setEditProcessForm({ ...editProcessForm, client_id: e.target.value })
                  }
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Description
                </label>
                <textarea
                  value={editProcessForm.description}
                  onChange={(e) =>
                    setEditProcessForm({ ...editProcessForm, description: e.target.value })
                  }
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowEditProcess(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleEditProcess()}
                disabled={submittingProcess}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {submittingProcess && <Loader className="h-4 w-4 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

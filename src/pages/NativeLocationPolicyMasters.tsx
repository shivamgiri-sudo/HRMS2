import { useEffect, useState } from "react";
import {
  AlertTriangle, FileText, Loader, MapPin,
  Pencil, Plus, RefreshCcw, Trash2, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = {
  id: string;
  location_name: string;
  location_code: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  branch_id: string | null;
  active_status: number;
  created_at: string;
};

type Branch = {
  id: string;
  branch_name: string;
  branch_code: string;
};

type Policy = {
  id: string;
  policy_name: string;
  policy_code: string | null;
  description: string | null;
  effective_date: string | null;
  version: string | null;
  active_status: number;
  created_at: string;
};

type LocationForm = {
  location_name: string;
  location_code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  branch_id: string;
};

type PolicyForm = {
  policy_name: string;
  policy_code: string;
  description: string;
  effective_date: string;
  version: string;
};

const EMPTY_LOCATION_FORM: LocationForm = {
  location_name: "",
  location_code: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  branch_id: "",
};

const EMPTY_POLICY_FORM: PolicyForm = {
  policy_name: "",
  policy_code: "",
  description: "",
  effective_date: "",
  version: "",
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
      {children}
    </label>
  );
}

function FormInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
    />
  );
}

function ActiveBadge({ active }: { active: number }) {
  return active === 1 ? (
    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
      Active
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
      Inactive
    </span>
  );
}

// ── Tab: Locations ─────────────────────────────────────────────────────────────

function LocationsTab() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_LOCATION_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [locRes, branchRes] = await Promise.all([
        hrmsApi.get<{ data: Location[] }>("/api/org/locations"),
        hrmsApi.get<{ data: Branch[] }>("/api/org/branches"),
      ]);
      setLocations(locRes.data ?? []);
      setBranches(branchRes.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_LOCATION_FORM);
    setShowModal(true);
  };

  const openEdit = (loc: Location) => {
    setEditId(loc.id);
    setForm({
      location_name: loc.location_name,
      location_code: loc.location_code ?? "",
      address: loc.address ?? "",
      city: loc.city ?? "",
      state: loc.state ?? "",
      pincode: loc.pincode ?? "",
      branch_id: loc.branch_id ?? "",
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(EMPTY_LOCATION_FORM);
  };

  const submit = async () => {
    if (!form.location_name.trim()) {
      setMessage("Location name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        location_name: form.location_name.trim(),
        location_code: form.location_code.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
        branch_id: form.branch_id || null,
      };
      if (editId) {
        await hrmsApi.put(`/api/org/locations/${editId}`, payload);
        setMessage("Location updated.");
      } else {
        await hrmsApi.post("/api/org/locations", payload);
        setMessage("Location added.");
      }
      closeModal();
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this location?")) return;
    try {
      await hrmsApi.delete(`/api/org/locations/${id}`);
      setMessage("Location deleted.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const branchName = (id: string | null) => {
    if (!id) return "–";
    return branches.find((b) => b.id === id)?.branch_name ?? id.slice(0, 8);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{locations.length} locations</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add Location
          </button>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : locations.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <MapPin className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No locations found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Name", "Code", "City", "State", "Branch", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => (
                  <tr key={loc.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-950">{loc.location_name}</td>
                    <td className="p-4 font-mono text-slate-600">{loc.location_code ?? "–"}</td>
                    <td className="p-4 text-slate-700">{loc.city ?? "–"}</td>
                    <td className="p-4 text-slate-700">{loc.state ?? "–"}</td>
                    <td className="p-4 text-slate-500">{branchName(loc.branch_id)}</td>
                    <td className="p-4"><ActiveBadge active={loc.active_status} /></td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(loc)}
                          className="cursor-pointer rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => remove(loc.id)}
                          className="cursor-pointer rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">
                {editId ? "Edit Location" : "Add Location"}
              </h2>
              <button onClick={closeModal} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Location Name *</FieldLabel>
                  <FormInput
                    value={form.location_name}
                    onChange={(v) => setForm({ ...form, location_name: v })}
                    placeholder="e.g. Bangalore HQ"
                  />
                </div>
                <div>
                  <FieldLabel>Location Code</FieldLabel>
                  <FormInput
                    value={form.location_code}
                    onChange={(v) => setForm({ ...form, location_code: v })}
                    placeholder="e.g. BLR-HQ"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Address</FieldLabel>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Full address…"
                  rows={2}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel>City</FieldLabel>
                  <FormInput
                    value={form.city}
                    onChange={(v) => setForm({ ...form, city: v })}
                    placeholder="City"
                  />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <FormInput
                    value={form.state}
                    onChange={(v) => setForm({ ...form, state: v })}
                    placeholder="State"
                  />
                </div>
                <div>
                  <FieldLabel>Pincode</FieldLabel>
                  <FormInput
                    value={form.pincode}
                    onChange={(v) => setForm({ ...form, pincode: v })}
                    placeholder="560001"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Branch</FieldLabel>
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                >
                  <option value="">— Select branch —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.branch_name} ({b.branch_code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={closeModal}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving…" : editId ? "Update Location" : "Add Location"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Policies ──────────────────────────────────────────────────────────────

function PoliciesTab() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ data: Policy[] }>("/api/org/policies");
      setPolicies(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_POLICY_FORM);
    setShowModal(true);
  };

  const openEdit = (pol: Policy) => {
    setEditId(pol.id);
    setForm({
      policy_name: pol.policy_name,
      policy_code: pol.policy_code ?? "",
      description: pol.description ?? "",
      effective_date: pol.effective_date ? pol.effective_date.slice(0, 10) : "",
      version: pol.version ?? "",
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(EMPTY_POLICY_FORM);
  };

  const submit = async () => {
    if (!form.policy_name.trim()) {
      setMessage("Policy name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        policy_name: form.policy_name.trim(),
        policy_code: form.policy_code.trim() || null,
        description: form.description.trim() || null,
        effective_date: form.effective_date || null,
        version: form.version.trim() || null,
      };
      if (editId) {
        await hrmsApi.put(`/api/org/policies/${editId}`, payload);
        setMessage("Policy updated.");
      } else {
        await hrmsApi.post("/api/org/policies", payload);
        setMessage("Policy added.");
      }
      closeModal();
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this policy?")) return;
    try {
      await hrmsApi.delete(`/api/org/policies/${id}`);
      setMessage("Policy deleted.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-3.5 text-sm text-blue-700">
        <strong>Note:</strong> Policy versions are managed here. Attach policies to employees in the Lifecycle module.
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{policies.length} policies</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add Policy
          </button>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {message}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : policies.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No policies found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Policy Name", "Code", "Description", "Effective Date", "Version", "Status", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policies.map((pol) => (
                  <tr key={pol.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-950">{pol.policy_name}</td>
                    <td className="p-4 font-mono text-slate-600">{pol.policy_code ?? "–"}</td>
                    <td className="max-w-[240px] p-4 text-slate-500 truncate">
                      {pol.description ?? "–"}
                    </td>
                    <td className="p-4 font-mono text-slate-600">
                      {pol.effective_date ? pol.effective_date.slice(0, 10) : "–"}
                    </td>
                    <td className="p-4 text-slate-700">{pol.version ?? "–"}</td>
                    <td className="p-4"><ActiveBadge active={pol.active_status} /></td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(pol)}
                          className="cursor-pointer rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => remove(pol.id)}
                          className="cursor-pointer rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">
                {editId ? "Edit Policy" : "Add Policy"}
              </h2>
              <button onClick={closeModal} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Policy Name *</FieldLabel>
                  <FormInput
                    value={form.policy_name}
                    onChange={(v) => setForm({ ...form, policy_name: v })}
                    placeholder="e.g. Leave Policy"
                  />
                </div>
                <div>
                  <FieldLabel>Policy Code</FieldLabel>
                  <FormInput
                    value={form.policy_code}
                    onChange={(v) => setForm({ ...form, policy_code: v })}
                    placeholder="e.g. POL-001"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description of the policy…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Effective Date</FieldLabel>
                  <FormInput
                    type="date"
                    value={form.effective_date}
                    onChange={(v) => setForm({ ...form, effective_date: v })}
                  />
                </div>
                <div>
                  <FieldLabel>Version</FieldLabel>
                  <FormInput
                    value={form.version}
                    onChange={(v) => setForm({ ...form, version: v })}
                    placeholder="e.g. v1.0"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={closeModal}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving…" : editId ? "Update Policy" : "Add Policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = "locations" | "policies";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "locations", label: "Locations", icon: <MapPin className="h-4 w-4" /> },
  { id: "policies",  label: "Policies",  icon: <FileText className="h-4 w-4" /> },
];

export default function NativeLocationPolicyMasters() {
  const [activeTab, setActiveTab] = useState<Tab>("locations");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            Org Masters
          </p>
          <h1 className="text-3xl font-black text-slate-950">
            Location &amp; Policy Masters
          </h1>
          <p className="max-w-3xl text-slate-600">
            Manage office locations and HR policy versions for your organisation.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "locations" && <LocationsTab />}
        {activeTab === "policies"  && <PoliciesTab />}
      </div>
    </DashboardLayout>
  );
}

import { useEffect, useState, useCallback } from "react";
import { Package, Plus, Loader, RefreshCcw, X, CheckCircle2, XCircle, Undo2, Send, Printer, AlertTriangle, Ban } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatusBadge, normalizeStatus } from "@/components/ui/status-badge";

// --- Types -------------------------------------------------------------

type ExitPassItem = {
  id?: string;
  asset_id?: string;
  category: string;
  item_name: string;
  serial_number?: string;
  make_model?: string;
  quantity: number;
  unit: string;
  condition_out?: string;
  remarks?: string;
};

type ExitPass = {
  id: string;
  pass_number: string | null;
  requestor_employee_id: string;
  requestor_name?: string;
  request_department: "IT" | "ADMIN";
  branch_id: string;
  branch_name?: string;
  movement_type: "returnable" | "non_returnable";
  priority: "normal" | "urgent" | "emergency";
  purpose_code: string;
  purpose_details: string;
  destination_type: string;
  destination_name?: string;
  destination_address?: string;
  planned_exit_at: string;
  expected_return_at?: string;
  status: string;
  submitted_at?: string;
  created_at: string;
  items?: ExitPassItem[];
  is_overdue?: boolean | number;
};

const EMPTY_ITEM: ExitPassItem = { category: "", item_name: "", quantity: 1, unit: "Nos" };

const DEPARTMENTS = ["IT", "ADMIN"] as const;
const MOVEMENT_TYPES: Array<{ value: ExitPass["movement_type"]; label: string }> = [
  { value: "returnable", label: "Returnable" },
  { value: "non_returnable", label: "Non-Returnable" },
];
const PRIORITIES = ["normal", "urgent", "emergency"] as const;
const DESTINATION_TYPES = ["Vendor", "Another MAS Branch", "Employee Residence", "Client Location", "Repair Centre", "Other"];
const CARRIER_TYPES: Array<{ value: string; label: string }> = [
  { value: "employee", label: "Employee" },
  { value: "vendor", label: "Vendor" },
  { value: "courier", label: "Courier" },
  { value: "driver", label: "Driver" },
  { value: "other", label: "Other" },
];

const CATEGORIES: Record<"IT" | "ADMIN", string[]> = {
  IT: [
    "Laptop", "Desktop", "Monitor", "CPU", "Keyboard", "Mouse", "Headset", "Switch", "Router",
    "Firewall", "Server Equipment", "Hard Disk", "SSD", "RAM", "Printer", "UPS", "CCTV Equipment",
    "Access-Control Hardware", "Mobile Device", "Charger / Adapter", "Network Equipment", "Other IT Material",
  ],
  ADMIN: [
    "Furniture", "Electrical Equipment", "AC Components", "Office Equipment", "Stationery (Bulk)",
    "Repairable Equipment", "Scrap Material", "Facility Equipment", "Vendor Material", "Documents / Files",
    "Other Administrative Material",
  ],
};

const REASONS: Record<"IT" | "ADMIN", Array<{ code: string; label: string }>> = {
  IT: [
    { code: "repair", label: "Repair" },
    { code: "warranty_replacement", label: "Warranty Replacement" },
    { code: "vendor_service", label: "Vendor Service" },
    { code: "wfh_assignment", label: "Employee WFH Assignment" },
    { code: "client_requirement", label: "Client Requirement" },
    { code: "branch_transfer", label: "Branch Transfer" },
    { code: "replacement", label: "Replacement" },
    { code: "testing", label: "Testing" },
    { code: "disposal", label: "Disposal" },
    { code: "scrap", label: "Scrap" },
    { code: "temp_installation", label: "Temporary Installation" },
    { code: "permanent_transfer", label: "Permanent Transfer" },
    { code: "other", label: "Other" },
  ],
  ADMIN: [
    { code: "repair", label: "Repair" },
    { code: "vendor_service", label: "Vendor Service" },
    { code: "branch_transfer", label: "Branch Transfer" },
    { code: "office_setup", label: "Office Setup" },
    { code: "event", label: "Event" },
    { code: "scrap", label: "Scrap" },
    { code: "disposal", label: "Disposal" },
    { code: "maintenance", label: "Maintenance" },
    { code: "temp_movement", label: "Temporary Movement" },
    { code: "permanent_movement", label: "Permanent Movement" },
    { code: "other", label: "Other" },
  ],
};

type BranchOption = { id: string; branch_name: string; address?: string | null; city?: string | null; state?: string | null };
type EmployeeHit = { id: string; employee_code: string; full_name: string; mobile?: string | null };

const INPUT_CLS = "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500";

// --- Page ----------------------------------------------------------------

export default function NativeExitPass() {
  const [tab, setTab] = useState<"mine" | "pending_bh" | "pending_admin" | "outside">("mine");
  const [passes, setPasses] = useState<ExitPass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [decisionTarget, setDecisionTarget] = useState<{ pass: ExitPass; stage: "branch_head" | "admin" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const path =
        tab === "mine" ? "/api/exit-passes" :
        tab === "pending_bh" ? "/api/exit-passes/pending/branch-head" :
        tab === "pending_admin" ? "/api/exit-passes/pending/admin" :
        "/api/exit-passes?status=outside_premises";
      const res = await hrmsApi.get<{ success: boolean; data: ExitPass[]; message?: string }>(path);
      if (!res?.success) throw new Error(res?.message ?? "Failed to load");
      setPasses(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exit passes");
      setPasses([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">

        {/* Gradient header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-700 via-rose-600 to-orange-600 text-white p-6 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-24 bottom-0 h-16 w-16 rounded-full bg-orange-300/20 blur-xl" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Package className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-rose-200">IT · Admin · Assets</p>
                <h1 className="mt-0.5 text-2xl font-bold text-white">Asset &amp; Material Exit Pass</h1>
                <p className="mt-0.5 text-sm text-rose-100">Raise, approve and print IT/Admin asset movement gate passes.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void load()}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <RefreshCcw className="h-4 w-4" /> Refresh
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-white text-rose-700 hover:bg-rose-50 transition-colors shadow"
              >
                <Plus className="h-4 w-4" /> Raise Exit Pass
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {([
            ["mine", "My Requests"],
            ["pending_bh", "Pending Branch Head"],
            ["pending_admin", "Pending Admin"],
            ["outside", "Outside Premises"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                tab === key ? "border-rose-600 text-rose-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {actionError && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {actionError}
            <button onClick={() => setActionError(null)} className="ml-auto text-rose-400 hover:text-rose-600 cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : passes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-2xl bg-white">
            <Package className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-base font-bold text-slate-700">No exit passes here yet</h3>
            <p className="mt-1 text-sm text-slate-500">
              {tab === "mine" ? "Raise one with the button above." :
                tab === "outside" ? "Nothing is currently checked out." :
                "Nothing is waiting on your decision right now."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-3">Pass No.</th>
                  <th className="text-left font-semibold px-4 py-3">Requestor</th>
                  <th className="text-left font-semibold px-4 py-3">Branch</th>
                  <th className="text-left font-semibold px-4 py-3">Dept</th>
                  <th className="text-left font-semibold px-4 py-3">Movement</th>
                  <th className="text-left font-semibold px-4 py-3">Exit</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-right font-semibold px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {passes.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{p.pass_number ?? <span className="text-slate-400">Draft</span>}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{p.requestor_name ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{p.branch_name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.request_department === "IT" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {p.request_department}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.movement_type === "returnable" ? "Returnable" : "Non-Returnable"}</td>
                    <td className="px-4 py-3 text-slate-600">{p.planned_exit_at ? new Date(p.planned_exit_at).toLocaleDateString() : "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={normalizeStatus(p.status)} />
                        {!!p.is_overdue && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-600 text-white">Overdue</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {tab === "mine" && p.status === "draft" && (
                          <>
                            <ActionBtn icon={Send} label="Submit" onAction={async () => {
                              await hrmsApi.post(`/api/exit-passes/${p.id}/submit`);
                              void load();
                            }} onError={setActionError} />
                            <ActionBtn icon={Ban} label="Cancel" variant="danger" onAction={async () => {
                              if (!window.confirm("Cancel this draft exit pass?")) return;
                              await hrmsApi.patch(`/api/exit-passes/${p.id}/cancel`);
                              void load();
                            }} onError={setActionError} />
                          </>
                        )}
                        {tab === "pending_bh" && p.status === "pending_branch_head" && (
                          <ActionBtn icon={CheckCircle2} label="Decide" onAction={() => { setDecisionTarget({ pass: p, stage: "branch_head" }); }} onError={setActionError} />
                        )}
                        {tab === "pending_admin" && p.status === "pending_admin_approval" && (
                          <ActionBtn icon={CheckCircle2} label="Decide" onAction={() => { setDecisionTarget({ pass: p, stage: "admin" }); }} onError={setActionError} />
                        )}
                        {(p.status === "approved" || p.status === "outside_premises") && (
                          <a
                            href={`/it-admin/exit-pass/${p.id}/print`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors cursor-pointer"
                          >
                            <Printer className="h-3.5 w-3.5" /> Print
                          </a>
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

      {showCreate && (
        <CreateExitPassModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setTab("mine"); void load(); }}
        />
      )}

      {decisionTarget && (
        <DecisionModal
          pass={decisionTarget.pass}
          stage={decisionTarget.stage}
          onClose={() => setDecisionTarget(null)}
          onDone={() => { setDecisionTarget(null); void load(); }}
        />
      )}
    </DashboardLayout>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onAction,
  onError,
  variant = "default",
}: {
  icon: typeof Send;
  label: string;
  onAction: () => void | Promise<void>;
  onError: (msg: string) => void;
  variant?: "default" | "danger";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onAction();
        } catch (e) {
          onError(e instanceof Error ? e.message : "Action failed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
      className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer disabled:opacity-50 ${
        variant === "danger"
          ? "border-rose-200 text-rose-600 hover:bg-rose-50"
          : "border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
    >
      {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

// --- Create modal --------------------------------------------------------

function CreateExitPassModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [department, setDepartment] = useState<(typeof DEPARTMENTS)[number]>("IT");
  const [movementType, setMovementType] = useState<ExitPass["movement_type"]>("returnable");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [purposeCode, setPurposeCode] = useState(REASONS.IT[0].code);
  const [purposeDetails, setPurposeDetails] = useState("");
  const [destinationType, setDestinationType] = useState(DESTINATION_TYPES[0]);
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [plannedExitAt, setPlannedExitAt] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [items, setItems] = useState<ExitPassItem[]>([{ ...EMPTY_ITEM }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  useEffect(() => {
    hrmsApi.get<{ data: BranchOption[] }>("/api/org/branches")
      .then((res) => setBranches(res?.data ?? []))
      .catch(() => setBranches([]));
  }, []);

  const [carrierType, setCarrierType] = useState("employee");
  const [carrierEmployeeId, setCarrierEmployeeId] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [carrierMobile, setCarrierMobile] = useState("");
  const [carrierCompany, setCarrierCompany] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeHit[]>([]);
  const [empSearching, setEmpSearching] = useState(false);

  useEffect(() => {
    if (carrierType !== "employee" || empSearch.trim().length < 2) { setEmpResults([]); return; }
    const t = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeHit[] }>(`/api/exit-passes/employees/search?q=${encodeURIComponent(empSearch)}`);
        setEmpResults(res?.data ?? []);
      } catch { setEmpResults([]); }
      finally { setEmpSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [empSearch, carrierType]);

  const pickCarrierEmployee = (hit: EmployeeHit) => {
    setCarrierEmployeeId(hit.id);
    setCarrierName(hit.full_name);
    setCarrierMobile(hit.mobile ?? "");
    setEmpSearch(`${hit.full_name} (${hit.employee_code})`);
    setEmpResults([]);
  };

  const updateItem = (idx: number, patch: Partial<ExitPassItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const submit = async () => {
    setError(null);
    if (!plannedExitAt) { setError("Exit date/time is required."); return; }
    if (!purposeDetails.trim()) { setError("Purpose is required."); return; }
    if (items.some((it) => !it.category || !it.item_name)) { setError("Every item needs a category and name."); return; }

    setSubmitting(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data?: { id: string }; message?: string }>("/api/exit-passes", {
        request_department: department,
        movement_type: movementType,
        priority,
        purpose_code: purposeCode,
        purpose_details: purposeDetails,
        destination_type: destinationType,
        destination_name: destinationName || null,
        destination_address: destinationAddress || null,
        carrier_type: carrierType,
        carrier_employee_id: carrierType === "employee" ? (carrierEmployeeId || null) : null,
        carrier_name: carrierName || null,
        carrier_mobile: carrierMobile || null,
        carrier_company: carrierType !== "employee" ? (carrierCompany || null) : null,
        vehicle_number: vehicleNumber || null,
        planned_exit_at: plannedExitAt,
        expected_return_at: movementType === "returnable" ? (expectedReturnAt || null) : null,
        items,
      });
      if (!res?.success) throw new Error(res?.message ?? "Could not create the pass");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the pass");
    } finally {
      setSubmitting(false);
    }
  };

  const reasons = REASONS[department];
  const categories = CATEGORIES[department];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-rose-600 to-orange-600 rounded-t-2xl">
          <h2 className="text-lg font-bold text-white">Raise Exit Pass</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Request Type">
              <select
                value={department}
                onChange={(e) => {
                  const d = e.target.value as typeof department;
                  setDepartment(d);
                  setPurposeCode(REASONS[d][0].code);
                }}
                className={INPUT_CLS}
              >
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={INPUT_CLS}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Reason">
              <select value={purposeCode} onChange={(e) => setPurposeCode(e.target.value)} className={INPUT_CLS}>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Movement Type">
              <select value={movementType} onChange={(e) => setMovementType(e.target.value as ExitPass["movement_type"])} className={INPUT_CLS}>
                {MOVEMENT_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Exit Date/Time">
              <input type="datetime-local" value={plannedExitAt} onChange={(e) => setPlannedExitAt(e.target.value)} className={INPUT_CLS} />
            </Field>
            {movementType === "returnable" && (
              <Field label="Expected Return">
                <input type="datetime-local" value={expectedReturnAt} onChange={(e) => setExpectedReturnAt(e.target.value)} className={INPUT_CLS} />
              </Field>
            )}
            <Field label="Destination Type">
              <select
                value={destinationType}
                onChange={(e) => {
                  setDestinationType(e.target.value);
                  setDestinationBranchId("");
                  setDestinationName("");
                  setDestinationAddress("");
                }}
                className={INPUT_CLS}
              >
                {DESTINATION_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            {destinationType === "Another MAS Branch" ? (
              <Field label="Destination Branch">
                <select
                  value={destinationBranchId}
                  onChange={(e) => {
                    const b = branches.find((x) => x.id === e.target.value);
                    setDestinationBranchId(e.target.value);
                    setDestinationName(b?.branch_name ?? "");
                    setDestinationAddress(b?.address || [b?.city, b?.state].filter(Boolean).join(", "));
                  }}
                  className={INPUT_CLS}
                >
                  <option value="">Select branch...</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Destination Name">
                <input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} className={INPUT_CLS} placeholder="e.g. Dell Service Centre" />
              </Field>
            )}
            <Field label="Destination Address" >
              <input value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} className={INPUT_CLS} />
            </Field>
          </div>

          <Field label="Purpose of Movement">
            <textarea value={purposeDetails} onChange={(e) => setPurposeDetails(e.target.value)} rows={2} className={INPUT_CLS} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Carried By">
              <select
                value={carrierType}
                onChange={(e) => { setCarrierType(e.target.value); setCarrierEmployeeId(""); setCarrierName(""); setCarrierMobile(""); setEmpSearch(""); }}
                className={INPUT_CLS}
              >
                {CARRIER_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Vehicle Number (optional)">
              <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className={INPUT_CLS} placeholder="e.g. UP16 AB 1234" />
            </Field>

            {carrierType === "employee" ? (
              <div className="col-span-2 relative">
                <Field label="Employee (search by name or code)">
                  <input
                    value={empSearch}
                    onChange={(e) => { setEmpSearch(e.target.value); setCarrierEmployeeId(""); }}
                    className={INPUT_CLS}
                    placeholder="Start typing a name or employee code..."
                  />
                </Field>
                {empSearching && <div className="absolute right-3 top-9 text-xs text-slate-400">Searching...</div>}
                {empResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {empResults.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => pickCarrierEmployee(hit)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                      >
                        {hit.full_name} <span className="text-slate-400">({hit.employee_code})</span>
                      </button>
                    ))}
                  </div>
                )}
                {carrierEmployeeId && carrierMobile && (
                  <div className="mt-1 text-xs text-slate-400">Mobile auto-filled: {carrierMobile}</div>
                )}
              </div>
            ) : (
              <>
                <Field label="Carrier Name">
                  <input value={carrierName} onChange={(e) => setCarrierName(e.target.value)} className={INPUT_CLS} />
                </Field>
                <Field label="Company">
                  <input value={carrierCompany} onChange={(e) => setCarrierCompany(e.target.value)} className={INPUT_CLS} />
                </Field>
                <Field label="Mobile">
                  <input value={carrierMobile} onChange={(e) => setCarrierMobile(e.target.value)} className={INPUT_CLS} />
                </Field>
              </>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Materials</span>
              <button
                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
              >
                + Add Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select className={`${INPUT_CLS} col-span-2`} value={item.category} onChange={(e) => updateItem(idx, { category: e.target.value })}>
                    <option value="">Category...</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className={`${INPUT_CLS} col-span-3`} placeholder="Item name" value={item.item_name} onChange={(e) => updateItem(idx, { item_name: e.target.value })} />
                  <input className={`${INPUT_CLS} col-span-2`} placeholder="Asset ID" value={item.asset_id ?? ""} onChange={(e) => updateItem(idx, { asset_id: e.target.value })} />
                  <input className={`${INPUT_CLS} col-span-2`} placeholder="Serial No." value={item.serial_number ?? ""} onChange={(e) => updateItem(idx, { serial_number: e.target.value })} />
                  <input className={`${INPUT_CLS} col-span-2`} placeholder="Make/Model" value={item.make_model ?? ""} onChange={(e) => updateItem(idx, { make_model: e.target.value })} />
                  <input type="number" min={1} className={`${INPUT_CLS} col-span-1`} value={item.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 1 })} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">Cancel</button>
          <button
            disabled={submitting}
            onClick={() => void submit()}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {submitting ? "Saving..." : "Save Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Decision modal (Branch Head / Admin) ---------------------------------

function DecisionModal({
  pass, stage, onClose, onDone,
}: {
  pass: ExitPass;
  stage: "branch_head" | "admin";
  onClose: () => void;
  onDone: () => void;
}) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approved" | "rejected" | "returned") => {
    if (decision !== "approved" && !remarks.trim()) {
      setError("Remarks are required for a rejection or return-for-correction.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const path = stage === "branch_head"
        ? `/api/exit-passes/${pass.id}/branch-head/decision`
        : `/api/exit-passes/${pass.id}/admin/decision`;
      const res = await hrmsApi.post<{ success: boolean; message?: string }>(path, { decision, remarks: remarks || undefined });
      if (!res?.success) throw new Error(res?.message ?? "Could not record the decision");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-700 to-slate-600 rounded-t-2xl">
          <h2 className="text-lg font-bold text-white">{stage === "branch_head" ? "Branch Head Decision" : "Admin Decision"}</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-700 space-y-1">
            <div><span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Requestor</span><br />{pass.requestor_name ?? "-"}</div>
            <div className="pt-1"><span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Purpose</span><br />{pass.purpose_details}</div>
          </div>
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <Field label="Remarks (required for reject/return)">
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className={INPUT_CLS} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          {stage === "branch_head" && (
            <button
              disabled={!!busy}
              onClick={() => void decide("returned")}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Undo2 className="h-4 w-4" /> Return
            </button>
          )}
          <button
            disabled={!!busy}
            onClick={() => void decide("rejected")}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-semibold rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <XCircle className="h-4 w-4" /> Reject
          </button>
          <button
            disabled={!!busy}
            onClick={() => void decide("approved")}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

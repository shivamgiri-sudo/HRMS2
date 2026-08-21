import { useEffect, useState, useCallback } from "react";
import { Plus, Loader, RefreshCcw, X, CheckCircle2, XCircle, Undo2, Send, Printer } from "lucide-react";
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
};

const EMPTY_ITEM: ExitPassItem = { category: "", item_name: "", quantity: 1, unit: "Nos" };

const DEPARTMENTS = ["IT", "ADMIN"] as const;
const MOVEMENT_TYPES: Array<{ value: ExitPass["movement_type"]; label: string }> = [
  { value: "returnable", label: "Returnable" },
  { value: "non_returnable", label: "Non-Returnable" },
];
const PRIORITIES = ["normal", "urgent", "emergency"] as const;
const DESTINATION_TYPES = ["Vendor", "Another MAS Branch", "Employee Residence", "Client Location", "Repair Centre", "Other"];

const INPUT_CLS = "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500";

// --- Page ----------------------------------------------------------------

export default function NativeExitPass() {
  const [tab, setTab] = useState<"mine" | "pending_bh" | "pending_admin">("mine");
  const [passes, setPasses] = useState<ExitPass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [decisionTarget, setDecisionTarget] = useState<{ pass: ExitPass; stage: "branch_head" | "admin" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path =
        tab === "mine" ? "/api/exit-passes" :
        tab === "pending_bh" ? "/api/exit-passes/pending/branch-head" :
        "/api/exit-passes/pending/admin";
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
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Asset &amp; Material Exit Pass</h1>
            <p className="text-sm text-slate-500 mt-1">
              Raise, approve and print IT/Admin asset movement gate passes. The letterhead on print
              uses your own branch, resolved from your employee record.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700"
            >
              <Plus className="h-4 w-4" /> Raise Exit Pass
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-200 mt-6 mb-5">
          {([
            ["mine", "My Requests"],
            ["pending_bh", "Pending Branch Head"],
            ["pending_admin", "Pending Admin"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === key ? "border-rose-600 text-rose-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : passes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-2xl">
            <h3 className="text-base font-bold text-slate-700">No exit passes here yet</h3>
            <p className="mt-1 text-sm text-slate-500">
              {tab === "mine" ? "Raise one with the button above." : "Nothing is waiting on your decision right now."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold px-4 py-2.5">Pass No.</th>
                  <th className="text-left font-semibold px-4 py-2.5">Requestor</th>
                  <th className="text-left font-semibold px-4 py-2.5">Branch</th>
                  <th className="text-left font-semibold px-4 py-2.5">Dept</th>
                  <th className="text-left font-semibold px-4 py-2.5">Movement</th>
                  <th className="text-left font-semibold px-4 py-2.5">Exit</th>
                  <th className="text-left font-semibold px-4 py-2.5">Status</th>
                  <th className="text-right font-semibold px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {passes.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{p.pass_number ?? "-"}</td>
                    <td className="px-4 py-2.5">{p.requestor_name ?? "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.branch_name ?? "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.request_department}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.movement_type === "returnable" ? "Returnable" : "Non-Returnable"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.planned_exit_at ? new Date(p.planned_exit_at).toLocaleDateString() : "-"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={normalizeStatus(p.status)} /></td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      {tab === "mine" && p.status === "draft" && (
                        <ActionBtn icon={Send} label="Submit" onClick={async () => {
                          await hrmsApi.post(`/api/exit-passes/${p.id}/submit`);
                          void load();
                        }} />
                      )}
                      {tab === "pending_bh" && p.status === "pending_branch_head" && (
                        <ActionBtn icon={CheckCircle2} label="Decide" onClick={() => setDecisionTarget({ pass: p, stage: "branch_head" })} />
                      )}
                      {tab === "pending_admin" && p.status === "pending_admin_approval" && (
                        <ActionBtn icon={CheckCircle2} label="Decide" onClick={() => setDecisionTarget({ pass: p, stage: "admin" })} />
                      )}
                      {(p.status === "approved" || p.status === "exit_verified") && (
                        <a
                          href={`/it-admin/exit-pass/${p.id}/print`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                        >
                          <Printer className="h-3.5 w-3.5" /> Print
                        </a>
                      )}
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

function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Send; label: string; onClick: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
  const [purposeDetails, setPurposeDetails] = useState("");
  const [destinationType, setDestinationType] = useState(DESTINATION_TYPES[0]);
  const [destinationName, setDestinationName] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [plannedExitAt, setPlannedExitAt] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [items, setItems] = useState<ExitPassItem[]>([{ ...EMPTY_ITEM }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        purpose_code: department === "IT" ? "wfh_assignment" : "office_setup",
        purpose_details: purposeDetails,
        destination_type: destinationType,
        destination_name: destinationName || null,
        destination_address: destinationAddress || null,
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Raise Exit Pass</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Request Type">
              <select value={department} onChange={(e) => setDepartment(e.target.value as typeof department)} className={INPUT_CLS}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={INPUT_CLS}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
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
              <select value={destinationType} onChange={(e) => setDestinationType(e.target.value)} className={INPUT_CLS}>
                {DESTINATION_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Destination Name">
              <input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} className={INPUT_CLS} placeholder="e.g. Dell Service Centre" />
            </Field>
            <Field label="Destination Address">
              <input value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} className={INPUT_CLS} />
            </Field>
          </div>

          <Field label="Purpose of Movement">
            <textarea value={purposeDetails} onChange={(e) => setPurposeDetails(e.target.value)} rows={2} className={INPUT_CLS} />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Materials</span>
              <button
                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                + Add Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input className={`${INPUT_CLS} col-span-2`} placeholder="Category" value={item.category} onChange={(e) => updateItem(idx, { category: e.target.value })} />
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
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            disabled={submitting}
            onClick={() => void submit()}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{stage === "branch_head" ? "Branch Head Decision" : "Admin Decision"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-slate-600">
            <div><span className="text-slate-400">Requestor:</span> {pass.requestor_name ?? "-"}</div>
            <div><span className="text-slate-400">Purpose:</span> {pass.purpose_details}</div>
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          <Field label="Remarks (required for reject/return)">
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className={INPUT_CLS} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          {stage === "branch_head" && (
            <button
              disabled={!!busy}
              onClick={() => void decide("returned")}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" /> Return
            </button>
          )}
          <button
            disabled={!!busy}
            onClick={() => void decide("rejected")}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" /> Reject
          </button>
          <button
            disabled={!!busy}
            onClick={() => void decide("approved")}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
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

import { useEffect, useState, useCallback } from "react";
import { Package, Plus, Loader, RefreshCcw, X, CheckCircle2, XCircle, Undo2, Send, Printer, AlertTriangle, Ban, ChevronRight, Clock, User, MapPin, Truck, FileText, ClipboardList, Settings, Trash2 } from "lucide-react";
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
  condition_in?: string;
  has_damage?: boolean;
  missing?: boolean;
  remarks?: string;
};

type ExitPassApproval = {
  id: string;
  stage: "branch_head" | "admin";
  approver_name: string;
  decision: string;
  remarks?: string | null;
  decided_at: string;
};

type ExitPassDetail = {
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
  carrier_type?: string;
  carrier_name?: string;
  carrier_mobile?: string;
  carrier_company?: string;
  vehicle_number?: string;
  status: string;
  submitted_at?: string;
  created_at: string;
  exit_verified_at?: string;
  exit_gate?: string;
  items?: ExitPassItem[];
  approvals?: ExitPassApproval[];
  letterhead?: {
    branch_name: string;
    branch_code?: string;
    city?: string;
    state?: string;
    address?: string;
    requestor_name: string;
  } | null;
  is_overdue?: boolean | number;
};

type ExitPass = ExitPassDetail;

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
type BranchHeadAssignment = {
  id: string;
  branch_name: string;
  branch_head_id: string;
  branch_head_name?: string;
  branch_head_code?: string;
  is_active: boolean;
  assigned_at: string;
};

const INPUT_CLS = "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500";

function fmtDate(val?: string | null): string {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtShortDate(val?: string | null): string {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// --- Page ----------------------------------------------------------------

export default function NativeExitPass() {
  const [tab, setTab] = useState<"mine" | "pending_bh" | "pending_admin" | "outside" | "bh_admin">("mine");
  const [passes, setPasses] = useState<ExitPass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [decisionTarget, setDecisionTarget] = useState<{ pass: ExitPass; stage: "branch_head" | "admin" } | null>(null);
  const [detailPassId, setDetailPassId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tab === "bh_admin") return;
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
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {([
            ["mine", "My Requests"],
            ["pending_bh", "Pending Branch Head"],
            ["pending_admin", "Pending Admin"],
            ["outside", "Outside Premises"],
            ["bh_admin", "Branch Head Setup"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                tab === key ? "border-rose-600 text-rose-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {key === "bh_admin" && <Settings className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>

        {tab === "bh_admin" ? (
          <BranchHeadAdmin />
        ) : (
          <>
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
                      <tr
                        key={p.id}
                        onClick={() => setDetailPassId(p.id)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          <span className="flex items-center gap-1">
                            {p.pass_number ?? <span className="text-slate-400">Draft</span>}
                            <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-rose-400 transition-colors" />
                          </span>
                        </td>
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
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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
          </>
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

      {detailPassId && (
        <ExitPassDetailDrawer
          passId={detailPassId}
          onClose={() => setDetailPassId(null)}
        />
      )}
    </DashboardLayout>
  );
}

// --- Detail Drawer -------------------------------------------------------

function ExitPassDetailDrawer({ passId, onClose }: { passId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ExitPassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    hrmsApi.get<{ success: boolean; data: ExitPassDetail; message?: string }>(`/api/exit-passes/${passId}`)
      .then((res) => {
        if (!res?.success) throw new Error(res?.message ?? "Failed to load");
        setDetail(res.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load details"))
      .finally(() => setLoading(false));
  }, [passId]);

  const priorityColor = detail?.priority === "emergency" ? "bg-red-100 text-red-700" :
    detail?.priority === "urgent" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-slate-900/40" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-rose-700 to-orange-600 shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-white/80" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-rose-200">Exit Pass Detail</p>
              <h2 className="text-base font-bold text-white">
                {detail?.pass_number ?? (detail ? "Draft" : "Loading...")}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {detail && (detail.status === "approved" || detail.status === "outside_premises") && (
              <a
                href={`/it-admin/exit-pass/${detail.id}/print`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </a>
            )}
            <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader className="h-5 w-5 animate-spin mr-2" /> Loading details...
            </div>
          )}
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {detail && (
            <>
              {/* Status + meta row */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={normalizeStatus(detail.status)} />
                {!!detail.is_overdue && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-600 text-white">Overdue</span>
                )}
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${priorityColor}`}>
                  {detail.priority} priority
                </span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${detail.request_department === "IT" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                  {detail.request_department}
                </span>
                <span className="ml-auto text-xs text-slate-400">Created {fmtShortDate(detail.created_at)}</span>
              </div>

              {/* Pass Details */}
              <section>
                <SectionLabel icon={<ClipboardList className="h-3.5 w-3.5" />} title="Pass Details" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailRow label="Requestor" value={detail.requestor_name} />
                  <DetailRow label="Branch" value={detail.branch_name} />
                  <DetailRow label="Movement Type" value={detail.movement_type === "returnable" ? "Returnable" : "Non-Returnable"} />
                  <DetailRow label="Reason" value={detail.purpose_code?.replace(/_/g, " ")} />
                  <DetailRow label="Planned Exit" value={fmtDate(detail.planned_exit_at)} />
                  {detail.movement_type === "returnable" && (
                    <DetailRow label="Expected Return" value={fmtDate(detail.expected_return_at)} />
                  )}
                  {detail.submitted_at && <DetailRow label="Submitted At" value={fmtDate(detail.submitted_at)} />}
                  {detail.exit_verified_at && <DetailRow label="Exit Verified At" value={fmtDate(detail.exit_verified_at)} />}
                  {detail.exit_gate && <DetailRow label="Exit Gate" value={detail.exit_gate} />}
                </div>
                <div className="mt-3 text-sm">
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Purpose</span>
                  <p className="text-slate-700 whitespace-pre-wrap">{detail.purpose_details || "—"}</p>
                </div>
              </section>

              {/* Destination */}
              <section>
                <SectionLabel icon={<MapPin className="h-3.5 w-3.5" />} title="Destination" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailRow label="Type" value={detail.destination_type} />
                  <DetailRow label="Name" value={detail.destination_name} />
                  {detail.destination_address && <DetailRow label="Address" value={detail.destination_address} />}
                </div>
              </section>

              {/* Carrier */}
              <section>
                <SectionLabel icon={<Truck className="h-3.5 w-3.5" />} title="Carrier" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailRow label="Carried By" value={detail.carrier_type} />
                  <DetailRow label="Name" value={detail.carrier_name} />
                  <DetailRow label="Mobile" value={detail.carrier_mobile} />
                  {detail.carrier_company && <DetailRow label="Company" value={detail.carrier_company} />}
                  {detail.vehicle_number && <DetailRow label="Vehicle No." value={detail.vehicle_number} />}
                </div>
              </section>

              {/* Items */}
              <section>
                <SectionLabel icon={<Package className="h-3.5 w-3.5" />} title={`Materials / Items (${detail.items?.length ?? 0})`} />
                {!detail.items?.length ? (
                  <p className="text-sm text-slate-400 italic">No items recorded.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide border-b border-slate-100">
                          <th className="text-left font-semibold px-3 py-2">Category</th>
                          <th className="text-left font-semibold px-3 py-2">Item</th>
                          <th className="text-left font-semibold px-3 py-2">Asset ID</th>
                          <th className="text-left font-semibold px-3 py-2">Serial No.</th>
                          <th className="text-left font-semibold px-3 py-2">Make/Model</th>
                          <th className="text-right font-semibold px-3 py-2">Qty</th>
                          <th className="text-left font-semibold px-3 py-2">Unit</th>
                          <th className="text-left font-semibold px-3 py-2">Condition Out</th>
                          {detail.status === "closed" && <th className="text-left font-semibold px-3 py-2">Condition In</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {detail.items.map((item, idx) => (
                          <tr key={item.id ?? idx} className="hover:bg-slate-50/60">
                            <td className="px-3 py-2 text-slate-600">{item.category || "—"}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{item.item_name}</td>
                            <td className="px-3 py-2 font-mono text-slate-500">{item.asset_id || "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-500">{item.serial_number || "—"}</td>
                            <td className="px-3 py-2 text-slate-500">{item.make_model || "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-700 font-semibold">{item.quantity}</td>
                            <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                            <td className="px-3 py-2 text-slate-500">{item.condition_out || "—"}</td>
                            {detail.status === "closed" && (
                              <td className="px-3 py-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.has_damage ? "bg-red-100 text-red-700" : item.missing ? "bg-orange-100 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}>
                                  {item.missing ? "Missing" : item.has_damage ? "Damaged" : (item.condition_in || "OK")}
                                </span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Approval Timeline */}
              <section>
                <SectionLabel icon={<CheckCircle2 className="h-3.5 w-3.5" />} title="Approval Timeline" />
                {!detail.approvals?.length ? (
                  <p className="text-sm text-slate-400 italic">No approval decisions recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.approvals.map((appr) => (
                      <div key={appr.id} className="flex gap-3">
                        <div className={`mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-bold ${appr.decision === "approved" ? "bg-emerald-500" : appr.decision === "rejected" ? "bg-red-500" : "bg-orange-400"}`}>
                          {appr.decision === "approved" ? "✓" : appr.decision === "rejected" ? "✗" : "↩"}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-slate-800">{appr.approver_name}</span>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{appr.stage.replace("_", " ")}</span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${appr.decision === "approved" ? "bg-emerald-50 text-emerald-700" : appr.decision === "rejected" ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"}`}>
                              {appr.decision}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(appr.decided_at)}</p>
                          {appr.remarks && (
                            <p className="mt-1 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                              {appr.remarks}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Documents */}
              <section>
                <SectionLabel icon={<FileText className="h-3.5 w-3.5" />} title="Documents" />
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-slate-200" />
                  <p className="font-medium text-slate-500">No documents attached</p>
                  <p className="text-xs mt-0.5">Gate pass prints are available once the pass is approved.</p>
                  {(detail.status === "approved" || detail.status === "outside_premises") && (
                    <a
                      href={`/it-admin/exit-pass/${detail.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                    >
                      <Printer className="h-3.5 w-3.5" /> Open Printable Gate Pass
                    </a>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-slate-400">{icon}</span>
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-slate-700">{value || "—"}</span>
    </div>
  );
}

// --- Branch Head Admin Tab -----------------------------------------------

function BranchHeadAdmin() {
  const [assignments, setAssignments] = useState<BranchHeadAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BranchHeadAssignment[]; message?: string }>("/api/exit-passes/admin/branch-head-assignments");
      if (!res?.success) throw new Error(res?.message ?? "Failed to load");
      setAssignments(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deactivate = async (id: string, branchName: string) => {
    if (!window.confirm(`Deactivate the Branch Head assignment for "${branchName}"? Exit passes from this branch will be blocked until a new assignment is added.`)) return;
    try {
      await hrmsApi.patch(`/api/exit-passes/admin/branch-head-assignments/${id}/deactivate`);
      setActionMsg("Assignment deactivated.");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-800">Branch Head Assignments</h3>
          <p className="text-xs text-slate-500 mt-0.5">Controls who receives exit pass requests for each branch. Must be set before employees can submit passes.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors"
        >
          <Plus className="h-4 w-4" /> Assign Branch Head
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>Root cause of "No active Branch Head" errors:</strong> This table must have an active row for each branch.
          If a branch shows an error when submitting, add the assignment here with the correct branch name and Branch Head employee.
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {actionMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {actionMsg}
          <button onClick={() => setActionMsg(null)} className="ml-auto cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-rose-200 rounded-2xl bg-rose-50/30">
          <AlertTriangle className="h-10 w-10 text-rose-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">No branch head assignments configured</h3>
          <p className="mt-1 text-sm text-slate-500">All branches are currently blocked from submitting exit passes.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-100">
                <th className="text-left font-semibold px-4 py-3">Branch Name</th>
                <th className="text-left font-semibold px-4 py-3">Branch Head</th>
                <th className="text-left font-semibold px-4 py-3">Employee Code</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-left font-semibold px-4 py-3">Assigned</th>
                <th className="text-right font-semibold px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{a.branch_name}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-slate-300" />
                      {a.branch_head_name ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.branch_head_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${a.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {a.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtShortDate(a.assigned_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {a.is_active && (
                      <button
                        onClick={() => void deactivate(a.id, a.branch_name)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <AssignBranchHeadModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setActionMsg("Branch Head assignment saved."); void load(); }}
        />
      )}
    </div>
  );
}

// --- Assign Branch Head Modal --------------------------------------------

function AssignBranchHeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchName, setBranchName] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeHit[]>([]);
  const [empSearching, setEmpSearching] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [selectedEmpName, setSelectedEmpName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hrmsApi.get<{ data: BranchOption[] }>("/api/org/branches")
      .then((res) => setBranches(res?.data ?? []))
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    if (empSearch.trim().length < 2) { setEmpResults([]); return; }
    const t = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeHit[] }>(`/api/exit-passes/employees/search?q=${encodeURIComponent(empSearch)}`);
        setEmpResults(res?.data ?? []);
      } catch { setEmpResults([]); }
      finally { setEmpSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [empSearch]);

  const pickEmp = (hit: EmployeeHit) => {
    setSelectedEmpId(hit.id);
    setSelectedEmpName(hit.full_name);
    setEmpSearch(`${hit.full_name} (${hit.employee_code})`);
    setEmpResults([]);
  };

  const save = async () => {
    if (!branchName) { setError("Select a branch."); return; }
    if (!selectedEmpId) { setError("Search and select an employee as Branch Head."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; message?: string }>("/api/exit-passes/admin/branch-head-assignments", {
        branch_name: branchName,
        branch_head_id: selectedEmpId,
      });
      if (!res?.success) throw new Error(res?.message ?? "Failed to save");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-rose-600 to-orange-600 rounded-t-2xl">
          <h2 className="text-lg font-bold text-white">Assign Branch Head</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <Field label="Branch">
            <select value={branchName} onChange={(e) => setBranchName(e.target.value)} className={INPUT_CLS}>
              <option value="">Select branch...</option>
              {branches.map((b) => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
            </select>
          </Field>
          <div className="relative">
            <Field label="Branch Head Employee (search by name or code)">
              <input
                value={empSearch}
                onChange={(e) => { setEmpSearch(e.target.value); setSelectedEmpId(""); setSelectedEmpName(""); }}
                className={INPUT_CLS}
                placeholder="Type to search..."
              />
            </Field>
            {empSearching && <div className="absolute right-3 top-9 text-xs text-slate-400">Searching...</div>}
            {empResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {empResults.map((hit) => (
                  <button key={hit.id} type="button" onClick={() => pickEmp(hit)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                    {hit.full_name} <span className="text-slate-400">({hit.employee_code})</span>
                  </button>
                ))}
              </div>
            )}
            {selectedEmpName && (
              <p className="mt-1 text-xs text-emerald-600 font-semibold">Selected: {selectedEmpName}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">Cancel</button>
          <button disabled={submitting} onClick={() => void save()}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer transition-colors">
            {submitting ? "Saving..." : "Save Assignment"}
          </button>
        </div>
      </div>
    </div>
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

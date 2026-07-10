import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Edit2,
  Info, Loader, Plus, RefreshCcw, Shield, ShieldAlert, ShieldCheck,
  User, X, XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PurposeCode = "employment" | "payroll" | "communication" | "lms" | "portal" | "recruitment" | "health";
type PrincipalType = "employee" | "candidate" | "client_user" | "portal_user";
type ConsentChannel = "web" | "api" | "import" | "manual";
type RightsRequestType = "access" | "correction" | "erasure" | "nomination" | "grievance";
type RightsRequestStatus = "pending" | "in_review" | "resolved" | "rejected";
type RetentionAction = "anonymize" | "delete" | "archive" | "notify_admin";

interface DataConsent {
  id: string;
  data_principal_id: string;
  principal_type: PrincipalType;
  purpose_code: PurposeCode;
  consent_text_version: string;
  consent_text_hash: string;
  consented_at: string;
  withdrawn_at: string | null;
  ip_address: string | null;
  channel: ConsentChannel;
}

interface DataRightsRequest {
  id: string;
  principal_id: string;
  principal_type: "employee" | "candidate" | "client_user";
  request_type: RightsRequestType;
  description: string | null;
  field_name: string | null;
  current_value: string | null;
  requested_value: string | null;
  status: RightsRequestStatus;
  assigned_to: string | null;
  resolved_at: string | null;
  response_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RetentionPolicy {
  id: string;
  entity_type: string;
  retention_days: number;
  action_on_expiry: RetentionAction;
  legal_basis: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface DpdpConfigEntry {
  config_key: string;
  config_value: string;
  description: string | null;
  updated_at: string;
}

interface ConsentStatEntry {
  purpose_code: string;
  consented_count: number;
}

type BreachSeverity = "low" | "medium" | "high" | "critical";
type BreachStatus = "detected" | "investigating" | "contained" | "resolved" | "reported";

interface BreachRecord {
  id: string;
  breach_ref: string;
  detected_at: string;
  breach_type: string;
  affected_records_count: number;
  affected_data_types: string | null;
  severity: BreachSeverity;
  description: string;
  immediate_action_taken: string | null;
  notified_authority_at: string | null;
  notified_principals_at: string | null;
  authority_ref: string | null;
  remediation_notes: string | null;
  status: BreachStatus;
  reported_by: string;
  created_at: string;
}

interface BreachLogForm {
  detected_at: string;
  breach_type: string;
  severity: string;
  description: string;
  affected_records_count: string;
  affected_data_types: string[];
  immediate_action_taken: string;
}

interface BreachUpdateForm {
  status: string;
  notified_authority_at: string;
  notified_principals_at: string;
  authority_ref: string;
  remediation_notes: string;
}

const BREACH_TYPES = [
  { value: "unauthorized_access", label: "Unauthorized Access" },
  { value: "data_leak", label: "Data Leak" },
  { value: "system_breach", label: "System Breach" },
  { value: "insider_threat", label: "Insider Threat" },
  { value: "ransomware", label: "Ransomware" },
  { value: "other", label: "Other" },
];

const BREACH_STATUSES: { value: BreachStatus; label: string }[] = [
  { value: "detected", label: "Detected" },
  { value: "investigating", label: "Investigating" },
  { value: "contained", label: "Contained" },
  { value: "resolved", label: "Resolved" },
  { value: "reported", label: "Reported" },
];

const DATA_TYPE_OPTIONS = [
  "name", "email", "mobile", "salary", "aadhaar", "pan", "bank_account", "address", "dob", "other",
];

const SEVERITY_COLORS: Record<BreachSeverity, string> = {
  low:      "bg-slate-100 text-slate-700",
  medium:   "bg-amber-50 text-amber-700",
  high:     "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

const BREACH_STATUS_COLORS: Record<BreachStatus, string> = {
  detected:      "bg-red-50 text-red-700",
  investigating: "bg-amber-50 text-amber-700",
  contained:     "bg-blue-50 text-blue-700",
  resolved:      "bg-emerald-50 text-emerald-700",
  reported:      "bg-slate-100 text-slate-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<PurposeCode, string> = {
  employment: "Employment",
  payroll: "Payroll",
  communication: "Communication",
  lms: "LMS / Training",
  portal: "Client Portal",
  recruitment: "Recruitment",
  health: "Health",
};

const REQUEST_TYPE_LABELS: Record<RightsRequestType, string> = {
  access: "Access My Data",
  correction: "Request Correction",
  erasure: "Request Erasure",
  nomination: "Nomination",
  grievance: "Grievance",
};

const STATUS_COLORS: Record<RightsRequestStatus, string> = {
  pending:   "bg-amber-50 text-amber-700",
  in_review: "bg-violet-50 text-violet-700",
  resolved:  "bg-emerald-50 text-emerald-700",
  rejected:  "bg-red-50 text-red-700",
};

const ACTION_COLORS: Record<RetentionAction, string> = {
  anonymize:    "bg-blue-50 text-blue-700",
  delete:       "bg-red-50 text-red-700",
  archive:      "bg-slate-100 text-slate-700",
  notify_admin: "bg-amber-50 text-amber-700",
};

function StatusBadge({ status }: { status: RightsRequestStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ActionBadge({ action }: { action: RetentionAction }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${ACTION_COLORS[action] ?? "bg-slate-100 text-slate-600"}`}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

function ConsentBadge({ withdrawn }: { withdrawn: string | null }) {
  if (withdrawn) {
    return <span className="rounded-full px-3 py-1 text-xs font-semibold bg-red-50 text-red-700">Withdrawn</span>;
  }
  return <span className="rounded-full px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700">Consented</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeDPDPCompliance() {
  const [activeTab, setActiveTab] = useState<"consent" | "rights" | "retention" | "versions" | "config" | "breach">("consent");
  const [message, setMessage] = useState<{ text: string; type: "info" | "error" }>({ text: "", type: "info" });
  const [breachPendingCount, setBreachPendingCount] = useState(0);

  const showMsg = (text: string, type: "info" | "error" = "info") => setMessage({ text, type });
  const clearMsg = () => setMessage({ text: "", type: "info" });

  const TABS: { id: "consent" | "rights" | "retention" | "versions" | "config" | "breach"; label: string }[] = [
    { id: "consent",   label: "Consent" },
    { id: "rights",    label: "Data Rights" },
    { id: "retention", label: "Retention Policy" },
    { id: "versions",  label: "Consent Texts" },
    { id: "config",    label: "Privacy Config" },
    { id: "breach",    label: "Breach Log" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Compliance</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">DPDP Compliance</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            Manage personal data consents, data principal rights, retention policies, and grievance officer configuration per the Digital Personal Data Protection Act 2023.
          </p>
        </div>

        {message.text && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${
            message.type === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-blue-200 bg-blue-50 text-blue-800"
          }`}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message.text}
            <button onClick={clearMsg} className="ml-auto cursor-pointer text-current opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); clearMsg(); }}
              className={`flex-1 cursor-pointer rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.id === "breach" && breachPendingCount > 0 ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  {tab.label}
                  <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white leading-none">
                    {breachPendingCount}
                  </span>
                </span>
              ) : tab.label}
            </button>
          ))}
        </div>

        {activeTab === "consent"   && <ConsentTab   showMsg={showMsg} />}
        {activeTab === "rights"    && <DataRightsTab showMsg={showMsg} />}
        {activeTab === "retention" && <RetentionTab  showMsg={showMsg} />}
        {activeTab === "versions"  && <ConsentVersionsTab showMsg={showMsg} />}
        {activeTab === "config"    && <PrivacyConfigTab showMsg={showMsg} />}
        {activeTab === "breach"    && <BreachLogTab showMsg={showMsg} onPendingCount={setBreachPendingCount} />}
      </div>
    </DashboardLayout>
  );
}

// ─── Consent Tab ──────────────────────────────────────────────────────────────

function ConsentTab({ showMsg }: { showMsg: (t: string, type?: "info" | "error") => void }) {
  const [myConsents, setMyConsents] = useState<DataConsent[]>([]);
  const [allConsents, setAllConsents] = useState<DataConsent[]>([]);
  const [stats, setStats] = useState<ConsentStatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const myRes = await hrmsApi.get<{ success: boolean; data: DataConsent[] }>("/api/privacy/consent/my-consents");
      setMyConsents(myRes.data ?? []);

      if (adminView) {
        const [allRes, statsRes] = await Promise.all([
          hrmsApi.get<{ success: boolean; data: DataConsent[] }>("/api/privacy/consent/all"),
          hrmsApi.get<{ success: boolean; data: ConsentStatEntry[] }>("/api/privacy/consent/stats"),
        ]);
        setAllConsents(allRes.data ?? []);
        setStats(statsRes.data ?? []);
      }
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to load consents", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [adminView]);

  const withdraw = async (purposeCode: string) => {
    setWithdrawing(purposeCode);
    try {
      await hrmsApi.post("/api/privacy/consent/withdraw", { purpose_code: purposeCode });
      showMsg(`Consent for ${PURPOSE_LABELS[purposeCode as PurposeCode] ?? purposeCode} withdrawn.`);
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Withdrawal failed", "error");
    } finally {
      setWithdrawing(null);
    }
  };

  const ALL_PURPOSES = Object.keys(PURPOSE_LABELS) as PurposeCode[];

  const consentMap = myConsents.reduce<Partial<Record<PurposeCode, DataConsent>>>((acc, c) => {
    if (!acc[c.purpose_code] || (c.withdrawn_at === null && acc[c.purpose_code]!.withdrawn_at !== null)) {
      acc[c.purpose_code] = c;
    }
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* My Consents */}
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="font-black text-slate-950">My Consents</h2>
            <p className="text-sm text-slate-500">Your personal data consent status per purpose</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="divide-y">
            {ALL_PURPOSES.map((p) => {
              const c = consentMap[p];
              const isActive = c != null && c.withdrawn_at === null;
              return (
                <div key={p} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="font-semibold text-slate-950">{PURPOSE_LABELS[p]}</p>
                    {c ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {c.consent_text_version} &middot; {c.consented_at?.slice(0, 10)}
                        {c.withdrawn_at && ` · Withdrawn ${c.withdrawn_at.slice(0, 10)}`}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-slate-400">Not yet consented</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {c ? <ConsentBadge withdrawn={c.withdrawn_at} /> : (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-500">Not given</span>
                    )}
                    {isActive && (
                      <button
                        onClick={() => withdraw(p)}
                        disabled={withdrawing === p}
                        className="cursor-pointer rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                      >
                        {withdrawing === p ? "Withdrawing…" : "Withdraw"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAdminView(!adminView)}
          className={`inline-flex items-center gap-2 cursor-pointer rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors ${
            adminView ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <User className="h-4 w-4" />
          {adminView ? "Hide Admin View" : "Show Admin View"}
        </button>
      </div>

      {adminView && (
        <>
          {/* Coverage stats */}
          <div className="rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Consent Coverage</h2>
              <p className="text-sm text-slate-500">Active consent counts per purpose across all principals</p>
            </div>
            <div className="flex flex-wrap gap-4 p-5">
              {stats.length === 0 ? (
                <p className="text-sm text-slate-400">No consent data available.</p>
              ) : stats.map((s) => (
                <div key={s.purpose_code} className="rounded-2xl border bg-slate-50 px-5 py-4 min-w-[140px]">
                  <p className="text-xs font-bold uppercase text-slate-500">{PURPOSE_LABELS[s.purpose_code as PurposeCode] ?? s.purpose_code}</p>
                  <p className="mt-1 text-3xl font-black text-slate-950">{s.consented_count}</p>
                </div>
              ))}
            </div>
          </div>

          {/* All consents table */}
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">All Consents</h2>
              <p className="text-sm text-slate-500">{allConsents.length} records</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Principal ID", "Type", "Purpose", "Version", "Consented At", "Status", "Channel"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allConsents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-slate-400">No consent records found.</td>
                    </tr>
                  ) : allConsents.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 font-mono text-xs text-slate-600">{c.data_principal_id.slice(0, 16)}…</td>
                      <td className="p-4 capitalize text-slate-600">{c.principal_type}</td>
                      <td className="p-4 font-semibold text-slate-800">{PURPOSE_LABELS[c.purpose_code] ?? c.purpose_code}</td>
                      <td className="p-4 font-mono text-slate-500">{c.consent_text_version}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">{c.consented_at?.slice(0, 10)}</td>
                      <td className="p-4"><ConsentBadge withdrawn={c.withdrawn_at} /></td>
                      <td className="p-4 capitalize text-slate-500">{c.channel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Data Rights Tab ──────────────────────────────────────────────────────────

function DataRightsTab({ showMsg }: { showMsg: (t: string, type?: "info" | "error") => void }) {
  const [myRequests, setMyRequests] = useState<DataRightsRequest[]>([]);
  const [allRequests, setAllRequests] = useState<DataRightsRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [resolveModal, setResolveModal] = useState<{ id: string; type: RightsRequestType } | null>(null);

  const [form, setForm] = useState({
    request_type: "access" as RightsRequestType,
    description: "",
    field_name: "",
    current_value: "",
    requested_value: "",
  });

  const [resolveForm, setResolveForm] = useState({
    status: "resolved" as "in_review" | "resolved" | "rejected",
    response_notes: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const myRes = await hrmsApi.get<{ success: boolean; data: DataRightsRequest[] }>("/api/privacy/rights/my-requests");
      setMyRequests(myRes.data ?? []);
      if (adminView) {
        const allRes = await hrmsApi.get<{ success: boolean; data: DataRightsRequest[] }>("/api/privacy/rights/requests");
        setAllRequests(allRes.data ?? []);
      }
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to load requests", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [adminView]);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (form.request_type === "access") {
        await hrmsApi.post("/api/privacy/rights/access", {});
      } else if (form.request_type === "correction") {
        if (!form.field_name || !form.current_value || !form.requested_value) {
          showMsg("field_name, current_value, and requested_value are required for correction requests.", "error");
          return;
        }
        await hrmsApi.post("/api/privacy/rights/correction", {
          field_name: form.field_name,
          current_value: form.current_value,
          requested_value: form.requested_value,
          description: form.description || undefined,
        });
      } else if (form.request_type === "erasure") {
        await hrmsApi.post("/api/privacy/rights/erasure", { description: form.description });
      }
      showMsg("Request submitted successfully.");
      setForm({ request_type: "access", description: "", field_name: "", current_value: "", requested_value: "" });
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Submission failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const resolve = async () => {
    if (!resolveModal) return;
    try {
      await hrmsApi.patch(`/api/privacy/rights/requests/${resolveModal.id}`, {
        status: resolveForm.status,
        response_notes: resolveForm.response_notes || undefined,
      });
      showMsg("Request updated.");
      setResolveModal(null);
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Update failed", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Submit a request */}
      <div className="rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black text-slate-950">Submit a Request</h2>
          <p className="text-sm text-slate-500">Exercise your data principal rights under DPDP Act 2023</p>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Request Type</label>
            <select
              value={form.request_type}
              onChange={(e) => setForm({ ...form, request_type: e.target.value as RightsRequestType })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors max-w-xs"
            >
              {(["access", "correction", "erasure"] as RightsRequestType[]).map((t) => (
                <option key={t} value={t}>{REQUEST_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {form.request_type === "correction" && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Field Name</label>
                <input
                  value={form.field_name}
                  onChange={(e) => setForm({ ...form, field_name: e.target.value })}
                  placeholder="e.g. date_of_birth"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Current Value</label>
                <input
                  value={form.current_value}
                  onChange={(e) => setForm({ ...form, current_value: e.target.value })}
                  placeholder="Current incorrect value"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Requested Value</label>
                <input
                  value={form.requested_value}
                  onChange={(e) => setForm({ ...form, requested_value: e.target.value })}
                  placeholder="Correct value"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {form.request_type === "access" ? "Additional Notes (optional)" : "Description"}
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Provide additional context or reason…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="cursor-pointer rounded-2xl bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </div>

      {/* My requests */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="font-black text-slate-950">My Requests</h2>
            <p className="text-sm text-slate-500">{myRequests.length} submitted</p>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : myRequests.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No requests submitted yet.</div>
        ) : (
          <div className="divide-y">
            {myRequests.map((r) => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-950">{REQUEST_TYPE_LABELS[r.request_type]}</p>
                    <p className="mt-0.5 text-xs text-slate-400">Submitted {formatISTDate(r.created_at)}</p>
                    {r.description && <p className="mt-1 text-sm text-slate-600">{r.description}</p>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.response_notes && (
                  <div className="mt-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
                    <span className="font-semibold text-slate-700">Response: </span>{r.response_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin view toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAdminView(!adminView)}
          className={`inline-flex items-center gap-2 cursor-pointer rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors ${
            adminView ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Shield className="h-4 w-4" />
          {adminView ? "Hide Admin View" : "Admin: All Requests"}
        </button>
      </div>

      {adminView && (
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">All Data Rights Requests</h2>
            <p className="text-sm text-slate-500">{allRequests.length} total</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Principal", "Type", "Status", "Assigned To", "Submitted", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">No requests found.</td>
                  </tr>
                ) : allRequests.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-xs text-slate-600">{r.principal_id.slice(0, 16)}…</td>
                    <td className="p-4 font-semibold text-slate-800">{REQUEST_TYPE_LABELS[r.request_type]}</td>
                    <td className="p-4"><StatusBadge status={r.status} /></td>
                    <td className="p-4 font-mono text-xs text-slate-500">{r.assigned_to ? r.assigned_to.slice(0, 12) + "…" : "—"}</td>
                    <td className="p-4 font-mono text-xs text-slate-400">{formatISTDate(r.created_at)}</td>
                    <td className="p-4">
                      {r.status !== "resolved" && r.status !== "rejected" && (
                        <button
                          onClick={() => {
                            setResolveModal({ id: r.id, type: r.request_type });
                            setResolveForm({ status: "resolved", response_notes: "" });
                          }}
                          className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Update Request</h2>
              <button onClick={() => setResolveModal(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                <select
                  value={resolveForm.status}
                  onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value as "in_review" | "resolved" | "rejected" })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Response Notes</label>
                <textarea
                  value={resolveForm.response_notes}
                  onChange={(e) => setResolveForm({ ...resolveForm, response_notes: e.target.value })}
                  placeholder="Explain action taken or reason for rejection…"
                  rows={4}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setResolveModal(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void resolve()}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Retention Policy Tab ─────────────────────────────────────────────────────

function RetentionTab({ showMsg }: { showMsg: (t: string, type?: "info" | "error") => void }) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModal, setEditModal] = useState<RetentionPolicy | null>(null);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    retention_days: 0,
    action_on_expiry: "archive" as RetentionAction,
    legal_basis: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: RetentionPolicy[] }>("/api/privacy/retention/policies");
      setPolicies(res.data ?? []);
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to load policies", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openEdit = (p: RetentionPolicy) => {
    setEditModal(p);
    setEditForm({
      retention_days: p.retention_days,
      action_on_expiry: p.action_on_expiry,
      legal_basis: p.legal_basis ?? "",
    });
  };

  const save = async () => {
    if (!editModal) return;
    setSaving(true);
    try {
      await hrmsApi.put(`/api/privacy/retention/policies/${encodeURIComponent(editModal.entity_type)}`, {
        retention_days: Number(editForm.retention_days),
        action_on_expiry: editForm.action_on_expiry,
        legal_basis: editForm.legal_basis || undefined,
      });
      showMsg("Retention policy updated.");
      setEditModal(null);
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: RetentionPolicy) => {
    try {
      await hrmsApi.put(`/api/privacy/retention/policies/${encodeURIComponent(p.entity_type)}`, {
        is_active: p.is_active ? 0 : 1,
      });
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Update failed", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <p>
          These policies determine how long personal data is retained per Indian law. Consult a legal advisor before making changes to retention periods or expiry actions.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="font-black text-slate-950">Retention Policies</h2>
            <p className="text-sm text-slate-500">{policies.length} configured</p>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Entity Type", "Retention", "Action on Expiry", "Legal Basis", "Active", "Edit"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-semibold text-slate-950">{p.entity_type}</td>
                    <td className="p-4 text-slate-700">
                      {p.retention_days >= 365
                        ? `${Math.round(p.retention_days / 365)} yr${Math.round(p.retention_days / 365) !== 1 ? "s" : ""}`
                        : `${p.retention_days} day${p.retention_days !== 1 ? "s" : ""}`}
                    </td>
                    <td className="p-4"><ActionBadge action={p.action_on_expiry} /></td>
                    <td className="p-4 text-xs text-slate-500 max-w-[260px] truncate" title={p.legal_basis ?? undefined}>
                      {p.legal_basis ?? "—"}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => void toggleActive(p)}
                        className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${
                          p.is_active ? "bg-emerald-500" : "bg-slate-200"
                        }`}
                        aria-label={p.is_active ? "Active" : "Inactive"}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          p.is_active ? "translate-x-6" : "translate-x-1"
                        }`} />
                      </button>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => openEdit(p)}
                        className="cursor-pointer rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                        aria-label="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Edit Retention Policy</h2>
                <p className="text-sm text-slate-500 font-mono">{editModal.entity_type}</p>
              </div>
              <button onClick={() => setEditModal(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Retention Days</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.retention_days}
                    onChange={(e) => setEditForm({ ...editForm, retention_days: Number(e.target.value) })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action on Expiry</label>
                  <select
                    value={editForm.action_on_expiry}
                    onChange={(e) => setEditForm({ ...editForm, action_on_expiry: e.target.value as RetentionAction })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    {(["anonymize", "delete", "archive", "notify_admin"] as RetentionAction[]).map((a) => (
                      <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Legal Basis</label>
                <textarea
                  value={editForm.legal_basis}
                  onChange={(e) => setEditForm({ ...editForm, legal_basis: e.target.value })}
                  placeholder="Indian law reference (e.g. DPDP Act 2023, Labour Law…)"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Breach Log Tab ───────────────────────────────────────────────────────────

function BreachLogTab({
  showMsg,
  onPendingCount,
}: {
  showMsg: (t: string, type?: "info" | "error") => void;
  onPendingCount: (n: number) => void;
}) {
  const [breaches, setBreaches] = useState<BreachRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<BreachRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [logForm, setLogForm] = useState<BreachLogForm>({
    detected_at: "",
    breach_type: "other",
    severity: "medium",
    description: "",
    affected_records_count: "0",
    affected_data_types: [],
    immediate_action_taken: "",
  });

  const [updateForm, setUpdateForm] = useState<BreachUpdateForm>({
    status: "detected",
    notified_authority_at: "",
    notified_principals_at: "",
    authority_ref: "",
    remediation_notes: "",
  });

  const hoursAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60));
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BreachRecord[] }>("/api/privacy/breaches");
      const data = res.data ?? [];
      setBreaches(data);
      const pending = data.filter((b) => !b.notified_authority_at && hoursAgo(b.detected_at) <= 72).length;
      onPendingCount(pending);
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to load breach log", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggleDataType = (type: string) => {
    setLogForm((prev) => ({
      ...prev,
      affected_data_types: prev.affected_data_types.includes(type)
        ? prev.affected_data_types.filter((t) => t !== type)
        : [...prev.affected_data_types, type],
    }));
  };

  const submitLog = async () => {
    if (!logForm.detected_at || !logForm.description.trim()) {
      showMsg("Detected at date and description are required.", "error");
      return;
    }
    setSubmitting(true);
    try {
      await hrmsApi.post("/api/privacy/breaches", {
        detected_at: logForm.detected_at,
        breach_type: logForm.breach_type,
        severity: logForm.severity,
        description: logForm.description,
        affected_records_count: parseInt(logForm.affected_records_count, 10) || 0,
        affected_data_types: logForm.affected_data_types,
        immediate_action_taken: logForm.immediate_action_taken || null,
      });
      setShowLogModal(false);
      setLogForm({
        detected_at: "",
        breach_type: "other",
        severity: "medium",
        description: "",
        affected_records_count: "0",
        affected_data_types: [],
        immediate_action_taken: "",
      });
      showMsg("Breach logged successfully.");
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to log breach", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const openUpdate = (b: BreachRecord) => {
    setUpdateTarget(b);
    setUpdateForm({
      status: b.status,
      notified_authority_at: b.notified_authority_at?.slice(0, 16) ?? "",
      notified_principals_at: b.notified_principals_at?.slice(0, 16) ?? "",
      authority_ref: b.authority_ref ?? "",
      remediation_notes: b.remediation_notes ?? "",
    });
  };

  const submitUpdate = async () => {
    if (!updateTarget) return;
    setSubmitting(true);
    try {
      await hrmsApi.patch(`/api/privacy/breaches/${updateTarget.id}`, {
        status: updateForm.status || null,
        notified_authority_at: updateForm.notified_authority_at || null,
        notified_principals_at: updateForm.notified_principals_at || null,
        authority_ref: updateForm.authority_ref || null,
        remediation_notes: updateForm.remediation_notes || null,
      });
      setUpdateTarget(null);
      showMsg("Breach record updated.");
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to update breach", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingAlerts = breaches.filter((b) => !b.notified_authority_at && hoursAgo(b.detected_at) <= 72);
  const stats = {
    total: breaches.length,
    criticalHigh: breaches.filter((b) => b.severity === "critical" || b.severity === "high").length,
    pendingNotification: breaches.filter((b) => !b.notified_authority_at).length,
    resolved: breaches.filter((b) => b.status === "resolved" || b.status === "reported").length,
  };

  return (
    <div className="space-y-6">
      {/* 72-hour DPDP notification alerts */}
      {pendingAlerts.map((b) => (
        <div key={b.id} className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
          <p className="text-sm font-semibold text-red-800">
            DPDP Alert: Breach <span className="font-black">{b.breach_ref}</span> detected{" "}
            {hoursAgo(b.detected_at)} hours ago — authority notification required within 72 hours.
          </p>
        </div>
      ))}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Total Breaches</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{stats.total}</p>
        </div>
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Critical / High</p>
          <p className="mt-2 text-3xl font-black text-red-700">{stats.criticalHigh}</p>
        </div>
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Pending Notification</p>
          <p className="mt-2 text-3xl font-black text-amber-700">{stats.pendingNotification}</p>
        </div>
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Resolved</p>
          <p className="mt-2 text-3xl font-black text-emerald-700">{stats.resolved}</p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="font-black text-slate-950">Breach Incidents</h2>
            <p className="text-sm text-slate-500">{breaches.length} records</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowLogModal(true)}
              className="inline-flex items-center gap-2 cursor-pointer rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Log Breach
            </button>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Ref", "Detected", "Type", "Severity", "Records", "Status", "Authority Notified", "Actions"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breaches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-slate-400">No breach incidents recorded.</td>
                  </tr>
                ) : breaches.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-xs font-black text-slate-700">{b.breach_ref}</td>
                    <td className="p-4 font-mono text-xs text-slate-500">{b.detected_at?.slice(0, 10)}</td>
                    <td className="p-4">
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 capitalize">
                        {b.breach_type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${SEVERITY_COLORS[b.severity] ?? "bg-slate-100 text-slate-600"}`}>
                        {b.severity}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-slate-600">{b.affected_records_count.toLocaleString()}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${BREACH_STATUS_COLORS[b.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-500">
                      {b.notified_authority_at
                        ? b.notified_authority_at.slice(0, 10)
                        : <span className="font-bold text-amber-600">Pending</span>}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => openUpdate(b)}
                        className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        Update
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Breach Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Log Data Breach</h2>
              <button onClick={() => setShowLogModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Detected At</label>
                  <input
                    type="datetime-local"
                    value={logForm.detected_at}
                    onChange={(e) => setLogForm({ ...logForm, detected_at: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Breach Type</label>
                  <select
                    value={logForm.breach_type}
                    onChange={(e) => setLogForm({ ...logForm, breach_type: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    {BREACH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Severity</label>
                  <select
                    value={logForm.severity}
                    onChange={(e) => setLogForm({ ...logForm, severity: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    {(["low", "medium", "high", "critical"] as BreachSeverity[]).map((s) => (
                      <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Affected Records</label>
                  <input
                    type="number"
                    min="0"
                    value={logForm.affected_records_count}
                    onChange={(e) => setLogForm({ ...logForm, affected_records_count: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={logForm.description}
                  onChange={(e) => setLogForm({ ...logForm, description: e.target.value })}
                  rows={3}
                  placeholder="Describe what happened…"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Affected Data Types</label>
                <div className="flex flex-wrap gap-2">
                  {DATA_TYPE_OPTIONS.map((type) => (
                    <label
                      key={type}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={logForm.affected_data_types.includes(type)}
                        onChange={() => toggleDataType(type)}
                        className="h-3.5 w-3.5"
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Immediate Action Taken</label>
                <textarea
                  value={logForm.immediate_action_taken}
                  onChange={(e) => setLogForm({ ...logForm, immediate_action_taken: e.target.value })}
                  rows={2}
                  placeholder="Steps taken immediately after detection…"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowLogModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >Cancel</button>
              <button
                onClick={() => void submitLog()}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >{submitting ? "Logging…" : "Log Breach"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Update Modal */}
      {updateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Update Breach</h2>
                <p className="text-xs font-mono text-slate-400">{updateTarget.breach_ref}</p>
              </div>
              <button onClick={() => setUpdateTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                <select
                  value={updateForm.status}
                  onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  {BREACH_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Authority Notified At</label>
                  <input
                    type="datetime-local"
                    value={updateForm.notified_authority_at}
                    onChange={(e) => setUpdateForm({ ...updateForm, notified_authority_at: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Principals Notified At</label>
                  <input
                    type="datetime-local"
                    value={updateForm.notified_principals_at}
                    onChange={(e) => setUpdateForm({ ...updateForm, notified_principals_at: e.target.value })}
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Authority Reference No.</label>
                <input
                  value={updateForm.authority_ref}
                  onChange={(e) => setUpdateForm({ ...updateForm, authority_ref: e.target.value })}
                  placeholder="Reference from CERT-In / DPDP Authority"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remediation Notes</label>
                <textarea
                  value={updateForm.remediation_notes}
                  onChange={(e) => setUpdateForm({ ...updateForm, remediation_notes: e.target.value })}
                  rows={3}
                  placeholder="Steps taken to remediate and prevent recurrence…"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setUpdateTarget(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >Cancel</button>
              <button
                onClick={() => void submitUpdate()}
                disabled={submitting}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >{submitting ? "Saving…" : "Save Update"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Privacy Config Tab ───────────────────────────────────────────────────────

function PrivacyConfigTab({ showMsg }: { showMsg: (t: string, type?: "info" | "error") => void }) {
  const [config, setConfig] = useState<DpdpConfigEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DpdpConfigEntry[] }>("/api/privacy/config");
      setConfig(res.data ?? []);
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Failed to load config", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const val = (key: string) => config.find((c) => c.config_key === key)?.config_value ?? "";

  const save = async () => {
    if (!editingKey) return;
    setSaving(true);
    try {
      await hrmsApi.put(`/api/privacy/config/${encodeURIComponent(editingKey)}`, { config_value: editValue });
      showMsg("Config updated.");
      setEditingKey(null);
      await load();
    } catch (err: unknown) {
      showMsg((err as Error)?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (key: string) => {
    setEditingKey(key);
    setEditValue(val(key));
  };

  // Compliance checklist logic
  const officerName = val("grievance_officer_name");
  const policyUrl = val("privacy_policy_url");
  const officerDesignated = officerName !== "" && officerName !== "To be configured";
  const policyPublished = policyUrl !== "" && policyUrl !== "/privacy-policy";

  const checks: { label: string; pass: boolean }[] = [
    { label: "Grievance Officer designated", pass: officerDesignated },
    { label: "Privacy Policy published", pass: policyPublished },
    { label: "Consent mechanism available", pass: true },
    { label: "Retention policies configured", pass: true },
    { label: "Data Rights mechanism available", pass: true },
  ];

  const ConfigCard = ({
    title, keys,
  }: {
    title: string;
    keys: string[];
  }) => (
    <div className="rounded-3xl border bg-white shadow-sm">
      <div className="border-b p-5">
        <h3 className="font-black text-slate-950">{title}</h3>
      </div>
      <div className="divide-y">
        {keys.map((key) => {
          const entry = config.find((c) => c.config_key === key);
          return (
            <div key={key} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase text-slate-500 mb-0.5">{entry?.description ?? key}</p>
                {editingKey === key ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                    />
                    <button
                      onClick={() => void save()}
                      disabled={saving}
                      className="cursor-pointer rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {saving ? "…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-800 break-all">{entry?.config_value ?? "—"}</p>
                )}
              </div>
              {editingKey !== key && (
                <button
                  onClick={() => startEdit(key)}
                  className="cursor-pointer flex-shrink-0 rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                  aria-label="Edit"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <ConfigCard
              title="Grievance Officer"
              keys={[
                "grievance_officer_name",
                "grievance_officer_email",
                "grievance_officer_designation",
                "grievance_response_sla_days",
              ]}
            />
            <ConfigCard
              title="Data Fiduciary"
              keys={["data_fiduciary_name"]}
            />
          </div>

          <div className="space-y-6">
            <ConfigCard
              title="Privacy Policy"
              keys={["privacy_policy_version", "privacy_policy_url"]}
            />

            {/* Compliance Checklist */}
            <div className="rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h3 className="font-black text-slate-950">DPDP Compliance Checklist</h3>
                <p className="text-sm text-slate-500">Key requirements under the Digital Personal Data Protection Act 2023</p>
              </div>
              <div className="divide-y">
                {checks.map((c) => (
                  <div key={c.label} className="flex items-center gap-3 px-5 py-4">
                    {c.pass ? (
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
                    )}
                    <span className={`text-sm font-semibold ${c.pass ? "text-slate-800" : "text-slate-500"}`}>
                      {c.label}
                    </span>
                    {!c.pass && (
                      <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                        Action needed
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t p-5">
                <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
                  checks.every((c) => c.pass)
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800"
                }`}>
                  {checks.every((c) => c.pass) ? (
                    <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 flex-shrink-0" />
                  )}
                  <p className="text-sm font-bold">
                    {checks.filter((c) => c.pass).length}/{checks.length} requirements met
                    {checks.every((c) => c.pass)
                      ? " — Fully compliant"
                      : " — Complete remaining items to achieve compliance"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Consent Versions Tab ─────────────────────────────────────────────────────

interface ConsentVersion {
  id: string;
  version_code: string;
  purpose_code: string;
  title: string;
  consent_text: string;
  text_hash: string;
  language: string;
  status: "draft" | "legal_review" | "approved" | "active" | "superseded";
  legal_reviewed_by: string | null;
  legal_reviewed_at: string | null;
  activated_at: string | null;
  created_at: string;
}

const CONSENT_VERSION_COLORS: Record<ConsentVersion["status"], string> = {
  draft:        "bg-slate-100 text-slate-600",
  legal_review: "bg-amber-100 text-amber-700",
  approved:     "bg-blue-100 text-blue-700",
  active:       "bg-green-100 text-green-700",
  superseded:   "bg-slate-100 text-slate-400",
};

const PURPOSES = ["employment", "recruitment", "payroll", "communication", "lms", "health", "portal"] as const;

function ConsentVersionsTab({ showMsg }: { showMsg: (t: string, type?: "info" | "error") => void }) {
  const [versions, setVersions] = useState<ConsentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ id: string } | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [confirmActivate, setConfirmActivate] = useState<{ id: string; version_code: string; purpose: string } | null>(null);
  const [form, setForm] = useState({ version_code: "", purpose_code: "employment", title: "", consent_text: "", language: "en" });

  const load = () => {
    setLoading(true);
    hrmsApi.get<{ data: ConsentVersion[] }>("/api/privacy/consent-versions")
      .then(r => setVersions(r.data ?? []))
      .catch(() => showMsg("Failed to load consent versions", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const grouped = PURPOSES.reduce<Record<string, ConsentVersion[]>>((acc, p) => {
    acc[p] = versions.filter(v => v.purpose_code === p);
    return acc;
  }, {});

  const handleCreate = async () => {
    if (!form.version_code || !form.title || !form.consent_text) { showMsg("All fields required", "error"); return; }
    try {
      await hrmsApi.post("/api/privacy/consent-versions", form);
      showMsg("Draft created"); setShowCreate(false); setForm({ version_code: "", purpose_code: "employment", title: "", consent_text: "", language: "en" }); load();
    } catch { showMsg("Create failed", "error"); }
  };

  const handleReview = async () => {
    if (!reviewerName.trim()) { showMsg("Reviewer name required", "error"); return; }
    try {
      await hrmsApi.patch(`/api/privacy/consent-versions/${reviewModal!.id}/review`, { legal_reviewed_by: reviewerName });
      showMsg("Submitted for legal review"); setReviewModal(null); setReviewerName(""); load();
    } catch { showMsg("Failed", "error"); }
  };

  const handleApprove = async (id: string) => {
    try { await hrmsApi.patch(`/api/privacy/consent-versions/${id}/approve`, {}); showMsg("Approved"); load(); }
    catch { showMsg("Approve failed", "error"); }
  };

  const handleActivate = async () => {
    try {
      await hrmsApi.patch(`/api/privacy/consent-versions/${confirmActivate!.id}/activate`, {});
      showMsg(`Version ${confirmActivate!.version_code} activated for ${confirmActivate!.purpose}`);
      setConfirmActivate(null); load();
    } catch { showMsg("Activate failed", "error"); }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ⚠️ All consent texts must be reviewed by qualified legal counsel before activation. Activated versions cannot be edited — create a new version to make changes.
      </div>
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">+ Create New Version</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        PURPOSES.map(purpose => {
          const pvs = grouped[purpose] ?? [];
          if (!pvs.length) return null;
          const active = pvs.find(v => v.status === "active");
          return (
            <div key={purpose} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-950 capitalize">{purpose}</h3>
                {active && <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">Active: {active.version_code} ✓</span>}
              </div>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-slate-500 uppercase"><th className="py-2 text-left">Version</th><th className="py-2 text-left">Title</th><th className="py-2 text-left">Status</th><th className="py-2 text-left">Reviewed By</th><th className="py-2 text-left">Actions</th></tr></thead>
                <tbody>
                  {pvs.map(v => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">{v.version_code}</td>
                      <td className="py-2 max-w-xs truncate">{v.title}</td>
                      <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CONSENT_VERSION_COLORS[v.status]}`}>{v.status.replace("_", " ")}</span></td>
                      <td className="py-2 text-slate-600">{v.legal_reviewed_by ?? "—"}</td>
                      <td className="py-2 flex gap-2">
                        {v.status === "draft" && <button onClick={() => { setReviewModal({ id: v.id }); }} className="text-xs underline text-amber-700">Submit for Review</button>}
                        {v.status === "legal_review" && <button onClick={() => handleApprove(v.id)} className="text-xs underline text-blue-700">Mark Approved</button>}
                        {v.status === "approved" && <button onClick={() => setConfirmActivate({ id: v.id, version_code: v.version_code, purpose })} className="text-xs underline text-green-700">Activate</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-black">Create New Consent Version</h2>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Version code (e.g. v1.1)" value={form.version_code} onChange={e => setForm(f => ({ ...f, version_code: e.target.value }))} />
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={form.purpose_code} onChange={e => setForm(f => ({ ...f, purpose_code: e.target.value }))}>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea rows={5} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Consent text (full legal text)" value={form.consent_text} onChange={e => setForm(f => ({ ...f, consent_text: e.target.value }))} />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Create Draft</button>
            </div>
          </div>
        </div>
      )}

      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-black">Submit for Legal Review</h2>
            <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Legal counsel name" value={reviewerName} onChange={e => setReviewerName(e.target.value)} />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setReviewModal(null); setReviewerName(""); }} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleReview} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Submit</button>
            </div>
          </div>
        </div>
      )}

      {confirmActivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-black text-green-700">Activate Consent Version</h2>
            <p className="text-sm text-slate-700">This will activate <strong>{confirmActivate.version_code}</strong> for <strong>{confirmActivate.purpose}</strong> and supersede the current active version. This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmActivate(null)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleActivate} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white">Confirm Activate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

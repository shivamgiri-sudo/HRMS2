import { useCallback, useEffect, useState } from "react";
import {
  Award,
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  X,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR, useWorkforceAccess } from "@/hooks/useUserRole";
import { formatIST } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProgressStatus = "not_started" | "in_progress" | "completed" | "failed";
type CertStatus = "active" | "expired" | "revoked";
type SyncStatus = "success" | "partial" | "failed";

interface LearningProgress {
  id: string;
  employee_id: string;
  lms_learner_id: string;
  course_id: string | null;
  course_name: string | null;
  completion_pct: number;
  score: number | null;
  status: ProgressStatus;
  last_accessed: string | null;
  synced_at: string;
}

interface Certification {
  id: string;
  employee_id: string;
  certification_name: string;
  issued_date: string | null;
  expiry_date: string | null;
  status: CertStatus;
  synced_at: string;
}

interface EmployeeMapping {
  id: string;
  employee_id: string;
  lms_learner_id: string;
  email: string | null;
  mapped_at: string;
  is_active: number;
  full_name: string | null;
  employee_code: string | null;
  mapping_source?: string | null;
  mapping_confidence?: string | null;
}

interface SyncLogEntry {
  id: string;
  sync_type: string;
  records_synced: number;
  errors_count: number;
  status: SyncStatus;
  initiated_by: string | null;
  created_at: string;
}

interface BatchPlannerSummary {
  total_batches: number;
  active_batches: number;
  selected_candidates: number;
  confirmed_onboarded: number;
  lms_provisioned: number;
  ready_for_training: number;
  batch_assigned: number;
  open_slots: number;
  overbooked: number;
  average_fill_pct: number;
  filling_batches: number;
}

interface BatchPlannerBatch {
  batch_no: string;
  batch_name: string;
  batch_type: string | null;
  branch: string | null;
  process: string | null;
  lob: string | null;
  classroom_id: string | null;
  classroom_name: string | null;
  batch_status: string | null;
  start_date: string | null;
  end_date: string | null;
  expected_trainees: number;
  total_trainees: number;
  trainee_count: number;
  confirmed_onboarded_count: number;
  lms_ready_count: number;
  ojt_ready_count: number;
  handover_to_ops_count: number;
  certified_count: number;
  fill_pct: number;
  remaining_slots: number;
  overbooked: number;
  fill_state: string;
  created_at: string | null;
  last_updated_at: string | null;
}

interface BatchPlannerCandidate {
  candidate_id: string;
  candidate_code: string | null;
  full_name: string | null;
  branch_name: string | null;
  process_name: string | null;
  current_stage: string | null;
  profile_status: string | null;
  employee_code: string | null;
  employee_name: string | null;
  employee_id: string | null;
  lms_learner_id: string | null;
  batch_no: string | null;
  batch_status: string | null;
  onboarding_status: string | null;
  course_completion_pct: number | null;
  attendance_pct: number | null;
  certification_status: string | null;
  risk_status: string | null;
  confirmed_onboarded: boolean;
  lms_provisioned: boolean;
  batch_assigned: boolean;
  ready_for_training: boolean;
  readiness_state: string;
  suggested_batch_no: string | null;
  suggested_batch_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface BatchPlannerData {
  summary: BatchPlannerSummary;
  batches: BatchPlannerBatch[];
  candidates: BatchPlannerCandidate[];
}

interface ApiList<T> {
  success: boolean;
  data: T[];
}

interface LmsConnectionStatus {
  ok: boolean;
  source?: string;
  latency_ms?: number;
  error?: string;
  can_write_sessions?: boolean;
  can_update_lms?: boolean;
}

interface LmsSyncResult {
  mapped: number;
  progress: number;
  certifications: number;
  errors: string[];
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

const PROGRESS_COLORS: Record<ProgressStatus, string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress:  "bg-blue-50 text-blue-700",
  completed:    "bg-emerald-50 text-emerald-700",
  failed:       "bg-red-50 text-red-700",
};

const CERT_COLORS: Record<CertStatus, string> = {
  active:  "bg-emerald-50 text-emerald-700",
  expired: "bg-amber-50 text-amber-700",
  revoked: "bg-red-50 text-red-700",
};

const SYNC_COLORS: Record<SyncStatus, string> = {
  success: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  failed:  "bg-red-50 text-red-700",
};

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ── Progress Bar ───────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-600">{clamped.toFixed(0)}%</span>
    </div>
  );
}

// ── Tab definitions ────────────────────────────────────────────────────────────

type Tab = "learning" | "batch-planner" | "mapping" | "sync-log";

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeLMSIntegration() {
  const navigate = useNavigate();
  const { isAdminOrHR } = useIsAdminOrHR();
  const { employeeId } = useWorkforceAccess();

  const [activeTab, setActiveTab] = useState<Tab>("learning");
  const [message, setMessage] = useState("");

  // Tab 1 — My Learning
  const [progress, setProgress]         = useState<LearningProgress[]>([]);
  const [certs, setCerts]               = useState<Certification[]>([]);
  const [loadingLearning, setLoadingLearning] = useState(false);

  // Tab 2 — Employee Mapping
  const [mappings, setMappings]         = useState<EmployeeMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [mappingForm, setMappingForm]   = useState({ employee_id: "", lms_learner_id: "", email: "" });
  const [savingMapping, setSavingMapping] = useState(false);

  // Tab 3 — Sync Log
  const [syncLog, setSyncLog]           = useState<SyncLogEntry[]>([]);
  const [loadingSyncLog, setLoadingSyncLog] = useState(false);

  // Tab 4 — Batch Planner
  const [batchPlanner, setBatchPlanner] = useState<BatchPlannerData | null>(null);
  const [loadingBatchPlanner, setLoadingBatchPlanner] = useState(false);

  // ── Connection & Sync Control ─────────────────────────────────────────────
  const [connStatus, setConnStatus] = useState<LmsConnectionStatus | null>(null);
  const [checkingConn, setCheckingConn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<LmsSyncResult | null>(null);

  // ── Credentials Form ───────────────────────────────────────────────────────
  const [showCredForm, setShowCredForm] = useState(false);
  const [credForm, setCredForm] = useState({
    host: "",
    port: "3306",
    database: "mcn_lms",
    username: "",
    password: "",
    write_host: "",
    write_port: "3306",
    write_database: "mcn_lms",
    write_username: "",
    write_password: "",
  });
  const [savingCreds, setSavingCreds] = useState(false);

  const checkConnection = async () => {
    setCheckingConn(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LmsConnectionStatus }>("/api/lms/connection");
      setConnStatus(res.data);
    } catch (err) {
      setConnStatus({ ok: false, error: (err as Error).message });
    } finally {
      setCheckingConn(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: LmsSyncResult }>("/api/lms/sync", {});
      setSyncResult(res.data);
      await loadSyncLog();
    } catch (err) {
      setMessage((err as Error).message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const saveCreds = async () => {
    if (!credForm.host || !credForm.database || !credForm.username || !credForm.password) {
      setMessage("Host, database, username and password are required.");
      return;
    }
    setSavingCreds(true);
    try {
      await hrmsApi.post("/api/lms/config", {
        host: credForm.host.trim(),
        port: Number(credForm.port) || 3306,
        database: credForm.database.trim(),
        username: credForm.username.trim(),
        password: credForm.password,
        write_host: credForm.write_host.trim() || undefined,
        write_port: Number(credForm.write_port) || undefined,
        write_database: credForm.write_database.trim() || undefined,
        write_username: credForm.write_username.trim() || undefined,
        write_password: credForm.write_password || undefined,
        db_type: "mysql",
      });
      setShowCredForm(false);
      setMessage("LMS credentials saved.");
      await checkConnection();
    } catch (err) {
      setMessage((err as Error).message || "Failed to save credentials.");
    } finally {
      setSavingCreds(false);
    }
  };

  useEffect(() => {
    if (isAdminOrHR) void checkConnection();
  }, [isAdminOrHR]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadLearning = useCallback(async () => {
    if (!employeeId) return;
    setLoadingLearning(true);
    setMessage("");
    try {
      const [progRes, certRes] = await Promise.all([
        hrmsApi.get<ApiList<LearningProgress>>(`/api/lms/progress/${employeeId}`),
        hrmsApi.get<ApiList<Certification>>(`/api/lms/certifications/${employeeId}`),
      ]);
      setProgress(progRes.data ?? []);
      setCerts(certRes.data ?? []);
    } catch (err) {
      setMessage((err as Error).message || "Failed to load learning data.");
    } finally {
      setLoadingLearning(false);
    }
  }, [employeeId]);

  const loadMappings = useCallback(async () => {
    setLoadingMappings(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<ApiList<EmployeeMapping>>("/api/lms/mapping");
      setMappings(res.data ?? []);
    } catch (err) {
      setMessage((err as Error).message || "Failed to load mappings.");
    } finally {
      setLoadingMappings(false);
    }
  }, []);

  const loadSyncLog = useCallback(async () => {
    setLoadingSyncLog(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<ApiList<SyncLogEntry>>("/api/lms/sync-log");
      setSyncLog(res.data ?? []);
    } catch (err) {
      setMessage((err as Error).message || "Failed to load sync log.");
    } finally {
      setLoadingSyncLog(false);
    }
  }, []);

  const loadBatchPlanner = useCallback(async () => {
    setLoadingBatchPlanner(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BatchPlannerData }>("/api/lms/batch-planner");
      setBatchPlanner(res.data ?? null);
    } catch (err) {
      setMessage((err as Error).message || "Failed to load batch planner.");
    } finally {
      setLoadingBatchPlanner(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "learning")   void loadLearning();
    if (activeTab === "batch-planner") void loadBatchPlanner();
    if (activeTab === "mapping")    void loadMappings();
    if (activeTab === "sync-log")   void loadSyncLog();
  }, [activeTab, loadBatchPlanner, loadLearning, loadMappings, loadSyncLog]);

  // ── Add Mapping ────────────────────────────────────────────────────────────

  const submitMapping = async () => {
    if (!mappingForm.employee_id.trim() || !mappingForm.lms_learner_id.trim()) {
      setMessage("Employee ID and LMS Learner ID are required.");
      return;
    }
    setSavingMapping(true);
    try {
      await hrmsApi.post("/api/lms/mapping", {
        employee_id:    mappingForm.employee_id.trim(),
        lms_learner_id: mappingForm.lms_learner_id.trim(),
        email:          mappingForm.email.trim() || undefined,
      });
      setShowAddModal(false);
      setMappingForm({ employee_id: "", lms_learner_id: "", email: "" });
      setMessage("Mapping saved.");
      await loadMappings();
    } catch (err) {
      setMessage((err as Error).message || "Failed to save mapping.");
    } finally {
      setSavingMapping(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; adminOnly: boolean }[] = [
    { id: "learning",  label: "My Learning",       adminOnly: false },
    { id: "batch-planner", label: "Batch Planner", adminOnly: true  },
    { id: "mapping",   label: "Employee Mapping",   adminOnly: true  },
    { id: "sync-log",  label: "Sync Log",           adminOnly: true  },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdminOrHR);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Learning & Development</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">LMS Admin</h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Access the Learning Management System natively inside HRMS, view progress snapshots, manage employee LMS mappings, and plan training batches from one admin screen.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (activeTab === "learning")  void loadLearning();
                if (activeTab === "batch-planner") void loadBatchPlanner();
                if (activeTab === "mapping")   void loadMappings();
                if (activeTab === "sync-log")  void loadSyncLog();
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <a
              href="https://mcnlms.teammas.in/lms"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <BookOpen className="h-4 w-4" />
              Launch LMS
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          </div>
        </div>

        {/* Alert */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
            <button onClick={() => setMessage("")} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* ── LMS Connection & Sync Control (admin/HR only) ──────────────────── */}
        {isAdminOrHR && (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Connection Status */}
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="flex items-center gap-2 font-black text-slate-950"><Database className="h-4 w-4 text-blue-600" />LMS Database</h2>
                <button onClick={checkConnection} disabled={checkingConn} className="rounded-xl border px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
                  {checkingConn ? <Loader className="h-3.5 w-3.5 animate-spin inline" /> : <RefreshCcw className="h-3.5 w-3.5 inline" />}
                </button>
              </div>
              {connStatus === null && !checkingConn && <p className="text-xs text-slate-500">Checking…</p>}
              {checkingConn && <p className="text-xs text-slate-500">Testing connection…</p>}
              {connStatus && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${connStatus.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    {connStatus.ok ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    {connStatus.ok ? `Connected (${connStatus.latency_ms}ms)` : "Disconnected"}
                  </div>
                  {connStatus.source && <p className="text-xs text-slate-500">Source: <span className="font-semibold">{connStatus.source === "integration_hub" ? "Integration Hub credentials" : ".env fallback"}</span></p>}
                  {connStatus.ok && (
                    <div className={`rounded-xl px-3 py-2 text-xs font-bold ${connStatus.can_update_lms ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {connStatus.can_update_lms
                        ? "LMS write-back enabled"
                        : "LMS DB is read-only. HRMS can pull LMS data; HRMS-to-LMS writes need INSERT/UPDATE grants or bridge API support."}
                    </div>
                  )}
                  {connStatus.error && <p className="text-xs text-red-600">{connStatus.error}</p>}
                </div>
              )}
              <button onClick={() => setShowCredForm(v => !v)} className="mt-4 flex items-center gap-2 text-xs font-bold text-blue-600 hover:underline cursor-pointer">
                <Settings className="h-3.5 w-3.5" />{showCredForm ? "Hide" : "Configure"} Credentials
              </button>
              {showCredForm && (
                <div className="mt-4 space-y-3 rounded-2xl border bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase text-slate-500 tracking-wide">LMS MySQL Connection</p>
                  {([
                    { key: "host", label: "Host / IP", placeholder: "192.168.11.225" },
                    { key: "port", label: "Port", placeholder: "3306" },
                    { key: "database", label: "Database", placeholder: "mcn_lms" },
                    { key: "username", label: "Read Username", placeholder: "db_user" },
                  ] satisfies Array<{ key: keyof typeof credForm; label: string; placeholder: string }>).map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
                      <input
                        value={credForm[key]}
                        onChange={e => setCredForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                    <input
                      type="password"
                      value={credForm.password}
                      onChange={e => setCredForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-black uppercase tracking-wide text-amber-700">Optional Write Back Credentials</p>
                    <p className="text-xs text-amber-700">Use these when the LMS write user is different from the read user.</p>
                    {([
                      { key: "write_host", label: "Write Host / IP", placeholder: credForm.host || "192.168.11.225" },
                      { key: "write_port", label: "Write Port", placeholder: credForm.port || "3306" },
                      { key: "write_database", label: "Write Database", placeholder: credForm.database || "mcn_lms" },
                      { key: "write_username", label: "Write Username", placeholder: "lms_write_user" },
                    ] satisfies Array<{ key: keyof typeof credForm; label: string; placeholder: string }>).map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
                        <input
                          value={credForm[key]}
                          onChange={e => setCredForm(f => ({ ...f, [key]: e.target.value }))}
                          placeholder={placeholder}
                          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Write Password</label>
                      <input
                        type="password"
                        value={credForm.write_password}
                        onChange={e => setCredForm(f => ({ ...f, write_password: e.target.value }))}
                        placeholder="••••••••"
                        className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                  <button onClick={saveCreds} disabled={savingCreds} className="w-full rounded-xl bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                    {savingCreds ? "Saving…" : "Save & Test Connection"}
                  </button>
                </div>
              )}
            </div>

            {/* Sync Control */}
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-black text-slate-950 mb-3"><ShieldCheck className="h-4 w-4 text-emerald-600" />Sync Control</h2>
              <p className="text-xs text-slate-500 mb-4">Pulls trainee progress, certifications and mappings from LMS into HRMS snapshot tables using the live LMS database.</p>
              <button onClick={runSync} disabled={syncing || !connStatus?.ok} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2">
                {syncing ? <><Loader className="h-4 w-4 animate-spin" />Syncing…</> : <><RefreshCcw className="h-4 w-4" />Run Full Sync</>}
              </button>
              {!connStatus?.ok && <p className="mt-2 text-xs text-slate-400 text-center">Connect database first</p>}
              {syncResult && (
                <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase text-slate-500 mb-2">Last Sync Result</p>
                  {[
                    { label: "Mappings", value: syncResult.mapped },
                    { label: "Progress rows", value: syncResult.progress },
                    { label: "Certifications", value: syncResult.certifications },
                    { label: "Errors", value: syncResult.errors.length, warn: syncResult.errors.length > 0 },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-slate-600">{label}</span>
                      <span className={`font-bold ${warn ? "text-amber-600" : "text-slate-950"}`}>{value}</span>
                    </div>
                  ))}
                  {syncResult.errors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs font-bold text-amber-600 cursor-pointer">Show errors</summary>
                      <ul className="mt-2 space-y-1">
                        {syncResult.errors.slice(0, 10).map((e, i) => <li key={i} className="text-xs text-red-600 break-all">{e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Native LMS Console Link */}
            <div className="rounded-3xl border bg-white p-5 shadow-sm flex flex-col gap-4">
              <h2 className="flex items-center gap-2 font-black text-slate-950"><Settings className="h-4 w-4 text-slate-500" />Native LMS Console</h2>
              <p className="text-xs text-slate-500 flex-1">Manage schedule, view run history, configure field mappings and monitor LMS sync directly from HRMS.</p>
              <button onClick={() => navigate("/integration-hub")} className="w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                Open Integration Hub →
              </button>
              <a href="https://mcnlms.teammas.in/lms" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 cursor-pointer">
                <ExternalLink className="h-4 w-4" />Open LMS Portal
              </a>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setMessage(""); setActiveTab(t.id); }}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === t.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab 1: My Learning ─────────────────────────────────────────────── */}
        {activeTab === "learning" && (
          <div className="space-y-6">
            {/* Progress Snapshot */}
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-blue-600" />
                  <h2 className="font-black text-slate-950">Course Progress</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500">Snapshot synced from LMS</p>
              </div>
              {loadingLearning ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : progress.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No sync data yet.</p>
                  <p className="mt-1 text-sm">Data will appear after first LMS sync.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Course", "Progress", "Score", "Status", "Last Accessed"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {progress.map((row) => (
                        <tr key={row.id} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4">
                            <span className="font-semibold text-slate-900">
                              {row.course_name ?? row.course_id ?? "—"}
                            </span>
                          </td>
                          <td className="p-4">
                            <ProgressBar pct={Number(row.completion_pct)} />
                          </td>
                          <td className="p-4 text-slate-600">
                            {row.score != null ? `${Number(row.score).toFixed(1)}%` : "—"}
                          </td>
                          <td className="p-4">
                            <Badge label={row.status} colorClass={PROGRESS_COLORS[row.status]} />
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-400">
                            {row.last_accessed ? row.last_accessed.slice(0, 16).replace("T", " ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Certifications */}
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-amber-500" />
                  <h2 className="font-black text-slate-950">Certifications</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500">Snapshot synced from LMS</p>
              </div>
              {loadingLearning ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : certs.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Award className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No certifications found.</p>
                  <p className="mt-1 text-sm">Data will appear after first LMS sync.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Certification", "Issued Date", "Expiry Date", "Status"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {certs.map((cert) => (
                        <tr key={cert.id} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 font-semibold text-slate-900">{cert.certification_name}</td>
                          <td className="p-4 font-mono text-xs text-slate-500">{cert.issued_date ?? "—"}</td>
                          <td className="p-4 font-mono text-xs text-slate-500">{cert.expiry_date ?? "—"}</td>
                          <td className="p-4">
                            <Badge label={cert.status} colorClass={CERT_COLORS[cert.status]} />
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

        {/* ── Tab 2: Employee Mapping ────────────────────────────────────────── */}
        {activeTab === "batch-planner" && isAdminOrHR && (
          <div className="space-y-6">
            {loadingBatchPlanner ? (
              <div className="flex items-center justify-center rounded-3xl border bg-white py-24 shadow-sm">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : batchPlanner ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: "Selected Count", value: batchPlanner.summary.selected_candidates, hint: "ATS candidates in the training funnel", tone: "text-blue-700 bg-blue-50" },
                    { label: "Confirmed Onboarded", value: batchPlanner.summary.confirmed_onboarded, hint: "HR-confirmed for training intake", tone: "text-emerald-700 bg-emerald-50" },
                    { label: "LMS Provisioned", value: batchPlanner.summary.lms_provisioned, hint: "Mapped to LMS learner IDs", tone: "text-violet-700 bg-violet-50" },
                    { label: "Ready to Train", value: batchPlanner.summary.ready_for_training, hint: "Assigned and provisioned", tone: "text-amber-700 bg-amber-50" },
                    { label: "Open Slots", value: batchPlanner.summary.open_slots, hint: `${batchPlanner.summary.filling_batches} batches still have capacity`, tone: "text-slate-700 bg-slate-100" },
                  ].map((card) => (
                    <div key={card.label} className="rounded-3xl border bg-white p-5 shadow-sm">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                      <div className={`mt-3 inline-flex rounded-2xl px-4 py-2 text-3xl font-black ${card.tone}`}>{card.value}</div>
                      <p className="mt-3 text-xs text-slate-500">{card.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="font-black text-slate-950">Batch capacity snapshot</h2>
                      <p className="mt-1 text-sm text-slate-500">Active and planned batches with live fill status from LMS</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                      Average fill {batchPlanner.summary.average_fill_pct}% across {batchPlanner.summary.total_batches} batches
                    </div>
                  </div>
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          {["Batch", "Scope", "Fill", "Assignment", "Status"].map((h) => (
                            <th key={h} className="p-4 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchPlanner.batches.map((batch) => (
                          <tr key={batch.batch_no} className="border-t hover:bg-slate-50/70 transition-colors">
                            <td className="p-4">
                              <div className="font-semibold text-slate-950">{batch.batch_name}</div>
                              <div className="font-mono text-xs text-slate-400">{batch.batch_no}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {batch.classroom_name ?? "No classroom"} {batch.start_date ? ` | ${formatIST(batch.start_date)}` : ""}
                              </div>
                            </td>
                            <td className="p-4 text-slate-600">
                              <div>{batch.branch ?? "Any branch"}</div>
                              <div className="text-xs text-slate-400">{batch.process ?? "Any process"} {batch.lob ? ` | ${batch.lob}` : ""}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, batch.fill_pct)}%` }} />
                                </div>
                                <span className="text-xs font-bold text-slate-700">{batch.fill_pct}%</span>
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {batch.total_trainees}/{batch.expected_trainees} allocated {batch.remaining_slots > 0 ? ` | ${batch.remaining_slots} open` : batch.overbooked > 0 ? ` | ${batch.overbooked} over` : ""}
                              </div>
                            </td>
                            <td className="p-4 text-slate-600">
                              <div className="text-sm font-semibold text-slate-900">{batch.trainee_count} trainees</div>
                              <div className="text-xs text-slate-500">
                                {batch.confirmed_onboarded_count} onboarded | {batch.lms_ready_count} LMS ready
                              </div>
                              <div className="text-xs text-slate-400">
                                {batch.ojt_ready_count} OJT | {batch.certified_count} certified | {batch.handover_to_ops_count} handover
                              </div>
                            </td>
                            <td className="p-4">
                              <Badge
                                label={batch.fill_state}
                                colorClass={
                                  batch.fill_state === "filled"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : batch.fill_state === "nearly_full"
                                      ? "bg-amber-50 text-amber-700"
                                      : batch.fill_state === "overbooked"
                                        ? "bg-red-50 text-red-700"
                                        : "bg-blue-50 text-blue-700"
                                }
                              />
                              <div className="mt-2 text-xs text-slate-500">{batch.batch_status ?? "Unknown status"}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="font-black text-slate-950">Candidate queue for training batches</h2>
                      <p className="mt-1 text-sm text-slate-500">Selected and onboarded candidates with suggested batch placement</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                      {batchPlanner.summary.batch_assigned} already assigned, {Math.max(0, batchPlanner.summary.selected_candidates - batchPlanner.summary.batch_assigned)} waiting
                    </div>
                  </div>
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          {["Candidate", "Pipeline", "LMS", "Batch", "Readiness"].map((h) => (
                            <th key={h} className="p-4 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchPlanner.candidates.map((candidate) => (
                          <tr key={candidate.candidate_id} className="border-t hover:bg-slate-50/70 transition-colors">
                            <td className="p-4">
                              <div className="font-semibold text-slate-950">{candidate.full_name ?? "Unnamed candidate"}</div>
                              <div className="font-mono text-xs text-slate-400">{candidate.candidate_code ?? candidate.employee_code ?? candidate.candidate_id}</div>
                              <div className="mt-1 text-xs text-slate-500">{candidate.branch_name ?? "No branch"} {candidate.process_name ? ` | ${candidate.process_name}` : ""}</div>
                            </td>
                            <td className="p-4 text-slate-600">
                              <div className="text-sm font-semibold text-slate-900">{candidate.current_stage ?? "unknown"}</div>
                              <div className="text-xs text-slate-500">{candidate.profile_status ?? "profile pending"}</div>
                              <div className="text-xs text-slate-400">{candidate.onboarding_status ?? "no onboarding bridge"}</div>
                            </td>
                            <td className="p-4 text-slate-600">
                              <div className="text-sm font-semibold text-slate-900">{candidate.lms_learner_id ?? "not provisioned"}</div>
                              <div className="text-xs text-slate-500">
                                {candidate.lms_provisioned ? "LMS record available" : "Waiting on LMS provision"}
                              </div>
                            </td>
                            <td className="p-4 text-slate-600">
                              <div className="text-sm font-semibold text-slate-900">{candidate.batch_no ?? candidate.suggested_batch_no ?? "unassigned"}</div>
                              <div className="text-xs text-slate-500">{candidate.batch_no ? "Assigned batch" : candidate.suggested_batch_reason ?? "Needs placement"}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  label={candidate.readiness_state}
                                  colorClass={
                                    candidate.readiness_state === "ready_for_training"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : candidate.readiness_state === "batch_assigned"
                                        ? "bg-blue-50 text-blue-700"
                                        : candidate.readiness_state === "lms_ready"
                                          ? "bg-violet-50 text-violet-700"
                                          : candidate.readiness_state === "onboarded"
                                            ? "bg-amber-50 text-amber-700"
                                            : "bg-slate-100 text-slate-600"
                                  }
                                />
                                {candidate.suggested_batch_no && (
                                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                    Suggest: {candidate.suggested_batch_no}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                {candidate.ready_for_training ? "Ready for HR batch sign-off" : candidate.suggested_batch_reason ?? "No suggestion yet"}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-3xl border bg-white p-12 text-center shadow-sm">
                <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <p className="font-semibold text-slate-900">No batch planner data yet.</p>
                <p className="mt-1 text-sm text-slate-500">Once batches and trainees exist in LMS, the planning view will populate here.</p>
              </div>
            )}
          </div>
        )}

        {/* â”€â”€ Tab 3: Employee Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === "mapping" && isAdminOrHR && (
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="font-black text-slate-950">Employee — LMS Learner Mappings</h2>
                <p className="mt-1 text-sm text-slate-500">{mappings.length} active mappings</p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add Mapping
              </button>
            </div>
            {loadingMappings ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : mappings.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <Settings className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-semibold">No mappings configured.</p>
                <p className="mt-1 text-sm">Add an employee-to-LMS mapping to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Employee", "Code", "LMS Learner ID", "Email", "Match", "Mapped At"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 font-semibold text-slate-900">{m.full_name ?? "—"}</td>
                        <td className="p-4 font-mono text-xs text-slate-500">{m.employee_code ?? "—"}</td>
                        <td className="p-4 font-mono text-xs text-slate-700">{m.lms_learner_id}</td>
                        <td className="p-4 text-slate-500">{m.email ?? "—"}</td>
                        <td className="p-4">
                          {m.mapping_source ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-bold capitalize text-slate-700">{m.mapping_source.replace(/_/g, " ")}</span>
                              {m.mapping_confidence && <span className="text-[11px] font-semibold uppercase text-slate-400">{m.mapping_confidence}</span>}
                            </div>
                          ) : "â€”"}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-400">
                          {m.mapped_at?.slice(0, 16).replace("T", " ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Tab 3: Sync Log ────────────────────────────────────────────────── */}
        {activeTab === "sync-log" && isAdminOrHR && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
              <span className="font-semibold">
                Manual sync is managed via the Integration Hub. This log shows historical sync runs.
              </span>
              <button
                onClick={() => navigate("/integration-hub")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800 transition-colors cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open Integration Hub
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Sync Audit Log</h2>
                <p className="mt-1 text-sm text-slate-500">Last 100 sync runs</p>
              </div>
              {loadingSyncLog ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : syncLog.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No sync runs recorded yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[750px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Sync Type", "Records Synced", "Errors", "Status", "Initiated By", "Date"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {syncLog.map((log) => (
                        <tr key={log.id} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 font-semibold text-slate-900 capitalize">
                            {log.sync_type.replace(/_/g, " ")}
                          </td>
                          <td className="p-4 text-slate-700">{log.records_synced}</td>
                          <td className="p-4">
                            {log.errors_count > 0 ? (
                              <span className="font-semibold text-red-600">{log.errors_count}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="p-4">
                            <Badge label={log.status} colorClass={SYNC_COLORS[log.status]} />
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-500">
                            {log.initiated_by ? log.initiated_by.slice(0, 8) + "…" : "system"}
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-400">
                            {formatIST(log.created_at)}
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

      {/* ── Add Mapping Modal ──────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add LMS Mapping</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Employee ID (UUID)
                </label>
                <input
                  value={mappingForm.employee_id}
                  onChange={(e) => setMappingForm({ ...mappingForm, employee_id: e.target.value })}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-…"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  LMS Learner ID
                </label>
                <input
                  value={mappingForm.lms_learner_id}
                  onChange={(e) => setMappingForm({ ...mappingForm, lms_learner_id: e.target.value })}
                  placeholder="e.g. LRN-00123"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Email <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="email"
                  value={mappingForm.email}
                  onChange={(e) => setMappingForm({ ...mappingForm, email: e.target.value })}
                  placeholder="employee@example.com"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitMapping}
                disabled={savingMapping}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {savingMapping ? "Saving…" : "Save Mapping"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Mail,
  PhoneCall,
  PhoneIcon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeletons";
import { SessionContextPanel } from "@/components/ats/SessionContextPanel";
import {
  loadSessionContext,
  saveSessionContext,
  clearSessionContext,
  type SessionContext,
} from "@/lib/sessionContext";

type HiringActivityRow = Record<string, any>;

type BootstrapResponse = {
  actor: {
    userId: string;
    recruiterName: string;
    recruiterEmployeeId: string | null;
    recruiterCode: string | null;
    branchName: string;
    activityDate: string;
    activityMonth: string;
  };
  options: {
    processOptions: string[];
    sourceOptions: string[];
    positionOptions: string[];
    wpGroupOptions: string[];
    callingOutcomeOptions: string[];
    genderOptions: string[];
    educationOptions: string[];
    experienceOptions: string[];
  };
};

type HiringDashboard = {
  metrics: {
    total_records: number;
    total_contacted: number;
    contacted_pct: number;
    not_contacted: number;
    shortlisted: number;
    recruiter_rejected: number;
    final_selected: number;
    joined: number;
    walkins: number;
  };
};

type HiringListResponse = {
  success: boolean;
  data: HiringActivityRow[];
  total: number;
  page: number;
  limit: number;
};

type HiringDashboardResponse = {
  success: boolean;
  data: HiringDashboard;
};

type BootstrapApiResponse = {
  success: boolean;
  data: BootstrapResponse;
};

type FormState = {
  process_name: string;
  hiring_source: string;
  position_name: string;
  wp_group: string;
  candidate_name: string;
  mobile: string;
  candidate_email: string;
  gender: string;
  education_qualification: string;
  experience_level: string;
  candidate_location: string;
  recruiter_remarks: string;
  recruiter_rejection_reason: string;
};

const EMPTY_FORM: FormState = {
  process_name: "",
  hiring_source: "",
  position_name: "",
  wp_group: "",
  candidate_name: "",
  mobile: "",
  candidate_email: "",
  gender: "",
  education_qualification: "",
  experience_level: "",
  candidate_location: "",
  recruiter_remarks: "",
  recruiter_rejection_reason: "",
};

const FIELD_ORDER: Array<keyof FormState> = [
  "process_name",
  "hiring_source",
  "position_name",
  "wp_group",
  "candidate_name",
  "mobile",
  "candidate_email",
  "gender",
  "education_qualification",
  "experience_level",
  "candidate_location",
  "recruiter_remarks",
  "recruiter_rejection_reason",
];

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function normalizeText(value: string) {
  return value.trim();
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function isArrived(row: HiringActivityRow) {
  const status = String(row.current_status ?? "").toLowerCase();
  return Boolean(
    row.linked_candidate_id ||
    row.queue_token_id ||
    row.walkin_flag === 1 ||
    row.walkin_flag === "1" ||
    status.includes("arrived") ||
    status.includes("waiting")
  );
}

function isSelected(row: HiringActivityRow) {
  return Boolean(
    row.final_selection_flag === 1 ||
    row.final_selection_flag === "1" ||
    String(row.current_status ?? "").toLowerCase().includes("selected")
  );
}

function statusTone(row: HiringActivityRow) {
  if (isSelected(row)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (isArrived(row)) return "bg-sky-50 text-sky-700 border-sky-200";
  if (String(row.recruiter_remarks ?? "").toLowerCase() === "rejected") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  unavailable,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
          <div className={`mt-2 text-3xl font-black tracking-tight ${unavailable ? "text-slate-400" : "text-slate-950"}`}>
            {value}
          </div>
          <div className="mt-2 text-sm text-slate-600">{unavailable ? "Data unavailable" : hint}</div>
        </div>
        <div className={`rounded-2xl p-3 ${unavailable ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  help,
  required,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        <span>{label}</span>
        {required ? <span className="text-rose-500">*</span> : null}
      </div>
      {children}
      {help ? <div className="text-xs text-slate-500">{help}</div> : null}
    </label>
  );
}

export default function NativeATSHiringEntry() {
  const location = useLocation();
  const isCalling = location.pathname.includes("/calling-entry");

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [rows, setRows] = useState<HiringActivityRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsPage, setRowsPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dashboard, setDashboard] = useState<HiringDashboard | null>(null);
  const [dashboardFailed, setDashboardFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [entrySearch, setEntrySearch] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const fieldRefs = useRef<Partial<Record<keyof FormState, HTMLElement | null>>>({});

  const assignFieldRef = (key: keyof FormState) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  };

  const focusField = (key: keyof FormState) => {
    fieldRefs.current[key]?.focus();
  };

  const moveToNextField = (key: keyof FormState) => {
    const currentIndex = FIELD_ORDER.indexOf(key);
    const nextKey = FIELD_ORDER[currentIndex + 1];
    if (nextKey) focusField(nextKey);
  };

  const handleKeyAdvance = (key: keyof FormState) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || key === "recruiter_rejection_reason") return;
    event.preventDefault();
    moveToNextField(key);
  };

  const updateForm = (key: keyof FormState, value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: key === "mobile" ? digitsOnly(value) : value,
    }));
  };

  const clearCandidateFields = () => {
    setForm((prev) => ({
      ...prev,
      candidate_name: "",
      mobile: "",
      candidate_email: "",
      gender: "",
      education_qualification: "",
      experience_level: "",
      candidate_location: "",
      recruiter_remarks: "",
      recruiter_rejection_reason: "",
    }));
    setValidationErrors([]);
    window.setTimeout(() => focusField("candidate_name"), 0);
  };

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setValidationErrors([]);
    setSuccessMsg("");
    setErrorMsg("");
    window.setTimeout(() => focusField("process_name"), 0);
  };

  const loadPageData = async () => {
    setLoading(true);
    setLoadError("");
    setRowsPage(1);
    try {
      const [bootstrapRes, rowsRes] = await Promise.all([
        hrmsApi.get<BootstrapApiResponse>("/api/ats/recruiter/hiring-activity/bootstrap"),
        hrmsApi.get<HiringListResponse>("/api/ats/recruiter/hiring-activity?limit=12&page=1"),
      ]);
      setBootstrap(bootstrapRes.data);
      setRows(rowsRes.data ?? []);
      setRowsTotal(rowsRes.total ?? 0);

      // Load session context from localStorage
      const savedContext = loadSessionContext();
      if (savedContext) {
        setForm((prev) => ({
          ...prev,
          process_name: savedContext.process_name,
          hiring_source: savedContext.hiring_source,
          position_name: savedContext.position_name,
          wp_group: savedContext.wp_group,
        }));
        setSessionLocked(savedContext.locked);
      }
    } catch (error: unknown) {
      setLoadError((error as { message?: string })?.message || "Unable to load hiring entry. Please refresh.");
    } finally {
      setLoading(false);
    }
    // Load dashboard separately so a metrics failure doesn't block the form
    hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
      .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
      .catch(() => { setDashboardFailed(true); });
  };

  // Lightweight reload used after saves — skips the bootstrap call since actor context is static
  const reloadRowsAfterSave = async () => {
    setRowsPage(1);
    try {
      const rowsRes = await hrmsApi.get<HiringListResponse>("/api/ats/recruiter/hiring-activity?limit=12&page=1");
      setRows(rowsRes.data ?? []);
      setRowsTotal(rowsRes.total ?? 0);
    } catch (_e) { /* non-critical — entries list still shows stale data */ }
    hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
      .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
      .catch(() => { setDashboardFailed(true); });
  };

  const loadMoreRows = async () => {
    setLoadingMore(true);
    try {
      const nextPage = rowsPage + 1;
      const res = await hrmsApi.get<HiringListResponse>(`/api/ats/recruiter/hiring-activity?limit=12&page=${nextPage}`);
      setRows((prev) => [...prev, ...(res.data ?? [])]);
      setRowsPage(nextPage);
    } catch (_e) { /* ignore pagination failure */ } finally {
      setLoadingMore(false);
    }
  };

  // Handle session context lock toggle
  const toggleSessionLock = () => {
    if (sessionLocked) {
      // Unlock
      setSessionLocked(false);
      clearSessionContext();
    } else {
      // Lock
      const context: SessionContext = {
        process_name: form.process_name,
        hiring_source: form.hiring_source,
        position_name: form.position_name,
        wp_group: form.wp_group,
        locked: true,
        timestamp: Date.now(),
      };
      saveSessionContext(context);
      setSessionLocked(true);
      // Focus first candidate field
      window.setTimeout(() => focusField("candidate_name"), 100);
    }
  };

  // Update session context field
  const updateSessionField = (field: string, value: string) => {
    updateForm(field as keyof FormState, value);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyboard = (e: globalThis.KeyboardEvent) => {
      // Ctrl/Cmd + Enter: Save entry
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !saving && sessionLocked) {
        e.preventDefault();
        void saveEntry();
      }
      // Ctrl/Cmd + D: Toggle optional fields
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setShowOptionalFields((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyboard);
    return () => window.removeEventListener("keydown", handleGlobalKeyboard);
  }, [saving, sessionLocked]);

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    if (bootstrap && !loading) {
      if (sessionLocked) {
        window.setTimeout(() => focusField("candidate_name"), 0);
      } else {
        window.setTimeout(() => focusField("process_name"), 0);
      }
    }
  }, [bootstrap, loading, sessionLocked]);

  const filteredRows = useMemo(() => {
    const q = entrySearch.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.candidate_name, r.mobile, r.process_name, r.position_name, r.activity_date, r.recruiter_remarks]
        .join(" ").toLowerCase().includes(q)
    );
  }, [rows, entrySearch]);

  const sourceOptions = bootstrap?.options.sourceOptions ?? [];
  const processOptions = bootstrap?.options.processOptions ?? [];
  const positionOptions = bootstrap?.options.positionOptions ?? [];
  const wpGroupOptions = bootstrap?.options.wpGroupOptions ?? [];
  const outcomeOptions = bootstrap?.options.callingOutcomeOptions ?? [];
  const genderOptions = bootstrap?.options.genderOptions ?? [];
  const educationOptions = bootstrap?.options.educationOptions ?? [];
  const experienceOptions = bootstrap?.options.experienceOptions ?? [];

  const turnoutRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.walkins / dashboard.metrics.total_records) * 1000) / 10
    : 0;

  const selectedRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.final_selected / dashboard.metrics.total_records) * 1000) / 10
    : 0;

  const validate = () => {
    const errors: string[] = [];
    if (!normalizeText(form.process_name)) errors.push("Process name is required.");
    if (!normalizeText(form.hiring_source)) errors.push("Hiring source is required.");
    if (!normalizeText(form.position_name)) errors.push("Position is required.");
    if (!normalizeText(form.wp_group)) errors.push("WP group is required.");
    if (!normalizeText(form.candidate_name)) errors.push("Candidate name is required.");
    if (digitsOnly(form.mobile).length !== 10) errors.push("Enter a valid 10-digit mobile number.");
    if (!normalizeText(form.recruiter_remarks)) errors.push("Calling outcome is required.");

    const normalizedOutcome = normalizeText(form.recruiter_remarks).toLowerCase();
    if ((normalizedOutcome === "rejected" || normalizedOutcome === "not contacted") && !normalizeText(form.recruiter_rejection_reason)) {
      errors.push("Reason is required when outcome is Rejected or Not Contacted.");
    }

    const email = normalizeText(form.candidate_email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Enter a valid email address or leave it blank.");
    }

    return errors;
  };

  const saveEntry = async () => {
    const errors = validate();
    setValidationErrors(errors);
    setSuccessMsg("");
    setErrorMsg("");
    if (errors.length) return;

    setSaving(true);
    try {
      const payload = {
        ...form,
        process_name: normalizeText(form.process_name),
        hiring_source: normalizeText(form.hiring_source),
        position_name: normalizeText(form.position_name),
        wp_group: normalizeText(form.wp_group),
        candidate_name: normalizeText(form.candidate_name),
        mobile: digitsOnly(form.mobile),
        candidate_email: normalizeText(form.candidate_email),
        gender: normalizeText(form.gender),
        education_qualification: normalizeText(form.education_qualification),
        experience_level: normalizeText(form.experience_level),
        candidate_location: normalizeText(form.candidate_location),
        recruiter_remarks: normalizeText(form.recruiter_remarks),
        recruiter_rejection_reason: normalizeText(form.recruiter_rejection_reason),
        source_system: "HRMS",
        duplicateMode: "update_existing",
      };

      const res = await hrmsApi.post<{ success: boolean; data: { action?: string; row?: HiringActivityRow } }>(
        "/api/ats/recruiter/hiring-activity",
        payload
      );

      const action = res.data?.action ?? "saved";
      setSuccessMsg(action === "updated" ? "Existing entry updated for this candidate." : "Calling entry saved successfully.");
      clearCandidateFields();
      await reloadRowsAfterSave();
    } catch (error: unknown) {
      setErrorMsg((error as { message?: string })?.message || "Unable to save entry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />
        </div>
      </DashboardLayout>
    );
  }

  if (loadError) {
    return (
      <DashboardLayout>
        <EmptyState
          icon={AlertCircle}
          title="Could not load hiring entry"
          description={loadError}
          action={{ label: "Retry", onClick: () => void loadPageData() }}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">
              {isCalling ? "Recruiter Calling Entry" : "Recruiter Hiring Entry"}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Fast pre-walk-in calling form
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Recruiter, branch, date, and month are captured automatically from the logged-in profile. Use <span className="font-semibold text-slate-900">Tab</span> or <span className="font-semibold text-slate-900">Enter</span> to move quickly across fields.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadPageData()}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Clear all
            </button>
          </div>
        </div>

        {successMsg ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {successMsg}
          </div>
        ) : null}
        {errorMsg ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {errorMsg}
          </div>
        ) : null}

        {validationErrors.length ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="font-bold">Please fix these before saving:</div>
            <ul className="mt-2 space-y-1">
              {validationErrors.map((error) => (
                <li key={error}>- {error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {dashboardFailed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            Metrics unavailable — dashboard data could not be loaded. The form is still fully functional.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Calls Logged"
            value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.total_records ?? 0)}
            hint="Total recruiter calling entries recorded."
            icon={<PhoneCall className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
          <MetricCard
            label="Contacted"
            value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.total_contacted ?? 0)} (${dashboard?.metrics.contacted_pct ?? 0}%)`}
            hint="Candidates the recruiter actually reached."
            icon={<BadgeCheck className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
          <MetricCard
            label="Shortlisted"
            value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.shortlisted ?? 0)}
            hint="Candidates kept warm for next action."
            icon={<Target className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
          <MetricCard
            label="Turned Up"
            value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.walkins ?? 0)} (${turnoutRate}%)`}
            hint="Auto-linked from candidate registration."
            icon={<Users className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
          <MetricCard
            label="Selected"
            value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.final_selected ?? 0)} (${selectedRate}%)`}
            hint="Final selections mapped from later ATS flow."
            icon={<UserRound className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
          <MetricCard
            label="Joined"
            value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.joined ?? 0)}
            hint="Joined candidates coming through this funnel."
            icon={<Clock3 className="h-5 w-5" />}
            unavailable={dashboardFailed}
          />
        </div>

        {/* Session Context Panel - replaces static auto-captured fields */}
        <SessionContextPanel
          process_name={form.process_name}
          hiring_source={form.hiring_source}
          position_name={form.position_name}
          wp_group={form.wp_group}
          locked={sessionLocked}
          processOptions={processOptions}
          sourceOptions={sourceOptions}
          positionOptions={positionOptions}
          wpGroupOptions={wpGroupOptions}
          onUpdate={updateSessionField}
          onToggleLock={toggleSessionLock}
          onKeyAdvance={handleKeyAdvance}
        />

        {/* Auto-captured metadata - compact version */}
        {sessionLocked && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-500">Recruiter:</span>
                <span className="font-semibold text-slate-800">{bootstrap?.actor.recruiterName ?? "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-500">Branch:</span>
                <span className="font-semibold text-slate-800">{bootstrap?.actor.branchName ?? "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-slate-500" />
                <span className="font-semibold text-slate-800">{bootstrap?.actor.activityDate ?? "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-500">Month:</span>
                <span className="font-semibold text-slate-800">{bootstrap?.actor.activityMonth ?? "-"}</span>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">

            {/* Primary Entry Form - Two Zone Design */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-slate-950">Rapid Entry Mode</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {sessionLocked ? (
                      <>Essential fields only. Press <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-bold">Ctrl+Enter</kbd> to save.</>
                    ) : (
                      "Lock session context above to start rapid entry."
                    )}
                  </div>
                </div>
                <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
                  Auto-update duplicates
                </div>
              </div>

              {/* Primary Zone - Always Visible Core Fields */}
              <div className="space-y-5">
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      <UserRound className="h-4 w-4" />
                      <span>Candidate Name</span>
                      <span className="text-rose-500">*</span>
                    </div>
                    <input
                      ref={assignFieldRef("candidate_name") as any}
                      value={form.candidate_name}
                      onChange={(event) => updateForm("candidate_name", event.target.value)}
                      onKeyDown={handleKeyAdvance("candidate_name")}
                      disabled={!sessionLocked}
                      className="h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-lg font-medium outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      placeholder={sessionLocked ? "Type candidate name..." : "Lock context first"}
                      autoComplete="name"
                    />
                  </label>

                  <label className="block space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      <PhoneIcon className="h-4 w-4" />
                      <span>Mobile Number</span>
                      <span className="text-rose-500">*</span>
                      {digitsOnly(form.mobile).length === 10 && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      )}
                    </div>
                    <input
                      ref={assignFieldRef("mobile") as any}
                      value={form.mobile}
                      onChange={(event) => updateForm("mobile", event.target.value)}
                      onKeyDown={handleKeyAdvance("mobile")}
                      disabled={!sessionLocked}
                      className="h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-lg font-medium outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      placeholder={sessionLocked ? "10-digit mobile..." : "Lock context first"}
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                  </label>

                  <label className="block space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Calling Outcome</span>
                      <span className="text-rose-500">*</span>
                    </div>
                    <select
                      ref={assignFieldRef("recruiter_remarks") as any}
                      value={form.recruiter_remarks}
                      onChange={(event) => updateForm("recruiter_remarks", event.target.value)}
                      onKeyDown={handleKeyAdvance("recruiter_remarks")}
                      disabled={!sessionLocked}
                      className="h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-lg font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    >
                      <option value="">Select outcome...</option>
                      {outcomeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Conditional Rejection Reason */}
                  {(form.recruiter_remarks.toLowerCase() === "rejected" ||
                    form.recruiter_remarks.toLowerCase() === "not contacted") && (
                    <label className="block space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-rose-500">
                        <span>Reason (Required)</span>
                      </div>
                      <textarea
                        ref={assignFieldRef("recruiter_rejection_reason") as any}
                        value={form.recruiter_rejection_reason}
                        onChange={(event) => updateForm("recruiter_rejection_reason", event.target.value)}
                        className="min-h-[88px] w-full rounded-xl border-2 border-rose-300 bg-white px-4 py-3 text-base outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                        placeholder="Why rejected or not contacted? (e.g., Busy, Switched off, Wrong number, Not interested...)"
                      />
                    </label>
                  )}
                </div>

                {/* Optional Fields Toggle */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOptionalFields(!showOptionalFields)}
                    disabled={!sessionLocked}
                    className="flex w-full items-center justify-between rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-center gap-2">
                      {showOptionalFields ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      <span>
                        {showOptionalFields ? "Hide" : "Add"} Optional Details
                      </span>
                      <span className="text-xs text-slate-500">(Email, Gender, Education, Experience, Location)</span>
                    </div>
                    <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs">Ctrl+D</kbd>
                  </button>

                  {/* Secondary Zone - Optional Fields (Collapsible) */}
                  {showOptionalFields && sessionLocked && (
                    <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-600">
                        <ChevronRight className="h-3 w-3" />
                        Optional Details
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            <Mail className="h-3 w-3" />
                            <span>Email</span>
                          </div>
                          <input
                            ref={assignFieldRef("candidate_email") as any}
                            value={form.candidate_email}
                            onChange={(event) => updateForm("candidate_email", event.target.value)}
                            onKeyDown={handleKeyAdvance("candidate_email")}
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-400"
                            placeholder="Optional email"
                            autoComplete="email"
                          />
                        </label>

                        <label className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Gender</div>
                          <select
                            ref={assignFieldRef("gender") as any}
                            value={form.gender}
                            onChange={(event) => updateForm("gender", event.target.value)}
                            onKeyDown={handleKeyAdvance("gender")}
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                          >
                            <option value="">Select...</option>
                            {genderOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Education</div>
                          <select
                            ref={assignFieldRef("education_qualification") as any}
                            value={form.education_qualification}
                            onChange={(event) => updateForm("education_qualification", event.target.value)}
                            onKeyDown={handleKeyAdvance("education_qualification")}
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                          >
                            <option value="">Select...</option>
                            {educationOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Experience</div>
                          <select
                            ref={assignFieldRef("experience_level") as any}
                            value={form.experience_level}
                            onChange={(event) => updateForm("experience_level", event.target.value)}
                            onKeyDown={handleKeyAdvance("experience_level")}
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                          >
                            <option value="">Select...</option>
                            {experienceOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-2 md:col-span-2">
                          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Location</div>
                          <input
                            ref={assignFieldRef("candidate_location") as any}
                            value={form.candidate_location}
                            onChange={(event) => updateForm("candidate_location", event.target.value)}
                            onKeyDown={handleKeyAdvance("candidate_location")}
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-400"
                            placeholder="Area / town"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Save Button & Footer */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t-2 border-slate-100 pt-6">
                <div className="text-sm text-slate-600">
                  Turn-up, selection, and joining will auto-sync from later ATS stages.
                </div>
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={saving || loading || !sessionLocked}
                  className={`inline-flex h-14 items-center gap-3 rounded-2xl px-6 text-base font-black shadow-lg ${
                    saving || loading || !sessionLocked
                      ? "cursor-not-allowed bg-slate-300 text-slate-500"
                      : "bg-gradient-to-r from-slate-900 to-slate-700 text-white hover:from-slate-800 hover:to-slate-600"
                  }`}
                >
                  {saving ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                  Save Entry
                  {sessionLocked && (
                    <kbd className="rounded border border-white/30 bg-white/20 px-1.5 py-0.5 text-xs">Ctrl+Enter</kbd>
                  )}
                </button>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <Users className="h-4 w-4" />
                My entries and candidate progress
              </div>

              <label className="relative mb-4 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={entrySearch}
                  onChange={(e) => setEntrySearch(e.target.value)}
                  placeholder="Search name, mobile, process, date, outcome…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm outline-none focus:border-slate-400 focus:bg-white"
                />
              </label>

              {rows.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">No recruiter calling entries yet.</div>
              ) : filteredRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">No entries match "{entrySearch}".</div>
              ) : (
                <div className="space-y-3">
                  {filteredRows.map((row) => {
                    const arrived = isArrived(row);
                    const selected = isSelected(row);
                    return (
                      <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-black text-slate-950">
                              {row.candidate_name || "Candidate"}
                            </div>
                            <div className="mt-1 text-sm text-slate-600">
                              {row.mobile || "-"} • {row.process_name || "No process"} • {row.position_name || "No position"}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {row.hiring_source || "No source"} • {row.branch_name || bootstrap?.actor.branchName || "No branch"}
                            </div>
                          </div>
                          <div className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row)}`}>
                            {selected ? "Selected" : arrived ? "Turned Up" : row.recruiter_remarks || "Open"}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Outcome: {row.recruiter_remarks || "Pending"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Current: {row.current_status || "Open"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Date: {row.activity_date || "-"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Turned Up</div>
                            <div className={`mt-1 text-sm font-black ${arrived ? "text-sky-700" : "text-slate-700"}`}>
                              {arrived ? "Yes" : "Not yet"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected</div>
                            <div className={`mt-1 text-sm font-black ${selected ? "text-emerald-700" : "text-slate-700"}`}>
                              {selected ? "Yes" : "Pending"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Joined</div>
                            <div
                              className={`mt-1 text-sm font-black ${
                                row.joined_flag === 1 || row.joined_flag === "1" ? "text-emerald-700" : "text-slate-700"
                              }`}
                            >
                              {row.joined_flag === 1 || row.joined_flag === "1" ? "Yes" : "Pending"}
                            </div>
                          </div>
                        </div>

                        {row.recruiter_rejection_reason ? (
                          <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            {row.recruiter_rejection_reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {rows.length > 0 && rows.length < rowsTotal && !entrySearch && (
                <button
                  type="button"
                  onClick={() => void loadMoreRows()}
                  disabled={loadingMore}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                  {loadingMore ? "Loading…" : `Load more (${rowsTotal - rows.length} remaining)`}
                </button>
              )}
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

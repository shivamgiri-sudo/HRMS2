import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  BarChart2,
  Bell,
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
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeletons";
import { SessionContextPanel } from "@/components/ats/SessionContextPanel";
import { BulkCallingUpload } from "@/components/ats/BulkCallingUpload";
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

type AnalyticsData = {
  funnel: { stage: string; count: number; pct: number }[];
  byOutcome: { label: string; count: number }[];
  bySource: { label: string; total: number; selected: number; joined: number }[];
  byProcess: { label: string; total: number; selected: number; joined: number }[];
  byRecruiter: { label: string; total: number; selected: number; joined: number; selRate: number }[];
  trend: { date: string; logged: number; walkins: number; selected: number }[];
  followupDue: { id: string; candidate_name: string; mobile: string; followup_date: string; followup_reason: string }[];
};

type AnalyticsResponse = { success: boolean; data: AnalyticsData };

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
  walkin_date: string;
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
  walkin_date: "",
};

const CHART_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#f97316"];
const FUNNEL_COLORS = ["#64748b", "#0ea5e9", "#f59e0b", "#10b981", "#16a34a"];

const ENTRY_FIELD_ORDER: Array<keyof FormState> = [
  "candidate_name",
  "mobile",
  "wp_group",
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

// ── Pipeline status helpers (cross-table) ─────────────────────────────────────

function isWalkedIn(row: HiringActivityRow) {
  const status = String(row.current_status ?? "").toLowerCase();
  const linked = String(row.linked_candidate_status ?? "").toLowerCase();
  return Boolean(
    row.linked_candidate_id ||
    row.queue_token_id ||
    row.walkin_flag === 1 || row.walkin_flag === "1" ||
    status.includes("arrived") || status.includes("waiting") ||
    linked.includes("waiting") || linked.includes("arrived")
  );
}

function isSelected(row: HiringActivityRow) {
  const linked = String(row.linked_final_decision ?? "").toLowerCase();
  const status = String(row.current_status ?? "").toLowerCase();
  return Boolean(
    row.final_selection_flag === 1 || row.final_selection_flag === "1" ||
    status.includes("selected") ||
    linked === "selected"
  );
}

function isRejected(row: HiringActivityRow) {
  const linked = String(row.linked_final_decision ?? "").toLowerCase();
  const remarks = String(row.recruiter_remarks ?? "").toLowerCase();
  const status = String(row.current_status ?? "").toLowerCase();
  return Boolean(
    remarks === "rejected" ||
    status.includes("rejected") ||
    linked === "rejected"
  );
}

function isNoShow(row: HiringActivityRow) {
  const status = String(row.current_status ?? "").toLowerCase();
  const linked = String(row.linked_candidate_status ?? "").toLowerCase();
  const tokenStatus = String(row.token_queue_status ?? "").toLowerCase();
  return Boolean(
    status.includes("no show") || status.includes("no-show") ||
    linked.includes("no show") ||
    tokenStatus === "no_show"
  );
}

function isJoined(row: HiringActivityRow) {
  const profileStatus = String(row.linked_profile_status ?? "").toLowerCase();
  return Boolean(
    row.joined_flag === 1 || row.joined_flag === "1" ||
    profileStatus === "onboarded"
  );
}

// ── Status pill helpers ───────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: string }) {
  const o = outcome.toLowerCase();
  const cls =
    o === "selected" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    o === "rejected" ? "bg-rose-50 text-rose-700 border-rose-200" :
    o === "shortlisted" ? "bg-sky-50 text-sky-700 border-sky-200" :
    o === "not contacted" ? "bg-slate-100 text-slate-600 border-slate-200" :
    "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${cls}`}>
      {outcome || "Pending"}
    </span>
  );
}

function PipelineCell({ active, activeClass, inactiveLabel = "—" }: { active: boolean; activeClass: string; inactiveLabel?: string }) {
  return active
    ? <span className={`text-sm font-black ${activeClass}`}>✓</span>
    : <span className="text-sm text-slate-300">{inactiveLabel}</span>;
}

// ── Compact Metric Card ───────────────────────────────────────────────────────

function MetricCard({
  label, value, icon, unavailable,
}: {
  label: string; value: string | number; icon: ReactNode; unavailable?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className={`rounded-lg p-1.5 ${unavailable ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 truncate">{label}</div>
        <div className={`text-xl font-black leading-tight ${unavailable ? "text-slate-300" : "text-slate-900"}`}>{value}</div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NativeATSHiringEntry() {
  const location = useLocation();
  const isCalling = location.pathname.includes("/calling-entry");
  const { user } = useAuth();
  const roleKeys = user?.roles?.map((r: any) => r.role_key) || [];

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [activeTab, setActiveTab] = useState<"entry" | "bulk" | "progress" | "analytics">("entry");

  // Analytics tab state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const analyticsLoadedRef = useRef(false);

  // Followup modal state
  const [followupModal, setFollowupModal] = useState<{ id: string; candidateName: string } | null>(null);
  const [followupDate, setFollowupDate] = useState("");
  const [followupReason, setFollowupReason] = useState("");
  const [followupSaving, setFollowupSaving] = useState(false);

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

  // Progress tab filters
  const [entrySearch, setEntrySearch] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [filterRecruiter, setFilterRecruiter] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterProcess, setFilterProcess] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterWpGroup, setFilterWpGroup] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const fieldRefs = useRef<Partial<Record<keyof FormState, HTMLElement | null>>>({});

  const assignFieldRef = (key: keyof FormState) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  };

  const focusField = (key: keyof FormState) => {
    fieldRefs.current[key]?.focus();
  };

  const moveToNextField = (key: keyof FormState) => {
    const idx = ENTRY_FIELD_ORDER.indexOf(key);
    const next = ENTRY_FIELD_ORDER[idx + 1];
    if (next) focusField(next);
  };

  const handleKeyAdvance = (key: keyof FormState) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || key === "recruiter_rejection_reason") return;
    event.preventDefault();
    moveToNextField(key);
  };

  const updateForm = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: key === "mobile" ? digitsOnly(value) : value }));
  };

  const clearCandidateFields = () => {
    setForm((prev) => ({
      ...prev,
      candidate_name: "", mobile: "", candidate_email: "", gender: "",
      education_qualification: "", experience_level: "", candidate_location: "",
      recruiter_remarks: "", recruiter_rejection_reason: "", walkin_date: "",
    }));
    setValidationErrors([]);
    window.setTimeout(() => focusField("candidate_name"), 0);
  };

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setValidationErrors([]);
    setSuccessMsg("");
    setErrorMsg("");
  };

  const loadPageData = async () => {
    setLoading(true);
    setLoadError("");
    setRowsPage(1);
    try {
      const [bootstrapRes, rowsRes] = await Promise.all([
        hrmsApi.get<BootstrapApiResponse>("/api/ats/recruiter/hiring-activity/bootstrap"),
        hrmsApi.get<HiringListResponse>("/api/ats/recruiter/hiring-activity?limit=25&page=1"),
      ]);
      setBootstrap(bootstrapRes.data);
      setRows(rowsRes.data ?? []);
      setRowsTotal(rowsRes.total ?? 0);

      const savedContext = loadSessionContext();
      if (savedContext) {
        setForm((prev) => ({
          ...prev,
          process_name: savedContext.process_name,
          hiring_source: savedContext.hiring_source,
          position_name: savedContext.position_name,
          wp_group: savedContext.wp_group ?? "",
        }));
        setSessionLocked(savedContext.locked);
      }
    } catch (error: unknown) {
      setLoadError((error as { message?: string })?.message || "Unable to load hiring entry. Please refresh.");
    } finally {
      setLoading(false);
    }
    hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
      .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
      .catch(() => { setDashboardFailed(true); });
  };

  const reloadRowsAfterSave = async () => {
    setRowsPage(1);
    try {
      const rowsRes = await hrmsApi.get<HiringListResponse>("/api/ats/recruiter/hiring-activity?limit=25&page=1");
      setRows(rowsRes.data ?? []);
      setRowsTotal(rowsRes.total ?? 0);
    } catch (_e) { /* non-critical */ }
    hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
      .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
      .catch(() => { setDashboardFailed(true); });
  };

  const loadMoreRows = async () => {
    setLoadingMore(true);
    try {
      const nextPage = rowsPage + 1;
      const res = await hrmsApi.get<HiringListResponse>(`/api/ats/recruiter/hiring-activity?limit=25&page=${nextPage}`);
      setRows((prev) => [...prev, ...(res.data ?? [])]);
      setRowsPage(nextPage);
    } catch (_e) { /* ignore */ } finally {
      setLoadingMore(false);
    }
  };

  const loadAnalytics = async () => {
    if (analyticsLoading) return;
    setAnalyticsLoading(true);
    try {
      const res = await hrmsApi.get<AnalyticsResponse>("/api/ats/recruiter/hiring-activity/analytics");
      if (res.success && res.data) {
        setAnalytics(res.data);
        analyticsLoadedRef.current = true;
      } else {
        setAnalytics(null);
        toast.error("Analytics data could not be loaded. Please try again.");
      }
    } catch (err: unknown) {
      console.error("[Analytics] Load failed:", err);
      setAnalytics(null);
      toast.error((err as { message?: string })?.message ?? "Failed to load analytics data");
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const saveFollowup = async () => {
    if (!followupModal || !followupDate) return;
    setFollowupSaving(true);
    try {
      await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${followupModal.id}/set-followup`, {
        followup_date: followupDate,
        followup_reason: followupReason,
      });
      toast.success(`Follow-up reminder set for ${followupModal.candidateName}`);
      setFollowupModal(null);
      setFollowupDate("");
      setFollowupReason("");
      await reloadRowsAfterSave();
      if (analyticsLoadedRef.current) await loadAnalytics();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Could not set follow-up");
    } finally {
      setFollowupSaving(false);
    }
  };

  const toggleSessionLock = () => {
    if (sessionLocked) {
      setSessionLocked(false);
      clearSessionContext();
    } else {
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
      window.setTimeout(() => focusField("candidate_name"), 100);
    }
  };

  const updateSessionField = (field: string, value: string) => {
    updateForm(field as keyof FormState, value);
  };

  useEffect(() => {
    const handleGlobalKeyboard = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !saving && sessionLocked) {
        e.preventDefault();
        void saveEntry();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setShowOptionalFields((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyboard);
    return () => window.removeEventListener("keydown", handleGlobalKeyboard);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, sessionLocked]);

  useEffect(() => { void loadPageData(); }, []);

  useEffect(() => {
    if (bootstrap && !loading) {
      if (sessionLocked) window.setTimeout(() => focusField("candidate_name"), 0);
      else window.setTimeout(() => focusField("process_name"), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, loading, sessionLocked]);

  const filteredRows = useMemo(() => {
    let result = rows;
    const q = entrySearch.toLowerCase().trim();
    if (q) {
      result = result.filter((r) =>
        [r.candidate_name, r.mobile, r.process_name, r.position_name, r.activity_date, r.recruiter_remarks, r.wp_group, r.recruiter_name_snapshot, r.branch_name, r.hiring_source]
          .join(" ").toLowerCase().includes(q)
      );
    }
    if (filterOutcome) {
      result = result.filter((r) => String(r.recruiter_remarks ?? "").toLowerCase() === filterOutcome.toLowerCase());
    }
    if (filterRecruiter) {
      result = result.filter((r) => String(r.recruiter_name_snapshot ?? "").toLowerCase().includes(filterRecruiter.toLowerCase()));
    }
    if (filterBranch) {
      result = result.filter((r) => String(r.branch_name ?? "").toLowerCase().includes(filterBranch.toLowerCase()));
    }
    if (filterProcess) {
      result = result.filter((r) => String(r.process_name ?? "").toLowerCase().includes(filterProcess.toLowerCase()));
    }
    if (filterSource) {
      result = result.filter((r) => String(r.hiring_source ?? "").toLowerCase().includes(filterSource.toLowerCase()));
    }
    if (filterWpGroup) {
      result = result.filter((r) => String(r.wp_group ?? "").toLowerCase().includes(filterWpGroup.toLowerCase()));
    }
    if (filterFrom) {
      result = result.filter((r) => r.activity_date >= filterFrom);
    }
    if (filterTo) {
      result = result.filter((r) => r.activity_date <= filterTo);
    }
    return result;
  }, [rows, entrySearch, filterOutcome, filterRecruiter, filterBranch, filterProcess, filterSource, filterWpGroup, filterFrom, filterTo]);

  const sourceOptions = bootstrap?.options.sourceOptions ?? [];
  const processOptions = bootstrap?.options.processOptions ?? [];
  const positionOptions = bootstrap?.options.positionOptions ?? [];
  const wpGroupOptions = bootstrap?.options.wpGroupOptions ?? [];
  const outcomeOptions = bootstrap?.options.callingOutcomeOptions ?? [];
  const genderOptions = bootstrap?.options.genderOptions ?? [];
  const educationOptions = bootstrap?.options.educationOptions ?? [];
  const experienceOptions = bootstrap?.options.experienceOptions ?? [];

  const isRejectionRequired =
    form.recruiter_remarks.toLowerCase() === "rejected" ||
    form.recruiter_remarks.toLowerCase() === "not contacted";

  const isInterestedOutcome = form.recruiter_remarks.toLowerCase() === "if interested";

  const validate = () => {
    const errors: string[] = [];
    if (!normalizeText(form.process_name)) errors.push("Process name is required.");
    if (!normalizeText(form.hiring_source)) errors.push("Hiring source is required.");
    if (!normalizeText(form.position_name)) errors.push("Position is required.");
    if (!normalizeText(form.candidate_name)) errors.push("Candidate name is required.");
    if (digitsOnly(form.mobile).length !== 10) errors.push("Enter a valid 10-digit mobile number.");
    if (!normalizeText(form.recruiter_remarks)) errors.push("Calling outcome is required.");
    if (isRejectionRequired && !normalizeText(form.recruiter_rejection_reason)) {
      errors.push("Reason is required when outcome is Rejected or Not Contacted.");
    }
    if (isInterestedOutcome && !normalizeText(form.walkin_date)) {
      errors.push("Walk-in date is required when outcome is If Interested.");
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
        walkin_date: normalizeText(form.walkin_date),
        source_system: "HRMS",
        duplicateMode: "update_existing",
      };

      const res = await hrmsApi.post<{ success: boolean; data: { action?: string; row?: HiringActivityRow } }>(
        "/api/ats/recruiter/hiring-activity",
        payload
      );

      const action = res.data?.action ?? "saved";
      const savedRow = res.data?.row;

      // If "If Interested" outcome with walk-in date, create followup reminder
      if (isInterestedOutcome && form.walkin_date && savedRow?.id) {
        try {
          await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${savedRow.id}/set-followup`, {
            followup_date: form.walkin_date,
            followup_reason: `Walk-in scheduled for ${form.walkin_date}`,
          });
        } catch (followupError) {
          console.error("[Followup Creation] Error:", followupError);
          // Don't fail the main save if followup fails
        }
      }

      setSuccessMsg(action === "updated" ? "Existing entry updated for this candidate." : "Entry saved successfully.");
      clearCandidateFields();
      await reloadRowsAfterSave();
    } catch (error: unknown) {
      setErrorMsg((error as { message?: string })?.message || "Unable to save entry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Totals for tab badge ──────────────────────────────────────────────────
  const turnoutRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.walkins / dashboard.metrics.total_records) * 1000) / 10 : 0;
  const selectedRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.final_selected / dashboard.metrics.total_records) * 1000) / 10 : 0;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
          <div className="grid gap-2 grid-cols-3 md:grid-cols-6">
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
      <div className="space-y-4">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
              {isCalling ? "Recruiter Calling Entry" : "Recruiter Hiring Entry"}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
              Fast Pre-Walk-in Entry
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadPageData()}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* ── Alerts ── */}
        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">{errorMsg}</div>
        )}
        {validationErrors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <div className="font-bold mb-1">Fix before saving:</div>
            <ul className="space-y-0.5">{validationErrors.map((e) => <li key={e}>— {e}</li>)}</ul>
          </div>
        )}
        {dashboardFailed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Metrics unavailable. The form is still fully functional.
          </div>
        )}

        {/* ── Compact metric strip ── */}
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          <MetricCard label="Calls" value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.total_records ?? 0)} icon={<PhoneCall className="h-4 w-4" />} unavailable={dashboardFailed} />
          <MetricCard label="Contacted" value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.total_contacted ?? 0)}`} icon={<BadgeCheck className="h-4 w-4" />} unavailable={dashboardFailed} />
          <MetricCard label="Shortlisted" value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.shortlisted ?? 0)} icon={<Target className="h-4 w-4" />} unavailable={dashboardFailed} />
          <MetricCard label="Turned Up" value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.walkins ?? 0)} (${turnoutRate}%)`} icon={<Users className="h-4 w-4" />} unavailable={dashboardFailed} />
          <MetricCard label="Selected" value={dashboardFailed ? "—" : `${formatMetric(dashboard?.metrics.final_selected ?? 0)} (${selectedRate}%)`} icon={<UserRound className="h-4 w-4" />} unavailable={dashboardFailed} />
          <MetricCard label="Joined" value={dashboardFailed ? "—" : formatMetric(dashboard?.metrics.joined ?? 0)} icon={<Clock3 className="h-4 w-4" />} unavailable={dashboardFailed} />
        </div>

        {/* ── Session Context Panel (3 fields, no WP Group) ── */}
        <SessionContextPanel
          process_name={form.process_name}
          hiring_source={form.hiring_source}
          position_name={form.position_name}
          locked={sessionLocked}
          processOptions={processOptions}
          sourceOptions={sourceOptions}
          positionOptions={positionOptions}
          onUpdate={updateSessionField}
          onToggleLock={toggleSessionLock}
          onKeyAdvance={handleKeyAdvance}
        />

        {/* Auto-captured metadata bar */}
        {sessionLocked && (
          <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-5 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-400">Recruiter:</span>
                <span className="font-semibold text-slate-800">{bootstrap?.actor.recruiterName ?? "-"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-400">Branch:</span>
                <span className="font-semibold text-slate-800">{bootstrap?.actor.branchName ?? "-"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-slate-800">{bootstrap?.actor.activityDate ?? "-"}</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Tab bar ── */}
        <div className="flex gap-0 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab("entry")}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "entry"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Save className="h-3.5 w-3.5" />
            Rapid Entry
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bulk")}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "bulk"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            Bulk Upload
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("progress")}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "progress"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            My Entries &amp; Progress
            {rowsTotal > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">{rowsTotal}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("analytics"); if (!analyticsLoadedRef.current) void loadAnalytics(); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "analytics"
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Branch Analytics
          </button>
        </div>

        {/* ── TAB: Bulk Upload ── */}
        {activeTab === "bulk" && bootstrap && (
          <BulkCallingUpload
            bootstrap={bootstrap}
            sessionLocked={sessionLocked}
            sessionContext={{
              process_name: form.process_name,
              hiring_source: form.hiring_source,
              position_name: form.position_name,
            }}
          />
        )}

        {/* ── TAB 1: Rapid Entry (horizontal spreadsheet row) ── */}
        {activeTab === "entry" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-black text-slate-950">Rapid Entry Mode</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {sessionLocked
                    ? <>Tab across fields. <kbd className="rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-xs font-bold">Ctrl+Enter</kbd> to save.</>
                    : "Lock session context above to start rapid entry."}
                </div>
              </div>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-sky-700">
                Auto-update duplicates
              </span>
            </div>

            {/* Horizontal entry row */}
            <div
              className="grid gap-3 items-end"
              style={{ gridTemplateColumns: isRejectionRequired ? "2fr 1.4fr 1.2fr 1.4fr 2fr auto" : "2fr 1.4fr 1.2fr 1.8fr auto" }}
            >
              {/* Candidate Name */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <UserRound className="h-3 w-3" />
                  <span>Candidate Name</span>
                  <span className="text-rose-500">*</span>
                </div>
                <input
                  ref={assignFieldRef("candidate_name") as any}
                  value={form.candidate_name}
                  onChange={(e) => updateForm("candidate_name", e.target.value)}
                  onKeyDown={handleKeyAdvance("candidate_name")}
                  disabled={!sessionLocked}
                  className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-medium outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  placeholder={sessionLocked ? "Candidate name…" : "Lock context first"}
                  autoComplete="name"
                />
              </div>

              {/* Mobile */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <PhoneIcon className="h-3 w-3" />
                  <span>Mobile</span>
                  <span className="text-rose-500">*</span>
                  {digitsOnly(form.mobile).length === 10 && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                </div>
                <input
                  ref={assignFieldRef("mobile") as any}
                  value={form.mobile}
                  onChange={(e) => updateForm("mobile", e.target.value)}
                  onKeyDown={handleKeyAdvance("mobile")}
                  disabled={!sessionLocked}
                  className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-medium outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  placeholder="10-digit mobile"
                  inputMode="numeric"
                />
              </div>

              {/* WP Group (optional) */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">WP Group</div>
                <select
                  ref={assignFieldRef("wp_group") as any}
                  value={form.wp_group}
                  onChange={(e) => updateForm("wp_group", e.target.value)}
                  onKeyDown={handleKeyAdvance("wp_group")}
                  disabled={!sessionLocked}
                  className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Optional…</option>
                  {wpGroupOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Calling Outcome */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Outcome</span>
                  <span className="text-rose-500">*</span>
                </div>
                <select
                  ref={assignFieldRef("recruiter_remarks") as any}
                  value={form.recruiter_remarks}
                  onChange={(e) => updateForm("recruiter_remarks", e.target.value)}
                  onKeyDown={handleKeyAdvance("recruiter_remarks")}
                  disabled={!sessionLocked}
                  className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Select outcome…</option>
                  {outcomeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Conditional rejection reason */}
              {isRejectionRequired && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-500">Reason *</div>
                  <textarea
                    ref={assignFieldRef("recruiter_rejection_reason") as any}
                    value={form.recruiter_rejection_reason}
                    onChange={(e) => updateForm("recruiter_rejection_reason", e.target.value)}
                    className="h-12 w-full resize-none rounded-xl border-2 border-rose-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                    placeholder="Reason for rejection…"
                  />
                </div>
              )}

              {/* Conditional walk-in date for "If Interested" */}
              {isInterestedOutcome && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Walk-in Date *</div>
                  <input
                    type="date"
                    ref={assignFieldRef("walkin_date") as any}
                    value={form.walkin_date}
                    onChange={(e) => updateForm("walkin_date", e.target.value)}
                    className="h-12 w-full rounded-xl border-2 border-emerald-300 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}

              {/* Save button */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-transparent select-none">save</div>
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={saving || loading || !sessionLocked}
                  className={`h-12 rounded-xl px-5 font-black text-sm shadow-sm transition-colors ${
                    saving || loading || !sessionLocked
                      ? "cursor-not-allowed bg-slate-200 text-slate-400"
                      : "bg-slate-900 text-white hover:bg-slate-700"
                  }`}
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Optional details row */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowOptionalFields(!showOptionalFields)}
                disabled={!sessionLocked}
                className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {showOptionalFields ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {showOptionalFields ? "Hide" : "Add"} Optional Details
                <span className="text-slate-400">(Email, Gender, Education, Experience, Location)</span>
                <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px]">Ctrl+D</kbd>
              </button>

              {showOptionalFields && sessionLocked && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    <ChevronRight className="h-3 w-3" />
                    Optional Details
                  </div>
                  <div className="grid gap-3 md:grid-cols-5">
                    <label className="space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                        <Mail className="h-3 w-3" /> Email
                      </div>
                      <input
                        ref={assignFieldRef("candidate_email") as any}
                        value={form.candidate_email}
                        onChange={(e) => updateForm("candidate_email", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
                        placeholder="Optional email"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Gender</div>
                      <select
                        ref={assignFieldRef("gender") as any}
                        value={form.gender}
                        onChange={(e) => updateForm("gender", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                      >
                        <option value="">Select…</option>
                        {genderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Education</div>
                      <select
                        ref={assignFieldRef("education_qualification") as any}
                        value={form.education_qualification}
                        onChange={(e) => updateForm("education_qualification", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                      >
                        <option value="">Select…</option>
                        {educationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Experience</div>
                      <select
                        ref={assignFieldRef("experience_level") as any}
                        value={form.experience_level}
                        onChange={(e) => updateForm("experience_level", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                      >
                        <option value="">Select…</option>
                        {experienceOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Location</div>
                      <input
                        ref={assignFieldRef("candidate_location") as any}
                        value={form.candidate_location}
                        onChange={(e) => updateForm("candidate_location", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
                        placeholder="Area / town"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── TAB 3: Branch Analytics ── */}
        {activeTab === "analytics" && (
          <section className="space-y-5">
            {analyticsLoading && (
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}
            {!analyticsLoading && !analytics && (
              <div className="py-16 text-center text-sm text-slate-400">
                Analytics data could not be loaded.
                <button type="button" onClick={() => void loadAnalytics()} className="ml-2 underline text-slate-600">Retry</button>
              </div>
            )}
            {analytics && (
              <>
                {/* Funnel */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 text-sm font-black text-slate-900">Hiring Funnel</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={analytics.funnel} layout="vertical" margin={{ left: 20, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="stage" type="category" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip formatter={(v: number) => [v, "Count"]} />
                      {analytics.funnel.map((_, i) => null)}
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, formatter: (v: number, entry: any) => `${v} (${entry?.pct ?? 0}%)` }}>
                        {analytics.funnel.map((_, i) => (
                          <Cell key={i} fill={FUNNEL_COLORS[i] ?? "#64748b"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Trend + Outcome pie */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-3 text-sm font-black text-slate-900">Daily Trend (Last 30 Days)</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={analytics.trend} margin={{ left: -10, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="logged" stroke="#64748b" dot={false} name="Logged" strokeWidth={2} />
                        <Line type="monotone" dataKey="walkins" stroke="#0ea5e9" dot={false} name="Walk-ins" strokeWidth={2} />
                        <Line type="monotone" dataKey="selected" stroke="#10b981" dot={false} name="Selected" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-3 text-sm font-black text-slate-900">Outcome Distribution</div>
                    {analytics.byOutcome.length === 0 ? (
                      <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">No data</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={analytics.byOutcome} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={({ label, pct }: any) => `${label}`}>
                            {analytics.byOutcome.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, name: string) => [v, name]} />
                          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Recruiter leaderboard */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 text-sm font-black text-slate-900">Recruiter Leaderboard</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400 w-8">Rank</th>
                          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Recruiter</th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Logged</th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Walk-ins</th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Selected</th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Sel %</th>
                          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {analytics.byRecruiter.map((r, i) => (
                          <tr key={r.label} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{r.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-sky-600">{(analytics.byRecruiter as any)[i]?.walkins ?? "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-bold">{r.selected}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${(r.selRate || 0) >= 30 ? "bg-emerald-50 text-emerald-700" : (r.selRate || 0) >= 15 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                                {r.selRate ?? 0}%
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.joined ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Follow-ups due */}
                {analytics.followupDue.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-amber-800">
                      <Bell className="h-4 w-4" />
                      Follow-ups Due (Next 7 Days) — {analytics.followupDue.length}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[500px] text-sm">
                        <thead>
                          <tr className="border-b border-amber-200">
                            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-amber-700">Candidate</th>
                            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-amber-700">Mobile</th>
                            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-amber-700">Due Date</th>
                            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-amber-700">Reason</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase text-amber-700"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100">
                          {analytics.followupDue.map((f) => (
                            <tr key={f.id}>
                              <td className="px-3 py-2 font-semibold text-slate-800">{f.candidate_name}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-600">{f.mobile}</td>
                              <td className="px-3 py-2 tabular-nums text-amber-700 font-bold">{f.followup_date}</td>
                              <td className="px-3 py-2 text-slate-600">{f.followup_reason || "—"}</td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => { setFollowupModal({ id: f.id, candidateName: f.candidate_name }); setFollowupDate(f.followup_date); setFollowupReason(f.followup_reason); }}
                                  className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── TAB 2: My Entries & Progress (full-width table) ── */}
        {activeTab === "progress" && (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={entrySearch}
                  onChange={(e) => setEntrySearch(e.target.value)}
                  placeholder="Search name, mobile, process, WP group…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
              <select
                value={filterOutcome}
                onChange={(e) => setFilterOutcome(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All outcomes</option>
                {outcomeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select
                value={filterRecruiter}
                onChange={(e) => setFilterRecruiter(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All recruiters</option>
                {Array.from(new Set(rows.map(r => String(r.recruiter_name_snapshot || "")).filter(Boolean))).sort().map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {roleKeys.includes("super_admin") && (
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                >
                  <option value="">All branches</option>
                  {Array.from(new Set(rows.map(r => String(r.branch_name || "")).filter(Boolean))).sort().map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              )}
              <select
                value={filterProcess}
                onChange={(e) => setFilterProcess(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All processes</option>
                {Array.from(new Set(rows.map(r => String(r.process_name || "")).filter(Boolean))).sort().map((proc) => <option key={proc} value={proc}>{proc}</option>)}
              </select>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All sources</option>
                {Array.from(new Set(rows.map(r => String(r.hiring_source || "")).filter(Boolean))).sort().map((src) => <option key={src} value={src}>{src}</option>)}
              </select>
              <select
                value={filterWpGroup}
                onChange={(e) => setFilterWpGroup(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All WP groups</option>
                {Array.from(new Set(rows.map(r => String(r.wp_group || "")).filter(Boolean))).sort().map((wp) => <option key={wp} value={wp}>{wp}</option>)}
              </select>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                title="From date"
              />
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                title="To date"
              />
              {(entrySearch || filterOutcome || filterRecruiter || filterBranch || filterProcess || filterSource || filterWpGroup || filterFrom || filterTo) && (
                <button
                  type="button"
                  onClick={() => { setEntrySearch(""); setFilterOutcome(""); setFilterRecruiter(""); setFilterBranch(""); setFilterProcess(""); setFilterSource(""); setFilterWpGroup(""); setFilterFrom(""); setFilterTo(""); }}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-500 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">No recruiter entries yet.</div>
            ) : filteredRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">No entries match the current filters.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="sticky top-0 bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 w-8">#</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Candidate</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Mobile</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Process</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Source</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">WP Group</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Recruiter</th>
                        {roleKeys.includes("super_admin") && <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Branch</th>}
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Outcome</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Walk-in</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Selected</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Rejected</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">No Show</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Joined</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Date</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Follow-up</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 text-xs text-slate-400">{idx + 1}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-slate-900">{row.candidate_name || "—"}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 tabular-nums">{row.mobile || "—"}</td>
                          <td className="px-3 py-2.5 text-slate-700">{row.process_name || "—"}</td>
                          <td className="px-3 py-2.5 text-slate-600">{row.hiring_source || "—"}</td>
                          <td className="px-3 py-2.5 text-slate-600">{row.wp_group || "—"}</td>
                          <td className="px-3 py-2.5 text-slate-600">{row.recruiter_name_snapshot || "—"}</td>
                          {roleKeys.includes("super_admin") && <td className="px-3 py-2.5 text-slate-600">{row.branch_name || "—"}</td>}
                          <td className="px-3 py-2.5">
                            <OutcomeBadge outcome={row.recruiter_remarks || ""} />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <PipelineCell active={isWalkedIn(row)} activeClass="text-sky-600" />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <PipelineCell active={isSelected(row)} activeClass="text-emerald-600" />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <PipelineCell active={isRejected(row)} activeClass="text-rose-500" inactiveLabel="—" />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <PipelineCell active={isNoShow(row)} activeClass="text-amber-600" inactiveLabel="—" />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <PipelineCell active={isJoined(row)} activeClass="text-emerald-700" />
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 tabular-nums text-xs">{row.activity_date || "—"}</td>
                          <td className="px-3 py-2.5 text-center">
                            {row.followup_date ? (
                              <button
                                type="button"
                                onClick={() => { setFollowupModal({ id: row.id, candidateName: row.candidate_name || "Candidate" }); setFollowupDate(row.followup_date); setFollowupReason(row.followup_reason || ""); }}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                              >
                                <Bell className="h-2.5 w-2.5" />
                                {String(row.followup_date).slice(0, 10)}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => { setFollowupModal({ id: row.id, candidateName: row.candidate_name || "Candidate" }); setFollowupDate(""); setFollowupReason(""); }}
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-400 hover:border-amber-300 hover:text-amber-600"
                              >
                                <Plus className="h-2.5 w-2.5" />
                                Set
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rows.length < rowsTotal && !entrySearch && !filterOutcome && !filterFrom && !filterTo && (
                  <div className="border-t border-slate-100 p-4">
                    <button
                      type="button"
                      onClick={() => void loadMoreRows()}
                      disabled={loadingMore}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                      {loadingMore ? "Loading…" : `Load more (${rowsTotal - rows.length} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {/* ── Follow-up modal ── */}
      {followupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFollowupModal(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-black text-slate-900">Set Follow-up Reminder</div>
              <button type="button" onClick={() => setFollowupModal(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-1 text-sm font-semibold text-slate-700">{followupModal.candidateName}</div>
            <div className="space-y-3 mt-3">
              <label className="block space-y-1">
                <div className="text-xs font-bold uppercase text-slate-500">Follow-up Date *</div>
                <input
                  type="date"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-amber-400"
                />
              </label>
              <label className="block space-y-1">
                <div className="text-xs font-bold uppercase text-slate-500">Reason / Note</div>
                <textarea
                  value={followupReason}
                  onChange={(e) => setFollowupReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none"
                  placeholder="What to follow up on..."
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFollowupModal(null)} className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                type="button"
                onClick={() => void saveFollowup()}
                disabled={followupSaving || !followupDate}
                className={`h-9 rounded-xl px-4 text-sm font-bold ${followupSaving || !followupDate ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-amber-500 text-white hover:bg-amber-600"}`}
              >
                {followupSaving ? "Saving…" : "Save Reminder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

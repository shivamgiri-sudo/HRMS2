import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
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
  Download,
  Mail,
  PhoneCall,
  PhoneIcon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
// react-apexcharts is CJS — its default export may be wrapped in a namespace object
import _ReactApexChartImport from "react-apexcharts";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactApexChart = (_ReactApexChartImport as any).default ?? _ReactApexChartImport;
type ApexOptions = import("apexcharts").ApexChartOptions;
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";
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
    rejectionReasonOptions: string[];
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
  bySource: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byProcess: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byRecruiter: { label: string; total: number; walkins: number; selected: number; joined: number; selRate: number }[];
  byBranch: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byGender: { label: string; count: number; walkins: number; selected: number; joined: number }[];
  byDayOfWeek: { label: string; count: number }[];
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

function KpiTile({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub?: string; color: string; icon?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border-2 ${color} bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
        {icon && <div className="opacity-60">{icon}</div>}
      </div>
      <div className="mt-2 text-3xl font-black text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function AnalyticsEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center text-sm text-slate-400">{label}</div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NativeATSHiringEntry() {
  const location = useLocation();
  const isCalling = location.pathname.includes("/calling-entry");
  const { user } = useAuth();
  const roleKeys = useMemo(() => user?.roles?.map((r: any) => r.role_key) ?? [], [user?.roles]);
  const todayIso = useMemo(() => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  }, []);

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [activeTab, setActiveTab] = useState<"entry" | "bulk" | "progress" | "analytics">("entry");

  // Analytics tab state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const analyticsLoadedRef = useRef(false);
  const [trendPeriod, setTrendPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  // Analytics filter bar state
  const [aFromDate,  setAFromDate]  = useState("");
  const [aToDate,    setAToDate]    = useState("");
  const [aBranch,    setABranch]    = useState("");
  const [aProcess,   setAProcess]   = useState("");
  const [aSource,    setASource]    = useState("");
  const [aRecruiter, setARecruiter] = useState("");

  const tabBarRef = useRef<HTMLDivElement>(null);
  const saveEntryRef = useRef<(() => Promise<void>) | null>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutRefs.current.push(id);
    return id;
  }, []);
  useEffect(() => () => { timeoutRefs.current.forEach(clearTimeout); }, []);

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
  const [entrySearchRaw, setEntrySearchRaw] = useState("");
  const entrySearch = useDebounce(entrySearchRaw, 300);
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

  const assignFieldRef = useCallback((key: keyof FormState) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  }, []);

  const focusField = useCallback((key: keyof FormState) => {
    fieldRefs.current[key]?.focus();
  }, []);

  const moveToNextField = useCallback((key: keyof FormState) => {
    const idx = ENTRY_FIELD_ORDER.indexOf(key);
    const next = ENTRY_FIELD_ORDER[idx + 1];
    if (next) fieldRefs.current[next]?.focus();
  }, []);

  const handleKeyAdvance = useCallback((key: keyof FormState) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || key === "recruiter_rejection_reason") return;
    event.preventDefault();
    const idx = ENTRY_FIELD_ORDER.indexOf(key);
    const next = ENTRY_FIELD_ORDER[idx + 1];
    if (next) fieldRefs.current[next]?.focus();
  }, []);

  const updateForm = useCallback((key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: key === "mobile" ? digitsOnly(value) : value }));
  }, []);

  const clearCandidateFields = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      candidate_name: "", mobile: "", candidate_email: "", gender: "",
      education_qualification: "", experience_level: "", candidate_location: "",
      recruiter_remarks: "", recruiter_rejection_reason: "", walkin_date: "",
    }));
    setValidationErrors([]);
    safeTimeout(() => fieldRefs.current["candidate_name"]?.focus(), 0);
  }, [safeTimeout]);

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setValidationErrors([]);
    setSuccessMsg("");
    setErrorMsg("");
  };

  // Build query string from active filter state and fetch from server
  const fetchEntries = useCallback(async (page = 1, append = false) => {
    const qs = new URLSearchParams({ limit: "50", page: String(page) });
    if (filterFrom)      qs.set("fromDate",        filterFrom);
    if (filterTo)        qs.set("toDate",           filterTo);
    if (filterOutcome)   qs.set("recruiterRemarks", filterOutcome);
    if (filterRecruiter) qs.set("recruiter",        filterRecruiter);
    if (filterBranch)    qs.set("branch",           filterBranch);
    if (filterProcess)   qs.set("process",          filterProcess);
    if (filterSource)    qs.set("hiringSource",     filterSource);
    if (filterWpGroup)   qs.set("wpGroup",          filterWpGroup);
    if (entrySearch)     qs.set("search",           entrySearch);
    try {
      const res = await hrmsApi.get<HiringListResponse>(`/api/ats/recruiter/hiring-activity?${qs.toString()}`);
      if (append) setRows((prev) => [...prev, ...(res.data ?? [])]);
      else { setRows(res.data ?? []); setRowsPage(1); }
      setRowsTotal(res.total ?? 0);
    } catch (_e) { /* non-critical */ }
  }, [filterFrom, filterTo, filterOutcome, filterRecruiter, filterBranch, filterProcess, filterSource, filterWpGroup, entrySearch]);

  const loadPageData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const bootstrapRes = await hrmsApi.get<BootstrapApiResponse>("/api/ats/recruiter/hiring-activity/bootstrap");
      setBootstrap(bootstrapRes.data);
      // rows + rowsTotal are populated exclusively by fetchEntries (via the filter useEffect
      // that fires on mount). This avoids a race where loadPageData overwrites the filtered
      // rowsTotal with the unfiltered count.

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
    void fetchEntries(1, false);
    hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
      .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
      .catch(() => { setDashboardFailed(true); });
  };

  const loadMoreRows = async () => {
    setLoadingMore(true);
    const nextPage = rowsPage + 1;
    await fetchEntries(nextPage, true);
    setRowsPage(nextPage);
    setLoadingMore(false);
  };

  const loadAnalytics = async () => {
    if (analyticsLoading) return;
    setAnalyticsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (aFromDate)  qs.set("fromDate",     aFromDate);
      if (aToDate)    qs.set("toDate",        aToDate);
      if (aBranch)    qs.set("branch",        aBranch);
      if (aProcess)   qs.set("process",       aProcess);
      if (aSource)    qs.set("hiringSource",  aSource);
      if (aRecruiter) qs.set("recruiter",     aRecruiter);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      const res = await hrmsApi.get<AnalyticsResponse>(`/api/ats/recruiter/hiring-activity/analytics${query}`);
      if (res.success && res.data) {
        setAnalytics(res.data);
        analyticsLoadedRef.current = true;
      } else {
        setAnalytics(null);
        toast.error("Analytics data could not be loaded. Please try again.");
      }
    } catch (err: unknown) {
      console.error("[Analytics] Load failed:", err);
      analyticsLoadedRef.current = false; // allow retry on next tab click
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
      safeTimeout(() => focusField("candidate_name"), 100);
    }
  };

  const switchTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    safeTimeout(() => tabBarRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" }), 0);
  };

  const deleteEntry = async (id: string, candidateName: string) => {
    if (!window.confirm(`Delete entry for "${candidateName}"? This cannot be undone.`)) return;
    try {
      await hrmsApi.delete(`/api/ats/recruiter/hiring-activity/${id}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setRowsTotal((t) => Math.max(0, t - 1));
      toast.success("Entry deleted");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not delete entry");
    }
  };

  const updateSessionField = (field: string, value: string) => {
    updateForm(field as keyof FormState, value);
  };

  // Keep saveEntryRef current so the keyboard handler never has a stale closure
  useEffect(() => { saveEntryRef.current = saveEntry; });

  useEffect(() => {
    const handleGlobalKeyboard = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !saving && sessionLocked) {
        e.preventDefault();
        void saveEntryRef.current?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setShowOptionalFields((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyboard);
    return () => window.removeEventListener("keydown", handleGlobalKeyboard);
  }, [saving, sessionLocked]);

  useEffect(() => { void loadPageData(); }, []);

  // Re-fetch from server whenever any filter changes (filters are now server-side)
  useEffect(() => {
    void fetchEntries(1, false);
  // fetchEntries is memoized on all filter values — this fires on any filter change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEntries]);

  useEffect(() => {
    if (bootstrap && !loading) {
      if (sessionLocked) safeTimeout(() => focusField("candidate_name"), 0);
      else safeTimeout(() => focusField("process_name"), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, loading, sessionLocked]);

  // All filters are server-side — rows is already the filtered result set
  const filteredRows = rows;

  const sourceOptions = bootstrap?.options.sourceOptions ?? [];
  const processOptions = bootstrap?.options.processOptions ?? [];
  const positionOptions = bootstrap?.options.positionOptions ?? [];
  const wpGroupOptions = bootstrap?.options.wpGroupOptions ?? [];
  const outcomeOptions = bootstrap?.options.callingOutcomeOptions ?? [];
  const rejectionReasonOptions = bootstrap?.options.rejectionReasonOptions ?? [];
  const genderOptions = bootstrap?.options.genderOptions ?? [];
  const educationOptions = bootstrap?.options.educationOptions ?? [];
  const experienceOptions = bootstrap?.options.experienceOptions ?? [];

  // Source filter dropdowns from bootstrap (full domain lists) rather than paginated rows
  const filterMeta = useMemo(() => ({
    recruiters: [...new Set(rows.map(r => String(r.recruiter_name_snapshot || "")).filter(Boolean))].sort(),
    branches:   [...new Set(rows.map(r => String(r.branch_name || "")).filter(Boolean))].sort(),
    processes:  processOptions.map(String).filter(Boolean).sort(),
    sources:    sourceOptions.map(String).filter(Boolean).sort(),
    wpGroups:   wpGroupOptions.map(String).filter(Boolean).sort(),
  }), [rows, processOptions, sourceOptions, wpGroupOptions]);

  const aggregatedTrend = useMemo(() => {
    if (!analytics?.trend?.length) return [];
    if (trendPeriod === "daily") return analytics.trend;

    const buckets = new Map<string, { logged: number; walkins: number; selected: number }>();
    for (const d of analytics.trend) {
      let key: string;
      if (trendPeriod === "weekly") {
        const dt = new Date(d.date);
        const dayOfWeek = dt.getDay();
        const monday = new Date(dt);
        monday.setDate(dt.getDate() - ((dayOfWeek + 6) % 7));
        key = `W ${monday.toISOString().slice(5, 10)}`;
      } else {
        key = d.date.slice(0, 7);
      }
      const b = buckets.get(key) ?? { logged: 0, walkins: 0, selected: 0 };
      b.logged += d.logged;
      b.walkins += d.walkins;
      b.selected += d.selected;
      buckets.set(key, b);
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
  }, [analytics?.trend, trendPeriod]);

  const isRejectionRequired =
    form.recruiter_remarks.toLowerCase().includes("rejected") ||
    form.recruiter_remarks.toLowerCase().includes("not interested") ||
    form.recruiter_remarks.toLowerCase() === "not contacted (no attempt)";

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

      setSuccessMsg(
        action === "followup" ? "Follow-up call logged (not counted as unique attempt)."
        : action === "updated" ? "Existing entry updated for this candidate."
        : "Entry saved successfully."
      );
      clearCandidateFields();
      if (savedRow) {
        if (action === "updated") {
          setRows((prev) => prev.map((r) => r.id === savedRow.id ? savedRow : r));
        } else {
          setRows((prev) => [savedRow, ...prev.slice(0, 49)]);
          setRowsTotal((t) => t + 1);
        }
        hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard")
          .then((res) => { setDashboard(res.data ?? null); setDashboardFailed(false); })
          .catch(() => {});
      } else {
        await reloadRowsAfterSave();
      }
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
          icon={<AlertCircle className="h-8 w-8" />}
          title="Could not load hiring entry"
          description={loadError}
          action={<button type="button" onClick={() => void loadPageData()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">Retry</button>}
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
        <div ref={tabBarRef} className="flex gap-0 border-b border-slate-200">
          <button
            type="button"
            onClick={() => switchTab("entry")}
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
            onClick={() => switchTab("bulk")}
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
            onClick={() => switchTab("progress")}
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
            onClick={() => { switchTab("analytics"); if (!analyticsLoadedRef.current) void loadAnalytics(); }}
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
                Duplicates → Follow-up calls
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
                  <select
                    ref={assignFieldRef("recruiter_rejection_reason") as any}
                    value={form.recruiter_rejection_reason}
                    onChange={(e) => updateForm("recruiter_rejection_reason", e.target.value)}
                    className="h-12 w-full rounded-xl border-2 border-rose-300 bg-white px-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  >
                    <option value="">Select reason…</option>
                    {rejectionReasonOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
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
                    min={todayIso}
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
          <Suspense fallback={<div className="flex h-32 items-center justify-center text-slate-400 text-sm">Loading charts…</div>}>
          <section className="space-y-5">

            {/* ── Analytics header + filter bar ── */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-violet-600" />
                  Hiring Analytics
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        toast.info("Syncing candidate data to analytics...");
                        const syncRes: any = await hrmsApi.post("/api/ats/recruiter/hiring-activity/backfill-from-candidates", {});
                        const inserted = syncRes?.inserted ?? syncRes?.data?.inserted ?? 0;
                        toast.success(`Synced ${inserted} candidates to analytics`);
                        void loadAnalytics();
                      } catch { toast.error("Sync failed"); }
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 hover:bg-violet-100"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Sync Data
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const query = [
                          aFromDate && `fromDate=${aFromDate}`, aToDate && `toDate=${aToDate}`,
                          aBranch && `branch=${encodeURIComponent(aBranch)}`,
                          aProcess && `process=${encodeURIComponent(aProcess)}`,
                          aSource && `hiringSource=${encodeURIComponent(aSource)}`,
                          aRecruiter && `recruiter=${encodeURIComponent(aRecruiter)}`,
                        ].filter(Boolean).join("&");
                        const res: any = await hrmsApi.get(`/api/ats/recruiter/hiring-activity/report?${query}`);
                        const csvContent = typeof res === "string" ? res : res?.data ?? res?.csv ?? JSON.stringify(res);
                        const blob = new Blob([csvContent], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url;
                        a.download = `hiring-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
                        URL.revokeObjectURL(url);
                        toast.success("Report downloaded");
                      } catch { toast.error("Failed to download report"); }
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                  >
                    <Download className="h-3 w-3" />
                    Report
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadAnalytics()}
                    disabled={analyticsLoading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${analyticsLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">From</div>
                  <input type="date" value={aFromDate} onChange={(e) => setAFromDate(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">To</div>
                  <input type="date" value={aToDate} onChange={(e) => setAToDate(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Branch</div>
                  <input type="text" placeholder="All branches" value={aBranch} onChange={(e) => setABranch(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Process</div>
                  <select value={aProcess} onChange={(e) => setAProcess(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white">
                    <option value="">All</option>
                    {processOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Source</div>
                  <select value={aSource} onChange={(e) => setASource(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white">
                    <option value="">All</option>
                    {sourceOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Recruiter</div>
                  <input type="text" placeholder="Exact name" value={aRecruiter} onChange={(e) => setARecruiter(e.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs outline-none focus:border-violet-400 focus:bg-white" />
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={() => void loadAnalytics()} disabled={analyticsLoading}
                    className="h-8 w-full rounded-lg bg-violet-600 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                    Apply
                  </button>
                </div>
              </div>
            </div>

            {analyticsLoading && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}
            {!analyticsLoading && !analytics && (
              <div className="py-16 text-center text-sm text-slate-400">
                Analytics data could not be loaded.
                <button type="button" onClick={() => void loadAnalytics()} className="ml-2 underline text-slate-600">Retry</button>
              </div>
            )}

            {analytics && (() => {
              const totalLogged = analytics.funnel[0]?.count ?? 0;
              const selPct      = analytics.funnel[3]?.pct ?? 0;
              const joinPct     = analytics.funnel[4]?.pct ?? 0;
              const selCount    = analytics.funnel[3]?.count ?? 0;
              const joinCount   = analytics.funnel[4]?.count ?? 0;

              // ApexCharts: outcome donut
              const donutTotal   = analytics.byOutcome.reduce((a, b) => a + b.count, 0);
              const donutSeries  = analytics.byOutcome.map((o) => o.count);
              const donutLabels  = analytics.byOutcome.map((o) => o.label);
              const donutOptions: ApexOptions = {
                chart: { type: "donut", toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
                labels: donutLabels,
                colors: CHART_COLORS,
                plotOptions: {
                  pie: { donut: { size: "62%", labels: { show: true,
                    value: { fontSize: "20px", fontWeight: 800, color: "#1e293b" },
                    total: { show: true, label: "Total", fontSize: "11px", fontWeight: 700, color: "#64748b",
                      formatter: () => String(donutTotal) } } } },
                },
                legend: { position: "bottom", fontSize: "11px", itemMargin: { horizontal: 6, vertical: 4 } },
                dataLabels: { enabled: false },
                tooltip: { y: { formatter: (v: number) => `${v} (${donutTotal ? Math.round(v / donutTotal * 1000) / 10 : 0}%)` } },
                stroke: { width: 2 },
              };

              // ApexCharts: day-of-week bar
              const dowData    = analytics.byDayOfWeek ?? [];
              const dowOptions: ApexOptions = {
                chart: { type: "bar", toolbar: { show: false }, sparkline: { enabled: false } },
                plotOptions: { bar: { borderRadius: 4, columnWidth: "55%",
                  colors: { ranges: [{ from: 0, to: 0, color: "#e2e8f0" }] } } },
                xaxis: { categories: dowData.map((d) => d.label), labels: { style: { fontSize: "11px" } } },
                yaxis: { labels: { style: { fontSize: "10px" } }, allowDecimals: false },
                colors: ["#8b5cf6"],
                dataLabels: { enabled: false },
                grid: { strokeDashArray: 3, borderColor: "#f1f5f9" },
                tooltip: { y: { formatter: (v: number) => `${v} activities` } },
              };

              // ApexCharts: source conversion grouped bar
              const srcLabels   = analytics.bySource.map((s) => s.label);
              const srcOptions: ApexOptions = {
                chart: { type: "bar", toolbar: { show: false } },
                plotOptions: { bar: { columnWidth: "60%", borderRadius: 3, grouped: true } },
                xaxis: { categories: srcLabels, labels: { style: { fontSize: "10px" }, rotate: -30 } },
                yaxis: { labels: { style: { fontSize: "10px" } }, allowDecimals: false },
                colors: ["#94a3b8", "#0ea5e9", "#10b981", "#6366f1"],
                legend: { position: "top", fontSize: "11px", itemMargin: { horizontal: 8 } },
                dataLabels: { enabled: false },
                grid: { strokeDashArray: 3, borderColor: "#f1f5f9" },
                tooltip: { shared: true, intersect: false },
              };

              // ApexCharts: gender donut
              const genderData    = analytics.byGender ?? [];
              const genderTotal   = genderData.reduce((a, b) => a + b.count, 0);
              const genderOptions: ApexOptions = {
                chart: { type: "donut", toolbar: { show: false }, animations: { enabled: true, speed: 500 } },
                labels: genderData.map((g) => g.label),
                colors: ["#3b82f6", "#ec4899", "#f59e0b", "#94a3b8", "#10b981"],
                plotOptions: { pie: { donut: { size: "58%", labels: { show: true,
                  total: { show: true, label: "Total", fontSize: "11px", fontWeight: 700, color: "#64748b",
                    formatter: () => String(genderTotal) } } } } },
                legend: { position: "bottom", fontSize: "11px" },
                dataLabels: { enabled: true, formatter: (val: number) => `${Math.round(val)}%` },
                stroke: { width: 2 },
              };

              return (
                <>
                  {/* ── KPI tiles ── */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <KpiTile label="Total Candidates" value={totalLogged.toLocaleString()} color="border-slate-300" icon={<Users className="h-4 w-4 text-slate-400" />} />
                    <KpiTile label="Walk-ins" value={(analytics.funnel[2]?.count ?? 0).toLocaleString()} sub={`${analytics.funnel[2]?.pct ?? 0}% of logged`} color="border-blue-300" icon={<UserRound className="h-4 w-4 text-blue-500" />} />
                    <KpiTile label="Selected" value={selCount.toLocaleString()} sub={`${selPct}% selection rate`} color="border-emerald-300" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} />
                    <KpiTile label="Joined" value={joinCount.toLocaleString()} sub={`${joinPct}% join rate`} color="border-violet-300" icon={<BadgeCheck className="h-4 w-4 text-violet-500" />} />
                    <KpiTile
                      label="Follow-ups"
                      value={analytics.followupDue.length}
                      sub="due in 7 days"
                      color={analytics.followupDue.length > 0 ? "border-amber-400" : "border-slate-200"}
                      icon={<Bell className="h-4 w-4 text-amber-500" />}
                    />
                  </div>

                  {/* ── Visual Hiring Funnel ── */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-sm font-black text-slate-900">Hiring Funnel</div>
                      <div className="text-xs text-slate-400">Conversion at each stage</div>
                    </div>
                    {analytics.funnel.length === 0 ? (
                      <AnalyticsEmptyState label="No funnel data" />
                    ) : (
                      <div className="relative flex flex-col items-center gap-0">
                        {analytics.funnel.map((stage, i) => {
                          const maxCount = analytics.funnel[0]?.count || 1;
                          const widthPct = Math.max(20, (stage.count / maxCount) * 100);
                          const dropOff = i > 0 ? analytics.funnel[i - 1].count - stage.count : 0;
                          const dropPct = i > 0 && analytics.funnel[i - 1].count > 0
                            ? Math.round((dropOff / analytics.funnel[i - 1].count) * 100) : 0;
                          const colors = [
                            "from-slate-500 to-slate-600",
                            "from-blue-500 to-blue-600",
                            "from-amber-500 to-amber-600",
                            "from-emerald-500 to-emerald-600",
                            "from-violet-500 to-violet-600",
                          ];
                          const bgColor = colors[i] ?? "from-slate-500 to-slate-600";
                          return (
                            <div key={stage.stage} className="w-full flex flex-col items-center">
                              {i > 0 && dropOff > 0 && (
                                <div className="flex items-center gap-2 py-0.5">
                                  <div className="h-px w-8 bg-rose-200" />
                                  <span className="text-[10px] font-bold text-rose-500">−{dropOff} ({dropPct}% drop)</span>
                                  <div className="h-px w-8 bg-rose-200" />
                                </div>
                              )}
                              {i > 0 && dropOff === 0 && <div className="h-1" />}
                              <div
                                className={`relative flex items-center justify-between rounded-xl bg-gradient-to-r ${bgColor} px-5 py-3 text-white shadow-sm transition-all hover:shadow-md hover:scale-[1.01]`}
                                style={{ width: `${widthPct}%`, minWidth: "200px" }}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold">{stage.stage}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-lg font-black tabular-nums">{stage.count.toLocaleString()}</span>
                                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                                    {stage.pct}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Conversion summary */}
                        {analytics.funnel.length >= 2 && (
                          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-center">
                              <div className="text-lg font-black text-emerald-600">
                                {analytics.funnel[0].count > 0 ? Math.round((analytics.funnel[analytics.funnel.length - 1].count / analytics.funnel[0].count) * 100) : 0}%
                              </div>
                              <div className="text-[10px] font-bold uppercase text-slate-400">Overall Conversion</div>
                            </div>
                            {analytics.funnel.map((s, i) => i > 0 && (
                              <div key={s.stage} className="text-center">
                                <div className="text-sm font-black text-slate-700">
                                  {analytics.funnel[i - 1].count > 0 ? Math.round((s.count / analytics.funnel[i - 1].count) * 100) : 0}%
                                </div>
                                <div className="text-[10px] text-slate-400">{analytics.funnel[i - 1].stage} → {s.stage}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Row 1: Outcome Donut + KPIs side ── */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Outcome Donut — ApexCharts */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-3 text-sm font-black text-slate-900">Outcome Distribution</div>
                      {analytics.byOutcome.length === 0 ? (
                        <AnalyticsEmptyState label="No outcome data" />
                      ) : (
                        <ReactApexChart type="donut" series={donutSeries} options={donutOptions} height={280} />
                      )}
                    </div>

                    {/* Stage-to-stage conversion cards */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-3 text-sm font-black text-slate-900">Stage Conversion Rates</div>
                      <div className="grid grid-cols-2 gap-3">
                        {analytics.funnel.map((s, i) => {
                          if (i === 0) return null;
                          const prev = analytics.funnel[i - 1];
                          const rate = prev.count > 0 ? Math.round((s.count / prev.count) * 100) : 0;
                          const rateColor = rate >= 60 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                            : rate >= 30 ? "text-amber-600 bg-amber-50 border-amber-200"
                            : "text-rose-600 bg-rose-50 border-rose-200";
                          return (
                            <div key={s.stage} className={`rounded-xl border p-3 ${rateColor}`}>
                              <div className="text-2xl font-black">{rate}%</div>
                              <div className="text-[10px] font-bold uppercase mt-0.5">{prev.stage} → {s.stage}</div>
                              <div className="text-[10px] mt-1 opacity-75">{prev.count} → {s.count}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── Row 2: Activity Trend + Day of Week ── */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Trend — unchanged */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900 flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-slate-500" />
                          Activity Trend
                        </div>
                        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                          {(["daily", "weekly", "monthly"] as const).map((p) => (
                            <button key={p} type="button" onClick={() => setTrendPeriod(p)}
                              className={`px-2.5 py-1 text-[10px] font-bold uppercase ${trendPeriod === p ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={220}>
                        {trendPeriod === "daily" ? (
                          <LineChart data={aggregatedTrend} margin={{ left: -10, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="logged" stroke="#64748b" dot={false} name="Logged" strokeWidth={2} />
                            <Line type="monotone" dataKey="walkins" stroke="#0ea5e9" dot={false} name="Walk-ins" strokeWidth={2} />
                            <Line type="monotone" dataKey="selected" stroke="#10b981" dot={false} name="Selected" strokeWidth={2} />
                          </LineChart>
                        ) : (
                          <BarChart data={aggregatedTrend} margin={{ left: -10, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="logged" fill="#64748b" name="Logged" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="walkins" fill="#0ea5e9" name="Walk-ins" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="selected" fill="#10b981" name="Selected" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>

                    {/* Day of Week — ApexCharts */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-3 text-sm font-black text-slate-900">Activity by Day of Week</div>
                      {dowData.every((d) => d.count === 0) ? (
                        <AnalyticsEmptyState label="No day-of-week data" />
                      ) : (
                        <ReactApexChart
                          type="bar"
                          series={[{ name: "Activities", data: dowData.map((d) => d.count) }]}
                          options={dowOptions}
                          height={220}
                        />
                      )}
                    </div>
                  </div>

                  {/* ── Row 3: Source Conversion — full width ── */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-1 text-sm font-black text-slate-900">Source Conversion</div>
                    <div className="mb-3 text-xs text-slate-400">Logged → Walk-in → Selected → Joined per source</div>
                    {analytics.bySource.length === 0 ? (
                      <AnalyticsEmptyState label="No source data" />
                    ) : (
                      <ReactApexChart
                        type="bar"
                        series={[
                          { name: "Logged",   data: analytics.bySource.map((s) => s.total) },
                          { name: "Walk-in",  data: analytics.bySource.map((s) => s.walkins) },
                          { name: "Selected", data: analytics.bySource.map((s) => s.selected) },
                          { name: "Joined",   data: analytics.bySource.map((s) => s.joined) },
                        ]}
                        options={srcOptions}
                        height={280}
                      />
                    )}
                  </div>

                  {/* ── Row 4: Process + Branch ── */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Process Breakdown */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-1 text-sm font-black text-slate-900">Process Breakdown</div>
                      <div className="mb-3 text-xs text-slate-400">Candidates per process — logged → walk-in → selected → joined</div>
                      {analytics.byProcess.length === 0 ? (
                        <AnalyticsEmptyState label="No process data" />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(180, analytics.byProcess.length * 40)}>
                          <BarChart data={analytics.byProcess} layout="vertical" margin={{ left: 10, right: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={120} />
                            <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="total"    fill="#94a3b8" name="Logged"   radius={[0, 3, 3, 0]} />
                            <Bar dataKey="walkins"  fill="#0ea5e9" name="Walk-in"  radius={[0, 3, 3, 0]} />
                            <Bar dataKey="selected" fill="#10b981" name="Selected" radius={[0, 3, 3, 0]} />
                            <Bar dataKey="joined"   fill="#6366f1" name="Joined"   radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Branch Breakdown */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-1 text-sm font-black text-slate-900">Branch Breakdown</div>
                      <div className="mb-3 text-xs text-slate-400">Candidates per branch — logged → walk-in → selected → joined</div>
                      {(analytics.byBranch ?? []).length === 0 ? (
                        <AnalyticsEmptyState label="No branch data" />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(180, (analytics.byBranch ?? []).length * 40)}>
                          <BarChart data={analytics.byBranch ?? []} layout="vertical" margin={{ left: 10, right: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={110} />
                            <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="total"    fill="#94a3b8" name="Logged"   radius={[0, 3, 3, 0]} />
                            <Bar dataKey="walkins"  fill="#0ea5e9" name="Walk-in"  radius={[0, 3, 3, 0]} />
                            <Bar dataKey="selected" fill="#10b981" name="Selected" radius={[0, 3, 3, 0]} />
                            <Bar dataKey="joined"   fill="#6366f1" name="Joined"   radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {/* ── Row 5: Gender Donut + Recruiter Conversion ── */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Gender Distribution */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-1 text-sm font-black text-slate-900">Gender Distribution</div>
                      <div className="mb-3 text-xs text-slate-400">Candidates by gender with conversion</div>
                      {genderData.length === 0 ? (
                        <AnalyticsEmptyState label="No gender data" />
                      ) : (
                        <div className="space-y-2">
                          <ReactApexChart
                            type="donut"
                            series={genderData.map((g) => g.count)}
                            options={genderOptions}
                            height={180}
                          />
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-100">
                                  <th className="py-1 text-left text-[10px] font-bold uppercase text-slate-400">Gender</th>
                                  <th className="py-1 text-right text-[10px] font-bold uppercase text-slate-400">Total</th>
                                  <th className="py-1 text-right text-[10px] font-bold uppercase text-slate-400">Walk-in</th>
                                  <th className="py-1 text-right text-[10px] font-bold uppercase text-slate-400">Selected</th>
                                  <th className="py-1 text-right text-[10px] font-bold uppercase text-slate-400">Joined</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {genderData.map((g) => (
                                  <tr key={g.label}>
                                    <td className="py-1 font-semibold text-slate-700">{g.label}</td>
                                    <td className="py-1 text-right tabular-nums">{g.count}</td>
                                    <td className="py-1 text-right tabular-nums text-sky-600">{(g as any).walkins ?? 0}</td>
                                    <td className="py-1 text-right tabular-nums text-emerald-600">{(g as any).selected ?? 0}</td>
                                    <td className="py-1 text-right tabular-nums text-violet-600 font-bold">{g.joined ?? 0}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Recruiter Conversion */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="mb-3 text-sm font-black text-slate-900">Recruiter Conversion</div>
                      {analytics.byRecruiter.length === 0 ? (
                        <AnalyticsEmptyState label="No recruiter data" />
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(180, analytics.byRecruiter.length * 36)}>
                          <BarChart data={analytics.byRecruiter} layout="vertical" margin={{ left: 10, right: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={100} />
                            <Tooltip formatter={(v: number, name: string) => [v, name]} />
                            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="total"    fill="#94a3b8" name="Logged"   radius={[0, 2, 2, 0]} />
                            <Bar dataKey="walkins"  fill="#0ea5e9" name="Walk-ins" radius={[0, 2, 2, 0]} />
                            <Bar dataKey="selected" fill="#10b981" name="Selected" radius={[0, 2, 2, 0]} />
                            <Bar dataKey="joined"   fill="#6366f1" name="Joined"   radius={[0, 2, 2, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {/* ── Recruiter Leaderboard ── */}
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
                              <td className="px-3 py-2 text-right tabular-nums text-sky-600">{r.walkins ?? "—"}</td>
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

                  {/* ── Follow-ups due ── */}
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
              );
            })()}
          </section>
          </Suspense>
        )}

        {/* ── TAB 2: My Entries & Progress (full-width table) ── */}
        {activeTab === "progress" && (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={entrySearchRaw}
                  onChange={(e) => setEntrySearchRaw(e.target.value)}
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
                {filterMeta.recruiters.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {roleKeys.includes("super_admin") && (
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                >
                  <option value="">All branches</option>
                  {filterMeta.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              )}
              <select
                value={filterProcess}
                onChange={(e) => setFilterProcess(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All processes</option>
                {filterMeta.processes.map((proc) => <option key={proc} value={proc}>{proc}</option>)}
              </select>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All sources</option>
                {filterMeta.sources.map((src) => <option key={src} value={src}>{src}</option>)}
              </select>
              <select
                value={filterWpGroup}
                onChange={(e) => setFilterWpGroup(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="">All WP groups</option>
                {filterMeta.wpGroups.map((wp) => <option key={wp} value={wp}>{wp}</option>)}
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
                  onClick={() => { setEntrySearchRaw(""); setFilterOutcome(""); setFilterRecruiter(""); setFilterBranch(""); setFilterProcess(""); setFilterSource(""); setFilterWpGroup(""); setFilterFrom(""); setFilterTo(""); }}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-500 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const XLSX = await import("xlsx");
                    const exportData = filteredRows.map((r: any) => ({
                      "Date": r.activity_date?.slice(0, 10) ?? "",
                      "Recruiter": r.recruiter_name_snapshot ?? "",
                      "Branch": r.branch_name ?? "",
                      "Process": r.process_name ?? "",
                      "Source": r.hiring_source ?? "",
                      "WP Group": r.wp_group ?? "",
                      "Candidate Name": r.candidate_name ?? "",
                      "Mobile": r.mobile ?? "",
                      "Gender": r.gender ?? "",
                      "Email": r.candidate_email ?? "",
                      "Education": r.education_qualification ?? "",
                      "Experience": r.experience_level ?? "",
                      "Location": r.candidate_location ?? "",
                      "Calling Outcome": r.recruiter_remarks ?? "",
                      "Rejection Reason": r.recruiter_rejection_reason ?? "",
                      "HR Interview Status": r.hr_interview_status ?? "",
                      "Ops Interview Status": r.ops_interview_status ?? "",
                      "Current Status": r.current_status ?? "",
                      "Walk-in Date": r.walkin_date ?? "",
                      "Contacted": r.contacted_flag ? "Yes" : "No",
                      "Selected": r.final_selection_flag ? "Yes" : "No",
                      "Joined": r.joined_flag ? "Yes" : "No",
                    }));
                    const ws = XLSX.utils.json_to_sheet(exportData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Hiring Activity");
                    XLSX.writeFile(wb, `hiring_activity_report_${new Date().toISOString().slice(0, 10)}.xlsx`);
                    toast.success("Report exported");
                  } catch { toast.error("Export failed"); }
                }}
                className="h-9 cursor-pointer rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
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
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 text-xs text-slate-400">{idx + 1}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900">{row.candidate_name || "—"}</span>
                              {row.is_followup_attempt === 1 && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">Follow-up</span>}
                            </div>
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
                          <td className="px-3 py-2.5 text-center">
                            {(row.created_by === bootstrap?.actor.userId || row.recruiter_id === bootstrap?.actor.userId) && (
                              <button
                                type="button"
                                onClick={() => void deleteEntry(row.id, row.candidate_name || "entry")}
                                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Delete this entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rows.length < rowsTotal && (
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

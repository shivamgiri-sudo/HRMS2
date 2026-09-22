/**
 * META Lead Gen — All Leads.
 *
 * A flat, paginated view of every lead captured from META Lead Gen forms, across all campaigns —
 * the counterpart to MetaCampaignDashboard, which is organised by campaign. This page exists to
 * answer the operational question "show me everyone who applied", independent of which requisition
 * a form is (or is not yet) linked to.
 *
 * Reads GET /api/meta/leads-all, which returns { data: rows, total } — the total drives the pager
 * so we never guess page counts from a truncated page. Search is server-side over name / phone /
 * email, screening is a server-side filter, both reset the offset to 0 on change (a stale offset
 * against a smaller filtered set would land on an empty page).
 *
 * Clicking a row opens a drill-down drawer that fetches GET /api/meta/leads/:id — the single-lead
 * endpoint that carries the raw form answers (every question META delivered, including the hidden
 * requisition_code), which the list endpoint omits to keep the 2,600-row table light.
 *
 * Every value shown is a stored, parsed lead field or a joined requisition/campaign name. There are
 * no client-side computed metrics here, so nothing on this page can drift from the database.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Mail,
  MessageCircle,
  Phone,
  RefreshCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, num } from "@/components/analytics/analytics-kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CallingFeedback =
  | "Interested"
  | "Not Interested"
  | "No Response"
  | "Rescheduled"
  | "Already Joined"
  | "Declined Offer"
  | "Wrong Number";

const CALLING_FEEDBACK_OPTIONS: CallingFeedback[] = [
  "Interested",
  "Not Interested",
  "No Response",
  "Rescheduled",
  "Already Joined",
  "Declined Offer",
  "Wrong Number",
];

const CALLING_FEEDBACK_BADGE: Record<CallingFeedback, string> = {
  Interested: "bg-emerald-100 text-emerald-700",
  "Not Interested": "bg-rose-100 text-rose-700",
  "No Response": "bg-slate-100 text-slate-600",
  Rescheduled: "bg-amber-100 text-amber-700",
  "Already Joined": "bg-blue-100 text-blue-700",
  "Declined Offer": "bg-rose-100 text-rose-700",
  "Wrong Number": "bg-gray-100 text-gray-600",
};

type Lead = {
  id: string;
  metaFormId: string;
  metaLeadId: string;
  campaignId: string | null;
  requisitionId: string | null;
  parsedName: string | null;
  parsedPhone: string | null;
  parsedEmail: string | null;
  parsedAge: number | null;
  parsedLocation: string | null;
  parsedEducation: string | null;
  parsedExperienceYr: number | null;
  screeningResult: "pending" | "qualified" | "disqualified";
  disqualificationReason: string | null;
  atsCandidateId: string | null;
  notificationSentAt: string | null;
  voiceCallStatus: string | null;
  unreadMessageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  requisitionCode: string | null;
  designationName: string | null;
  branchName: string | null;
  campaignName: string | null;
  callingFeedback: CallingFeedback | null;
  callingFeedbackAt: string | null;
  callingFeedbackNotes: string | null;
};

type LeadDetail = Lead & {
  routingCode: string | null;
  fields: Array<{ name: string; value: string }>;
};

type NotifyPreview = {
  candidateName: string | null;
  phone: string | null;
  designation: string | null;
  branch: string | null;
  branchCity: string | null;
  branchAddress: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  mapsLink: string;
  messageBody: string;
  alreadySent: boolean;
};

const SCREENING_BADGE: Record<Lead["screeningResult"], string> = {
  qualified: "bg-emerald-100 text-emerald-700",
  disqualified: "bg-rose-100 text-rose-700",
  pending: "bg-amber-100 text-amber-700",
};

const PAGE_SIZE = 50;

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Pretty-print a raw META field name (snake_case question) into a readable label. */
function humaniseFieldName(name: string): string {
  return name
    .replace(/[_?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Quote and escape any cell that could break CSV structure or trigger formula injection.
  const needsQuote = /[",\n\r]/.test(s) || /^[=+\-@]/.test(s);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export default function MetaLeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [screening, setScreening] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  // Dimension filters — server-side
  const [branchFilter, setBranchFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [requisitionFilter, setRequisitionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOptions, setFilterOptions] = useState<{
    branches: string[];
    processes: string[];
    requisitions: Array<{ id: string; code: string; designation: string }>;
  }>({ branches: [], processes: [], requisitions: [] });

  // Drill-down drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // WhatsApp notification — per-lead status
  const [notifyResults, setNotifyResults] = useState<Record<string, 'sending' | 'sent' | 'failed'>>({});
  // sentOverrides tracks leads notified this session (before next server reload)
  const [sentOverrides, setSentOverrides] = useState<Set<string>>(new Set());

  // Bulk notify state
  const [bulkNotifying, setBulkNotifying] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: number } | null>(null);

  // Notify preview dialog state
  const [previewFor, setPreviewFor] = useState<{ id: string; preview: NotifyPreview } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  // Calling feedback state
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState("");

  const saveCallingFeedback = useCallback(async (leadId: string, feedback: CallingFeedback, notes?: string) => {
    setSavingFeedback(true);
    try {
      const res = await hrmsApi.post(`/meta/leads/${leadId}/calling-feedback`, {
        calling_feedback: feedback,
        notes: notes || undefined,
      });
      if (!res.success) throw new Error(res.message || "Failed to save feedback");
      // Update detail and row list with new feedback
      setDetail((prev) =>
        prev && prev.id === leadId
          ? { ...prev, callingFeedback: feedback, callingFeedbackAt: new Date().toISOString(), callingFeedbackNotes: notes || null }
          : prev
      );
      setRows((prev) =>
        prev.map((r) =>
          r.id === leadId
            ? { ...r, callingFeedback: feedback, callingFeedbackAt: new Date().toISOString(), callingFeedbackNotes: notes || null }
            : r
        )
      );
      setFeedbackNotes("");
    } catch (err) {
      console.error("Failed to save calling feedback:", err);
      setDetailError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSavingFeedback(false);
    }
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setErrorMsg("");
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        if (search.trim()) params.set("search", search.trim());
        if (screening !== "all") params.set("screening", screening);
        if (branchFilter) params.set("branchName", branchFilter);
        if (processFilter) params.set("processName", processFilter);
        if (requisitionFilter) params.set("requisitionId", requisitionFilter);
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        const res = await hrmsApi.get<{ success: boolean; data: Lead[]; total: number }>(
          `/api/meta/leads-all?${params.toString()}`
        );
        setRows(res.data ?? []);
        setTotal(Number(res.total ?? 0));
      } catch (err: unknown) {
        setErrorMsg((err as { message?: string })?.message || "Unable to load leads");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [offset, search, screening, branchFilter, processFilter, requisitionFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Debounce the search box so a burst of keystrokes fires one request, and reset paging.
  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset paging when any dimension filter changes.
  useEffect(() => {
    setOffset(0);
  }, [branchFilter, processFilter, requisitionFilter, dateFrom, dateTo]);

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: typeof filterOptions }>("/api/meta/filter-options")
      .then((res) => setFilterOptions(res.data ?? { branches: [], processes: [], requisitions: [] }))
      .catch(() => {});
  }, []);

  const openLead = useCallback(async (lead: Lead) => {
    setDrawerOpen(true);
    setDetailLoading(true);
    setDetailError("");
    // Seed the drawer from the row we already have, so the header renders instantly while the
    // full field data loads.
    setDetail({ ...lead, routingCode: null, fields: [] });
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LeadDetail }>(`/api/meta/leads/${lead.id}`);
      setDetail(res.data);
    } catch (err: unknown) {
      setDetailError((err as { message?: string })?.message || "Unable to load lead detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const notifyLead = useCallback(async (leadId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNotifyResults((prev) => ({ ...prev, [leadId]: 'sending' }));
    try {
      await hrmsApi.post(`/api/meta/leads/${leadId}/notify`, {});
      setNotifyResults((prev) => ({ ...prev, [leadId]: 'sent' }));
      setSentOverrides((prev) => new Set([...prev, leadId]));
      const now = new Date().toISOString();
      setRows((prev) => prev.map((r) => (r.id === leadId ? { ...r, notificationSentAt: now } : r)));
      setDetail((prev) => (prev?.id === leadId ? { ...prev, notificationSentAt: now } : prev));
    } catch {
      setNotifyResults((prev) => ({ ...prev, [leadId]: 'failed' }));
    }
  }, []);

  async function notifyAllQualified() {
    if (bulkNotifying) return;
    const unnotified = rows.filter(
      (r) => r.screeningResult === 'qualified' && !sentOverrides.has(r.id) && !r.notificationSentAt
    );
    if (unnotified.length === 0) return;
    setBulkNotifying(true);
    setBulkResult(null);
    let sent = 0, failed = 0;
    for (const lead of unnotified) {
      try {
        await hrmsApi.post(`/api/meta/leads/${lead.id}/notify`, {});
        sent++;
        setSentOverrides((prev) => new Set([...prev, lead.id]));
        setRows((prev) => prev.map((r) => r.id === lead.id ? { ...r, notificationSentAt: new Date().toISOString() } : r));
      } catch {
        failed++;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setBulkNotifying(false);
    setBulkResult({ sent, failed });
  }

  async function openNotifyPreview(leadId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setLoadingPreview(leadId);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: NotifyPreview }>(`/api/meta/leads/${leadId}/notify-preview`);
      setPreviewFor({ id: leadId, preview: res.data });
    } catch {
      // fallback: send directly without preview
      void notifyLead(leadId, e);
    } finally {
      setLoadingPreview(null);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);

  const exportCsv = useMemo(
    () => () => {
      const header = [
        "Name", "Phone", "Email", "Age", "Location", "Education", "Experience (yrs)",
        "Screening", "Disqualification Reason", "Requisition", "Designation", "Branch",
        "Campaign", "ATS Candidate", "Notified", "Received",
      ];
      const lines = rows.map((l) =>
        [
          l.parsedName, l.parsedPhone, l.parsedEmail, l.parsedAge, l.parsedLocation,
          l.parsedEducation, l.parsedExperienceYr, l.screeningResult, l.disqualificationReason,
          l.requisitionCode, l.designationName, l.branchName, l.campaignName,
          l.atsCandidateId ? "yes" : "no", l.notificationSentAt ? "yes" : "no",
          fmtDateTime(l.createdAt),
        ]
          .map(csvCell)
          .join(",")
      );
      const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meta-leads-page-${page}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [rows, page]
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Users className="h-6 w-6 text-blue-600" /> META Leads
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Every lead captured from META Lead Gen forms across all campaigns. {num(total)} total.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export page
            </button>
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Loading…" : "Refresh"}
            </button>
          </div>
        </header>

        {errorMsg && (
          <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search leads by name, phone or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone or email"
              className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {searchInput && (
              <button
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select
              aria-label="Filter by screening result"
              value={screening}
              onChange={(e) => {
                setOffset(0);
                setScreening(e.target.value);
              }}
              className="h-10 rounded-lg border border-slate-200 pl-8 pr-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500"
            >
              {[
                ["all", "All screening"],
                ["qualified", "Qualified"],
                ["disqualified", "Disqualified"],
                ["pending", "Pending"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Select
            value={branchFilter}
            onValueChange={(v) => setBranchFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-10 w-[150px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Branches</SelectItem>
              {filterOptions.branches.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={processFilter}
            onValueChange={(v) => setProcessFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-10 w-[150px]">
              <SelectValue placeholder="Process" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Processes</SelectItem>
              {filterOptions.processes.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={requisitionFilter}
            onValueChange={(v) => setRequisitionFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-10 w-[190px]">
              <SelectValue placeholder="Requisition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Requisitions</SelectItem>
              {filterOptions.requisitions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.code}{r.designation ? ` — ${r.designation}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            type="date"
            aria-label="Date from"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <input
            type="date"
            aria-label="Date to"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {(branchFilter || processFilter || requisitionFilter || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setBranchFilter("");
                setProcessFilter("");
                setRequisitionFilter("");
                setDateFrom("");
                setDateTo("");
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          )}
          {screening === "qualified" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void notifyAllQualified()}
                disabled={bulkNotifying}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <MessageCircle className="h-4 w-4" />
                {bulkNotifying
                  ? 'Notifying…'
                  : `Notify All (${rows.filter((r) => r.screeningResult === 'qualified' && !sentOverrides.has(r.id) && !r.notificationSentAt).length})`}
              </button>
              {bulkResult && (
                <span className="text-sm font-medium text-emerald-700">
                  {bulkResult.sent} sent{bulkResult.failed > 0 ? `, ${bulkResult.failed} failed` : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                label={search || screening !== "all" ? "No leads match these filters" : "No leads captured yet"}
                hint={
                  search || screening !== "all"
                    ? "Clear the search box or screening filter."
                    : "Leads appear here once a Lead Gen form is linked and its history is imported, or as new form fills arrive via the webhook."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left">
                  <tr className="border-b border-slate-200">
                    {[
                      { label: "Name", w: "w-40" },
                      { label: "Phone", w: "w-32" },
                      { label: "Email", w: "w-44" },
                      { label: "Age", w: "w-14" },
                      { label: "Location", w: "w-28" },
                      { label: "Education", w: "w-28" },
                      { label: "Exp", w: "w-16" },
                      { label: "Screening", w: "w-32" },
                      { label: "Requisition", w: "w-36" },
                      { label: "Campaign", w: "w-44" },
                      { label: "ATS", w: "w-24" },
                      { label: "Received", w: "w-32" },
                    ].map(({ label, w }) => (
                      <th key={label} className={`px-3 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 ${w}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => void openLead(l)}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-blue-50/60"
                    >
                      {/* Name */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">{l.parsedName ?? "—"}</span>
                          {l.unreadMessageCount > 0 && (
                            <a
                              href="/ats/whatsapp-inbox"
                              onClick={(e) => e.stopPropagation()}
                              className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-600"
                              title={`${l.unreadMessageCount} unread WhatsApp message${l.unreadMessageCount > 1 ? "s" : ""}`}
                            >
                              <MessageCircle className="h-2.5 w-2.5" />
                              {l.unreadMessageCount}
                            </a>
                          )}
                        </div>
                      </td>
                      {/* Phone */}
                      <td className="px-3 py-2.5">
                        {l.parsedPhone ? (
                          <a href={`tel:${l.parsedPhone}`} onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-sm text-blue-700 hover:underline">
                            <Phone className="h-3 w-3 shrink-0" />{l.parsedPhone}
                          </a>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      {/* Email */}
                      <td className="max-w-[170px] px-3 py-2.5">
                        {l.parsedEmail ? (
                          <a href={`mailto:${l.parsedEmail}`} onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-sm text-blue-700 hover:underline"
                            title={l.parsedEmail}>
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{l.parsedEmail}</span>
                          </a>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      {/* Age */}
                      <td className="px-3 py-2.5 text-sm text-slate-600">{l.parsedAge != null ? `${l.parsedAge} yr` : "—"}</td>
                      {/* Location */}
                      <td className="px-3 py-2.5 text-sm text-slate-600">{l.parsedLocation ?? "—"}</td>
                      {/* Education */}
                      <td className="px-3 py-2.5 text-sm text-slate-600">{l.parsedEducation ?? "—"}</td>
                      {/* Exp */}
                      <td className="px-3 py-2.5 text-sm text-slate-600">
                        {l.parsedExperienceYr != null ? `${l.parsedExperienceYr} yr` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${SCREENING_BADGE[l.screeningResult]}`}>
                          {l.screeningResult}
                        </span>
                        {l.disqualificationReason && (
                          <div className="mt-1 max-w-[190px] text-xs leading-snug text-slate-500">{l.disqualificationReason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-sm text-slate-700">{l.requisitionCode ?? "—"}</div>
                        <div className="text-xs text-slate-400">
                          {l.designationName ?? (l.requisitionId ? "—" : "unlinked form")}
                          {l.branchName ? ` · ${l.branchName}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-[210px] truncate text-sm text-slate-600" title={l.campaignName ?? ""}>
                          {l.campaignName ?? "—"}
                        </div>
                        <div className="font-mono text-xs text-slate-400">form {l.metaFormId}</div>
                      </td>
                      <td className="px-3 py-2.5 text-sm">
                        <div>
                          {l.atsCandidateId ? (
                            <span className="font-semibold text-emerald-600">created</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                        {l.screeningResult === "qualified" && !(sentOverrides.has(l.id) || l.notificationSentAt) && (
                          <button
                            onClick={(e) => void openNotifyPreview(l.id, e)}
                            disabled={notifyResults[l.id] === 'sending' || loadingPreview === l.id}
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <MessageCircle className="h-3 w-3" />
                            {loadingPreview === l.id ? '…' : notifyResults[l.id] === 'sending' ? '…' : notifyResults[l.id] === 'failed' ? 'Retry' : 'Notify'}
                          </button>
                        )}
                        {notifyResults[l.id] === 'failed' && (
                          <div className="text-xs text-rose-500">send failed</div>
                        )}
                        {(sentOverrides.has(l.id) || l.notificationSentAt) && (
                          <div className="text-xs text-emerald-600">
                            ✓ notified {l.notificationSentAt ? fmtDateTime(l.notificationSentAt) : 'just now'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDateTime(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pager */}
          {!loading && total > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <p className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-700">{num(showingFrom)}</span>–
                <span className="font-semibold text-slate-700">{num(showingTo)}</span> of{" "}
                <span className="font-semibold text-slate-700">{num(total)}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <span className="text-sm font-semibold text-slate-600">
                  Page {num(page)} / {num(pageCount)}
                </span>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={page >= pageCount}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drill-down drawer */}
      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            setDetail(null);
            setDetailError("");
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <SheetTitle className="text-lg font-bold text-slate-900">{detail?.parsedName ?? "Lead"}</SheetTitle>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {detail?.parsedPhone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {detail.parsedPhone}
                </span>
              )}
              {detail?.parsedEmail && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {detail.parsedEmail}
                </span>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {detailError && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {detailError}
              </div>
            )}

            {/* Screening + routing summary */}
            {detail && (
              <section className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Screening</p>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-sm font-bold ${SCREENING_BADGE[detail.screeningResult]}`}>
                    {detail.screeningResult}
                  </span>
                  {detail.disqualificationReason && (
                    <p className="mt-1.5 text-xs leading-snug text-slate-500">{detail.disqualificationReason}</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">ATS Candidate</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {detail.atsCandidateId ? "Created" : "Not created"}
                  </p>
                  {(sentOverrides.has(detail.id) || detail.notificationSentAt) ? (
                    <p className="mt-0.5 text-xs text-emerald-600">
                      ✓ Notified {detail.notificationSentAt ? fmtDateTime(detail.notificationSentAt) : 'just now'}
                    </p>
                  ) : detail.screeningResult === "qualified" ? (
                    <div className="mt-1.5 space-y-1">
                      <button
                        onClick={() => void notifyLead(detail.id)}
                        disabled={notifyResults[detail.id] === 'sending'}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {notifyResults[detail.id] === 'sending' ? "Sending…" : "Send WhatsApp Notification"}
                      </button>
                      {notifyResults[detail.id] === 'failed' && (
                        <p className="text-xs text-rose-600">Send failed — check Wassenger config and retry.</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-400">Not notified</p>
                  )}
                </div>
              </section>
            )}

            {/* Calling Feedback */}
            {detail && (
              <section className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Calling Feedback</p>
                {detail.callingFeedback && (
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-bold ${CALLING_FEEDBACK_BADGE[detail.callingFeedback]}`}>
                      {detail.callingFeedback}
                    </span>
                    <p className="mt-1 text-xs text-slate-500">
                      {fmtDateTime(detail.callingFeedbackAt)}
                    </p>
                    {detail.callingFeedbackNotes && (
                      <p className="mt-1 text-xs italic text-slate-600">{detail.callingFeedbackNotes}</p>
                    )}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  <Select
                    value={detail.callingFeedback ?? ""}
                    onValueChange={(val) => {
                      if (val && val !== detail.callingFeedback) {
                        void saveCallingFeedback(detail.id, val as CallingFeedback, feedbackNotes);
                      }
                    }}
                    disabled={savingFeedback}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select call outcome…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CALLING_FEEDBACK_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                  {savingFeedback && <p className="text-xs text-slate-500">Saving…</p>}
                </div>
              </section>
            )}

            {/* Routing */}
            {detail && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Routing</h3>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Requisition</dt>
                    <dd className="text-right font-mono text-slate-800">{detail.requisitionCode ?? "unlinked"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Designation</dt>
                    <dd className="text-right text-slate-800">
                      {detail.designationName ?? "—"}
                      {detail.branchName ? ` · ${detail.branchName}` : ""}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Campaign</dt>
                    <dd className="text-right text-slate-800">{detail.campaignName ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Source form</dt>
                    <dd className="text-right font-mono text-slate-700">{detail.metaFormId}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Hidden routing code</dt>
                    <dd className="text-right font-mono text-slate-800">{detail.routingCode ?? "none"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Received</dt>
                    <dd className="text-right text-slate-700">{fmtDateTime(detail.createdAt)}</dd>
                  </div>
                </dl>
              </section>
            )}

            {/* Raw form answers */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                Form Answers {detail?.fields?.length ? `(${detail.fields.length})` : ""}
              </h3>
              {detailLoading ? (
                <div className="mt-2 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
                  ))}
                </div>
              ) : detail?.fields?.length ? (
                <dl className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detail.fields.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="grid grid-cols-2 gap-3 px-3 py-2">
                      <dt className="text-sm text-slate-500">{humaniseFieldName(f.name)}</dt>
                      <dd className="text-right text-sm font-medium text-slate-800">{f.value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  No raw form answers stored (this lead may be a fetch stub).
                </p>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
      {/* Notify preview dialog */}
      <Dialog open={!!previewFor} onOpenChange={(o) => { if (!o) setPreviewFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-emerald-600" />
              WhatsApp Message Preview
            </DialogTitle>
            <DialogDescription>
              Review the message before sending to {previewFor?.preview.candidateName ?? "candidate"} · {previewFor?.preview.phone}
            </DialogDescription>
          </DialogHeader>
          {previewFor && (
            <div className="space-y-4">
              {/* Key details */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                {previewFor.preview.designation && (
                  <div><span className="text-xs font-bold uppercase text-slate-400">Role</span><p className="font-semibold text-slate-800">{previewFor.preview.designation}</p></div>
                )}
                {previewFor.preview.branch && (
                  <div><span className="text-xs font-bold uppercase text-slate-400">Branch</span><p className="font-semibold text-slate-800">{previewFor.preview.branchCity ?? previewFor.preview.branch}</p></div>
                )}
                {previewFor.preview.salaryMin && (
                  <div><span className="text-xs font-bold uppercase text-slate-400">Salary</span><p className="font-semibold text-slate-800">₹{previewFor.preview.salaryMin.toLocaleString("en-IN")}–₹{(previewFor.preview.salaryMax ?? previewFor.preview.salaryMin).toLocaleString("en-IN")}/mo</p></div>
                )}
                {previewFor.preview.branchAddress && (
                  <div className="col-span-2"><span className="text-xs font-bold uppercase text-slate-400">Address</span><p className="text-slate-700">{previewFor.preview.branchAddress}</p></div>
                )}
                {previewFor.preview.mapsLink && (
                  <div className="col-span-2"><a href={previewFor.preview.mapsLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm hover:underline">📍 View on Google Maps</a></div>
                )}
              </div>
              {/* Message body */}
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Message to be sent</p>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-[#d9fdd3] p-3 text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                  {previewFor.preview.messageBody}
                </div>
              </div>
              {previewFor.preview.alreadySent && (
                <p className="text-xs text-amber-600">⚠ This candidate was already notified. Sending again will re-deliver the message.</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setPreviewFor(null)}
                  className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={notifyResults[previewFor.id] === 'sending'}
                  onClick={() => { void notifyLead(previewFor.id, { stopPropagation: () => {} } as React.MouseEvent); setPreviewFor(null); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  <MessageCircle className="h-4 w-4" />
                  Send WhatsApp
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

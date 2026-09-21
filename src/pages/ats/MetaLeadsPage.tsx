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
import { EmptyState, num } from "@/components/analytics/analytics-kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  createdAt: string;
  requisitionCode: string | null;
  designationName: string | null;
  branchName: string | null;
  campaignName: string | null;
};

type LeadDetail = Lead & {
  routingCode: string | null;
  fields: Array<{ name: string; value: string }>;
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

  // WhatsApp notification
  const [notifying, setNotifying] = useState<Set<string>>(new Set());
  const [notifyResult, setNotifyResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

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
    setNotifying((prev) => new Set(prev).add(leadId));
    try {
      const res = await hrmsApi.post<{
        success: boolean;
        outcome: { succeeded: string[]; failed: Array<{ channel: string; error: string }> };
      }>(`/api/meta/leads/${leadId}/outreach`, {});
      const succeeded = res.outcome?.succeeded ?? [];
      const failed = res.outcome?.failed ?? [];
      const ok = succeeded.length > 0;
      const msg = ok
        ? `Sent via: ${succeeded.join(", ")}`
        : failed.length
        ? `Failed: ${failed.map((f) => f.channel).join(", ")}`
        : "No channels succeeded";
      setNotifyResult((prev) => ({ ...prev, [leadId]: { ok, msg } }));
      // Update the row and drawer so "Notified" shows immediately
      if (ok) {
        const now = new Date().toISOString();
        setRows((prev) => prev.map((r) => (r.id === leadId ? { ...r, notificationSentAt: now } : r)));
        setDetail((prev) => (prev?.id === leadId ? { ...prev, notificationSentAt: now } : prev));
      }
    } catch (err: unknown) {
      setNotifyResult((prev) => ({
        ...prev,
        [leadId]: { ok: false, msg: (err as { message?: string })?.message || "Request failed" },
      }));
    } finally {
      setNotifying((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }, []);

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
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left">
                  <tr className="border-b border-slate-200">
                    {["Lead", "Age", "Location", "Education / Exp", "Screening", "Requisition", "Source Form", "ATS", "Received"].map((h) => (
                      <th key={h} className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                        {h}
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
                      <td className="px-3 py-2.5">
                        <div className="text-sm font-semibold text-slate-900">{l.parsedName ?? "—"}</div>
                        <div className="text-xs text-slate-500">{l.parsedPhone ?? "no phone"}</div>
                        {l.parsedEmail && <div className="text-xs text-slate-400">{l.parsedEmail}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-600">{l.parsedAge != null ? `${l.parsedAge}` : "—"}</td>
                      <td className="px-3 py-2.5 text-sm text-slate-600">{l.parsedLocation ?? "—"}</td>
                      <td className="px-3 py-2.5 text-sm text-slate-600">
                        <div>{l.parsedEducation ?? "—"}</div>
                        <div className="text-xs text-slate-400">
                          {l.parsedExperienceYr != null ? `${l.parsedExperienceYr} yrs exp` : "exp —"}
                        </div>
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
                        {l.screeningResult === "qualified" && !l.notificationSentAt && (
                          <button
                            onClick={(e) => void notifyLead(l.id, e)}
                            disabled={notifying.has(l.id)}
                            title="Send WhatsApp shortlist notification"
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <MessageCircle className="h-3 w-3" />
                            {notifying.has(l.id) ? "…" : "Notify"}
                          </button>
                        )}
                        {l.notificationSentAt && (
                          <div className="text-xs text-emerald-600">✓ notified</div>
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
                  {detail.notificationSentAt ? (
                    <p className="mt-0.5 text-xs text-emerald-600">✓ Notified {fmtDateTime(detail.notificationSentAt)}</p>
                  ) : detail.screeningResult === "qualified" ? (
                    <div className="mt-1.5 space-y-1">
                      <button
                        onClick={() => void notifyLead(detail.id)}
                        disabled={notifying.has(detail.id)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {notifying.has(detail.id) ? "Sending…" : "Send WhatsApp Notification"}
                      </button>
                      {notifyResult[detail.id] && (
                        <p className={`text-xs ${notifyResult[detail.id].ok ? "text-emerald-600" : "text-rose-600"}`}>
                          {notifyResult[detail.id].msg}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-400">Not notified</p>
                  )}
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
    </DashboardLayout>
  );
}

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
 * Every value shown is a stored, parsed lead field or a joined requisition/campaign name. There are
 * no client-side computed metrics here, so nothing on this page can drift from the database.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState, num } from "@/components/analytics/analytics-kit";

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
    [offset, search, screening]
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
            <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Users className="h-5 w-5 text-blue-600" /> META Leads
            </h1>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Every lead captured from META Lead Gen forms across all campaigns. {num(total)} total.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Export page
            </button>
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
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
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search leads by name, phone or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone or email"
              className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {searchInput && (
              <button
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              aria-label="Filter by screening result"
              value={screening}
              onChange={(e) => {
                setOffset(0);
                setScreening(e.target.value);
              }}
              className="h-9 rounded-lg border border-slate-200 pl-7 pr-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
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
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
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
                      <th key={h} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <div className="text-xs font-semibold text-slate-900">{l.parsedName ?? "—"}</div>
                        <div className="text-[10px] text-slate-400">{l.parsedPhone ?? "no phone"}</div>
                        {l.parsedEmail && <div className="text-[10px] text-slate-400">{l.parsedEmail}</div>}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-600">{l.parsedAge != null ? `${l.parsedAge}` : "—"}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-600">{l.parsedLocation ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-600">
                        <div>{l.parsedEducation ?? "—"}</div>
                        <div className="text-[10px] text-slate-400">
                          {l.parsedExperienceYr != null ? `${l.parsedExperienceYr} yrs exp` : "exp —"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${SCREENING_BADGE[l.screeningResult]}`}>
                          {l.screeningResult}
                        </span>
                        {l.disqualificationReason && (
                          <div className="mt-1 max-w-[180px] text-[10px] leading-snug text-slate-500">{l.disqualificationReason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-[11px] text-slate-700">{l.requisitionCode ?? "—"}</div>
                        <div className="text-[10px] text-slate-400">
                          {l.designationName ?? (l.requisitionId ? "—" : "unlinked form")}
                          {l.branchName ? ` · ${l.branchName}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="max-w-[200px] truncate text-[11px] text-slate-600" title={l.campaignName ?? ""}>
                          {l.campaignName ?? "—"}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">form {l.metaFormId}</div>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {l.atsCandidateId ? (
                          <span className="font-semibold text-emerald-600">created</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-400">{fmtDateTime(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pager */}
          {!loading && total > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <p className="text-[12px] text-slate-500">
                Showing <span className="font-semibold text-slate-700">{num(showingFrom)}</span>–
                <span className="font-semibold text-slate-700">{num(showingTo)}</span> of{" "}
                <span className="font-semibold text-slate-700">{num(total)}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span className="text-[12px] font-semibold text-slate-600">
                  Page {num(page)} / {num(pageCount)}
                </span>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={page >= pageCount}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

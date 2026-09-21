/**
 * META Lead Gen — Shortlist Report.
 *
 * Answers "who would HRMS shortlist, and why?". Every lead is re-screened read-only against the
 * batch requisition it maps to (GET /api/meta/shortlist/*), and the stored result is shown next to
 * the result HRMS reaches today, so the gap is visible before anyone re-screens.
 *
 * Nothing on this page writes to a lead. Every number comes from the backend evaluation — there
 * are no client-side computed metrics.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RefreshCcw, Search, ListChecks } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Proposed = "qualified" | "disqualified" | "unmapped" | "no_data";
type Current = "pending" | "qualified" | "disqualified";

type Summary = {
  totalLeads: number;
  proposed: Record<Proposed, number>;
  current: Record<Current, number>;
  wouldChange: number;
  wouldRelink: number;
  newlyQualified: number;
  newlyDisqualified: number;
  outreachEligible: number;
  qualifiedButBatchClosed: number;
  alreadyNotified: number;
  topDisqualificationReasons: Array<{ label: string; count: number }>;
  topUnverifiedChecks: Array<{ label: string; count: number }>;
  byRequisition: Array<{
    requisitionId: string;
    requisitionCode: string | null;
    designation: string | null;
    branch: string | null;
    process: string | null;
    closedReason: string | null;
    requestedHeadcount: number | null;
    fulfilledHeadcount: number | null;
    total: number;
    qualified: number;
    disqualified: number;
    outreachEligible: number;
  }>;
};

type Row = {
  leadId: string;
  name: string | null;
  phone: string | null;
  createdAt: string | null;
  currentResult: Current;
  notified: boolean;
  mappingSource: "routing_code" | "stored" | "none";
  requisitionId: string | null;
  requisitionCode: string | null;
  designation: string | null;
  branch: string | null;
  proposedResult: Proposed;
  reason: string | null;
  skipped: string[];
  closedReason: string | null;
  outreachEligible: boolean;
  changed: boolean;
  relink: boolean;
};

type Detail = {
  evaluation: Row;
  requisition: {
    code: string | null;
    designation: string | null;
    branch: string | null;
    process: string | null;
    ageMin: number | null;
    ageMax: number | null;
    education: string | null;
    experienceMin: number | null;
    experienceMax: number | null;
    screeningConfig: Record<string, unknown> | null;
    requestedHeadcount: number | null;
    fulfilledHeadcount: number | null;
  } | null;
  lead: {
    age: number | null;
    education: string | null;
    experienceYears: number | null;
    gender: string | null;
    location: string | null;
    routingCode: string | null;
    answers: Record<string, string>;
  } | null;
};

const PROPOSED_LABEL: Record<Proposed, string> = {
  qualified: "Shortlisted",
  disqualified: "Not shortlisted",
  unmapped: "No requisition mapped",
  no_data: "Form data unavailable",
};
const PROPOSED_BADGE: Record<Proposed, string> = {
  qualified: "bg-emerald-100 text-emerald-700",
  disqualified: "bg-rose-100 text-rose-700",
  unmapped: "bg-slate-100 text-slate-600",
  no_data: "bg-amber-100 text-amber-700",
};
const CURRENT_LABEL: Record<Current, string> = { pending: "Pending", qualified: "Qualified", disqualified: "Disqualified" };
const PAGE_SIZE = 50;

const fmt = (n: number) => n.toLocaleString("en-IN");
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{fmt(value)}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function TopList({ title, items, empty }: { title: string; items: Array<{ label: string; count: number }>; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((i) => (
            <li key={i.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-slate-700">{i.label}</span>
              <span className="shrink-0 font-semibold text-slate-900">{fmt(i.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MetaShortlistReport() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [proposed, setProposed] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);
  const [requisitionId, setRequisitionId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [exportError, setExportError] = useState("");

  const query = useCallback(() => {
    const p = new URLSearchParams();
    if (proposed !== "all") p.set("proposed", proposed);
    if (changedOnly) p.set("changedOnly", "true");
    if (requisitionId) p.set("requisitionId", requisitionId);
    if (search.trim()) p.set("search", search.trim());
    return p;
  }, [proposed, changedOnly, requisitionId, search]);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const sp = new URLSearchParams();
        if (refresh) sp.set("refresh", "true");
        const lp = query();
        lp.set("limit", String(PAGE_SIZE));
        lp.set("offset", String(offset));
        const [s, l] = await Promise.all([
          hrmsApi.get<{ data: Summary }>(`/api/meta/shortlist/summary?${sp.toString()}`),
          hrmsApi.get<{ data: { rows: Row[]; total: number } }>(`/api/meta/shortlist/leads?${lp.toString()}`),
        ]);
        setSummary(s.data);
        setRows(l.data.rows);
        setTotal(l.data.total);
      } catch (e: unknown) {
        setError(errMsg(e, "Unable to load the shortlist report"));
      } finally {
        setLoading(false);
      }
    },
    [query, offset]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const openLead = async (leadId: string) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const res = await hrmsApi.get<{ data: Detail }>(`/api/meta/shortlist/leads/${leadId}`);
      setDetail(res.data);
    } catch (e: unknown) {
      setDetailError(errMsg(e, "Unable to load this lead"));
    } finally {
      setDetailLoading(false);
    }
  };

  const exportCsv = async () => {
    setExportError("");
    try {
      const token = localStorage.getItem("hrms_access_token");
      const res = await fetch(`/api/meta/shortlist/export.csv?${query().toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 403) throw new Error("Only HR / Recruitment HR can export this report.");
      if (!res.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "meta-shortlist.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setExportError(errMsg(e, "Export failed"));
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <ListChecks className="h-6 w-6 text-blue-600" /> Shortlist Report
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Each lead is screened against the batch requisition it is mapped to. This is a read-only preview of who
              HRMS would shortlist today and why — nothing here changes a lead.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void exportCsv()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <button
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        {(error || exportError) && (
          <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {error || exportError}
          </div>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Total leads" value={summary.totalLeads} tone="text-slate-900" />
              <Stat label="Shortlisted" value={summary.proposed.qualified} tone="text-emerald-600" hint={`${fmt(summary.outreachEligible)} in an open batch`} />
              <Stat label="Not shortlisted" value={summary.proposed.disqualified} tone="text-rose-600" />
              <Stat label="No requisition" value={summary.proposed.unmapped} tone="text-slate-600" hint="cannot be screened" />
              <Stat label="Would change" value={summary.wouldChange} tone="text-blue-600" hint={`${fmt(summary.newlyQualified)} newly shortlisted`} />
              <Stat label="Batch closed" value={summary.qualifiedButBatchClosed} tone="text-amber-600" hint="shortlisted, not contacted" />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TopList title="Why leads are not shortlisted" items={summary.topDisqualificationReasons} empty="No rejections." />
              <TopList title="What HRMS could not verify" items={summary.topUnverifiedChecks} empty="Every check could be evaluated." />
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">
                By batch requisition — click a row to filter the leads below
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Requisition</th>
                    <th className="px-4 py-2">Branch</th>
                    <th className="px-4 py-2 text-right">Seats</th>
                    <th className="px-4 py-2 text-right">Leads</th>
                    <th className="px-4 py-2 text-right">Shortlisted</th>
                    <th className="px-4 py-2 text-right">Not shortlisted</th>
                    <th className="px-4 py-2">Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byRequisition.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">None</td>
                    </tr>
                  )}
                  {summary.byRequisition.map((r) => (
                    <tr
                      key={r.requisitionId}
                      onClick={() => {
                        setOffset(0);
                        setRequisitionId(requisitionId === r.requisitionId ? "" : r.requisitionId);
                      }}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${requisitionId === r.requisitionId ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium text-slate-900">
                        {r.requisitionCode ?? "—"} <span className="font-normal text-slate-500">{r.designation}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{r.branch ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {r.fulfilledHeadcount ?? 0}/{r.requestedHeadcount ?? 0}
                      </td>
                      <td className="px-4 py-2 text-right">{fmt(r.total)}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">{fmt(r.qualified)}</td>
                      <td className="px-4 py-2 text-right text-rose-700">{fmt(r.disqualified)}</td>
                      <td className="px-4 py-2 text-xs">
                        {r.closedReason ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">{r.closedReason}</span> : "Open"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search leads by name or phone"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or phone"
              className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            aria-label="Filter by shortlist result"
            value={proposed}
            onChange={(e) => {
              setOffset(0);
              setProposed(e.target.value);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="all">All results</option>
            <option value="qualified">Shortlisted</option>
            <option value="disqualified">Not shortlisted</option>
            <option value="unmapped">No requisition mapped</option>
            <option value="no_data">Form data unavailable</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(e) => {
                setOffset(0);
                setChangedOnly(e.target.checked);
              }}
            />
            Only leads whose result would change
          </label>
          {requisitionId && (
            <button onClick={() => setRequisitionId("")} className="rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700">
              Requisition filter ✕
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Candidate</th>
                <th className="px-4 py-2">Requisition</th>
                <th className="px-4 py-2">Stored</th>
                <th className="px-4 py-2">HRMS result</th>
                <th className="px-4 py-2">Reason / not verified</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No leads match these filters.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.leadId} onClick={() => void openLead(r.leadId)} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{r.name ?? "—"}</div>
                    <div className="text-xs text-slate-500">{r.phone ?? "—"}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    {r.requisitionCode ?? "—"}
                    <div className="text-xs text-slate-500">{[r.designation, r.branch].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{CURRENT_LABEL[r.currentResult]}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PROPOSED_BADGE[r.proposedResult]}`}>{PROPOSED_LABEL[r.proposedResult]}</span>
                    {r.changed && <span className="ml-1.5 text-xs font-semibold text-blue-600">changes</span>}
                  </td>
                  <td className="max-w-md px-4 py-2 text-xs text-slate-600">
                    {r.reason ?? (r.skipped.length ? `Not verified: ${r.skipped.slice(0, 2).join("; ")}${r.skipped.length > 2 ? "…" : ""}` : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
            <span>{fmt(total)} leads</span>
            <div className="flex items-center gap-2">
              <button aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded border border-slate-200 p-1 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>Page {page} of {pageCount}</span>
              <button aria-label="Next page" disabled={page >= pageCount} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded border border-slate-200 p-1 disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{detail?.evaluation.name ?? "Lead"} {detail && <span className="text-sm font-normal text-slate-500">#{detail.evaluation.leadId.slice(0, 8)}</span>}</SheetTitle>
          </SheetHeader>
          {detailLoading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
          {detailError && <p role="alert" className="p-4 text-sm text-rose-700">{detailError}</p>}
          {detail && <DetailBody detail={detail} />}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

const SectionLabel = ({ children }: { children: string }) => (
  <div className="mb-1.5 mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</div>
);
const Line = ({ k, v }: { k: string; v: string | number | null | undefined }) => (
  <div className="flex justify-between gap-4 py-0.5 text-sm">
    <span className="text-slate-500">{k}</span>
    <span className="text-right font-medium text-slate-900">{v === null || v === undefined || v === "" ? "—" : v}</span>
  </div>
);

function DetailBody({ detail }: { detail: Detail }) {
  const { evaluation: e, requisition: r, lead } = detail;
  const cfg = r?.screeningConfig ? Object.entries(r.screeningConfig).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) : [];
  return (
    <div className="px-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PROPOSED_BADGE[e.proposedResult]}`}>{PROPOSED_LABEL[e.proposedResult]}</span>
        <span className="text-xs text-slate-500">Applied {fmtDate(e.createdAt)}</span>
        {e.outreachEligible && <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Would be contacted</span>}
        {e.closedReason && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Batch: {e.closedReason}</span>}
      </div>

      <SectionLabel>Decision</SectionLabel>
      <Line k="Stored result" v={CURRENT_LABEL[e.currentResult]} />
      <Line k="HRMS result today" v={PROPOSED_LABEL[e.proposedResult]} />
      <Line k="Reason" v={e.reason} />
      <Line k="Mapped via" v={e.mappingSource === "routing_code" ? "Form requisition code" : e.mappingSource === "stored" ? "Stored campaign link" : "Not mapped"} />
      {e.relink && <p className="mt-1 text-xs text-blue-700">The form's requisition code differs from the stored link; a re-screen would re-link this lead.</p>}

      <SectionLabel>What HRMS could not verify</SectionLabel>
      {e.skipped.length === 0 ? <p className="text-sm text-slate-500">None</p> : (
        <ul className="list-disc pl-5 text-sm text-slate-700">{e.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
      )}

      <SectionLabel>Requisition requirements</SectionLabel>
      {!r ? <p className="text-sm text-slate-500">None — no requisition mapped.</p> : (
        <>
          <Line k="Requisition" v={`${r.code ?? ""} ${r.designation ?? ""}`.trim()} />
          <Line k="Branch / process" v={[r.branch, r.process].filter(Boolean).join(" · ")} />
          <Line k="Age band" v={r.ageMin !== null || r.ageMax !== null ? `${r.ageMin ?? "any"} – ${r.ageMax ?? "any"}` : "Not set"} />
          <Line k="Education" v={r.education ?? "Not set"} />
          <Line k="Experience (min)" v={r.experienceMin ?? "Not set"} />
          <Line k="Seats filled" v={`${r.fulfilledHeadcount ?? 0} of ${r.requestedHeadcount ?? 0}`} />
          {cfg.map(([k, v]) => <Line key={k} k={k.replace(/_/g, " ")} v={typeof v === "object" ? JSON.stringify(v) : String(v)} />)}
        </>
      )}

      <SectionLabel>What the candidate told us</SectionLabel>
      {!lead ? <p className="text-sm text-slate-500">None — form data unavailable.</p> : (
        <>
          <Line k="Age" v={lead.age} />
          <Line k="Education" v={lead.education} />
          <Line k="Experience (yrs)" v={lead.experienceYears} />
          <Line k="Gender" v={lead.gender} />
          <Line k="Location" v={lead.location} />
          <Line k="Routing code on form" v={lead.routingCode} />
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            {Object.keys(lead.answers).length === 0 ? <p className="text-sm text-slate-500">None</p> : Object.entries(lead.answers).map(([k, v]) => <Line key={k} k={k.replace(/_/g, " ")} v={v} />)}
          </div>
        </>
      )}
    </div>
  );
}

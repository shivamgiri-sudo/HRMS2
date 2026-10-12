import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHasRole } from "@/hooks/useUserRole";
import {
  useAcknowledgeBranch, usePnlBranchReview, useRaiseBranchQuery, useResolveBranchQuery,
  type BranchQuerySection, type BranchReviewRow, type BranchReviewStatus,
} from "@/hooks/usePnlBranchReview";

const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(v ?? 0);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const SECTIONS: Array<{ key: BranchQuerySection; label: string }> = [
  { key: "revenue", label: "Revenue" }, { key: "people_cost", label: "People cost" },
  { key: "non_people_cost", label: "Non-people cost (GRN / vendor)" }, { key: "other", label: "Other" },
];
const STATUS: Record<BranchReviewStatus, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  pending: { label: "Awaiting review", tone: "border-slate-200 bg-slate-50 text-slate-700", Icon: CircleDashed },
  queried: { label: "Query open", tone: "border-amber-200 bg-amber-50 text-amber-800", Icon: MessageSquareWarning },
  acknowledged: { label: "Acknowledged", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  changed_after_acknowledgement: { label: "Changed since acknowledged", tone: "border-rose-200 bg-rose-50 text-rose-700", Icon: AlertTriangle },
};
const ISSUE_TEXT: Record<string, string> = {
  PAYROLL_NOT_POSTED_FOR_PERIOD: "Payroll is not posted for this month, so people cost is missing",
  REVENUE_WITH_NO_PAYROLL: "Revenue is recorded but no payroll is linked to it",
  PAYROLL_ACCRUED_NOT_FINAL: "Payroll is accrued, not final",
  COST_WITH_NO_REVENUE: "Cost is recorded but there is no revenue",
  GRN_WITHOUT_COST_CENTRE_BUDGET: "Spend exists without a cost-centre budget",
  GRN_OVER_ALLOCATED_BUDGET: "Spend is above the allocated budget",
  BRANCH_BUDGET_MISSING: "No branch budget is set",
  REVENUE_ESTIMATED_FROM_SEAT_RATE: "Revenue is estimated from seats x rate, not invoiced",
  GRN_ESTIMATED_FROM_RESERVED: "Some spend is an estimate from approved, not yet billed, GRNs",
  PAYROLL_WITHOUT_COST_CENTRE: "Some payroll has no cost centre",
};
const issueText = (i: string) => ISSUE_TEXT[i] ?? i.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const errText = (e: unknown) => (e as { message?: string })?.message || "Something went wrong";

function BranchCard({ row, period, canReview, canResolve, onOpenDetail }: {
  row: BranchReviewRow; period: string; canReview: boolean; canResolve: boolean; onOpenDetail?: (branchId: string) => void;
}) {
  const ack = useAcknowledgeBranch();
  const raise = useRaiseBranchQuery();
  const resolve = useResolveBranchQuery();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [section, setSection] = useState<BranchQuerySection>("revenue");
  const [ccId, setCcId] = useState("");
  const [message, setMessage] = useState("");
  const [ackNote, setAckNote] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const s = STATUS[row.status];
  const err = ack.error || raise.error || resolve.error;
  const incomplete = row.peopleCostMissing;

  const doAck = () => ack.mutate(
    { branchId: row.branchId, period, comment: ackNote.trim() || undefined, confirmIncomplete: incomplete },
    { onSuccess: () => { setConfirming(false); setAckNote(""); } },
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label={`${row.branchName} P&L review`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{row.branchName}</h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}><s.Icon className="h-3.5 w-3.5" aria-hidden />{s.label}</span>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Revenue</dt><dd className="font-semibold tabular-nums">{money(row.revenue)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Cost{incomplete ? " (incomplete)" : ""}</dt><dd className={`font-semibold tabular-nums ${incomplete ? "text-amber-700" : ""}`}>{money(row.cost)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{incomplete ? "Revenue less cost so far" : "Operating profit"}</dt><dd className={`font-semibold tabular-nums ${row.operatingProfit < 0 ? "text-rose-600" : ""}`}>{money(row.operatingProfit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Margin</dt><dd className="font-semibold tabular-nums" title={incomplete ? "Not meaningful until payroll is posted" : undefined}>{incomplete ? "Not final" : row.marginPct == null ? "NA" : `${row.marginPct.toFixed(1)}%`}</dd></div>
      </dl>
      {incomplete && <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Payroll is not in this month yet, so cost and margin are not the final result. Do not read the margin as a profit.</p>}

      {row.status === "changed_after_acknowledgement" && row.snapshot && (
        <p className="mt-2 text-xs text-rose-700">You acknowledged revenue {money(row.snapshot.revenue)}, cost {money(row.snapshot.cost)}, profit {money(row.snapshot.operatingProfit)}. The figures above are newer: review again.</p>
      )}
      {row.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800">{row.issues.map((i) => <li key={i}>{issueText(i)}</li>)}</ul>
      )}
      {row.acknowledgedAt && row.status === "acknowledged" && (
        <p className="mt-2 text-xs text-muted-foreground">Acknowledged by {row.acknowledgedByName ?? "a reviewer"}, {when(row.acknowledgedAt)}{row.comment ? `: ${row.comment}` : ""}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {row.costCentres.length > 0 && (
          <button type="button" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" aria-expanded={showCc} onClick={() => setShowCc((v) => !v)}>
            {showCc ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            By cost centre ({row.costCentres.length})
          </button>
        )}
        {onOpenDetail && <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onOpenDetail(row.branchId)}>Open full Live P&amp;L for this branch</button>}
      </div>
      {showCc && (
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[460px] text-left text-xs">
            <thead className="bg-muted text-[11px] uppercase tracking-wide text-muted-foreground"><tr>
              <th className="px-2 py-1.5">Cost centre</th><th className="px-2 py-1.5 text-right">Revenue</th><th className="px-2 py-1.5 text-right">People</th><th className="px-2 py-1.5 text-right">GRN</th><th className="px-2 py-1.5 text-right">Profit</th></tr></thead>
            <tbody className="divide-y divide-border">
              {row.costCentres.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-1.5"><span className="font-medium">{c.name}</span><span className="ml-1 text-muted-foreground">{c.code}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(c.revenue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(c.peopleCost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(c.grn)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${c.operatingProfit < 0 ? "text-rose-600" : ""}`}>{money(c.operatingProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {row.queries.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Queries">
          {row.queries.map((q) => {
            const cc = row.costCentres.find((c) => c.id === q.costCentreId);
            return (
              <li key={q.id} className="rounded-md border border-border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-semibold uppercase">{SECTIONS.find((x) => x.key === q.section)?.label}</span>
                  {cc && <span className="text-muted-foreground">{cc.name}</span>}
                  <span className={q.status === "open" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{q.status === "open" ? "Open" : "Resolved"}</span>
                  <span className="text-muted-foreground">raised by {q.raisedByName ?? "a reviewer"}, {when(q.raisedAt)}</span>
                </div>
                <p className="mt-1">{q.message}</p>
                {q.resolutionNote && <p className="mt-1 text-xs text-muted-foreground">Finance ({q.resolvedByName ?? "finance"}, {when(q.resolvedAt)}): {q.resolutionNote}</p>}
                {q.status === "open" && canResolve && (
                  <div className="mt-2 flex gap-2">
                    <input aria-label="Resolution note" className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm" placeholder="What was checked or changed"
                      value={note[q.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [q.id]: e.target.value }))} />
                    <Button size="sm" disabled={resolve.isPending || (note[q.id] ?? "").trim().length < 3}
                      onClick={() => resolve.mutate({ id: q.id, note: note[q.id] ?? "" })}>Resolve</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canReview && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={ack.isPending || row.openQueries > 0 || row.status === "acknowledged"}
            onClick={() => (incomplete ? setConfirming((v) => !v) : doAck())}>
            {row.status === "acknowledged" ? "Acknowledged" : row.status === "changed_after_acknowledgement" ? "Acknowledge again" : "Acknowledge figures"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "Raise a query"}</Button>
          {row.openQueries > 0 && <span className="self-center text-xs text-muted-foreground">Finance has to resolve the open query first.</span>}
        </div>
      )}
      {confirming && (
        <div className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">Cost for this month is incomplete.</p>
          <p className="text-amber-900">If you acknowledge now you are agreeing to the revenue and the cost recorded so far, not a final profit. Say what you checked.</p>
          <label className="block text-xs font-medium">Note (required)
            <input className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-sm" value={ackNote} maxLength={500} onChange={(e) => setAckNote(e.target.value)} placeholder="e.g. Revenue checked against client invoices; payroll awaited" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={ack.isPending || ackNote.trim().length < 5} onClick={doAck}>Acknowledge revenue and cost so far</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Not yet</Button>
          </div>
        </div>
      )}
      {open && (
        <form className="mt-3 space-y-2 rounded-md border border-border p-3" onSubmit={(e) => {
          e.preventDefault();
          raise.mutate({ branchId: row.branchId, period, section, message, costCentreId: ccId || undefined }, { onSuccess: () => { setMessage(""); setCcId(""); setOpen(false); } });
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium">Which part looks wrong?
              <select className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-sm" value={section} onChange={(e) => setSection(e.target.value as BranchQuerySection)}>
                {SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">Cost centre (optional)
              <select className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-sm" value={ccId} onChange={(e) => setCcId(e.target.value)}>
                <option value="">Whole branch</option>
                {row.costCentres.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium">What is wrong?
            <textarea className="mt-1 w-full rounded border border-input bg-background p-2 text-sm" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <Button size="sm" type="submit" disabled={raise.isPending || message.trim().length < 5}>Send to Finance</Button>
        </form>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{errText(err)}</p>}
    </section>
  );
}

type Filter = "all" | BranchReviewStatus;

export function PnlBranchReviewPanel({ period, onOpenDetail }: { period: string; onOpenDetail?: (branchId: string) => void }) {
  const q = usePnlBranchReview(period);
  const canReview = useHasRole("super_admin", "branch_head");
  const canResolve = useHasRole("super_admin", "finance_head", "accounts_head", "finance");
  const [filter, setFilter] = useState<Filter>("all");
  const branches = useMemo(() => {
    const order: Record<BranchReviewStatus, number> = { queried: 0, changed_after_acknowledgement: 1, pending: 2, acknowledged: 3 };
    return (q.data?.branches ?? []).filter((b) => filter === "all" || b.status === filter).slice().sort((a, b) => order[a.status] - order[b.status] || a.branchName.localeCompare(b.branchName));
  }, [q.data, filter]);

  if (q.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>;
  if (q.isError || !q.data) {
    return <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">Could not load the branch review for {period}. <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></p>;
  }
  const d = q.data;
  const chips: Array<{ key: Filter; label: string; n: number }> = [
    { key: "all", label: "All", n: d.totals.branches }, { key: "queried", label: "Query open", n: d.totals.queried },
    { key: "pending", label: "Awaiting review", n: d.totals.pending }, { key: "changed_after_acknowledgement", label: "Changed", n: d.totals.changed },
    { key: "acknowledged", label: "Acknowledged", n: d.totals.acknowledged },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span><strong>{d.totals.acknowledged}</strong> of {d.totals.branches} branches acknowledged</span>
        <span><strong>{d.totals.queried}</strong> with open queries</span>
        <span><strong>{d.totals.pending}</strong> awaiting review</span>
        {d.totals.changed > 0 && <span className="text-rose-700"><strong>{d.totals.changed}</strong> changed since acknowledged</span>}
        <span className="text-xs text-muted-foreground">Figures are the reconciled P&amp;L ({d.mode === "FINAL" ? "closed month" : "month to date"}), the same numbers the CEO view uses.</span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter branches by review status">
        {chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}>
            {c.label} <span className="tabular-nums">({c.n})</span>
          </button>
        ))}
      </div>
      {d.blockers.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">{d.mode === "BLOCKED" ? "This month cannot be acknowledged yet:" : "Company-wide data caveats for this month:"}</p>
          <ul className="list-disc pl-5">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {branches.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{d.branches.length === 0 ? `No branch P&L for ${period}.` : "No branch matches this filter."}</p>
        : <div className="grid gap-4 xl:grid-cols-2">{branches.map((b) => <BranchCard key={b.branchId} row={b} period={period} canReview={canReview} canResolve={canResolve} onOpenDetail={onOpenDetail} />)}</div>}
    </div>
  );
}

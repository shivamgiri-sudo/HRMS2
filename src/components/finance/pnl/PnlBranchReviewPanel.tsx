import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHasRole } from "@/hooks/useUserRole";
import {
  useAcknowledgeBranch, usePnlBranchReview, useRaiseBranchQuery, useResolveBranchQuery,
  type BranchQuerySection, type BranchReviewRow, type BranchReviewStatus,
} from "@/hooks/usePnlBranchReview";

const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(v ?? 0);
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
const errText = (e: unknown) => (e as { message?: string })?.message || "Something went wrong";

function BranchCard({ row, period, canReview, canResolve }: { row: BranchReviewRow; period: string; canReview: boolean; canResolve: boolean }) {
  const ack = useAcknowledgeBranch();
  const raise = useRaiseBranchQuery();
  const resolve = useResolveBranchQuery();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<BranchQuerySection>("revenue");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const s = STATUS[row.status];
  const err = ack.error || raise.error || resolve.error;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label={`${row.branchName} P&L review`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{row.branchName}</h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}><s.Icon className="h-3.5 w-3.5" aria-hidden />{s.label}</span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Revenue</dt><dd className="font-semibold tabular-nums">{money(row.revenue)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Cost</dt><dd className="font-semibold tabular-nums">{money(row.cost)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Operating profit</dt><dd className={`font-semibold tabular-nums ${row.operatingProfit < 0 ? "text-rose-600" : ""}`}>{money(row.operatingProfit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Margin</dt><dd className="font-semibold tabular-nums">{row.marginPct == null ? "NA" : `${row.marginPct.toFixed(1)}%`}</dd></div>
      </dl>
      {row.status === "changed_after_acknowledgement" && row.snapshot && (
        <p className="mt-2 text-xs text-rose-700">You acknowledged revenue {money(row.snapshot.revenue)}, cost {money(row.snapshot.cost)}, profit {money(row.snapshot.operatingProfit)}. The figures above are newer: review again.</p>
      )}
      {row.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800">{row.issues.map((i) => <li key={i}>{i.replaceAll("_", " ").toLowerCase()}</li>)}</ul>
      )}
      {row.acknowledgedAt && row.status === "acknowledged" && <p className="mt-2 text-xs text-muted-foreground">Acknowledged {new Date(row.acknowledgedAt).toLocaleString("en-IN")}{row.comment ? `: ${row.comment}` : ""}</p>}

      {row.queries.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Queries">
          {row.queries.map((q) => (
            <li key={q.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase">{SECTIONS.find((x) => x.key === q.section)?.label}</span>
                <span className={q.status === "open" ? "text-amber-700" : "text-emerald-700"}>{q.status === "open" ? "Open" : "Resolved"}</span>
              </div>
              <p className="mt-1">{q.message}</p>
              {q.resolutionNote && <p className="mt-1 text-xs text-muted-foreground">Finance: {q.resolutionNote}</p>}
              {q.status === "open" && canResolve && (
                <div className="mt-2 flex gap-2">
                  <input aria-label="Resolution note" className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm" placeholder="What was checked or changed"
                    value={note[q.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [q.id]: e.target.value }))} />
                  <Button size="sm" disabled={resolve.isPending || (note[q.id] ?? "").trim().length < 3}
                    onClick={() => resolve.mutate({ id: q.id, note: note[q.id] ?? "" })}>Resolve</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canReview && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={ack.isPending || row.openQueries > 0 || row.status === "acknowledged"}
            onClick={() => ack.mutate({ branchId: row.branchId, period })}>
            {row.status === "acknowledged" ? "Acknowledged" : row.status === "changed_after_acknowledgement" ? "Acknowledge again" : "Acknowledge figures"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "Raise a query"}</Button>
        </div>
      )}
      {open && (
        <form className="mt-3 space-y-2 rounded-md border border-border p-3" onSubmit={(e) => {
          e.preventDefault();
          raise.mutate({ branchId: row.branchId, period, section, message }, { onSuccess: () => { setMessage(""); setOpen(false); } });
        }}>
          <label className="block text-xs font-medium">Which part looks wrong?
            <select className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-sm" value={section} onChange={(e) => setSection(e.target.value as BranchQuerySection)}>
              {SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
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

export function PnlBranchReviewPanel({ period }: { period: string }) {
  const q = usePnlBranchReview(period);
  const canReview = useHasRole("super_admin", "branch_head", "branch_admin");
  const canResolve = useHasRole("super_admin", "finance_head", "accounts_head", "finance");

  if (q.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>;
  if (q.isError || !q.data) {
    return <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">Could not load the branch review for {period}. <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></p>;
  }
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span><strong>{d.totals.acknowledged}</strong> of {d.totals.branches} branches acknowledged</span>
        <span><strong>{d.totals.queried}</strong> with open queries</span>
        <span><strong>{d.totals.pending}</strong> awaiting review</span>
        {d.totals.changed > 0 && <span className="text-rose-700"><strong>{d.totals.changed}</strong> changed since acknowledged</span>}
        <span className="text-xs text-muted-foreground">Figures are the reconciled P&amp;L ({d.mode === "FINAL" ? "closed month" : "month to date"}), the same numbers the CEO view uses.</span>
      </div>
      {d.blockers.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">This month cannot be acknowledged yet:</p>
          <ul className="list-disc pl-5">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {d.branches.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No branch P&amp;L for {period}.</p>
        : <div className="grid gap-4 xl:grid-cols-2">{d.branches.map((b) => <BranchCard key={b.branchId} row={b} period={period} canReview={canReview} canResolve={canResolve} />)}</div>}
    </div>
  );
}

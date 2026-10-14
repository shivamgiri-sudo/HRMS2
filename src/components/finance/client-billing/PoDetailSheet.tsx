// src/components/finance/client-billing/PoDetailSheet.tsx
/** One PO: amount / drawn / balance, its particulars, every invoice on it, the document and its edit history. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Download, Loader2, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { approvePo, downloadPoDocument, getPoDetail, rejectPo } from "@/lib/clientBillingApi";
import { PoFormDialog } from "./PoFormDialog";
import { DRAWER_60VW_CLASS, InlineError, money } from "./shared";

export function PoDetailSheet({ poId, onClose }: { poId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const q = useQuery({ queryKey: ["client-billing", "po-detail", poId], queryFn: () => getPoDetail(poId!), enabled: Boolean(poId) });
  const d = q.data?.data;
  const billed = d?.invoices.filter((i) => i.stage === "billed") ?? [];
  const waiting = d?.invoices.filter((i) => i.stage === "waiting") ?? [];
  const drawnSum = billed.reduce((s, i) => s + Math.round(i.drawn * 100), 0) / 100;

  return (
    <Sheet open={Boolean(poId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className={DRAWER_60VW_CLASS}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>PO {d?.po.poNumber ?? ""}</SheetTitle>
          <SheetDescription>{d ? `${d.po.costCentre} · ${d.po.client} · ${d.po.branch} · ${d.po.periodFrom} to ${d.po.periodTo}` : "Loading…"}</SheetDescription>
          {d && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setEditOpen(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit PO</Button>
              {d.po.document && (
                <Button size="sm" variant="outline" className="cursor-pointer"
                  onClick={() => downloadPoDocument(d.po.id, d.po.document!.name).catch((e: Error) => toast({ title: "Could not download", description: e.message, variant: "destructive" }))}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />{d.po.document.name}
                </Button>
              )}
              {!d.po.document && <span className="self-center text-xs text-amber-700">No PO document on file — attach one with Edit PO.</span>}
            </div>
          )}
        </SheetHeader>
        {q.isLoading || !d ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-5 p-5 text-sm">
            {d.po.approvalStatus && d.po.approvalStatus !== "approved" && <PoApprovalPanel poId={d.po.id} status={d.po.approvalStatus} requestedBy={d.po.approvalRequestedBy ?? null} note={d.po.approvalNote ?? null} amount={d.po.amount} approvedAmount={d.po.approvedAmount ?? null} />}
            <div className="grid grid-cols-3 gap-3">
              {[["PO amount", d.po.amount], ["Drawn by bills", d.po.drawn], ["Balance", d.po.balance]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border p-3">
                  <p className="text-xs text-slate-600">{k}</p>
                  <p className="text-lg font-semibold tabular-nums">{money(Number(v))}</p>
                </div>
              ))}
            </div>

            <section>
              <h3 className="mb-1.5 font-semibold text-slate-900">Particulars</h3>
              {d.lines.length === 0 ? <p className="text-slate-600">Created before particulars were recorded — amount only.</p> : (
                <table className="w-full">
                  <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">Particulars</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">Rate</th><th className="px-2 py-1 text-right">Amount</th></tr></thead>
                  <tbody>{d.lines.map((l) => (
                    <tr key={l.lineNo} className="border-t"><td className="px-2 py-1">{l.lineNo}</td><td className="px-2 py-1">{l.particulars}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.qty}</td><td className="px-2 py-1 text-right tabular-nums">{money(l.rate)}</td><td className="px-2 py-1 text-right tabular-nums">{money(l.amount)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 font-semibold text-slate-900">Invoices on this PO</h3>
              {d.invoices.length === 0 ? <p className="text-slate-600">No invoice has used this PO yet.</p> : (
                <table className="w-full">
                  <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                    <th className="px-2 py-1 text-left">Bill / Proforma</th><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Month</th>
                    <th className="px-2 py-1 text-left">Stage</th><th className="px-2 py-1 text-right">Invoice total</th><th className="px-2 py-1 text-right">Drawn from PO</th>
                  </tr></thead>
                  <tbody>
                    {[...billed, ...waiting].map((i) => (
                      <tr key={`${i.stage}-${i.id}`} className="border-t">
                        <td className="px-2 py-1 font-medium">{i.number}</td><td className="px-2 py-1">{i.date}</td><td className="px-2 py-1">{i.month}</td>
                        <td className="px-2 py-1">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${i.stage === "billed" ? (i.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600") : "bg-amber-50 text-amber-800"}`}>
                            {i.stage === "billed" ? (i.status === "approved" ? "Billed" : `Billed · ${i.status}`) : "Proforma (not drawn yet)"}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(i.grandTotal)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{i.stage === "billed" ? money(i.drawn) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t font-semibold"><td colSpan={5} className="px-2 py-1 text-right">Drawn total</td><td className="px-2 py-1 text-right tabular-nums">{money(drawnSum)}</td></tr></tfoot>
                </table>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 font-semibold text-slate-900">History</h3>
              {d.history.length === 0 ? <p className="text-slate-600">No changes recorded.</p> : (
                <ol className="space-y-1.5">
                  {d.history.map((h, i) => (
                    <li key={i} className="rounded-md border px-3 py-2">
                      <p className="text-xs text-slate-500">{h.at} · {h.actor} · {h.action}</p>
                      <p className="text-slate-800">{h.changes}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
        <PoFormDialog open={editOpen} onOpenChange={setEditOpen} editing={d ?? null} />
      </SheetContent>
    </Sheet>
  );
}

/** A new PO, or an amount increase, waits for someone other than its maker before invoices can use it. */
function PoApprovalPanel({ poId, status, requestedBy, note, amount, approvedAmount }: {
  poId: string; status: "pending" | "rejected"; requestedBy: string | null; note: string | null; amount: number; approvedAmount: number | null;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = () => { setReason(""); void queryClient.invalidateQueries({ queryKey: ["client-billing"] }); };
  const approve = useMutation({ mutationFn: () => approvePo(poId, reason.trim()), onMutate: () => setError(null), onSuccess: done, onError: (e: Error) => setError(e.message) });
  const reject = useMutation({ mutationFn: () => rejectPo(poId, reason.trim()), onMutate: () => setError(null), onSuccess: done, onError: (e: Error) => setError(e.message) });
  if (status === "rejected") {
    return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">This PO (or its last change) was rejected{note ? `: ${note}` : ""}. Edit it to send it for approval again.</p>;
  }
  return (
    <section className="space-y-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-3" aria-label="PO approval">
      <p className="font-medium text-violet-900">Waiting for approval — invoices cannot use this PO yet.</p>
      <p className="text-xs text-violet-900">
        {approvedAmount != null && approvedAmount > 0 ? `Amount change ${money(approvedAmount)} → ${money(amount)}. ` : `New PO for ${money(amount)}. `}
        Raised by {requestedBy ?? "—"}; a different person must approve.
      </p>
      <Textarea aria-label="Approval note or rejection reason" placeholder="Note (required to reject, at least 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[56px] bg-white" />
      {error && <InlineError message={error} />}
      <div className="flex gap-2">
        <Button size="sm" className="cursor-pointer" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>
          {approve.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Approve PO
        </Button>
        <Button size="sm" variant="outline" className="cursor-pointer text-rose-700" disabled={reason.trim().length < 5 || approve.isPending || reject.isPending} onClick={() => reject.mutate()}>
          {reject.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}Reject
        </Button>
      </div>
    </section>
  );
}

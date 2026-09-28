// src/components/finance/journal/JournalVoucherDrawer.tsx
//
// The Drill-Down Mandate drawer for one journal voucher: full record, its lines, the posted
// (and reversal, if any) ledger entry, the approval timeline and the audit trail — plus every
// workflow action (submit/approve/reject/withdraw/reverse), gated by the same `permissions`
// object the backend computed with the same rules (journal-voucher.roles.ts), so a button never
// offers an action the API will refuse.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileEdit, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dateOnly, dateTime, money, type JvDetail,
} from "@/lib/finance/journalVoucherStatus";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

export function JournalVoucherDrawer({
  voucherId, open, onOpenChange, onEdit, onChanged,
}: {
  voucherId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (voucher: JvDetail) => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [confirmingReverse, setConfirmingReverse] = useState(false);

  const query = useQuery({
    queryKey: ["journal-voucher", voucherId],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: JvDetail }>(`/api/finance/journal-vouchers/${voucherId}`)).data,
    enabled: open && !!voucherId,
  });
  const voucher = query.data;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["journal-voucher", voucherId] });
    qc.invalidateQueries({ queryKey: ["journal-vouchers"] });
    qc.invalidateQueries({ queryKey: ["journal-voucher-summary"] });
    onChanged?.();
  };

  const actionMutation = useMutation({
    mutationFn: async (opts: { action: string; body?: Record<string, unknown> }) =>
      hrmsApi.post(`/api/finance/journal-vouchers/${voucherId}/${opts.action}`, opts.body ?? {}),
    onSuccess: (_res, opts) => {
      const titles: Record<string, string> = {
        submit: "Submitted for approval", approve: "Posted to the general ledger",
        reject: "Voucher rejected", withdraw: "Voucher withdrawn", reverse: "Voucher reversed",
      };
      toast({ title: titles[opts.action] ?? "Done" });
      setRejectReason(""); setWithdrawReason(""); setReverseReason(""); setApproveNote(""); setConfirmingReverse(false);
      invalidateAll();
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => hrmsApi.delete(`/api/finance/journal-vouchers/${voucherId}`),
    onSuccess: () => { toast({ title: "Draft deleted" }); onOpenChange(false); invalidateAll(); },
    onError: (e: Error) => toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });

  const busy = actionMutation.isPending || deleteMutation.isPending;
  const p = voucher?.permissions;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-sm">{voucher?.voucherNumber ?? "Journal Voucher (draft)"}</SheetTitle>
            {voucher && (
              <Badge variant="outline" className={STATUS_TONE[voucher.status]}>{STATUS_LABEL[voucher.status]}</Badge>
            )}
          </div>
          {voucher && <p className="text-xs text-slate-500">{dateOnly(voucher.voucherDate)} · {TYPE_LABEL[voucher.jvType]} · {money(voucher.totalAmount)}</p>}
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {query.isLoading && <p className="py-8 text-center text-xs text-slate-400">Loading…</p>}
          {voucher && (
            <>
              <Section title="Record">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Voucher Date" value={dateOnly(voucher.voucherDate)} />
                  <Field label="Type" value={TYPE_LABEL[voucher.jvType]} />
                  <Field label="Reference No." value={voucher.referenceNo} />
                  <Field label="Total" value={money(voucher.totalAmount)} />
                  <Field label="Branch" value={voucher.branchName ?? "Company-wide"} />
                  <Field label="Cost Centre" value={voucher.costCentreName} />
                  <Field label="Process" value={voucher.processName} />
                  <Field label="Maker" value={voucher.createdByName} />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Narration</div>
                  <p className="text-sm text-slate-700">{voucher.narration}</p>
                </div>
              </Section>

              <Section title={`Lines (${voucher.lines.length})`}>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      <tr><th className="px-2 py-1.5">Account</th><th className="px-2 py-1.5 text-right">Debit</th><th className="px-2 py-1.5 text-right">Credit</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {voucher.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="px-2 py-1.5">
                            <div className="text-slate-700">{l.accountLabel}</div>
                            {l.narration && <div className="text-[11px] text-slate-400">{l.narration}</div>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-rose-600">{l.debitAmount ? money(l.debitAmount) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">{l.creditAmount ? money(l.creditAmount) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {voucher.ledgerEntries.length > 0 && (
                <Section title="Ledger Postings">
                  {voucher.ledgerEntries.map((entry) => (
                    <div key={entry.journalEntryId} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <Badge variant="outline" className={entry.kind === "reversal" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                          {entry.kind === "reversal" ? "Reversal Entry" : "Posted Entry"}
                        </Badge>
                        <span className="text-[11px] text-slate-400">{entry.postedByName ?? "—"} · {dateTime(entry.postedAt)}</span>
                      </div>
                      {entry.lines.map((l, i) => (
                        <div key={i} className="flex justify-between text-xs text-slate-600">
                          <span>{l.accountLabel}</span>
                          <span className="tabular-nums">{l.debitAmount ? `Dr ${money(l.debitAmount)}` : `Cr ${money(l.creditAmount)}`}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </Section>
              )}

              <Section title="Approval Timeline">
                {voucher.timeline.length === 0 ? (
                  <p className="text-xs text-slate-400">None</p>
                ) : (
                  <ol className="space-y-2 border-l border-slate-200 pl-3">
                    {voucher.timeline.map((e) => (
                      <li key={e.id} className="text-xs">
                        <div className="font-semibold text-slate-700">
                          {e.action.replace(/_/g, " ")} — {e.actorName ?? "System"} <span className="font-normal text-slate-400">({e.actorRole})</span>
                        </div>
                        <div className="text-slate-400">{dateTime(e.at)}</div>
                        {e.remarks && <div className="mt-0.5 text-slate-600">“{e.remarks}”</div>}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <Section title="Audit Trail">
                {voucher.audit.length === 0 ? (
                  <p className="text-xs text-slate-400">None</p>
                ) : (
                  <ul className="space-y-1">
                    {voucher.audit.slice(0, 10).map((a, i) => (
                      <li key={i} className="text-xs text-slate-500">
                        {a.action.replace(/_/g, " ")} — {a.actorName ?? "—"} · {dateTime(a.at)}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>

        {voucher && p && (p.canEdit || p.canDelete || p.canSubmit || p.canApprove || p.canReject || p.canWithdraw || p.canReverse) && (
          <div className="space-y-3 border-t bg-slate-50 px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {p.canEdit && (
                <Button size="sm" variant="outline" className="cursor-pointer gap-1.5" onClick={() => onEdit(voucher)} disabled={busy}>
                  <FileEdit className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {p.canSubmit && (
                <Button size="sm" className="cursor-pointer bg-blue-600 hover:bg-blue-700" disabled={busy} onClick={() => actionMutation.mutate({ action: "submit" })}>
                  Submit for Approval
                </Button>
              )}
              {p.canDelete && (
                <Button size="sm" variant="destructive" className="cursor-pointer" disabled={busy} onClick={() => deleteMutation.mutate()}>
                  Delete Draft
                </Button>
              )}
            </div>

            {p.canApprove && (
              <div className="space-y-1.5">
                <Textarea rows={1} placeholder="Approval note (optional)" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} className="text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" className="cursor-pointer bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => actionMutation.mutate({ action: "approve", body: { note: approveNote || null } })}>
                    Approve &amp; Post
                  </Button>
                </div>
              </div>
            )}

            {p.canReject && (
              <div className="space-y-1.5">
                <Textarea rows={1} placeholder="Reason for rejection (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="text-xs" />
                <Button size="sm" variant="destructive" className="cursor-pointer" disabled={busy || rejectReason.trim().length < 5} onClick={() => actionMutation.mutate({ action: "reject", body: { reason: rejectReason } })}>
                  Reject
                </Button>
              </div>
            )}

            {p.canWithdraw && (
              <div className="space-y-1.5">
                <Textarea rows={1} placeholder="Reason for withdrawing (required)" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} className="text-xs" />
                <Button size="sm" variant="outline" className="cursor-pointer" disabled={busy || withdrawReason.trim().length < 5} onClick={() => actionMutation.mutate({ action: "withdraw", body: { reason: withdrawReason } })}>
                  Withdraw
                </Button>
              </div>
            )}

            {p.canReverse && !confirmingReverse && (
              <Button size="sm" variant="outline" className="cursor-pointer gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50" disabled={busy} onClick={() => setConfirmingReverse(true)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reverse This Posting
              </Button>
            )}
            {p.canReverse && confirmingReverse && (
              <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 p-2.5">
                <p className="text-xs text-violet-700">Posts an equal-and-opposite contra entry. The original stays visible in the ledger; nothing is deleted.</p>
                <Textarea rows={1} placeholder="Reason for reversal (required)" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className="bg-white text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" className="cursor-pointer bg-violet-600 hover:bg-violet-700" disabled={busy || reverseReason.trim().length < 5} onClick={() => actionMutation.mutate({ action: "reverse", body: { reason: reverseReason } })}>
                    Confirm Reversal
                  </Button>
                  <Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => setConfirmingReverse(false)} disabled={busy}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

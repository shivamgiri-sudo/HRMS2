// src/components/finance/client-billing/InvoiceApproveView.tsx
/**
 * Legacy "Approve Proforma Invoice" page (used by both View & Approve Proforma and Invoice
 * Approval in I-Spark): Branch / Cost Center / Financial Year / Month for strip, Bill To |
 * Ship To | Details (Bill Date, Proforma No., JCC No., PO No., GRN, GST facts), Bill Details
 * (S.No, Service, Particulars, Rate, Qty, Amount), a separate "Less" block for deductions
 * followed by one blank line, Total / tax / Grand Total, then Approved / Back.
 *   mode "proforma": Approved = step 1 (no bill number).
 *   mode "invoice":  Approved = step 2, generates the bill number.
 * At every stage the narration and particulars can be corrected ("Edit narration / particulars"),
 * but the particulars must add up to the same total — the server refuses anything else.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { approveInvoice, approveProforma, getBillingHeader, getProforma, updateInvoiceNarration } from "@/lib/clientBillingApi";
import { money } from "./shared";

const ROW_TONES = ["bg-sky-500/80", "bg-emerald-500/70", "bg-cyan-500/60"];
/** Bill Details and Less share these widths so their Rate / Qty / Amount columns line up. */
const COLS = (
  <colgroup><col className="w-[7%]" /><col className="w-[10%]" /><col className="w-[48%]" /><col className="w-[12%]" /><col className="w-[9%]" /><col className="w-[14%]" /></colgroup>
);

interface EditLine { particulars: string; qty: string; rate: string; lineType: "charge" | "deduction" }
const linePaise = (l: EditLine) => Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100);

export function InvoiceApproveView({ invoiceId, mode, onClose, onApproved }: {
  invoiceId: string | null;
  mode: "proforma" | "invoice" | "view";
  onClose: () => void;
  /** Invoice mode: called with the generated bill number and the row, for the legacy banner. */
  onApproved?: (result: { billNo?: string; branch?: string | null; amount: number; month: string }) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["client-billing", "approve-view", invoiceId], queryFn: () => getProforma(invoiceId as string), enabled: Boolean(invoiceId) });
  const inv = detail.data?.data;
  const header = useQuery({ queryKey: ["client-billing", "billing-header", inv?.cost_centre_id], queryFn: () => getBillingHeader(inv!.cost_centre_id), enabled: Boolean(inv?.cost_centre_id) });
  const h = header.data?.data;
  const party = h?.party;

  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState("");
  const [draft, setDraft] = useState<EditLine[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => { setEditing(false); setEditError(null); }, [invoiceId]);

  const approve = useMutation({
    mutationFn: async (): Promise<{ billNo?: string }> => {
      if (mode === "invoice") return { billNo: (await approveInvoice(invoiceId!)).data.billNo };
      await approveProforma(invoiceId!);
      return {};
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      const billNo = res.billNo;
      if (mode === "invoice") {
        onApproved?.({ billNo, branch: h?.branch_name, amount: Number(inv?.total_amount ?? 0), month: inv?.month_label ?? "" });
      } else {
        toast({ title: "Proforma approved", description: "Moved to Invoice Approval." });
      }
      onClose();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const totalPaise = Math.round(Number(inv?.total_amount ?? 0) * 100);
  const draftPaise = draft.reduce((s, l) => s + (l.lineType === "deduction" ? -linePaise(l) : linePaise(l)), 0);
  const draftOk = draft.some((l) => l.lineType === "charge") && draft.every((l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "" && Number(l.rate) >= 0);

  const saveEdit = useMutation({
    mutationFn: () => updateInvoiceNarration(invoiceId!, {
      description: narration.trim() || null,
      lines: draft.map((l) => ({ particulars: l.particulars.trim(), qty: Number(l.qty), rate: Number(l.rate), lineType: l.lineType })),
    }),
    onMutate: () => setEditError(null),
    onSuccess: (res) => {
      toast({ title: res.data.changed.length ? "Narration / particulars saved" : "Nothing changed", description: res.data.changed.join("; ") || undefined });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      setEditing(false);
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const startEdit = () => {
    if (!inv) return;
    setNarration(inv.description ?? "");
    setDraft(inv.lines.map((l) => ({ particulars: l.particulars, qty: String(Number(l.qty)), rate: String(Number(l.rate)), lineType: l.line_type === "deduction" ? "deduction" : "charge" })));
    setEditError(null);
    setEditing(true);
  };

  const lines = inv?.lines ?? [];
  const charges = lines.filter((l) => l.line_type !== "deduction");
  const deductions = lines.filter((l) => l.line_type === "deduction");
  const canEdit = Boolean(inv && !Number(inv.is_migrated) && ["proforma", "approved"].includes(String(inv.invoice_status)));
  const party5 = (a: string[] | undefined) => [0, 1, 2, 3, 4, 5].map((i) => a?.[i] ?? "").slice(0, Math.max(5, a?.length ?? 0));
  const partyBlock = (title: string, a: string[] | undefined) => (
    <section className="rounded-md border text-sm" aria-label={title}>
      <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">{title}</h3>
      <p className="border-b px-2 py-1 font-semibold">{party?.clientName || h?.client_name || "—"}</p>
      {party5(a).map((line, i) => <p key={i} className="min-h-[26px] border-b px-2 py-1 font-medium last:border-b-0">{line}</p>)}
      {party?.clientGstin && <p className="border-t bg-slate-50 px-2 py-1 text-xs">GSTIN {party.clientGstin} · {party.clientStateName} ({party.clientStateCode})</p>}
    </section>
  );
  const kv: Array<[string, string]> = [
    ["Bill Date", inv ? String(inv.invoice_date).slice(0, 10) : ""],
    [inv?.bill_no ? "Bill No." : "Proforma No.", inv?.bill_no ?? inv?.proforma_no ?? ""],
    ["JCC No.", inv?.jcc_no ?? ""], ["PO No.", inv?.po_numbers ?? ""], ["GRN", inv?.grn_no ?? ""],
    ["Our GSTIN", party?.ourGstin ?? ""], ["PAN", party?.pan ?? ""], ["SAC / HSN", party?.sacCode || party?.hsnCode || ""],
    ["Place of Supply", party?.placeOfSupply ?? ""],
  ];
  const taxRows: Array<[string, unknown]> = [
    ["Total:", inv?.total_amount],
    ...(Number(inv?.igst_amount) > 0 ? [["IGST @ 18.00%", inv?.igst_amount] as [string, unknown]] : []),
    ...(Number(inv?.cgst_amount) > 0 ? [["CGST @ 9.00%", inv?.cgst_amount] as [string, unknown], ["SGST @ 9.00%", inv?.sgst_amount] as [string, unknown]] : []),
    ["Grand Total:", inv?.grand_total],
  ];
  const th = "px-2 py-1";
  const setLine = (i: number, patch: Partial<EditLine>) => setDraft(draft.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[min(96vw,1400px)] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base font-medium">{mode === "view" ? "Invoice" : "Approve Proforma Invoice"}</DialogTitle></DialogHeader>
        {detail.isLoading || !inv ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-center text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-2">Branch</th><th className="p-2">Cost Center</th><th className="p-2">Financial Year</th><th className="p-2">Month for</th></tr></thead>
                <tbody><tr className="font-medium text-white">
                  <td className="bg-sky-500/80 p-2">{h?.branch_name ?? "—"}</td><td className="bg-rose-500/80 p-2">{h?.cost_centre_code ?? "—"}</td>
                  <td className="bg-sky-500/80 p-2">{inv.finance_year}</td><td className="bg-rose-500/80 p-2">{inv.month_label}</td>
                </tr></tbody>
              </table>
            </div>
            {party && party.warnings.length > 0 && (
              <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />GST / address data to check on the cost centre:</p>
                <ul className="ml-6 list-disc">{party.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {partyBlock("Bill To", party?.billTo)}
              {partyBlock("Ship To", party?.shipTo)}
              <section className="rounded-md border text-sm" aria-label="Details">
                <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">Details</h3>
                {kv.map(([k, v]) => <div key={k} className="grid grid-cols-2 border-b last:border-b-0"><span className="px-2 py-1 font-semibold">{k}</span><span className="px-2 py-1 break-words">{v}</span></div>)}
              </section>
            </div>

            {!editing ? (
              <>
                <section className="rounded-md border text-sm" aria-label="Narration">
                  <div className="flex items-center justify-between border-b bg-slate-50 px-2 py-1">
                    <h3 className="text-xs text-slate-600">Narration</h3>
                    {canEdit && <Button size="sm" variant="outline" className="h-7 cursor-pointer" onClick={startEdit}><Pencil className="mr-1 h-3.5 w-3.5" />Edit narration / particulars</Button>}
                  </div>
                  <p className="px-2 py-1.5">{inv.description || <span className="text-slate-500">—</span>}</p>
                </section>
                <section className="overflow-x-auto rounded-md border" aria-label="Bill Details">
                  <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">Bill Details</h3>
                  <table className="w-full table-fixed text-sm">
                    {COLS}
                    <thead className="text-left text-xs"><tr><th className={th}>S.No.</th><th className={th}>Service</th><th className={th}>Particulars</th><th className={th}>Rate</th><th className={th}>Qty.</th><th className={th}>Amount</th></tr></thead>
                    <tbody>
                      {charges.map((l, i) => (
                        <tr key={l.id} className={`${ROW_TONES[i % 3]} text-white`}>
                          <td className={th}>{i + 1}</td><td className={th} /><td className={th}>{l.particulars}</td>
                          <td className={`${th} tabular-nums`}>{Number(l.rate)}</td><td className={`${th} tabular-nums`}>{Number(l.qty)}</td><td className={`${th} tabular-nums`}>{Number(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="overflow-x-auto rounded-md border border-rose-200" aria-label="Less">
                  <h3 className="border-b border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800">Less</h3>
                  <table className="w-full table-fixed text-sm">
                    {COLS}
                    <tbody>
                      {deductions.map((l, i) => (
                        <tr key={l.id} className="bg-rose-50/60 text-rose-900">
                          <td className={th}>{i + 1}</td><td className={th} /><td className={th}>{l.particulars}</td>
                          <td className={`${th} tabular-nums`}>{Number(l.rate)}</td><td className={`${th} tabular-nums`}>{Number(l.qty)}</td><td className={`${th} tabular-nums`}>{Number(l.amount)}</td>
                        </tr>
                      ))}
                      <tr aria-hidden="true"><td colSpan={6} className="h-7" /></tr>
                    </tbody>
                  </table>
                </section>
              </>
            ) : (
              <section className="space-y-3 rounded-md border border-sky-300 p-3 text-sm" aria-label="Edit narration and particulars">
                <div>
                  <label className="text-xs font-medium text-slate-700" htmlFor="nar">Narration</label>
                  <Input id="nar" className="mt-1 h-8" maxLength={255} value={narration} onChange={(e) => setNarration(e.target.value)} />
                </div>
                {(["charge", "deduction"] as const).map((type) => (
                  <div key={type}>
                    <div className="mb-1 flex items-center justify-between">
                      <h4 className={`text-xs font-semibold ${type === "deduction" ? "text-rose-800" : "text-slate-800"}`}>{type === "charge" ? "Particulars" : "Less"}</h4>
                      <Button size="sm" variant="outline" className="h-7 cursor-pointer" onClick={() => setDraft([...draft, { particulars: "", qty: "1", rate: "", lineType: type }])}>
                        <Plus className="mr-1 h-3.5 w-3.5" />Add {type === "charge" ? "particular" : "less line"}
                      </Button>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {draft.map((l, i) => l.lineType !== type ? null : (
                          <tr key={i} className="border-t">
                            <td className="py-1 pr-2"><Input aria-label={`${type} particulars ${i + 1}`} className="h-8" maxLength={255} value={l.particulars} onChange={(e) => setLine(i, { particulars: e.target.value })} /></td>
                            <td className="w-24 py-1 pr-2"><Input aria-label={`${type} qty ${i + 1}`} className="h-8" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                            <td className="w-32 py-1 pr-2"><Input aria-label={`${type} rate ${i + 1}`} className="h-8" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                            <td className="w-32 py-1 pr-2 text-right tabular-nums">{money(linePaise(l) / 100)}</td>
                            <td className="w-10 py-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8 cursor-pointer text-rose-600" aria-label={`Remove ${type} line ${i + 1}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 ${draftPaise === totalPaise ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
                  <span>Particulars total <b className="tabular-nums">{money(draftPaise / 100)}</b> · invoice total <b className="tabular-nums">{money(totalPaise / 100)}</b></span>
                  <span>{draftPaise === totalPaise ? "Matches — can be saved" : `Difference ${money((draftPaise - totalPaise) / 100)} — the total cannot change`}</span>
                </div>
                {editError && <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-800">{editError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" disabled={!draftOk || draftPaise !== totalPaise || saveEdit.isPending} onClick={() => saveEdit.mutate()}>
                    {saveEdit.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
                  </Button>
                </div>
              </section>
            )}

            <section className="rounded-md border text-sm" aria-label="Totals">
              {taxRows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[2fr_1fr] border-b last:border-b-0">
                  <span className="px-2 py-1 font-semibold">{k}</span><span className={`px-2 py-1 tabular-nums ${k === "Grand Total:" ? "font-semibold" : ""}`}>{money(Number(v))}</span>
                </div>
              ))}
            </section>
            <div className="flex justify-center gap-3 pb-2">
              {mode !== "view" && (
                <Button disabled={approve.isPending || editing} onClick={() => approve.mutate()} className="bg-sky-600 px-6 hover:bg-sky-700">
                  {approve.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Approved
                </Button>
              )}
              <Button variant="outline" onClick={onClose} className="px-6">Back</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

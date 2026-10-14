// src/components/finance/client-billing/NarrationEditor.tsx
/**
 * "Edit narration / particulars" block of the Approve Proforma Invoice screen. The particulars
 * may be reworded or re-split, but must add up to the same taxable total — the server refuses
 * anything else (and, depending on the backend, may refuse particulars once the bill has been
 * sent or exported); whatever it says is shown inline, verbatim.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { updateInvoiceNarration, type InvoiceDetail } from "@/lib/clientBillingApi";
import { InlineError, formatDateTime, money } from "./shared";

interface EditLine { particulars: string; qty: string; rate: string; lineType: "charge" | "deduction" }
const linePaise = (l: EditLine) => Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100);

export function NarrationEditor({ inv, onSaved, onCancel }: {
  inv: InvoiceDetail;
  /** Called after a successful save with the list of changed fields. */
  onSaved: (changed: string[]) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [narration, setNarration] = useState(inv.description ?? "");
  const [draft, setDraft] = useState<EditLine[]>(() => inv.lines.map((l) => ({
    particulars: l.particulars, qty: String(Number(l.qty)), rate: String(Number(l.rate)),
    lineType: l.line_type === "deduction" ? "deduction" : "charge",
  })));

  const totalPaise = Math.round(Number(inv.total_amount ?? 0) * 100);
  const draftPaise = draft.reduce((s, l) => s + (l.lineType === "deduction" ? -linePaise(l) : linePaise(l)), 0);
  const draftOk = draft.some((l) => l.lineType === "charge") && draft.every((l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "" && Number(l.rate) >= 0);

  const saveEdit = useMutation({
    mutationFn: () => updateInvoiceNarration(inv.id, {
      description: narration.trim() || null,
      lines: draft.map((l) => ({ particulars: l.particulars.trim(), qty: Number(l.qty), rate: Number(l.rate), lineType: l.lineType })),
    }),
    onSuccess: (res) => {
      toast({ title: res.data.changed.length ? "Narration / particulars saved" : "Nothing changed", description: res.data.changed.join("; ") || undefined });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onSaved(res.data.changed);
    },
  });

  const setLine = (i: number, patch: Partial<EditLine>) => setDraft(draft.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <section className="space-y-3 rounded-md border border-sky-300 p-3 text-sm" aria-label="Edit narration and particulars">
      {inv.last_sent_at && (
        <p role="note" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The client already received this invoice as a PDF on {formatDateTime(inv.last_sent_at)}. After saving, send it again so their copy matches.
        </p>
      )}
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
      {saveEdit.isError && <InlineError title="Not saved" message={saveEdit.error.message} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="cursor-pointer" disabled={!draftOk || draftPaise !== totalPaise || saveEdit.isPending} onClick={() => saveEdit.mutate()}>
          {saveEdit.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
        </Button>
      </div>
    </section>
  );
}

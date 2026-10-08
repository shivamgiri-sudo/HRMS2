import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  computeLineAmount,
  LINE_TYPE_LABEL,
  METRIC_OPTIONS,
  useCloseForecast,
  useReopenForecast,
  useReviewForecast,
  useRevenueForecast,
  useSaveForecastDraft,
  useSubmitForecast,
  type ApprovalState,
  type ForecastLineType,
  type ForecastListRow,
  type LineInput,
} from "@/hooks/useRevenueForecast";
import { ForecastStatusBadge, money } from "./forecastUi";

export type SheetMode = "edit" | "view" | "review" | "close" | "reopen";

interface DraftLine {
  key: string;
  lineType: ForecastLineType;
  description: string;
  metricKey: string;
  quantity: string;
  rate: string;
  amount: string;
}

const toNum = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
let keySeq = 0;
const newLine = (lineType: ForecastLineType = "seat"): DraftLine => ({
  key: `l${++keySeq}`, lineType, description: "", metricKey: "talk_minutes", quantity: "", rate: "", amount: "",
});

function Approval({ label, state, note }: { label: string; state: ApprovalState | null | undefined; note?: string | null }) {
  const Icon = state === "approved" ? CheckCircle2 : state === "rejected" ? XCircle : CircleDashed;
  const tone = state === "approved" ? "text-emerald-700" : state === "rejected" ? "text-rose-700" : "text-slate-600";
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
      <div>
        <p className={`font-semibold ${tone}`}>{label}: {state === "approved" ? "Approved" : state === "rejected" ? "Rejected" : "Pending"}</p>
        {note ? <p className="text-slate-600">“{note}”</p> : null}
      </div>
    </div>
  );
}

export function ForecastSheet({
  open, onOpenChange, mode, row, period,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SheetMode;
  row: ForecastListRow | null;
  period: string;
}) {
  const { toast } = useToast();
  const detail = useRevenueForecast(open && row?.forecastId ? row.forecastId : null);
  const save = useSaveForecastDraft();
  const submit = useSubmitForecast();
  const review = useReviewForecast();
  const close = useCloseForecast();
  const reopen = useReopenForecast();
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState("");
  const [actuals, setActuals] = useState<Record<string, { quantity: string; rate: string; amount: string }>>({});
  /** Inline validation shows once the user has tried to save (then live as they fix lines). */
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const f = detail.data;
  // Seed the editor / close form from the saved forecast each time the sheet opens on one.
  useEffect(() => {
    if (!open) return;
    setNote("");
    setShowErrors(false);
    setDirty(false);
    if (!f) {
      setLines([newLine()]);
      setNotes("");
      setActuals({});
      return;
    }
    setNotes(f.notes ?? "");
    setLines(f.lines.map((l) => ({
      key: `l${++keySeq}`, lineType: l.line_type, description: l.description, metricKey: l.metric_key ?? "talk_minutes",
      quantity: str(l.quantity), rate: str(l.rate), amount: str(Math.abs(Number(l.amount))),
    })));
    setActuals(Object.fromEntries(f.lines.map((l) => [l.id, {
      quantity: str(l.actual_quantity ?? l.quantity), rate: str(l.actual_rate ?? l.rate),
      amount: str(Math.abs(Number(l.actual_amount ?? l.amount))),
    }])));
  }, [open, f]);

  const lineAmounts = lines.map((l) => computeLineAmount({ lineType: l.lineType, quantity: toNum(l.quantity), rate: toNum(l.rate), amount: toNum(l.amount) }));
  const draftTotal = lineAmounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const actualAmounts = useMemo(() => (f?.lines ?? []).map((l) => {
    const a = actuals[l.id];
    return a ? computeLineAmount({ lineType: l.line_type, quantity: toNum(a.quantity), rate: toNum(a.rate), amount: toNum(a.amount) }) : null;
  }), [f, actuals]);
  const actualTotal = actualAmounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const forecastTotal = Number(f?.forecast_amount ?? 0);

  const busy = save.isPending || submit.isPending || review.isPending || close.isPending || reopen.isPending;
  const fail = (e: unknown) => toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
  const done = (title: string) => { toast({ title }); onOpenChange(false); };

  const linePayload = (): LineInput[] => lines.map((l) => ({
    lineType: l.lineType, description: l.description, metricKey: l.lineType === "metric" ? l.metricKey : null,
    quantity: toNum(l.quantity), rate: toNum(l.rate), amount: toNum(l.amount),
  }));
  const lineErrors = lines.map((l, i) => ({
    description: !l.description.trim(),
    amount: lineAmounts[i] === null,
  }));
  const invalidLines = lineErrors.flatMap((e, i) => (e.description || e.amount ? [i + 1] : []));
  const invalidLine = invalidLines.length ? invalidLines[0] - 1 : -1;

  async function saveDraft(andSubmit: boolean) {
    if (!row) return;
    if (invalidLine >= 0) {
      setShowErrors(true);
      return;
    }
    try {
      const saved = await save.mutateAsync({ costCentreId: row.costCentreId, period, notes: notes || null, lines: linePayload() });
      if (andSubmit) {
        await submit.mutateAsync(saved.id);
        done("Forecast submitted to the Finance Head");
      } else done("Draft saved");
    } catch (e) { fail(e); }
  }

  const update = (key: string, patch: Partial<DraftLine>) => {
    setDirty(true);
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  /** Closing an editor with unsaved changes asks first instead of silently dropping them. */
  const requestClose = (o: boolean) => {
    if (o || busy) return;
    if (mode === "edit" && dirty) { setConfirmDiscard(true); return; }
    onOpenChange(false);
  };
  const errClass = "border-rose-500 focus-visible:ring-rose-500";
  const editable = mode === "edit";
  const title = row
    ? [row.costCentreCode, row.costCentreName !== row.costCentreCode ? row.costCentreName : null].filter(Boolean).join(" · ")
    : "Forecast";

  return (
    <>
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
            {title}
            {row ? <ForecastStatusBadge status={f?.status ?? row.status} /> : null}
          </SheetTitle>
          <SheetDescription>
            {row?.branchName}{row?.processName ? ` · ${row.processName}` : ""} · revenue forecast for {period}
            {mode === "close" ? " — enter what was actually invoiced per line." : null}
          </SheetDescription>
        </SheetHeader>

        {row?.forecastId && detail.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading forecast…</div>
        ) : detail.isError ? (
          <p className="py-6 text-sm text-rose-700">Could not load this forecast. {(detail.error as Error)?.message}</p>
        ) : (
          <div className="mt-4 space-y-5">
            {f && f.status !== "draft" ? (
              <div className="rounded-lg border bg-slate-50 p-3">
                <Approval label="Finance Head" state={f.finance_head_status} note={f.finance_head_note} />
              </div>
            ) : null}

            {mode === "close" && f ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <caption className="sr-only">Forecast against actual, per line</caption>
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-2">Line</th>
                      <th className="px-2 py-2 text-right">Forecast</th>
                      <th className="px-2 py-2">Actual qty</th>
                      <th className="px-2 py-2">Actual rate</th>
                      <th className="px-2 py-2">or amount</th>
                      <th className="px-2 py-2 text-right">Actual</th>
                      <th className="px-2 py-2 text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lines.map((l, i) => {
                      const a = actuals[l.id] ?? { quantity: "", rate: "", amount: "" };
                      const set = (patch: Partial<typeof a>) => setActuals((cur) => ({ ...cur, [l.id]: { ...a, ...patch } }));
                      const usesQty = l.line_type === "seat" || l.line_type === "metric";
                      const actual = actualAmounts[i];
                      const variance = actual === null ? null : actual - Number(l.amount);
                      return (
                        <tr key={l.id} className="border-t">
                          <td className="px-2 py-2"><p className="font-medium text-slate-900">{l.description}</p><p className="text-slate-600">{LINE_TYPE_LABEL[l.line_type]}</p></td>
                          <td className="px-2 py-2 text-right tabular-nums">{money(Number(l.amount))}</td>
                          <td className="px-2 py-2"><Input aria-label={`Actual quantity, ${l.description}`} className="h-8 w-24 text-xs" inputMode="decimal" value={a.quantity} onChange={(e) => set({ quantity: e.target.value })} disabled={!usesQty} /></td>
                          <td className="px-2 py-2"><Input aria-label={`Actual rate, ${l.description}`} className="h-8 w-24 text-xs" inputMode="decimal" value={a.rate} onChange={(e) => set({ rate: e.target.value })} disabled={!usesQty} /></td>
                          <td className="px-2 py-2"><Input aria-label={`Actual amount, ${l.description}`} className="h-8 w-28 text-xs" inputMode="decimal" value={a.amount} onChange={(e) => set({ amount: e.target.value })} disabled={usesQty} /></td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{actual === null ? "—" : money(actual)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${variance === null ? "" : variance < 0 ? "text-rose-700" : "text-emerald-700"}`}>{variance === null ? "—" : `${variance >= 0 ? "+" : ""}${money(variance)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-2 py-2">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(forecastTotal)}</td>
                      <td colSpan={3} />
                      <td className="px-2 py-2 text-right tabular-nums">{money(actualTotal)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${actualTotal - forecastTotal < 0 ? "text-rose-700" : "text-emerald-700"}`}>{`${actualTotal - forecastTotal >= 0 ? "+" : ""}${money(actualTotal - forecastTotal)}`}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <caption className="sr-only">Revenue lines</caption>
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Description</th>
                      <th className="px-2 py-2">Qty / seats</th>
                      <th className="px-2 py-2">Rate (₹)</th>
                      <th className="px-2 py-2">Amount (₹)</th>
                      <th className="px-2 py-2 text-right">Line total</th>
                      {f?.status === "closed" ? <th className="px-2 py-2 text-right">Actual</th> : null}
                      {editable ? <th className="px-2 py-2"><span className="sr-only">Remove</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const usesQty = l.lineType === "seat" || l.lineType === "metric";
                      const saved = f?.lines[i];
                      return (
                        <tr key={l.key} className="border-t align-top">
                          <td className="px-2 py-2">
                            {editable ? (
                              <div className="space-y-1">
                                <select aria-label={`Line ${i + 1} type`} className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  value={l.lineType} onChange={(e) => update(l.key, { lineType: e.target.value as ForecastLineType })}>
                                  {Object.entries(LINE_TYPE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                                </select>
                                {l.lineType === "metric" ? (
                                  <select aria-label={`Line ${i + 1} metric`} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                    value={l.metricKey} onChange={(e) => update(l.key, { metricKey: e.target.value })}>
                                    {METRIC_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                  </select>
                                ) : null}
                              </div>
                            ) : (
                              <span>{LINE_TYPE_LABEL[l.lineType]}{l.lineType === "metric" ? ` · ${METRIC_OPTIONS.find((m) => m.value === l.metricKey)?.label ?? l.metricKey}` : ""}</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {editable ? <Input aria-label={`Line ${i + 1} description`} aria-invalid={showErrors && lineErrors[i].description} className={`h-8 min-w-40 text-xs ${showErrors && lineErrors[i].description ? errClass : ""}`} value={l.description} placeholder={l.lineType === "seat" ? "e.g. 40 seats @ ₹25,000" : "Describe the line"} onChange={(e) => update(l.key, { description: e.target.value })} /> : l.description}
                          </td>
                          <td className="px-2 py-2">{editable ? <Input aria-label={`Line ${i + 1} quantity`} aria-invalid={showErrors && usesQty && lineErrors[i].amount} className={`h-8 w-24 text-xs ${showErrors && usesQty && lineErrors[i].amount ? errClass : ""}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /> : (l.quantity || "—")}</td>
                          <td className="px-2 py-2">{editable ? <Input aria-label={`Line ${i + 1} rate`} aria-invalid={showErrors && usesQty && lineErrors[i].amount} className={`h-8 w-24 text-xs ${showErrors && usesQty && lineErrors[i].amount ? errClass : ""}`} inputMode="decimal" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} /> : (l.rate || "—")}</td>
                          <td className="px-2 py-2">{editable ? <Input aria-label={`Line ${i + 1} amount`} aria-invalid={showErrors && !usesQty && lineErrors[i].amount} className={`h-8 w-28 text-xs ${showErrors && !usesQty && lineErrors[i].amount ? errClass : ""}`} inputMode="decimal" value={l.amount} disabled={usesQty} placeholder={usesQty ? "qty × rate" : ""} onChange={(e) => update(l.key, { amount: e.target.value })} /> : (usesQty ? "—" : money(Number(l.amount)))}</td>
                          <td className={`px-2 py-2 text-right font-semibold tabular-nums ${(lineAmounts[i] ?? 0) < 0 ? "text-rose-700" : "text-slate-900"}`}>{lineAmounts[i] === null ? "—" : money(lineAmounts[i]!)}</td>
                          {f?.status === "closed" ? <td className="px-2 py-2 text-right tabular-nums">{saved?.actual_amount === null || saved?.actual_amount === undefined ? "—" : money(Number(saved.actual_amount))}</td> : null}
                          {editable ? (
                            <td className="px-2 py-2">
                              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => { setDirty(true); setLines((cur) => cur.filter((x) => x.key !== l.key)); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-2 py-2" colSpan={5}>Forecast total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(draftTotal)}</td>
                      {f?.status === "closed" ? <td className="px-2 py-2 text-right tabular-nums">{money(Number(f.closed_amount ?? 0))}</td> : null}
                      {editable ? <td /> : null}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {editable ? (
              <div className="flex flex-wrap gap-2">
                {(["seat", "metric", "fixed", "reward", "penalty"] as ForecastLineType[]).map((t) => (
                  <Button key={t} type="button" size="sm" variant="outline" onClick={() => { setDirty(true); setLines((cur) => [...cur, newLine(t)]); }}>
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> {LINE_TYPE_LABEL[t]}
                  </Button>
                ))}
              </div>
            ) : null}

            {editable ? (
              <div className="space-y-1">
                <Label htmlFor="forecast-notes" className="text-xs">Notes for the approvers (optional)</Label>
                <Textarea id="forecast-notes" rows={2} value={notes} onChange={(e) => { setDirty(true); setNotes(e.target.value); }} />
              </div>
            ) : f?.notes ? <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-700"><span className="font-semibold">Notes: </span>{f.notes}</p> : null}

            {(mode === "review" || mode === "close" || mode === "reopen") ? (
              <div className="space-y-1">
                <Label htmlFor="forecast-note" className="text-xs">
                  {mode === "review" ? "Comment (required to reject)" : mode === "close" ? "Close note (e.g. invoice numbers)" : "Reason for reopening (required)"}
                </Label>
                <Textarea id="forecast-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            ) : null}

            {editable && showErrors && invalidLines.length ? (
              <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                Line{invalidLines.length > 1 ? "s" : ""} {invalidLines.join(", ")} {invalidLines.length > 1 ? "are" : "is"} incomplete — each line needs a description and an amount (or, for seats and metrics, a quantity and a rate).
              </p>
            ) : null}
            {mode === "close" && f && actualAmounts.some((a) => a === null) ? (
              <p role="status" className="text-xs text-slate-700">Enter the actual for every line to close the forecast (quantity and rate for seats and metrics, the amount for the others).</p>
            ) : null}
            {mode === "review" && !note.trim() ? (
              <p className="text-xs text-slate-600">To reject, write a comment for the Branch Head first.</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button variant="ghost" onClick={() => requestClose(false)} disabled={busy}>Cancel</Button>
              {editable ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => void saveDraft(false)}>Save draft</Button>
                  <Button disabled={busy} onClick={() => void saveDraft(true)}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null} Save &amp; submit for approval
                  </Button>
                </>
              ) : null}
              {mode === "view" && f && (f.status === "draft" || f.status === "rejected") ? (
                <Button disabled={busy} onClick={() => submit.mutateAsync(f.id).then(() => done("Forecast submitted"), fail)}>Submit for approval</Button>
              ) : null}
              {mode === "review" && f ? (
                <>
                  <Button variant="outline" className="border-rose-300 text-rose-700 hover:bg-rose-50" disabled={busy || !note.trim()}
                    title={!note.trim() ? "Write a comment to reject" : undefined}
                    onClick={() => review.mutateAsync({ id: f.id, decision: "rejected", note }).then(() => done("Forecast sent back to the Branch Head"), fail)}>
                    Reject
                  </Button>
                  <Button disabled={busy} onClick={() => review.mutateAsync({ id: f.id, decision: "approved", note: note || undefined }).then(() => done("Approved"), fail)}>
                    Approve
                  </Button>
                </>
              ) : null}
              {mode === "close" && f ? (
                <Button disabled={busy || actualAmounts.some((a) => a === null)}
                  onClick={() => close.mutateAsync({
                    id: f.id, note: note || undefined,
                    actuals: f.lines.map((l) => ({ lineId: l.id, actualQuantity: toNum(actuals[l.id]?.quantity ?? ""), actualRate: toNum(actuals[l.id]?.rate ?? ""), actualAmount: toNum(actuals[l.id]?.amount ?? "") })),
                  }).then(() => done("Forecast closed — the P&L now uses the closed amount"), fail)}>
                  Close forecast at {money(actualTotal)}
                </Button>
              ) : null}
              {mode === "reopen" && f ? (
                <Button disabled={busy || !note.trim()} onClick={() => reopen.mutateAsync({ id: f.id, reason: note }).then(() => done("Forecast reopened"), fail)}>Reopen</Button>
              ) : null}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>The lines you edited have not been saved. Save a draft to keep them.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setConfirmDiscard(false); setDirty(false); onOpenChange(false); }}>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

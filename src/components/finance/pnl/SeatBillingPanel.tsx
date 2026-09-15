import { useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { dateTimeLabel, money } from "@/components/finance/grn/grn-format";
import { useHasRole } from "@/hooks/useUserRole";
import {
  useSeatBilling,
  useSeatBillingCostCentre,
  useSeatBillingMutations,
  type CostCentreSeatBilling,
  type SeatBillingLine,
  type SeatLineKind,
} from "@/hooks/useSeatBilling";

const WRITE_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"] as const;
const SECTION = "text-xs font-bold uppercase tracking-wide text-slate-400";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(period: string | null | undefined) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period ?? "—";
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

function inr(value: number | null | undefined) {
  return money(value ?? 0, 0);
}

function seatsLabel(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function SourceBadge({ cc }: { cc: Pick<CostCentreSeatBilling, "source" | "sourcePeriod"> }) {
  if (cc.source === "configured") return <Badge className="bg-blue-600 hover:bg-blue-600">Configured</Badge>;
  if (cc.source === "invoice") {
    return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">From {periodLabel(cc.sourcePeriod)} invoice</Badge>;
  }
  return <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">No rate</Badge>;
}

const EXCLUDED_LABEL: Record<string, string> = {
  incentive: "Incentive / R&R",
  one_time: "One-time",
  usage: "Usage / recharge",
  revenue_share: "Revenue share",
  zero_value: "Zero value",
};

function classificationLabel(value: string) {
  if (value === "seat") return "Seat";
  if (value === "fixed") return "Fixed monthly";
  const reason = value.replace(/^excluded:/, "");
  return `Excluded — ${EXCLUDED_LABEL[reason] ?? reason}`;
}

const ACTION_LABEL: Record<string, string> = {
  seat_billing_line_created: "Line added",
  seat_billing_line_updated: "Line edited",
  seat_billing_line_deactivated: "Line deactivated",
};

function None() {
  return <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">None</p>;
}

interface LineFormState {
  id: string | null;
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly: string;
  seats: string;
  monthlyAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
}

function emptyForm(period: string): LineFormState {
  return { id: null, lineLabel: "", lineKind: "seat", rateMonthly: "", seats: "", monthlyAmount: "", effectiveFrom: period, effectiveTo: "", notes: "" };
}

function formFromLine(line: SeatBillingLine, period: string): LineFormState {
  return {
    id: line.id,
    lineLabel: line.lineLabel,
    lineKind: line.lineKind,
    rateMonthly: line.lineKind === "seat" ? String(line.rateMonthly) : "",
    seats: line.lineKind === "seat" ? String(line.seats) : "",
    monthlyAmount: line.lineKind === "fixed" ? String(line.monthlyValue) : "",
    effectiveFrom: line.effectiveFrom ?? period,
    effectiveTo: line.effectiveTo ?? "",
    notes: line.notes ?? "",
  };
}

function CostCentreDrawer({
  costCentreId,
  period,
  canWrite,
  onClose,
}: {
  costCentreId: string | null;
  period: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const detailQuery = useSeatBillingCostCentre(costCentreId, period);
  const { createLine, updateLine, deactivateLine, importFromInvoice } = useSeatBillingMutations();
  const [form, setForm] = useState<LineFormState | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<string | null>(null);
  const detail = detailQuery.data;
  const cc = detail?.costCentre;
  const editable = canWrite && Boolean(detail?.configurationAvailable);
  const saving = createLine.isPending || updateLine.isPending;

  const monthlyPreview = form
    ? form.lineKind === "fixed"
      ? Number(form.monthlyAmount || 0)
      : Number(form.rateMonthly || 0) * Number(form.seats || 0)
    : 0;

  async function save() {
    if (!form || !cc) return;
    const payload = {
      lineLabel: form.lineLabel,
      lineKind: form.lineKind,
      rateMonthly: form.lineKind === "seat" ? Number(form.rateMonthly) : undefined,
      seats: form.lineKind === "seat" ? Number(form.seats) : undefined,
      monthlyAmount: form.lineKind === "fixed" ? Number(form.monthlyAmount) : undefined,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      notes: form.notes || null,
    };
    try {
      if (form.id) await updateLine.mutateAsync({ id: form.id, ...payload });
      else await createLine.mutateAsync({ costCentreId: cc.costCentreId, ...payload });
      toast.success(form.id ? "Line updated" : "Line added");
      setForm(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the line");
    }
  }

  async function runImport() {
    if (!cc) return;
    try {
      const result = await importFromInvoice.mutateAsync({ costCentreId: cc.costCentreId, period });
      toast.success(`Imported ${result.imported} line(s) from the ${periodLabel(result.sourcePeriod)} invoice`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import the invoice lines");
    }
  }

  async function deactivate(id: string) {
    try {
      await deactivateLine.mutateAsync({ id });
      toast.success("Line deactivated");
      setConfirmingDeactivate(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not deactivate the line");
    }
  }

  return (
    <Sheet open={Boolean(costCentreId)} onOpenChange={(open) => { if (!open) { setForm(null); onClose(); } }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="space-y-1 pr-6 text-left">
          <SheetTitle className="text-base">{cc?.costCentreCode ?? "Cost centre"}</SheetTitle>
          {cc && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <SourceBadge cc={cc} />
              <span>{cc.costCentreName}</span>
              <span>· {cc.branchName ?? "No branch"}</span>
              <span>· {periodLabel(period)}</span>
            </div>
          )}
        </SheetHeader>

        {detailQuery.isLoading && (
          <div className="mt-6 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>
        )}
        {detailQuery.isError && (
          <div className="mt-6 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            Could not load this cost centre. <button type="button" className="underline" onClick={() => void detailQuery.refetch()}>Retry</button>
          </div>
        )}

        {detail && cc && (
          <div className="mt-5 space-y-6">
            <section className="space-y-2">
              <p className={SECTION}>Estimate for {periodLabel(period)}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Monthly", inr(cc.monthlyValue)],
                  ["Per day", inr(cc.perDay)],
                  [`To date (${detail.daysElapsed}/${detail.daysInMonth} d)`, inr(cc.toDate)],
                  ["Seats", seatsLabel(cc.seats)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 p-2">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={SECTION}>LOB lines used</p>
                <div className="flex gap-2">
                  {editable && cc.source === "invoice" && (
                    <Button size="sm" variant="outline" onClick={() => void runImport()} disabled={importFromInvoice.isPending}>
                      {importFromInvoice.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                      Import to edit
                    </Button>
                  )}
                  {editable && (
                    <Button size="sm" onClick={() => setForm(emptyForm(period))}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add line
                    </Button>
                  )}
                </div>
              </div>
              {cc.source === "invoice" && (
                <p className="text-xs text-amber-700">
                  Read from the {periodLabel(cc.sourcePeriod)} invoice. Import them to change seats or rates for {periodLabel(period)} onwards
                  {editable ? "" : " (needs finance edit access and the configuration table)"}.
                </p>
              )}
              {cc.lines.length === 0 ? <None /> : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Line (LOB)</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Seats</TableHead>
                        <TableHead className="text-right">Monthly</TableHead>
                        <TableHead>Effective</TableHead>
                        {editable && cc.source === "configured" && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cc.lines.map((line, index) => (
                        <TableRow key={line.id ?? `${line.lineLabel}-${index}`}>
                          <TableCell className="max-w-56">
                            <p className="truncate text-xs font-medium text-slate-800" title={line.lineLabel}>{line.lineLabel}</p>
                            <p className="text-[11px] text-slate-400">{line.lineKind === "fixed" ? "Fixed monthly" : "Per seat"}</p>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{line.lineKind === "fixed" ? "—" : inr(line.rateMonthly)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{line.lineKind === "fixed" ? "—" : seatsLabel(line.seats)}</TableCell>
                          <TableCell className="text-right text-xs font-medium tabular-nums">{inr(line.monthlyValue)}</TableCell>
                          <TableCell className="text-[11px] text-slate-500">
                            {line.effectiveFrom ? `${periodLabel(line.effectiveFrom)} → ${line.effectiveTo ? periodLabel(line.effectiveTo) : "open"}` : "This month"}
                          </TableCell>
                          {editable && cc.source === "configured" && line.id && (
                            <TableCell className="whitespace-nowrap text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit line" onClick={() => setForm(formFromLine(line, period))}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {confirmingDeactivate === line.id ? (
                                <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => void deactivate(line.id!)} disabled={deactivateLine.isPending}>
                                  Confirm
                                </Button>
                              ) : (
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" aria-label="Deactivate line" onClick={() => setConfirmingDeactivate(line.id)}>
                                  <Power className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {form && (
              <section className="space-y-3 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                <p className={SECTION}>{form.id ? "Edit line" : "Add line"}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Line / LOB name</Label>
                    <Input value={form.lineLabel} maxLength={200} onChange={(e) => setForm({ ...form, lineLabel: e.target.value })} placeholder="e.g. BVO Chat" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Billing type</Label>
                    <Select value={form.lineKind} onValueChange={(value) => setForm({ ...form, lineKind: value as SeatLineKind })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seat">Per seat (rate × seats)</SelectItem>
                        <SelectItem value="fixed">Fixed monthly amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.lineKind === "seat" ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Seat rate per month (₹)</Label>
                        <Input type="number" min={1} step="1" value={form.rateMonthly} onChange={(e) => setForm({ ...form, rateMonthly: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Seats</Label>
                        <Input type="number" min={0.01} step="0.01" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs">Monthly amount (₹)</Label>
                      <Input type="number" min={1} step="1" value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Effective from</Label>
                    <MonthYearPicker value={form.effectiveFrom} onChange={(value) => setForm({ ...form, effectiveFrom: value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Effective to (optional)</Label>
                    <MonthYearPicker value={form.effectiveTo} emptyLabel="Open" onChange={(value) => setForm({ ...form, effectiveTo: value })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Notes</Label>
                    <Textarea rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this rate or seat count" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">Monthly value: <span className="font-semibold tabular-nums">{inr(monthlyPreview)}</span></p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
                    <Button size="sm" onClick={() => void save()} disabled={saving}>
                      {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
                    </Button>
                  </div>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <p className={SECTION}>Left out of the estimate</p>
              {cc.excludedLines.length === 0 ? <None /> : (
                <div className="space-y-1">
                  {cc.excludedLines.map((line, index) => (
                    <div key={`${line.lineLabel}-${index}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-xs">
                      <span className="truncate text-slate-700" title={line.lineLabel}>{line.lineLabel}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{EXCLUDED_LABEL[line.reason] ?? line.reason}</Badge>
                        <span className="tabular-nums text-slate-500">{inr(line.amount)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <p className={SECTION}>Invoice lines — last 3 months</p>
              {detail.invoiceHistory.length === 0 ? <None /> : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead>Line</TableHead>
                        <TableHead className="text-right">Rate × qty</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Treated as</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.invoiceHistory.map((line, index) => (
                        <TableRow key={`${line.billSourceId ?? index}-${line.period}`}>
                          <TableCell className="whitespace-nowrap text-xs">{periodLabel(line.period)}</TableCell>
                          <TableCell className="max-w-48 truncate text-xs" title={line.lineLabel}>{line.lineLabel}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{inr(line.rate)} × {seatsLabel(line.qty)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{inr(line.amount)}</TableCell>
                          <TableCell className="text-[11px] text-slate-500">{classificationLabel(line.classification)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <p className={SECTION}>Configuration history</p>
              {detail.history.length === 0 ? <None /> : (
                <div className="space-y-1">
                  {detail.history.map((row) => (
                    <div key={row.id} className={`rounded-md border px-2 py-1.5 text-xs ${row.active ? "border-slate-200" : "border-slate-100 text-slate-400 line-through"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{row.lineLabel}</span>
                        <span className="tabular-nums">{row.lineKind === "fixed" ? inr(row.monthlyValue) : `${inr(row.rateMonthly)} × ${seatsLabel(row.seats)}`}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {periodLabel(row.effectiveFrom)} → {row.effectiveTo ? periodLabel(row.effectiveTo) : "open"} · {row.source === "invoice" ? `imported from ${periodLabel(row.sourcePeriod)} invoice` : "entered manually"} · updated {dateTimeLabel(row.updatedAt) ?? "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <p className={SECTION}>Audit trail</p>
              {detail.auditTrail.length === 0 ? <None /> : (
                <div className="space-y-1">
                  {detail.auditTrail.map((entry, index) => {
                    const before = entry.change?.before ?? null;
                    const after = entry.change?.after ?? null;
                    const changed = before && after
                      ? Object.keys(after).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]))
                      : [];
                    return (
                      <div key={`${entry.at}-${index}`} className="rounded-md border border-slate-100 px-2 py-1.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-800">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                          <span className="text-[11px] text-slate-500">{dateTimeLabel(entry.at) ?? "—"}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          by {entry.actor ?? "unknown"}
                          {changed.length > 0 && ` · ${changed.map((key) => `${key}: ${String(before?.[key] ?? "—")} → ${String(after?.[key] ?? "—")}`).join("; ")}`}
                          {entry.change?.reason ? ` · reason: ${entry.change.reason}` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * P&L Configuration > Seat billing.
 *
 * Revenue per day = seat rate x seats, per LOB line of each cost centre. Lines come from the cost
 * centre's last invoice unless finance configures them here; Live P&L uses the result for cost
 * centres that have no invoice yet for the month. See pnl-seat-billing.service.ts.
 */
export function SeatBillingPanel({ period, branchId }: { period: string; branchId?: string }) {
  const query = useSeatBilling(period, branchId);
  const canWrite = useHasRole(...WRITE_ROLES);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "configured" | "invoice" | "none">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const data = query.data;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.costCentres ?? []).filter((cc) =>
      (sourceFilter === "all" || cc.source === sourceFilter)
      && (!needle || `${cc.costCentreCode} ${cc.costCentreName} ${cc.branchName ?? ""} ${cc.lines.map((l) => l.lineLabel).join(" ")}`.toLowerCase().includes(needle)));
  }, [data, search, sourceFilter]);

  if (query.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>;
  if (query.isError || !data) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Could not load seat billing for {periodLabel(period)}. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }

  const cards = [
    { label: "Monthly seat billing", value: inr(data.totals.monthlyValue) },
    { label: "Revenue per day", value: inr(data.totals.perDay) },
    { label: `Month to date (${data.daysElapsed}/${data.daysInMonth} days)`, value: inr(data.totals.toDate) },
    { label: "Billed seats", value: seatsLabel(data.totals.seats) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Seat billing — {periodLabel(period)}</h2>
        <p className="text-xs text-slate-500">
          Revenue per day = seat rate × seats, per LOB line. Each cost centre uses the lines configured here, or else its last invoice.
          Live P&amp;L uses this for cost centres that have no invoice yet for the month, and replaces it once the month is invoiced.
        </p>
      </div>

      {!data.configurationAvailable && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Editing is not switched on yet — the seat billing table has not been created in the database. Figures below come from each cost centre&apos;s last invoice.</span>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-md border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-medium uppercase text-slate-500">{card.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <Badge className="bg-blue-600 hover:bg-blue-600">{data.totals.configured} configured</Badge>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{data.totals.fromInvoice} from last invoice</Badge>
        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{data.totals.withoutRate} with no rate</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Input className="h-8 w-56" placeholder="Search cost centre or LOB" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as typeof sourceFilter)}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="configured">Configured</SelectItem>
              <SelectItem value="invoice">From last invoice</SelectItem>
              <SelectItem value="none">No rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cost centre</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">LOB lines</TableHead>
              <TableHead className="text-right">Seats</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead className="text-right">Per day</TableHead>
              <TableHead className="text-right">To date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-6 text-center text-xs text-slate-400">No cost centres match.</TableCell></TableRow>
            )}
            {rows.map((cc) => (
              <TableRow key={cc.costCentreId} className="cursor-pointer hover:bg-blue-50/60" onClick={() => setOpenId(cc.costCentreId)}>
                <TableCell>
                  <p className="text-xs font-medium text-slate-800">{cc.costCentreCode}</p>
                  <p className="max-w-64 truncate text-[11px] text-slate-500">{cc.costCentreName}</p>
                </TableCell>
                <TableCell className="text-xs text-slate-600">{cc.branchName ?? "—"}</TableCell>
                <TableCell><SourceBadge cc={cc} /></TableCell>
                <TableCell className="text-right text-xs tabular-nums">{cc.lines.length}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{seatsLabel(cc.seats)}</TableCell>
                <TableCell className="text-right text-xs font-medium tabular-nums">{inr(cc.monthlyValue)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{inr(cc.perDay)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{inr(cc.toDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CostCentreDrawer costCentreId={openId} period={period} canWrite={canWrite} onClose={() => setOpenId(null)} />
    </div>
  );
}

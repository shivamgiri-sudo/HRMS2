// src/components/finance/client-billing/ProformaEntrySheet.tsx
/**
 * Legacy I-Spark "Initial Invoice/Proforma", two stages exactly like the old screens:
 *   Stage 1 "Proforma Invoice": Company, Branch, Cost Center, Finance Year, Month Year, Month,
 *     invoice Date, Invoice Description, Invoice Type, Apply Tax Calculation, Apply GST -> Go.
 *   Stage 2 "Proforma Entry": Branch / Cost Center / Financial Year / Month for / GST No. /
 *     Vendor GST No. strip, Bill To + Ship To, Details (Date, PO No., JCC No., GRN and Bill No.
 *     locked), the provision "Category / Total Revenue" strip, Add Particular, Add Deduction,
 *     totals, Submit.
 * Used for create and for Edit (opens on stage 2). The server recomputes every amount;
 * totals here are display only.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  createProforma, getBillingHeader, getProforma, updateProforma, INVOICE_TYPES,
  type BillingHeader, type CreateProformaPayload, type InvoiceType,
} from "@/lib/clientBillingApi";
import { BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions } from "./BillingScopeSelects";
import { BILLING_CATEGORY_OPTIONS, currentFinanceYear, financeYearOptions, monthLabelOptions, todayLocalISO } from "./billingFieldOptions";
import { ProvisionScopePanel } from "./ProvisionScopePanel";
import { money } from "./shared";

interface Line { particulars: string; qty: string; rate: string }
const blank = (): Line => ({ particulars: "", qty: "", rate: "" });
const amountOf = (l: Line) => Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100) / 100;
const valid = (l: Line) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "" && Number(l.rate) >= 0;

/** Display-only twin of the server rule: GSTIN state of the client vs our branch state, else the flag. */
function gstTypeOf(h: BillingHeader | undefined): "Integrated" | "Intrastate" {
  const client = (h?.vendor_gst_no ?? "").slice(0, 2) || (h?.vendor_state_code ?? "").padStart(2, "0");
  if (h?.state_code && /^\d{2}$/.test(client)) return client === h.state_code ? "Intrastate" : "Integrated";
  return h?.gst_type === "Intrastate" ? "Intrastate" : "Integrated";
}

function LineTable({ title, lines, onChange, tone }: { title: string; lines: Line[]; onChange: (l: Line[]) => void; tone: "charge" | "deduction" }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <section className="rounded-md border" aria-label={title}>
      <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-1.5">
        <h3 className={`text-sm font-medium ${tone === "deduction" ? "text-rose-700" : "text-rose-700"}`}>{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-600">
            <th className="w-12 px-2 py-1">SNo</th><th className="px-2 py-1">Particulars</th><th className="w-28 px-2 py-1">Qty</th>
            <th className="w-36 px-2 py-1">Rate</th><th className="w-36 px-2 py-1">Amount</th><th className="w-24 px-2 py-1">Action</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t">
              <td className="px-2 py-1 text-xs text-slate-500">{i + 1}</td>
              <td className="px-2 py-1"><Input aria-label={`${title} particulars ${i + 1}`} className="h-8 text-sm" placeholder="Particulars" value={l.particulars} onChange={(e) => set(i, { particulars: e.target.value })} /></td>
              <td className="px-2 py-1"><Input aria-label={`${title} qty ${i + 1}`} className="h-8 text-sm" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
              <td className="px-2 py-1"><Input aria-label={`${title} rate ${i + 1}`} className="h-8 text-sm" inputMode="decimal" placeholder="Rate" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
              <td className="px-2 py-1"><Input aria-label={`${title} amount ${i + 1}`} className="h-8 bg-slate-50 text-sm tabular-nums" readOnly value={amountOf(l) || 0} /></td>
              <td className="px-2 py-1">
                {i === lines.length - 1 ? (
                  <Button type="button" size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => onChange([...lines, blank()])} aria-label={`${title} add row`}>
                    <Plus className="mr-1 h-3.5 w-3.5" />ADD
                  </Button>
                ) : (
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`${title} remove row ${i + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ProformaEntrySheet({ open, onOpenChange, onSaved, editInvoiceId = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editInvoiceId?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(editInvoiceId);
  const [stage, setStage] = useState<1 | 2>(1);
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [costCentreId, setCostCentreId] = useState("");
  const [financeYear, setFinanceYear] = useState(currentFinanceYear());
  const [monthLabel, setMonthLabel] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("Revenue");
  const [category, setCategory] = useState("Others");
  const [applyTaxCalc, setApplyTaxCalc] = useState(true);
  const [applyGst, setApplyGst] = useState(true);
  const [poNo, setPoNo] = useState("");
  const [jccNo, setJccNo] = useState("");
  const [charges, setCharges] = useState<Line[]>([blank()]);
  const [deductions, setDeductions] = useState<Line[]>([blank()]);

  const options = useBillingFilterOptions().data?.data;
  const ccOptions = costCentreSearchOptions(narrowCostCentres(options?.costCentres ?? [], scope.companyName, scope.branchId));
  const detail = useQuery({ queryKey: ["client-billing", "proforma-edit", editInvoiceId], queryFn: () => getProforma(editInvoiceId as string), enabled: open && isEdit });
  const header = useQuery({ queryKey: ["client-billing", "billing-header", costCentreId], queryFn: () => getBillingHeader(costCentreId), enabled: Boolean(costCentreId) && stage === 2 });
  const h = header.data?.data;
  const editing = detail.data?.data;

  useEffect(() => {
    if (open) return;
    setStage(1); setScope({ companyName: "", branchId: "" }); setCostCentreId(""); setFinanceYear(currentFinanceYear());
    setMonthLabel(""); setInvoiceDate(todayLocalISO()); setDescription(""); setInvoiceType("Revenue"); setCategory("Others");
    setApplyTaxCalc(true); setApplyGst(true); setPoNo(""); setJccNo(""); setCharges([blank()]); setDeductions([blank()]);
  }, [open]);

  useEffect(() => {
    if (!editing) return;
    setStage(2);
    setCostCentreId(editing.cost_centre_id); setFinanceYear(editing.finance_year); setMonthLabel(editing.month_label);
    setInvoiceDate(String(editing.invoice_date).slice(0, 10)); setDescription(editing.description ?? "");
    setInvoiceType(editing.invoice_type === "Non Revenue" ? "Non Revenue" : "Revenue"); setCategory(editing.category);
    setApplyTaxCalc(Number(editing.apply_tax_calc ?? 1) === 1); setApplyGst(Boolean(editing.apply_gst));
    setPoNo(editing.po_numbers ?? ""); setJccNo(editing.jcc_no ?? "");
    const toLine = (l: { particulars: string; qty: string | number; rate: string | number }) => ({ particulars: l.particulars, qty: String(Number(l.qty)), rate: String(Number(l.rate)) });
    const c = editing.lines.filter((l) => l.line_type !== "deduction").map(toLine);
    const d = editing.lines.filter((l) => l.line_type === "deduction").map(toLine);
    setCharges(c.length ? c : [blank()]); setDeductions(d.length ? [...d, blank()] : [blank()]);
  }, [editing]);

  const validCharges = charges.filter(valid);
  const validDeductions = deductions.filter(valid);
  const total = useMemo(() => Math.round((validCharges.reduce((s, l) => s + amountOf(l), 0) - validDeductions.reduce((s, l) => s + amountOf(l), 0)) * 100) / 100, [validCharges, validDeductions]);
  const gstType = gstTypeOf(h);
  const taxOn = applyTaxCalc && applyGst;
  const igst = taxOn && gstType === "Integrated" ? Math.round(total * 18) / 100 : 0;
  const cgst = taxOn && gstType === "Intrastate" ? Math.round(total * 9) / 100 : 0;
  const grand = Math.round((total + igst + cgst * 2) * 100) / 100;
  const monthName = monthLabel ? monthLabel.slice(0, 3) : "";
  const stage1Ok = Boolean(costCentreId && financeYear && monthLabel && invoiceDate && invoiceType);

  const save = useMutation({
    mutationFn: async () => {
      const payload: CreateProformaPayload = {
        costCentreId, category, financeYear, monthLabel, invoiceDate, description: description.trim() || undefined,
        applyGst, applyTaxCalc, invoiceType,
        lines: [
          ...validCharges.map((l) => ({ particulars: l.particulars.trim(), qty: Number(l.qty), rate: Number(l.rate), lineType: "charge" as const })),
          ...validDeductions.map((l) => ({ particulars: l.particulars.trim(), qty: Number(l.qty), rate: Number(l.rate), lineType: "deduction" as const })),
        ],
        poNumbers: poNo.split(",").map((p) => p.trim()).filter(Boolean),
        jccNo: jccNo.trim() || undefined,
      };
      if (isEdit && editInvoiceId) {
        // The edit route takes PO/JCC inside `references` and replaces the whole block, so the
        // GRN / dates / RCM already on the invoice are sent back unchanged (never wiped).
        const { costCentreId: _cc, poNumbers, jccNo: jcc, ...rest } = payload; void _cc;
        const d = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
        return updateProforma(editInvoiceId, {
          ...rest,
          references: {
            poNumbers, jccNo: jcc ?? null, jccDate: d(editing?.jcc_date),
            grnNo: editing?.grn_no ?? null, grnDate: d(editing?.grn_date), rcmApplicable: Boolean(editing?.rcm_applicable),
          },
        });
      }
      return createProforma(payload);
    },
    onSuccess: (res) => {
      const no = (res.data as { proformaNo?: string }).proformaNo;
      toast({ title: isEdit ? "Proforma updated" : "Proforma created", description: no ?? undefined });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onSaved(); onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: isEdit ? "Could not update proforma" : "Could not create proforma", description: e.message, variant: "destructive" }),
  });

  const field = (label: string, control: React.ReactNode) => (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3"><Label className="text-right text-sm text-emerald-700">{label}</Label>{control}</div>
  );
  const addr = (a?: Array<string | null | undefined>) => (a ?? []).filter(Boolean).map((x, i) => <p key={i}>{x}</p>);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-none lg:w-[min(92vw,1400px)]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {stage === 1 ? "Proforma Invoice" : `Proforma Entry${editing?.proforma_no ? ` · ${editing.proforma_no}` : ""}`}
          </SheetTitle>
        </SheetHeader>

        {isEdit && detail.isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : stage === 1 ? (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid max-w-5xl grid-cols-1 gap-x-10 gap-y-3 lg:grid-cols-2">
              {!isEdit && <>
                <BillingScopeSelects labelled companyName={scope.companyName} branchId={scope.branchId} onChange={(s) => { setScope(s); setCostCentreId(""); }} />
              </>}
              <div className="lg:col-span-2">
                <Label className="text-xs">Cost Center *</Label>
                <SearchableSelect className="mt-1" options={ccOptions} value={costCentreId} onChange={setCostCentreId} disabled={isEdit}
                  placeholder="Cost Center" searchPlaceholder="Search code, client…" emptyText="No cost centre found." aria-label="Cost centre" />
              </div>
              <div>
                <Label className="text-xs">Finance Year *</Label>
                <Select value={financeYear} onValueChange={(v) => { setFinanceYear(v); setMonthLabel(""); }}>
                  <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Finance year"><SelectValue placeholder="Select Year" /></SelectTrigger>
                  <SelectContent>{financeYearOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Month Year *</Label>
                <Select value={monthLabel} onValueChange={setMonthLabel}>
                  <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Month year"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{monthLabelOptions(financeYear).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Month</Label>
                <Input className="mt-1 h-8 bg-slate-50 text-sm" readOnly aria-label="Month" value={monthName} placeholder="Month" />
              </div>
              <div>
                <Label className="text-xs" htmlFor="pf-date">invoice Date *</Label>
                <Input id="pf-date" type="date" className="mt-1 h-8 text-sm" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs" htmlFor="pf-desc">Invoice Description</Label>
                <Input id="pf-desc" className="mt-1 h-8 text-sm" placeholder="Invoice Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
              </div>
              <div>
                <Label className="text-xs">Invoice Type *</Label>
                <Select value={invoiceType} onValueChange={(v) => setInvoiceType(v as InvoiceType)}>
                  <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Invoice type"><SelectValue /></SelectTrigger>
                  <SelectContent>{INVOICE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Category *</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...(BILLING_CATEGORY_OPTIONS.includes(category as never) ? [] : [category]), ...BILLING_CATEGORY_OPTIONS].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 lg:col-span-2">
                <Checkbox id="pf-tax" checked={applyTaxCalc} onCheckedChange={(v) => setApplyTaxCalc(v === true)} />
                <Label htmlFor="pf-tax" className="text-sm">Apply Tax Calculation <span className="text-muted-foreground">(check for Yes — unticked means no tax at all)</span></Label>
              </div>
              <div className="flex items-center gap-2 lg:col-span-2">
                <Checkbox id="pf-gst" checked={applyGst} onCheckedChange={(v) => setApplyGst(v === true)} />
                <Label htmlFor="pf-gst" className="text-sm">Apply GST <span className="text-muted-foreground">(Check for GST)</span></Label>
              </div>
            </div>
            <div className="mt-6">
              <Button disabled={!stage1Ok} onClick={() => setStage(2)} className="bg-emerald-600 px-8 hover:bg-emerald-700">
                Go<ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-center text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr><th className="p-2">Branch</th><th className="p-2">Cost Center</th><th className="p-2">Financial Year</th><th className="p-2">Month for</th><th className="p-2">GST No.</th><th className="p-2">Vendor GST No.</th></tr>
                </thead>
                <tbody>
                  <tr className="font-medium">
                    <td className="bg-sky-100 p-2">{h?.branch_name ?? "—"}</td><td className="bg-rose-100 p-2">{h?.cost_centre_code ?? "—"}</td>
                    <td className="bg-sky-100 p-2">{financeYear}</td><td className="bg-rose-100 p-2">{monthName}</td>
                    <td className="bg-sky-100 p-2">{h?.service_tax_no ?? "—"}</td><td className="bg-rose-100 p-2">{h?.vendor_gst_no ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[{ t: "Bill To", a: [h?.bill_to_address1, h?.bill_to_address2, h?.bill_to_address3] }, { t: "Ship To", a: [h?.ship_to_address1 ?? h?.bill_to_address1, h?.ship_to_address2 ?? h?.bill_to_address2, h?.ship_to_address3 ?? h?.bill_to_address3] }].map((b) => (
                <section key={b.t} className="rounded-md border text-sm" aria-label={b.t}>
                  <h3 className="border-b bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">{b.t}</h3>
                  <p className="bg-sky-600 px-3 py-1 font-semibold text-white">{h?.client_name ?? "—"}</p>
                  <div className="space-y-0.5 px-3 py-2 font-medium text-slate-800">{addr(b.a)}</div>
                </section>
              ))}
            </div>

            <section className="rounded-md border p-3 text-sm" aria-label="Details">
              <p className="mb-2 text-base text-slate-700">Date {invoiceDate}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                {field("PO No.:", <Input aria-label="PO No." className="h-8" value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="PO numbers, comma separated" />)}
                {field("JCC No.:", <Input aria-label="JCC No." className="h-8" value={jccNo} onChange={(e) => setJccNo(e.target.value)} />)}
                {field("GRN", <Input aria-label="GRN" className="h-8 bg-slate-100" disabled value={editing?.grn_no ?? ""} title="Added after billing (Download Initial Invoice → ADD GRN)" />)}
                {field("Bill No.:", <Input aria-label="Bill No." className="h-8 bg-slate-100" disabled value={editing?.bill_no ?? ""} title="Generated at Invoice Approval" />)}
              </div>
            </section>

            <ProvisionScopePanel costCentreId={costCentreId} financeYear={financeYear} monthLabel={monthLabel} taxableTotal={total}
              alreadyDrawn={editing && editing.month_label === monthLabel && editing.finance_year === financeYear ? Number(editing.total_amount) : 0} />

            <LineTable title="Add Particular" lines={charges} onChange={setCharges} tone="charge" />
            <LineTable title="Add Deduction" lines={deductions} onChange={setDeductions} tone="deduction" />

            <section className="rounded-md border text-sm" aria-label="Totals">
              {[
                ["Total:", total],
                ...(taxOn && gstType === "Integrated" ? [["IGST @ 18%", igst]] : []),
                ...(taxOn && gstType === "Intrastate" ? [["CGST @ 9%", cgst], ["SGST @ 9%", cgst]] : []),
                ["Grand Total:", grand],
              ].map(([k, v]) => (
                <div key={String(k)} className="grid grid-cols-2 border-b last:border-b-0">
                  <span className="px-3 py-1.5 font-medium">{k}</span>
                  <span className="px-3 py-1.5 tabular-nums">{money(Number(v))}</span>
                </div>
              ))}
              {!taxOn && <p className="px-3 py-1.5 text-xs text-amber-700">No tax: Apply Tax Calculation or Apply GST is unticked.</p>}
            </section>

            <div className="flex justify-end gap-2 pb-2">
              <Button variant="outline" onClick={() => setStage(1)}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
              <Button disabled={validCharges.length === 0 || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                {isEdit ? "Save changes" : "Submit"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

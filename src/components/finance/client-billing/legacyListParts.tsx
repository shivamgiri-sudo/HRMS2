// src/components/finance/client-billing/legacyListParts.tsx
/**
 * Building blocks shared by the I-Spark list screens (LegacyBillingLists.tsx,
 * InvoiceApprovalList.tsx, RejectedInvoiceList.tsx): the search bar (legacy Company / Branch /
 * Finance year / number, plus date range, cost centre and invoice type), the pager, the blue
 * legacy table with a load-error + Retry state and a page-totals footer, and the list query.
 * Every filter maps 1:1 onto GET /proformas (and its CSV export), so an export matches the screen.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INVOICE_TYPES, listProformas, type ClientBillingListFilters, type InvoiceRow } from "@/lib/clientBillingApi";
import { BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions } from "./BillingScopeSelects";
import { currentFinanceYear, financeYearOptions } from "./billingFieldOptions";

export const PAGE = 25;
export const link = "cursor-pointer text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-sm disabled:opacity-50";
export const num = (v: unknown) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const ALL = "_all";

export interface Filters {
  companyName: string;
  branchId: string;
  financeYear: string;
  number: string;
  fromDate: string;
  toDate: string;
  costCentreId: string;
  invoiceType: string;
}

export const initialFilters = (financeYear: string = currentFinanceYear()): Filters => ({
  companyName: "", branchId: "", financeYear, number: "", fromDate: "", toDate: "", costCentreId: "", invoiceType: "",
});

/** Screen filters -> API filters (no page / limit), shared by the list query and CSV export. */
export function toListFilters(f: Filters): ClientBillingListFilters {
  return {
    companyName: f.companyName || undefined, branchId: f.branchId || undefined, financeYear: f.financeYear || undefined,
    search: f.number.trim() || undefined, fromDate: f.fromDate || undefined, toDate: f.toDate || undefined,
    costCentreId: f.costCentreId || undefined, invoiceType: f.invoiceType || undefined,
  };
}

/** Called by a list's Export CSV button with the exact filters on screen. */
export type ExportCsvHandler = (filters: ClientBillingListFilters, filename: string) => Promise<void> | void;

export function SearchBar({ value, defaults, onSearch, numberLabel, right, showInvoiceType = false, onExport }: {
  value: Filters;
  /** What "Clear" resets to (the list's opening filters). */
  defaults: Filters;
  onSearch: (f: Filters) => void;
  numberLabel: string;
  right?: ReactNode;
  showInvoiceType?: boolean;
  onExport?: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [exporting, setExporting] = useState(false);
  const costCentres = useBillingFilterOptions().data?.data.costCentres ?? [];
  const ccOptions = [{ value: "", label: "All cost centres" }, ...costCentreSearchOptions(narrowCostCentres(costCentres, draft.companyName, draft.branchId))];
  const id = numberLabel.replace(/\W+/g, "-");
  const dirty = JSON.stringify(draft) !== JSON.stringify(defaults);
  return (
    <div className="mb-3 rounded-md border bg-white p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BillingScopeSelects labelled companyName={draft.companyName} branchId={draft.branchId} onChange={(s) => setDraft({ ...draft, ...s, costCentreId: "" })} />
        <div>
          <Label className="text-xs">Select Finance year</Label>
          <Select value={draft.financeYear || ALL} onValueChange={(v) => setDraft({ ...draft, financeYear: v === ALL ? "" : v })}>
            <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Select Finance year"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {financeYearOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor={`num-${id}`}>{numberLabel}</Label>
          <Input id={`num-${id}`} className="mt-1 h-8 text-sm" placeholder={numberLabel} value={draft.number}
            onChange={(e) => setDraft({ ...draft, number: e.target.value })} onKeyDown={(e) => e.key === "Enter" && onSearch(draft)} />
        </div>
        <div>
          <Label className="text-xs" htmlFor={`from-${id}`}>Bill date from</Label>
          <Input id={`from-${id}`} type="date" className="mt-1 h-8 text-sm" value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs" htmlFor={`to-${id}`}>Bill date to</Label>
          <Input id={`to-${id}`} type="date" className="mt-1 h-8 text-sm" value={draft.toDate} onChange={(e) => setDraft({ ...draft, toDate: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Cost centre</Label>
          <SearchableSelect className="mt-1" options={ccOptions} value={draft.costCentreId} onChange={(v) => setDraft({ ...draft, costCentreId: v })}
            placeholder="All cost centres" searchPlaceholder="Search cost centre…" emptyText="No cost centre found." aria-label="Cost centre" />
        </div>
        {showInvoiceType && (
          <div>
            <Label className="text-xs">Invoice type</Label>
            <Select value={draft.invoiceType || ALL} onValueChange={(v) => setDraft({ ...draft, invoiceType: v === ALL ? "" : v })}>
              <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Invoice type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {INVOICE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" className="cursor-pointer bg-sky-600 px-5 hover:bg-sky-700" onClick={() => onSearch(draft)}>search</Button>
          {dirty && (
            <Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => { setDraft(defaults); onSearch(defaults); }}>
              <X className="mr-1 h-3.5 w-3.5" />Clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onExport && (
            <Button size="sm" variant="outline" className="cursor-pointer" disabled={exporting}
              onClick={async () => { setExporting(true); try { await onExport(); } finally { setExporting(false); } }}>
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}Export CSV
            </Button>
          )}
          {right}
        </div>
      </div>
    </div>
  );
}

export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
      <span className="text-slate-500">{total} record(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="cursor-pointer" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
        <span className="font-semibold">{page} / {pages}</span>
        <Button variant="outline" size="sm" className="cursor-pointer" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Table({ head, children, empty, loading, error, onRetry, foot }: {
  head: ReactNode[];
  children: ReactNode;
  empty: boolean;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  foot?: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-sky-600 text-left text-white">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-2 font-semibold !text-white">{h}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={head.length} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
          ) : error ? (
            <tr><td colSpan={head.length} className="py-8 text-center">
              <p role="alert" className="text-sm text-rose-700">Could not load the list: {error instanceof Error ? error.message : "unknown error"}</p>
              {onRetry && <Button size="sm" variant="outline" className="mt-2 cursor-pointer" onClick={onRetry}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>}
            </td></tr>
          ) : empty ? (
            <tr><td colSpan={head.length} className="py-8 text-center text-muted-foreground">No records found</td></tr>
          ) : children}
        </tbody>
        {!loading && !error && !empty && foot && <tfoot className="sticky bottom-0 border-t-2 bg-slate-100 font-semibold">{foot}</tfoot>}
      </table>
    </div>
  );
}

export function useList(key: string, f: Filters, page: number, extra: ClientBillingListFilters) {
  return useQuery({
    queryKey: ["client-billing", key, f, page],
    queryFn: () => listProformas({ ...extra, ...toListFilters(f), page, limit: PAGE }),
  });
}

/** Paise-exact sum of a money column over the rows on screen. */
export function pageSum(rows: InvoiceRow[], key: "total_amount" | "grand_total"): number {
  return rows.reduce((s, r) => s + Math.round(Number(r[key] ?? 0) * 100), 0) / 100;
}

export function PageTotalCell({ label = "Page total", colSpan }: { label?: string; colSpan: number }) {
  return <td colSpan={colSpan} className="px-2 py-1.5 text-right text-xs uppercase tracking-wide text-slate-600">{label}</td>;
}

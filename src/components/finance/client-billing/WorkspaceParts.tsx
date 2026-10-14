// src/components/finance/client-billing/WorkspaceParts.tsx
/**
 * Small pieces of the Client Billing workspace page (moved out of
 * ClientBillingWorkspacePage.tsx to keep it under ~500 lines): the filter-bar state, the
 * toolbar + pagination footer used by the Credit Notes tab, the KPI tile, the historical tag
 * and the split PDF download button.
 */
import {
  ArrowLeft, ArrowRight, Download, Loader2, Search, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { BillingScopeSelects } from "./BillingScopeSelects";

export const PAGE_SIZE = 25;

export interface ListFilterState {
  status: string;
  fromDate: string;
  toDate: string;
  costCentreId: string;
  companyName: string;
  branchId: string;
  search: string;
  page: number;
}

export const EMPTY_FILTERS = (status: string): ListFilterState => ({
  status, fromDate: "", toDate: "", costCentreId: "", companyName: "", branchId: "", search: "", page: 1,
});

/**
 * Shown in the actions cell in place of Approve/Reject on a row the live workflow can
 * never act on.
 *
 * Every one of the 10,794 invoices and 144 credit notes currently in this module came from
 * the 2026-08-19 legacy cutover and carries `is_migrated = 1`. Both approval services
 * refuse those rows outright (design §3 — a migrated historical record is read-only through
 * the live workflow), but this page rendered Approve/Reject on them regardless, so the two
 * pending proformas and 23 draft credit notes presented as actionable work that no click
 * could ever clear. Confirmed live 2026-08-27: clicking Approve returned
 * "...is a migrated historical record (is_migrated=1) and cannot be approved through the
 * live workflow" — a developer-facing string, aimed at a finance user, naming an internal
 * column and a raw UUID.
 *
 * The row stays fully visible and readable (Preview / Download PDF / detail are unchanged);
 * only the two buttons that cannot succeed are replaced by an explanation of why.
 */
export function HistoricalRecordTag() {
  return (
    <span
      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
      title="Migrated from the legacy billing system — historical record, read-only. It cannot be approved or rejected here."
    >
      Historical
    </span>
  );
}

/** Compact stat tile — same visual language as BranchBudgetManagementWorkspace.tsx's
 *  `Metric` (border/tint per tone, uppercase label, bold value), kept file-local to match
 *  that page's own convention of not sharing this across pages. */
export function Metric({ label, value, sub, tone = "slate" }: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    amber: "border-amber-200 bg-amber-50/80",
    rose: "border-rose-200 bg-rose-50/80",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

/** Reusable filter bar: search, date range, cost-centre picker, optional status select, and
 *  a CSV export button — shared by all three tabs so filter behavior never drifts between
 *  them. Directly bound onChange (no debounce), matching VendorPaymentDispatchPage.tsx's own
 *  filter inputs — the dataset here is small enough that per-keystroke queries are fine. */
export function ListToolbar({
  filters, onChange, statusOptions, costCentreOptions, searchPlaceholder, onExport, isExporting,
}: {
  filters: ListFilterState;
  onChange: (next: ListFilterState) => void;
  statusOptions?: ReadonlyArray<{ value: string; label: string }>;
  costCentreOptions: (filters: ListFilterState) => SearchableOption[];
  searchPlaceholder: string;
  onExport: () => void;
  isExporting: boolean;
}) {
  const set = (patch: Partial<ListFilterState>) => onChange({ ...filters, ...patch, page: 1 });
  const hasActiveFilters = Boolean(
    filters.fromDate || filters.toDate || filters.costCentreId || filters.search || filters.companyName || filters.branchId,
  );
  return (
    /*
     * Two explicit groups — filters, then actions — rather than one wrapping row with
     * `ml-auto` on the export button. With a single flex-wrap row, `ml-auto` resolves
     * against whichever line the button lands on, so below ~1280px the search box wrapped
     * to line two on the left and Export/New Proforma sat at the far right of that same
     * line with a wide gap between them. Observed live at 1024px. Grouping keeps the
     * filters together and the actions together at every width.
     */
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Legacy screens open with Company + Branch; picking one narrows the cost centres. */}
        <BillingScopeSelects
          compact
          companyName={filters.companyName}
          branchId={filters.branchId}
          onChange={(next) => set({ ...next, costCentreId: "" })}
        />
        {statusOptions && (
          <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className="h-8 w-48 text-xs" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Both date boxes rendered an identical bare "dd-mm-yyyy", with the from/to
            distinction only in a `title` tooltip — invisible on keyboard focus and on touch.
            They are one control conceptually, so they live in one non-shrinking group with an
            inline "–" between them: the pair can never be split across two wrapped lines, and
            the captions sit beside the inputs rather than above, which keeps the whole filter
            bar one row tall. (A first attempt stacked a caption over each input separately —
            that doubled the row height and at 1024px pushed To onto its own line below From,
            which read worse than the unlabelled version it replaced.) */}
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border bg-slate-50/60 px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">From</span>
          <Input
            type="date"
            className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
            value={filters.fromDate}
            onChange={(e) => set({ fromDate: e.target.value })}
            aria-label="From date"
          />
          <span className="text-slate-400">–</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">To</span>
          <Input
            type="date"
            className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
            value={filters.toDate}
            onChange={(e) => set({ toDate: e.target.value })}
            aria-label="To date"
          />
        </div>
        <div className="w-48">
          <SearchableSelect
            options={costCentreOptions(filters)}
            value={filters.costCentreId}
            onChange={(v) => set({ costCentreId: v })}
            placeholder="All cost centres"
            searchPlaceholder="Search cost centre…"
            emptyText="No cost centre found."
            aria-label="Cost centre"
          />
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input
            className="h-8 w-44 pl-7 text-xs"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost" size="sm" className="h-8 text-xs"
            onClick={() => onChange(EMPTY_FILTERS(filters.status))}
          >
            <X className="mr-1 h-3 w-3" />Clear
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Export CSV
        </Button>
      </div>
    </div>
  );
}

export function PaginationFooter({ page, total, onPageChange }: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
      <span className="text-slate-500">
        Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
        –{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />Prev
        </Button>
        <span className="font-semibold">{page} / {totalPages}</span>
        <Button
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next<ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Split download button: with-letterhead (branded, for emailing to the client) or without
 *  (for printing onto pre-printed letterhead stationery) — same invoice content either way,
 *  see clientBillingApi.ts's downloadInvoicePdf. Hoisted out of the page component so it
 *  isn't redefined (and remounted) on every render. */
export function DownloadPdfButton({
  kind, id, docNumber, downloadingId, onDownload,
}: {
  kind: "proforma" | "invoice" | "credit-note";
  id: string;
  docNumber: string;
  downloadingId: string | null;
  onDownload: (kind: "proforma" | "invoice" | "credit-note", id: string, docNumber: string, letterhead: boolean) => unknown;
}) {
  const isDownloading = downloadingId === id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Download PDF" aria-label="Download PDF" disabled={isDownloading}>
          {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => { void onDownload(kind, id, docNumber, true); }}>
          With letterhead
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void onDownload(kind, id, docNumber, false); }}>
          Without letterhead (for printed stationery)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

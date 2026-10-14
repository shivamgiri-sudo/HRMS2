// src/components/finance/client-billing/LegacyBillingLists.tsx
/**
 * The three I-Spark list screens, same filters and columns as the old pages:
 *   View Proforma Invoice   — Select Company, Select Branch, Select Finance year, Proforma No., search.
 *                             Sr. No. | Branch Name | Proforma No. | Amount | PO No. | Description |
 *                             Action (Edit / Approve / Reject) | Download (PDF / Letter Head)
 *   Invoice Approval        — Select Branch. Sr. No. | Branch Name | Amount | Description | Action (view / Edit)
 *   Download Initial Invoice— Select Company, Select Branch, Select Finance year, Bill No., search.
 *                             Sr. No. | Branch Name | Invoice No. | Amount | PO No. | Description |
 *                             Action (PDF / Letter Head / Export) | Files
 * "Amount" is the taxable total (legacy shows 778901, not the grand total).
 * PDF = with the MAS letterhead; Letter Head = plain, for printing on pre-printed letterhead.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listProformas, type InvoiceRow } from "@/lib/clientBillingApi";
import { BillingScopeSelects, useBillingFilterOptions } from "./BillingScopeSelects";
import { currentFinanceYear, financeYearOptions } from "./billingFieldOptions";

const PAGE = 25;
const link = "cursor-pointer text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-sm disabled:opacity-50";
const num = (v: unknown) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

interface Filters { companyName: string; branchId: string; financeYear: string; number: string }

function SearchBar({ value, onSearch, numberLabel, right }: { value: Filters; onSearch: (f: Filters) => void; numberLabel: string; right?: ReactNode }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="mb-3 rounded-md border bg-white p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BillingScopeSelects labelled companyName={draft.companyName} branchId={draft.branchId} onChange={(s) => setDraft({ ...draft, ...s })} />
        <div>
          <Label className="text-xs">Select Finance year</Label>
          <Select value={draft.financeYear} onValueChange={(v) => setDraft({ ...draft, financeYear: v })}>
            <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Select Finance year"><SelectValue /></SelectTrigger>
            <SelectContent>{financeYearOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor={`num-${numberLabel}`}>{numberLabel}</Label>
          <Input id={`num-${numberLabel}`} className="mt-1 h-8 text-sm" placeholder={numberLabel} value={draft.number}
            onChange={(e) => setDraft({ ...draft, number: e.target.value })} onKeyDown={(e) => e.key === "Enter" && onSearch(draft)} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button size="sm" className="bg-sky-600 px-5 hover:bg-sky-700" onClick={() => onSearch(draft)}>search</Button>
        {right}
      </div>
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
      <span className="text-slate-500">{total} record(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
        <span className="font-semibold">{page} / {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function Table({ head, children, empty, loading }: { head: string[]; children: ReactNode; empty: boolean; loading: boolean }) {
  return (
    <div className="flex-1 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-sky-600 text-left text-white">
          <tr>{head.map((h, i) => <th key={`${h}-${i}`} className="whitespace-nowrap px-2 py-2 font-semibold !text-white">{h}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={head.length} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
          ) : empty ? (
            <tr><td colSpan={head.length} className="py-8 text-center text-muted-foreground">No records found</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

function useList(key: string, f: Filters, page: number, extra: Parameters<typeof listProformas>[0]) {
  return useQuery({
    queryKey: ["client-billing", key, f, page],
    queryFn: () => listProformas({
      ...extra, companyName: f.companyName || undefined, branchId: f.branchId || undefined,
      financeYear: f.financeYear || undefined, search: f.number.trim() || undefined, page, limit: PAGE,
    }),
  });
}

const initial = (): Filters => ({ companyName: "", branchId: "", financeYear: currentFinanceYear(), number: "" });

export function ProformaApprovalList({ onCreate, onEdit, onApprove, onReject, onDownload }: {
  onCreate: () => void;
  onEdit: (row: InvoiceRow) => void;
  onApprove: (row: InvoiceRow) => void;
  onReject: (row: InvoiceRow) => void;
  onDownload: (row: InvoiceRow, letterhead: boolean) => void;
}) {
  const [f, setF] = useState(initial());
  const [page, setPage] = useState(1);
  const q = useList("legacy-proformas", f, page, { status: "proforma", stage: "proforma_approval" });
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SearchBar value={f} numberLabel="Proforma No." onSearch={(n) => { setF(n); setPage(1); }}
        right={<Button size="sm" onClick={onCreate}>Initial Invoice/Proforma</Button>} />
      <Table loading={q.isLoading} empty={rows.length === 0}
        head={["Sr. No.", "Branch Name", "Proforma No.", "Amount", "PO No.", "Description", "Action", "", "", "Download", ""]}>
        {rows.map((r, i) => (
          <tr key={r.id} data-approval-id={r.id} className="border-b odd:bg-slate-50">
            <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
            <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
            <td className="px-2 py-1.5">{r.proforma_no}</td>
            <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
            <td className="px-2 py-1.5">{r.po_numbers ?? ""}</td>
            <td className="max-w-[360px] px-2 py-1.5">{r.description ?? ""}</td>
            {r.is_migrated ? <td colSpan={3} className="px-2 py-1.5 text-xs text-slate-500">Historical</td> : <>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onEdit(r)}>Edit</button></td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onApprove(r)}>Approve</button></td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onReject(r)}>Reject</button></td>
            </>}
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onDownload(r, true)}>PDF</button></td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onDownload(r, false)}>Letter Head</button></td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

export function InvoiceApprovalList({ onView, onEdit, banner }: { onView: (row: InvoiceRow) => void; onEdit: (row: InvoiceRow) => void; banner?: string | null }) {
  const [branchId, setBranchId] = useState("");
  const [page, setPage] = useState(1);
  const branches = useBillingFilterOptions().data?.data.branches ?? [];
  const q = useList("legacy-invoice-approval", { ...initial(), financeYear: "", branchId }, page, { status: "proforma", stage: "invoice_approval" });
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {banner && <p role="status" className="mb-2 text-center text-sm font-semibold text-red-600">{banner}</p>}
      <div className="mb-3 w-72">
        <Label className="text-xs font-semibold">Select Branch</Label>
        <Select value={branchId || "_all"} onValueChange={(v) => { setBranchId(v === "_all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Select Branch"><SelectValue placeholder="Select Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Table loading={q.isLoading} empty={rows.length === 0} head={["Sr. No.", "Branch Name", "Amount", "Description", "Action", ""]}>
        {rows.map((r, i) => (
          <tr key={r.id} data-approval-id={r.id} className="border-b odd:bg-slate-50">
            <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
            <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
            <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
            <td className="px-2 py-1.5">{r.description ?? ""} <span className="text-xs text-slate-500">({r.proforma_no})</span></td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onView(r)} aria-label={`view ${r.proforma_no}`}>view</button></td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onEdit(r)} aria-label={`Edit ${r.proforma_no}`}>Edit</button></td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

export interface DownloadActions {
  onDownload: (row: InvoiceRow, letterhead: boolean) => void;
  onExport: (row: InvoiceRow) => void;
  onView: (row: InvoiceRow) => void;
  onAddGrn: (row: InvoiceRow) => void;
  onApprovePo: (row: InvoiceRow) => void;
  onSubmit: (row: InvoiceRow) => void;
  onDeleteRequest: (row: InvoiceRow) => void;
  onAudit: (row: InvoiceRow) => void;
}

export function DownloadInvoiceList(a: DownloadActions) {
  const [f, setF] = useState(initial());
  const [page, setPage] = useState(1);
  const q = useList("legacy-download", f, page, { status: "approved" });
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SearchBar value={f} numberLabel="Bill No." onSearch={(n) => { setF(n); setPage(1); }} />
      <Table loading={q.isLoading} empty={rows.length === 0}
        head={["Sr. No.", "Branch Name", "Invoice No.", "Amount", "PO No.", "Description", "Action", "", "", "Files", ""]}>
        {rows.map((r, i) => (
          <tr key={r.id} className="border-b odd:bg-slate-50">
            <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
            <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onView(r)}>{r.bill_no}</button></td>
            <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
            <td className="px-2 py-1.5">{r.po_numbers ?? ""}{r.po_numbers && r.po_approved ? <span className="ml-1 text-xs text-emerald-700">(approved)</span> : null}</td>
            <td className="max-w-[360px] px-2 py-1.5">{r.description ?? ""}</td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onDownload(r, true)}>PDF</button></td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onDownload(r, false)}>Letter Head</button></td>
            <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onExport(r)}>Export</button></td>
            <td className="px-2 py-1.5 text-xs text-slate-400">—</td>
            <td className="px-2 py-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`More actions for ${r.bill_no}`}><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => a.onAddGrn(r)}>ADD GRN</DropdownMenuItem>
                  {r.po_numbers && !r.po_approved && <DropdownMenuItem onSelect={() => a.onApprovePo(r)}>Approve PO</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => a.onSubmit(r)}>Submit to Client</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => a.onAudit(r)}>Audit log</DropdownMenuItem>
                  {!r.is_migrated && <DropdownMenuItem className="text-rose-700" onSelect={() => a.onDeleteRequest(r)}>Invoice Delete / Status Change Request</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

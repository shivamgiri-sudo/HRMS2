// src/components/finance/client-billing/LegacyBillingLists.tsx
/**
 * The I-Spark list screens, same filters and columns as the old pages, plus a date range,
 * cost-centre and type filter, CSV export, a page-totals row and a load-error Retry:
 *   View Proforma Invoice   — Select Company, Select Branch, Select Finance year, Proforma No., search.
 *                             Sr. No. | Branch Name | Proforma No. | Amount | PO No. | Description |
 *                             Action (Edit / Approve / Reject) | Download (PDF / Letter Head)
 *   Invoice Approval        — InvoiceApprovalList.tsx (re-exported below).
 *   Download Initial Invoice— Select Company, Select Branch, Select Finance year, Bill No., search.
 *                             Sr. No. | Branch Name | Invoice No. | Client | Bill date | Amount |
 *                             Grand total | Received | Outstanding | Sent | PO No. | Description |
 *                             Action (PDF / Letter Head / Export) | Files
 * "Amount" is the taxable total (legacy shows 778901, not the grand total).
 * PDF = with the MAS letterhead; Letter Head = plain, for printing on pre-printed letterhead.
 * Proforma / bill numbers open the detail drawer (history, e-mails, change requests, audit).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { listOutstandingBills, type InvoiceRow, type OutstandingBill } from "@/lib/clientBillingApi";
import {
  PAGE, PageTotalCell, Pager, SearchBar, Table, initialFilters, link, num, pageSum, toListFilters, useList,
  type ExportCsvHandler,
} from "./legacyListParts";
import { formatDateOnly, formatDateTime, whoBy } from "./shared";

export { InvoiceApprovalList } from "./InvoiceApprovalList";

export function ProformaApprovalList({ onCreate, onEdit, onApprove, onReject, onDownload, onOpen, onExportCsv }: {
  onCreate: () => void;
  onEdit: (row: InvoiceRow) => void;
  onApprove: (row: InvoiceRow) => void;
  onReject: (row: InvoiceRow) => void;
  onDownload: (row: InvoiceRow, letterhead: boolean) => void;
  /** Proforma number click: detail drawer. */
  onOpen?: (row: InvoiceRow) => void;
  onExportCsv?: ExportCsvHandler;
}) {
  const [f, setF] = useState(initialFilters());
  const [page, setPage] = useState(1);
  const extra = { status: "proforma", stage: "proforma_approval" } as const;
  const q = useList("legacy-proformas", f, page, extra);
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SearchBar value={f} defaults={initialFilters()} numberLabel="Proforma No." onSearch={(n) => { setF(n); setPage(1); }}
        onExport={onExportCsv ? () => onExportCsv({ ...toListFilters(f), ...extra }, "proformas-awaiting-approval.csv") : undefined}
        right={<Button size="sm" className="cursor-pointer" onClick={onCreate}>Initial Invoice/Proforma</Button>} />
      <Table loading={q.isLoading} empty={rows.length === 0} error={q.error} onRetry={() => void q.refetch()}
        head={["Sr. No.", "Branch Name", "Proforma No.", "Amount", "PO No.", "Description", "Action", "", "", "Download", ""]}
        foot={<tr><PageTotalCell colSpan={3} /><td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "total_amount"))}</td><td colSpan={7} /></tr>}>
        {rows.map((r, i) => (
          <tr key={r.id} data-approval-id={r.id} className="border-b odd:bg-slate-50">
            <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
            <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
            <td className="px-2 py-1.5">
              {onOpen ? <button type="button" className={link} onClick={() => onOpen(r)} aria-label={`Details of ${r.proforma_no}`}>{r.proforma_no}</button> : r.proforma_no}
            </td>
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

export interface DownloadActions {
  onDownload: (row: InvoiceRow, letterhead: boolean) => void;
  onExport: (row: InvoiceRow) => void;
  onView: (row: InvoiceRow) => void;
  onAddGrn: (row: InvoiceRow) => void;
  onApprovePo: (row: InvoiceRow) => void;
  onSubmit: (row: InvoiceRow) => void;
  onDeleteRequest: (row: InvoiceRow) => void;
  onAudit: (row: InvoiceRow) => void;
  /** Bill number click: detail drawer. */
  onOpen?: (row: InvoiceRow) => void;
  onCreditNote?: (row: InvoiceRow) => void;
  onExportCsv?: ExportCsvHandler;
}

/**
 * Received / outstanding per bill from the receipts register (GET /receipts/outstanding, the
 * same rows the Receipts tab shows). That route only returns bills that still owe money, for
 * MAS Callnet cost centres and live (non-migrated) bills, so a bill missing from it is shown as
 * "—" with an explanation rather than guessed as paid.
 */
function useOutstandingMap(companyName: string, branchId: string) {
  const q = useQuery({
    queryKey: ["client-billing", "outstanding", { companyName, branchId }, ""],
    queryFn: () => listOutstandingBills({ companyName: companyName || undefined, branchId: branchId || undefined }),
    staleTime: 60_000,
  });
  return useMemo(() => new Map<string, OutstandingBill>((q.data?.data ?? []).map((b) => [b.id, b])), [q.data]);
}

const NOT_OUTSTANDING = "Not in the outstanding register: fully received, a historical bill, or another company's bill.";

export function DownloadInvoiceList(a: DownloadActions) {
  const [f, setF] = useState(initialFilters());
  const [page, setPage] = useState(1);
  const q = useList("legacy-download", f, page, { status: "approved" });
  const rows = q.data?.data ?? [];
  const outstanding = useOutstandingMap(f.companyName, f.branchId);
  // "Approved by / at" is not a client_invoice column on origin/main; the column appears only
  // once the API returns it (the detail drawer's history reads it from the audit log meanwhile).
  const showApproved = rows.some((r) => r.approved_at !== undefined);
  const head = ["Sr. No.", "Branch Name", "Invoice No.", "Client", "Bill date", "Amount", "Grand total", "Received", "Outstanding", "Sent to client",
    ...(showApproved ? ["Approved"] : []), "PO No.", "Description", "Action", "", "", "Files", ""];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SearchBar value={f} defaults={initialFilters()} numberLabel="Bill No." showInvoiceType onSearch={(n) => { setF(n); setPage(1); }}
        onExport={a.onExportCsv ? () => a.onExportCsv!({ ...toListFilters(f), status: "approved" }, "invoices-export.csv") : undefined} />
      <Table loading={q.isLoading} empty={rows.length === 0} error={q.error} onRetry={() => void q.refetch()} head={head}
        foot={<tr><PageTotalCell colSpan={5} /><td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "total_amount"))}</td>
          <td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "grand_total"))}</td><td colSpan={head.length - 7} /></tr>}>
        {rows.map((r, i) => {
          const o = outstanding.get(r.id);
          return (
            <tr key={r.id} className="border-b odd:bg-slate-50">
              <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
              <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <button type="button" className={link} onClick={() => (a.onOpen ?? a.onView)(r)} aria-label={`Details of ${r.bill_no}`}>{r.bill_no}</button>
              </td>
              <td className="max-w-[200px] px-2 py-1.5">{r.cost_centre_display_name ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{formatDateOnly(r.invoice_date)}</td>
              <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
              <td className="px-2 py-1.5 tabular-nums">{num(r.grand_total)}</td>
              <td className="px-2 py-1.5 tabular-nums" title={o ? undefined : NOT_OUTSTANDING}>{o ? num(o.settled) : "—"}</td>
              <td className={`px-2 py-1.5 tabular-nums ${o && o.days_past_due > 0 ? "font-semibold text-rose-700" : ""}`} title={o ? `${o.days_past_due > 0 ? `${o.days_past_due} days past due` : "Not yet due"}` : NOT_OUTSTANDING}>
                {o ? num(o.outstanding) : "—"}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-xs">{r.last_sent_at ? formatDateTime(r.last_sent_at) : <span className="text-slate-400">Not sent</span>}</td>
              {showApproved && <td className="whitespace-nowrap px-2 py-1.5 text-xs">{r.approved_at ? `${formatDateTime(r.approved_at)} · ${whoBy(r.approved_by_name, r.approved_by)}` : "—"}</td>}
              <td className="px-2 py-1.5">{r.po_numbers ?? ""}{r.po_numbers && r.po_approved ? <span className="ml-1 text-xs text-emerald-700">(approved)</span> : null}</td>
              <td className="max-w-[360px] px-2 py-1.5">{r.description ?? ""}</td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onDownload(r, true)}>PDF</button></td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onDownload(r, false)}>Letter Head</button></td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => a.onExport(r)}>Export</button></td>
              <td className="px-2 py-1.5 text-xs text-slate-400">—</td>
              <td className="px-2 py-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" aria-label={`More actions for ${r.bill_no}`}><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => a.onView(r)}>View invoice</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => a.onAddGrn(r)}>ADD GRN</DropdownMenuItem>
                    {r.po_numbers && !r.po_approved && <DropdownMenuItem onSelect={() => a.onApprovePo(r)}>Approve PO</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => a.onSubmit(r)}>Submit to Client</DropdownMenuItem>
                    {a.onCreditNote && <DropdownMenuItem onSelect={() => a.onCreditNote!(r)}>Raise credit note</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => a.onAudit(r)}>Audit log</DropdownMenuItem>
                    {!r.is_migrated && <DropdownMenuItem className="text-rose-700" onSelect={() => a.onDeleteRequest(r)}>Invoice Delete / Status Change Request</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          );
        })}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

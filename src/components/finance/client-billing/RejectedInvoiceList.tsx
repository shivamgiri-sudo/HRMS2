// src/components/finance/client-billing/RejectedInvoiceList.tsx
/**
 * "Rejected / Void": every client_invoice row with invoice_status = 'rejected' — proformas
 * rejected at either approval step and billed invoices cancelled by an approved void request
 * (those keep their bill number). Shows the reason and who / when; the number opens the detail
 * drawer, and "Clone as new proforma" starts a fresh proforma prefilled from the record's lines.
 */
import { useState } from "react";
import type { InvoiceRow } from "@/lib/clientBillingApi";
import {
  PAGE, PageTotalCell, Pager, SearchBar, Table, initialFilters, link, num, pageSum, toListFilters, useList,
  type ExportCsvHandler,
} from "./legacyListParts";
import { formatDateTime, whoBy } from "./shared";

export function RejectedInvoiceList({ onOpen, onClone, onExportCsv }: {
  onOpen: (row: InvoiceRow) => void;
  onClone?: (row: InvoiceRow) => void;
  onExportCsv?: ExportCsvHandler;
}) {
  const [f, setF] = useState(initialFilters(""));
  const [page, setPage] = useState(1);
  const q = useList("legacy-rejected", f, page, { status: "rejected" });
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SearchBar value={f} defaults={initialFilters("")} numberLabel="Proforma / Bill No." onSearch={(n) => { setF(n); setPage(1); }}
        onExport={onExportCsv ? () => onExportCsv({ ...toListFilters(f), status: "rejected" }, "rejected-void-invoices.csv") : undefined} />
      <Table loading={q.isLoading} empty={rows.length === 0} error={q.error} onRetry={() => void q.refetch()}
        head={["Sr. No.", "Branch Name", "Proforma No.", "Bill No.", "Client", "Amount", "Grand total", "Reason", "Rejected by", "Rejected at", "Action"]}
        foot={<tr><PageTotalCell colSpan={5} /><td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "total_amount"))}</td>
          <td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "grand_total"))}</td><td colSpan={4} /></tr>}>
        {rows.map((r, i) => (
          <tr key={r.id} className="border-b odd:bg-slate-50">
            <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
            <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
            <td className="whitespace-nowrap px-2 py-1.5">
              <button type="button" className={link} onClick={() => onOpen(r)} aria-label={`Details of ${r.bill_no ?? r.proforma_no}`}>{r.proforma_no ?? "—"}</button>
            </td>
            <td className="whitespace-nowrap px-2 py-1.5">
              {r.bill_no ? <span title="Bill number kept on the voided invoice">{r.bill_no} <span className="text-xs text-rose-700">(void)</span></span> : "—"}
            </td>
            <td className="max-w-[200px] px-2 py-1.5">{r.cost_centre_display_name ?? "—"}</td>
            <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
            <td className="px-2 py-1.5 tabular-nums">{num(r.grand_total)}</td>
            <td className="max-w-[280px] px-2 py-1.5 text-rose-800">{r.rejected_reason ?? "—"}</td>
            <td className="px-2 py-1.5 text-xs">{whoBy(r.rejected_by_name, r.rejected_by)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatDateTime(r.rejected_at)}</td>
            <td className="whitespace-nowrap px-2 py-1.5">
              <button type="button" className={link} onClick={() => onOpen(r)}>View</button>
              {onClone && <> · <button type="button" className={link} onClick={() => onClone(r)} aria-label={`Clone ${r.proforma_no ?? r.bill_no} as new proforma`}>Clone as new proforma</button></>}
            </td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

// src/components/finance/client-billing/InvoiceApprovalList.tsx
/**
 * Legacy "Invoice Approval" (step 4): proformas whose step-1 approval is done and which wait for
 * the bill number. Sr. No. | Branch Name | Proforma No. | Client | Bill date | Amount |
 * Description | Action (view / Edit / Reject). Rows can be ticked and approved together
 * ("Approve selected", POST /invoices/bulk-approve, max 100) after a confirmation; each row's
 * outcome (bill number or the server's reason) is listed afterwards.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkApproveInvoices, type BulkApproveResponse, type InvoiceRow } from "@/lib/clientBillingApi";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  PAGE, PageTotalCell, Pager, SearchBar, Table, initialFilters, link, num, pageSum, toListFilters, useList,
  type ExportCsvHandler,
} from "./legacyListParts";
import { formatDateOnly } from "./shared";

type Result = BulkApproveResponse["results"][number] & { label: string };

export function InvoiceApprovalList({ onView, onEdit, onReject, onOpen, banner, onExportCsv }: {
  onView: (row: InvoiceRow) => void;
  onEdit: (row: InvoiceRow) => void;
  onReject?: (row: InvoiceRow) => void;
  onOpen?: (row: InvoiceRow) => void;
  banner?: string | null;
  onExportCsv?: ExportCsvHandler;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState(initialFilters(""));
  const [page, setPage] = useState(1);
  const extra = { status: "proforma", stage: "invoice_approval" } as const;
  const q = useList("legacy-invoice-approval", f, page, extra);
  const rows = q.data?.data ?? [];
  const selectable = rows.filter((r) => !r.is_migrated);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => { setSelected(new Set()); }, [f, page]);

  const bulk = useMutation({
    mutationFn: (ids: string[]) => bulkApproveInvoices(ids),
    onSuccess: (res, ids) => {
      const label = new Map(rows.map((r) => [r.id, r.proforma_no ?? r.id]));
      setResults(res.data.results.map((r) => ({ ...r, label: label.get(r.invoiceId) ?? r.invoiceId })));
      setSelected(new Set(res.data.results.filter((r) => !r.ok).map((r) => r.invoiceId).filter((id) => ids.includes(id))));
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
    },
  });
  const byId = new Map(results.map((r) => [r.invoiceId, r]));
  const allOnPage = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  const selectedTotal = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + Math.round(Number(r.total_amount) * 100), 0) / 100;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {banner && <p role="status" className="mb-2 text-center text-sm font-semibold text-red-600">{banner}</p>}
      <SearchBar value={f} defaults={initialFilters("")} numberLabel="Proforma No." onSearch={(n) => { setF(n); setPage(1); }}
        onExport={onExportCsv ? () => onExportCsv({ ...toListFilters(f), ...extra }, "invoice-approval-queue.csv") : undefined} />

      {selected.size > 0 && (
        <div role="region" aria-label="Bulk approval" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
          <span><b>{selected.size}</b> selected · taxable {num(selectedTotal)}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => setSelected(new Set())}>Clear selection</Button>
            <Button size="sm" className="cursor-pointer bg-sky-600 hover:bg-sky-700" onClick={() => { bulk.reset(); setConfirm(true); }}>
              Approve selected ({selected.size})
            </Button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <section aria-label="Bulk approval results" className="mb-2 rounded-md border bg-white px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium">
              Last bulk approval: {results.filter((r) => r.ok).length} approved, {results.filter((r) => !r.ok).length} failed
            </p>
            <Button size="sm" variant="ghost" className="h-7 cursor-pointer text-xs" onClick={() => setResults([])}>Dismiss</Button>
          </div>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {results.map((r) => (
              <li key={r.invoiceId} className={r.ok ? "text-emerald-800" : "text-rose-800"}>
                {r.ok ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : <XCircle className="mr-1 inline h-3.5 w-3.5" />}
                {r.label}: {r.ok ? `approved, bill no. ${r.billNo ?? ""}` : `failed — ${r.error ?? "unknown reason"}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Table loading={q.isLoading} empty={rows.length === 0} error={q.error} onRetry={() => void q.refetch()}
        head={[
          <Checkbox key="all" aria-label="Select all on this page" checked={allOnPage} disabled={selectable.length === 0}
            onCheckedChange={(v) => setSelected(v === true ? new Set(selectable.map((r) => r.id)) : new Set())} className="border-white" />,
          "Sr. No.", "Branch Name", "Proforma No.", "Client", "Bill date", "Amount", "Description", "Action", "", "",
        ]}
        foot={<tr><PageTotalCell colSpan={6} /><td className="px-2 py-1.5 tabular-nums">{num(pageSum(rows, "total_amount"))}</td><td colSpan={4} /></tr>}>
        {rows.map((r, i) => {
          const res = byId.get(r.id);
          return (
            <tr key={r.id} data-approval-id={r.id} className="border-b odd:bg-slate-50">
              <td className="px-2 py-1.5">
                {!r.is_migrated && (
                  <Checkbox aria-label={`Select ${r.proforma_no}`} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                )}
              </td>
              <td className="px-2 py-1.5">{(page - 1) * PAGE + i + 1}</td>
              <td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {onOpen ? <button type="button" className={link} onClick={() => onOpen(r)} aria-label={`Details of ${r.proforma_no}`}>{r.proforma_no}</button> : r.proforma_no}
                {res && !res.ok && <span className="block text-xs text-rose-700" role="alert">Failed: {res.error}</span>}
              </td>
              <td className="max-w-[200px] px-2 py-1.5">{r.cost_centre_display_name ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{formatDateOnly(r.invoice_date)}</td>
              <td className="px-2 py-1.5 tabular-nums">{num(r.total_amount)}</td>
              <td className="px-2 py-1.5">{r.description ?? ""}</td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onView(r)} aria-label={`view ${r.proforma_no}`}>view</button></td>
              <td className="px-2 py-1.5"><button type="button" className={link} onClick={() => onEdit(r)} aria-label={`Edit ${r.proforma_no}`}>Edit</button></td>
              <td className="px-2 py-1.5">
                {onReject && !r.is_migrated && <button type="button" className={`${link} text-rose-700`} onClick={() => onReject(r)} aria-label={`Reject ${r.proforma_no}`}>Reject</button>}
              </td>
            </tr>
          );
        })}
      </Table>
      <Pager page={page} total={q.data?.total ?? 0} onPage={setPage} />

      <ConfirmActionDialog
        open={confirm}
        title={`Approve ${selected.size} invoice(s) and generate bill numbers?`}
        description={<>Each selected proforma gets its bill number now. Rows the server refuses (PO, provision or GST checks) are listed with the reason; the rest are approved.</>}
        confirmLabel={bulk.isPending ? "Approving…" : `Approve ${selected.size}`}
        pending={bulk.isPending}
        error={bulk.isError ? bulk.error.message : null}
        onConfirm={() => bulk.mutate([...selected])}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}


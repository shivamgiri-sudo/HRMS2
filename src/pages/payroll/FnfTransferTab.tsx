/**
 * F&F Transfer tab — Full & Final settlement disbursement, as its own bank-transfer batch.
 *
 * Owner ruling 2026-09-12 (Q6): "The final settlement gets its own bank transfer batch,
 * separate from monthly salary, but using the same bank-file machinery and approvals."
 * Deliberately mirrors the Salary Transfer file tab in PaymentDisbursalCenter.tsx pattern for
 * pattern — same generate/reject/correct/import workflow, same table shapes — because a payroll
 * operator who already knows that screen should recognise this one without relearning it.
 *
 * THE ONE REAL DIFFERENCE: NO RUN SELECTOR
 *   Salary transfer is scoped to a payroll run (run_id) because monthly salary IS a run. F&F
 *   has no run — full_final_calculation is one row per exit, not per month — so this tab has
 *   no run picker and its eligibility/items queries are unscoped, exactly matching the backend
 *   (fnf-transfer.service.ts's getEligibleFnfTransferRows/getFnfTransferItems take no run_id).
 *
 * THE OTHER REAL DIFFERENCE: NOC IS MANDATORY, NOT A TOGGLE
 *   Every row here is a leaver by construction (full_final_calculation only exists for exited
 *   employees), so unlike the salary export — where NOC sits behind a company-wide kill switch
 *   most of whose population is active employees the gate never applies to — there is no
 *   equivalent "off" state to surface here. The backend enforces this unconditionally
 *   (nocReleaseStatusForEmployee, no kill-switch check) and returns every blocked settlement in
 *   `ineligible`, which this tab must show, not just the ones that passed — a payable
 *   settlement missing from the screen with no explanation is exactly the failure the gate
 *   exists to prevent.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, ShieldAlert } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types — mirror the backend contracts in fnf-transfer.service.ts / fnf-transfer.routes.ts ──

interface FnfIneligibleRow {
  full_final_calculation_id: string;
  exit_request_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  reason: string;
}

interface FnfEligibleRow {
  full_final_calculation_id: string;
  exit_request_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  amount: number;
  account_masked: string;
  ifsc: string;
  bank_name: string | null;
}

interface FnfTransferItem {
  id: string;
  batch_id: string;
  full_final_calculation_id: string;
  exit_request_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string | null;
  amount: number;
  pay_mod: string;
  account_masked: string;
  status: "exported" | "rejected" | "corrected_ready" | "confirmed";
  bucket: "ready_for_disbursal" | "disbursed" | "rejected";
  rejection_reason: string | null;
  rejection_reason_label: string | null;
  rejection_note: string | null;
  ecs_number: string | null;
  transfer_date: string | null;
  confirmed_at: string | null;
  batch_number: string;
  attempt_kind: string;
}

interface FnfImportPreviewRow {
  emp_code: string;
  emp_name: string;
  ecs_number: string;
  trf_date: string;
  outcome: "will_confirm" | "unmatched" | "already_confirmed" | "invalid";
  detail: string;
  item_id: string | null;
  full_final_calculation_id: string | null;
}

export function FnfTransferTab() {
  const qc = useQueryClient();

  // ── Eligibility selection ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [reexporting, setReexporting] = useState(false);

  // ── Items workflow (reject / mark-corrected-ready) ───────────────────────
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [openSection, setOpenSection] = useState<Record<"ready" | "disbursed" | "rejected", boolean>>({
    ready: true, disbursed: true, rejected: true,
  });

  // ── Transfer Number Update File import ───────────────────────────────────
  const [importPreview, setImportPreview] = useState<{
    file_name: string;
    file_sha256: string;
    summary: { total: number; will_confirm: number; unmatched: number; already_confirmed: number; invalid: number };
    data: FnfImportPreviewRow[];
  } | null>(null);
  const [importing, setImporting] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────
  const eligibleQ = useQuery<{
    data: FnfEligibleRow[];
    count: number;
    total_amount: number;
    ineligible: FnfIneligibleRow[];
  }>({
    queryKey: ["fnf-transfer-eligible"],
    queryFn: () => hrmsApi.get("/api/payroll/fnf-transfer/eligible"),
  });
  const eligibleRows = eligibleQ.data?.data ?? [];
  const ineligibleRows = eligibleQ.data?.ineligible ?? [];

  const itemsQ = useQuery<{
    data: FnfTransferItem[];
    rejection_reasons: Array<{ value: string; label: string }>;
  }>({
    queryKey: ["fnf-transfer-items"],
    queryFn: () => hrmsApi.get("/api/payroll/fnf-transfer/items"),
  });
  const items = itemsQ.data?.data ?? [];
  const rejectionReasons = itemsQ.data?.rejection_reasons ?? [];
  const correctedReadyItems = items.filter((i) => i.status === "corrected_ready");
  const readyForDisbursalItems = items.filter((i) => i.bucket === "ready_for_disbursal");
  const disbursedItems = items.filter((i) => i.bucket === "disbursed");
  const rejectedItems = items.filter((i) => i.bucket === "rejected");

  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every((r) => selectedIds.has(r.full_final_calculation_id));

  function toggleEligibleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleEligibleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) {
        for (const r of eligibleRows) next.delete(r.full_final_calculation_id);
      } else {
        for (const r of eligibleRows) next.add(r.full_final_calculation_id);
      }
      return next;
    });
  }

  async function downloadFnfTransferFile(reexport: boolean, ids?: string[]) {
    const setBusy = reexport ? setReexporting : setGenerating;
    setBusy(true);
    try {
      // POST, not GET — a real selection can exceed a query-string length limit, same reason
      // the salary-transfer export uses POST for anything but a trivially small selection.
      const blob = await hrmsApi.postBlob("/api/payroll/fnf-transfer/export", { ids: ids ?? [] });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `FnF_Transfer${reexport ? "_REEXPORT" : ""}_${new Date().toISOString().slice(0, 10)}.xls`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(reexport ? "F&F re-export file generated" : "F&F transfer file generated");
      setSelectedIds(new Set());
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-items"] });
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-eligible"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate file");
    } finally {
      setBusy(false);
    }
  }

  const rejectItemsMutation = useMutation({
    mutationFn: (vars: { item_ids: string[]; reason: string; note: string | null }) =>
      hrmsApi.patch("/api/payroll/fnf-transfer/items/reject", vars),
    onSuccess: () => {
      toast.success("Item(s) marked rejected — correction task created");
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-items"] });
      setRejectDialogOpen(false);
      setSelectedItemIds(new Set());
      setRejectReason("");
      setRejectNote("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Reject failed"),
  });

  const markCorrectedReadyMutation = useMutation({
    mutationFn: (itemId: string) =>
      hrmsApi.patch(`/api/payroll/fnf-transfer/items/${itemId}/mark-corrected-ready`),
    onSuccess: () => {
      toast.success("Marked ready for re-export");
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-items"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  async function handleImportFileSelected(file: File) {
    setImporting(true);
    setImportPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // No run_id appended — F&F's import match has nothing to scope by; full_final_calculation_id
      // plus the open_flag uniqueness constraint IS the scoping boundary (see
      // previewFnfTransferNumberImport's own doc comment).
      const res = await hrmsApi.postForm<{
        success: boolean;
        file_name: string;
        file_sha256: string;
        summary: any;
        data: FnfImportPreviewRow[];
      }>("/api/payroll/fnf-transfer/import/preview", fd);
      setImportPreview(res as any);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read file");
    } finally {
      setImporting(false);
    }
  }

  const commitImportMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<{
        success: boolean;
        message: string;
        data: { confirmed: number; ff_marked_paid: number; ff_mark_paid_failures: Array<{ full_final_calculation_id: string; error: string }>; skipped: number };
      }>("/api/payroll/fnf-transfer/import/commit", {
        file_name: importPreview?.file_name,
        file_sha256: importPreview?.file_sha256,
        preview: importPreview?.data,
      }),
    onSuccess: (res) => {
      toast.success(res?.message ?? "Import committed");
      // ff_mark_paid_failures is the maker-checker refusal case (the confirming user also
      // approved the settlement) — the transfer confirms regardless (the money left the bank),
      // but the settlement itself needs a second person to mark it paid. Surfaced explicitly
      // rather than buried in the success toast, since it needs a human follow-up action.
      const failures = res?.data?.ff_mark_paid_failures ?? [];
      if (failures.length > 0) {
        toast.warning(
          `${failures.length} settlement(s) confirmed on the bank side but could not be marked paid — ` +
          `they need approval from someone other than the settlement's approver.`,
        );
      }
      setImportPreview(null);
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-items"] });
      void qc.invalidateQueries({ queryKey: ["fnf-transfer-eligible"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Commit failed"),
  });

  const readySelectedCount = readyForDisbursalItems.filter((i) => selectedItemIds.has(i.id)).length;
  const allReadySelected = readyForDisbursalItems.length > 0 && readySelectedCount === readyForDisbursalItems.length;

  const renderItemTable = (rows: FnfTransferItem[], opts: { selectable?: boolean; showMarkCorrected?: boolean; emptyText: string }) => (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            {opts.selectable && <th className="px-2 py-2 w-8"></th>}
            {["Code", "Name", "Amount", "Pay Mod", "Account", "Batch", "Rejection reason", "ECS / TRF date"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
            ))}
            {opts.showMarkCorrected && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground text-xs">{opts.emptyText}</td></tr>
          ) : (
            rows.map((it) => (
              <tr key={it.id} className="border-t">
                {opts.selectable && (
                  <td className="px-2 py-2">
                    <Checkbox
                      checked={selectedItemIds.has(it.id)}
                      onCheckedChange={() =>
                        setSelectedItemIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-xs">{it.employee_code}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.employee_name ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">₹{Number(it.amount).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2">{it.pay_mod}</td>
                <td className="px-3 py-2 font-mono text-xs">{it.account_masked}</td>
                <td className="px-3 py-2 text-xs">{it.batch_number}{it.attempt_kind === "reexport" ? " (re-export)" : ""}</td>
                <td className="px-3 py-2 text-xs max-w-xs">
                  {it.rejection_reason_label ?? "—"}
                  {it.rejection_note && <div className="text-muted-foreground">{it.rejection_note}</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.ecs_number ? `${it.ecs_number} / ${it.transfer_date ?? "—"}` : "—"}
                  {it.status === "confirmed" && <div className="text-emerald-700">settlement marked paid</div>}
                </td>
                {opts.showMarkCorrected && (
                  <td className="px-3 py-2">
                    {it.status === "rejected" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={markCorrectedReadyMutation.isPending}
                        onClick={() => markCorrectedReadyMutation.mutate(it.id)}
                        title="Only after the bank-change request has been approved and penny-drop verified"
                      >
                        Mark corrected
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Debit account, Pay Mod and every column are computed server-side, in the exact same
        Salary Transfer File format as monthly salary — but this is a separate bank-transfer
        batch, keyed to each Full &amp; Final settlement rather than a payroll run. A leaver
        without a signed NOC cannot appear here at all: see the withheld list below.
      </p>

      {/* ── NOC-withheld settlements — mandatory, always shown, never silent ── */}
      {ineligibleRows.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            {ineligibleRows.length} settlement(s) withheld — NOC clearance is not complete
          </p>
          <p className="text-amber-900 mt-1 text-xs">
            A leaver without a signed NOC must not appear in a bank file. This is unconditional
            for Full &amp; Final — unlike monthly salary, every settlement here is a leaver, so
            there is no company-wide switch to turn this off. Complete the NOC in Payroll › NOC
            Management to release each one.
          </p>
          <div className="rounded-md border border-amber-200 bg-white/70 overflow-auto max-h-56 mt-3">
            <table className="w-full text-xs">
              <thead className="bg-amber-100/60 sticky top-0">
                <tr>
                  {["Code", "Name", "Reason"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ineligibleRows.map((r) => (
                  <tr key={r.full_final_calculation_id} className="border-t border-amber-100">
                    <td className="px-2 py-1.5 font-mono">{r.employee_code ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.employee_name ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Eligible settlements ─────────────────────────────────────────── */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            disabled={selectedIds.size === 0 || generating}
            onClick={() => downloadFnfTransferFile(false, [...selectedIds])}
            title="Generates the bank-upload .xls in the exact Salary Transfer File format for the selected settlements only"
          >
            <Download className="h-4 w-4 mr-2" />
            {generating ? "Generating…" : `Generate F&F Transfer File (${selectedIds.size} selected)`}
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {eligibleQ.isLoading ? "loading…" : `${eligibleRows.length} eligible, ₹${(eligibleQ.data?.total_amount ?? 0).toLocaleString("en-IN")} total`}
          </span>
        </div>

        <div className="rounded-md border overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-2 py-2 w-8">
                  <Checkbox
                    checked={allEligibleSelected}
                    onCheckedChange={toggleEligibleSelectAll}
                    aria-label="Select all eligible settlements"
                  />
                </th>
                {["Code", "Name", "Amount", "Account", "IFSC", "Bank"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {eligibleQ.isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : eligibleRows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No settlements eligible right now.</td></tr>
              ) : (
                eligibleRows.map((r) => (
                  <tr key={r.full_final_calculation_id} className={`border-t ${selectedIds.has(r.full_final_calculation_id) ? "bg-sky-50/60" : ""}`}>
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={selectedIds.has(r.full_final_calculation_id)}
                        onCheckedChange={() => toggleEligibleRow(r.full_final_calculation_id)}
                        aria-label={`Select ${r.employee_code}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.employee_code}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.employee_name}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.account_masked}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.ifsc}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.bank_name ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── F&F transfer items, same three-section workflow as Salary Transfer ── */}
      {items.length > 0 && (
        <div className="space-y-3">
          {/* Ready for Disbursal */}
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-semibold"
                onClick={() => setOpenSection((s) => ({ ...s, ready: !s.ready }))}
              >
                <Badge className="bg-amber-500 hover:bg-amber-500">Ready for Disbursal</Badge>
                ({readyForDisbursalItems.length})
              </button>
              <div className="flex items-center gap-2">
                {readyForDisbursalItems.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={allReadySelected}
                      onCheckedChange={() =>
                        setSelectedItemIds((prev) => {
                          const next = new Set(prev);
                          if (allReadySelected) readyForDisbursalItems.forEach((i) => next.delete(i.id));
                          else readyForDisbursalItems.forEach((i) => next.add(i.id));
                          return next;
                        })
                      }
                    />
                    Select all
                  </label>
                )}
                {readySelectedCount > 0 && (
                  <Button size="sm" variant="destructive" onClick={() => setRejectDialogOpen(true)}>
                    Add failure reason for {readySelectedCount}
                  </Button>
                )}
                {correctedReadyItems.length > 0 && (
                  <Button
                    size="sm"
                    disabled={reexporting}
                    onClick={() => downloadFnfTransferFile(true)}
                    title="Generates a new file containing only corrected, re-verified settlements"
                  >
                    {reexporting ? "Generating…" : `Re-export ${correctedReadyItems.length} corrected`}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Generated but not yet confirmed by a Transfer Number Update File upload. Uploading
              a file that includes these employees' codes moves them to Disbursed and marks the
              settlement paid automatically.
            </p>
            {openSection.ready && renderItemTable(readyForDisbursalItems, {
              selectable: true,
              showMarkCorrected: true,
              emptyText: "Nothing waiting — every generated settlement has either been confirmed or rejected.",
            })}
          </div>

          {/* Disbursed */}
          <div className="rounded-md border p-4 space-y-3">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold"
              onClick={() => setOpenSection((s) => ({ ...s, disbursed: !s.disbursed }))}
            >
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Disbursed</Badge>
              ({disbursedItems.length})
            </button>
            <p className="text-xs text-muted-foreground">
              Matched by employee code against an uploaded Transfer Number Update File — ECS/TRF
              number recorded, and the matching Full &amp; Final settlement marked paid.
            </p>
            {openSection.disbursed && renderItemTable(disbursedItems, {
              emptyText: "Nothing confirmed yet.",
            })}
          </div>

          {/* Rejected */}
          <div className="rounded-md border p-4 space-y-3">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold"
              onClick={() => setOpenSection((s) => ({ ...s, rejected: !s.rejected }))}
            >
              <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-200">Rejected</Badge>
              ({rejectedItems.length})
            </button>
            <p className="text-xs text-muted-foreground">
              Explicitly flagged with a failure reason. Once the bank-change request behind a
              reason is approved and penny-drop verified, mark it corrected to include it in the
              next re-export.
            </p>
            {openSection.rejected && renderItemTable(rejectedItems, {
              showMarkCorrected: true,
              emptyText: "No rejected items.",
            })}
          </div>
        </div>
      )}
      {items.length === 0 && !itemsQ.isLoading && (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No F&amp;F transfer batches generated yet.
        </div>
      )}

      {/* ── Transfer Number Update File import ─────────────────────────── */}
      <div className="rounded-md border p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Import Transfer Number Update File</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            CSV columns: EmpCode, EmpName, ECSNumber, TRF Date, Branch. Recording a transfer
            number here confirms the transfer and marks the matching settlement paid — nothing
            else does.
          </p>
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFileSelected(f);
            e.target.value = "";
          }}
          className="text-sm"
        />
        {importing && <p className="text-sm text-muted-foreground">Reading file…</p>}
        {importPreview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="outline">{importPreview.summary.total} rows</Badge>
              <Badge className="bg-emerald-600">{importPreview.summary.will_confirm} will confirm</Badge>
              {importPreview.summary.unmatched > 0 && <Badge variant="destructive">{importPreview.summary.unmatched} unmatched</Badge>}
              {importPreview.summary.already_confirmed > 0 && <Badge variant="secondary">{importPreview.summary.already_confirmed} already confirmed</Badge>}
              {importPreview.summary.invalid > 0 && <Badge variant="destructive">{importPreview.summary.invalid} invalid</Badge>}
            </div>
            <div className="rounded-md border overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {["Code", "Name", "ECS", "Date", "Outcome", "Detail"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.data.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.emp_code}</td>
                      <td className="px-2 py-1">{r.emp_name}</td>
                      <td className="px-2 py-1">{r.ecs_number}</td>
                      <td className="px-2 py-1">{r.trf_date}</td>
                      <td className={`px-2 py-1 font-medium ${r.outcome === "will_confirm" ? "text-emerald-700" : "text-amber-700"}`}>
                        {r.outcome.replace("_", " ")}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setImportPreview(null)}>Cancel</Button>
              <Button
                disabled={commitImportMutation.isPending || importPreview.summary.will_confirm === 0}
                onClick={() => commitImportMutation.mutate()}
              >
                {commitImportMutation.isPending ? "Committing…" : `Confirm ${importPreview.summary.will_confirm} transfer(s)`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Rejection dialog ─────────────────────────────────────────────── */}
      <Dialog open={rejectDialogOpen} onOpenChange={(o) => !o && setRejectDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedItemIds.size} item(s) rejected</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Creates a correction task. The employee's existing secure bank-update and
              penny-drop flow is used — nothing here edits an account directly.
            </p>
            <div>
              <label className="text-sm font-medium">Rejection reason</label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {rejectionReasons.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Note {rejectReason === "other" && <span className="text-destructive">*</span>}
              </label>
              <Textarea
                className="mt-1"
                rows={3}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Bank reference/reason detail. Never paste a full account number here."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={
                rejectItemsMutation.isPending ||
                !rejectReason ||
                (rejectReason === "other" && !rejectNote.trim())
              }
              onClick={() =>
                rejectItemsMutation.mutate({
                  item_ids: [...selectedItemIds],
                  reason: rejectReason,
                  note: rejectNote || null,
                })
              }
            >
              {rejectItemsMutation.isPending ? "Saving…" : "Confirm rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

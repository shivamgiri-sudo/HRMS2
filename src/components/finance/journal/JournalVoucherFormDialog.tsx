// src/components/finance/journal/JournalVoucherFormDialog.tsx
//
// Create or edit a journal voucher. Always saves as a draft first (the backend never enforces
// balance until submit — journal-voucher.validation.ts's assertSubmittable runs only at
// submit()), so "Save Draft" is the one call that can never fail on an unbalanced entry;
// "Save & Submit" chains the same save with an immediate submit for a maker confident the
// entry is already right.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { JV_TYPES, TYPE_LABEL, type JvDetail, type JvType } from "@/lib/finance/journalVoucherStatus";
import { JournalVoucherLineEditor, computeLineTotals, emptyLine, type EditableLine, type JvAccountOption } from "./JournalVoucherLineEditor";

type JvOptions = {
  expenseSubHeads: JvAccountOption[];
  payableAccounts: JvAccountOption[];
  branches: { id: string; name: string; code: string | null }[];
  costCentres: { id: string; name: string; code: string | null; branchId: string | null; processId: string | null }[];
  processes: { id: string; name: string; branchId: string | null }[];
  types: { value: JvType }[];
};

const ALL = "__all__";
const todayIso = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

function linesFromDetail(voucher?: JvDetail | null): EditableLine[] {
  if (!voucher || voucher.lines.length === 0) return [emptyLine("line-1"), emptyLine("line-2")];
  return voucher.lines.map((l, i) => ({
    key: `line-existing-${i}`,
    accountKey: `${l.accountType}::${l.accountId}`,
    debitAmount: l.debitAmount ? String(l.debitAmount) : "",
    creditAmount: l.creditAmount ? String(l.creditAmount) : "",
    narration: l.narration ?? "",
  }));
}

export function JournalVoucherFormDialog({
  open, onOpenChange, voucher, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing a draft/rejected voucher; absent for a new one. */
  voucher?: JvDetail | null;
  onSaved: (id: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!voucher;

  const [voucherDate, setVoucherDate] = useState(todayIso());
  const [jvType, setJvType] = useState<JvType>("provision");
  const [referenceNo, setReferenceNo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [processId, setProcessId] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine("line-1"), emptyLine("line-2")]);

  useEffect(() => {
    if (!open) return;
    setVoucherDate(voucher?.voucherDate ?? todayIso());
    setJvType(voucher?.jvType ?? "provision");
    setReferenceNo(voucher?.referenceNo ?? "");
    setBranchId(voucher?.branchId ?? "");
    setCostCentreId(voucher?.costCentreId ?? "");
    setProcessId(voucher?.processId ?? "");
    setNarration(voucher?.narration ?? "");
    setLines(linesFromDetail(voucher));
  }, [open, voucher]);

  const optionsQuery = useQuery({
    queryKey: ["journal-voucher-options"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: JvOptions }>("/api/finance/journal-vouchers/options")).data,
    enabled: open,
  });
  const options = optionsQuery.data;

  // Closed-set dependent dropdowns: a cost centre / process list scoped to the chosen branch,
  // cleared when the parent changes so a stale child never outlives its parent.
  const costCentreOptions = (options?.costCentres ?? []).filter((c) => !branchId || !c.branchId || c.branchId === branchId);
  const processOptions = (options?.processes ?? []).filter((p) => !branchId || !p.branchId || p.branchId === branchId);
  useEffect(() => {
    if (costCentreId && !costCentreOptions.some((c) => c.id === costCentreId)) setCostCentreId("");
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (processId && !processOptions.some((p) => p.id === processId)) setProcessId("");
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts: JvAccountOption[] = [...(options?.expenseSubHeads ?? []), ...(options?.payableAccounts ?? [])];
  const totals = computeLineTotals(lines);

  function buildPayload() {
    return {
      voucherDate,
      jvType,
      narration,
      referenceNo: referenceNo || null,
      branchId: branchId || null,
      costCentreId: costCentreId || null,
      processId: processId || null,
      lines: lines
        .filter((l) => l.accountKey && (Number(l.debitAmount) > 0 || Number(l.creditAmount) > 0))
        .map((l) => {
          const [accountType, accountId] = l.accountKey.split("::");
          return {
            accountType, accountId,
            debitAmount: Number(l.debitAmount || 0),
            creditAmount: Number(l.creditAmount || 0),
            narration: l.narration || null,
          };
        }),
    };
  }

  const saveMutation = useMutation({
    mutationFn: async (opts: { thenSubmit: boolean }) => {
      const payload = buildPayload();
      const res = isEdit
        ? await hrmsApi.put<{ success: boolean; data: JvDetail }>(`/api/finance/journal-vouchers/${voucher!.id}`, payload)
        : await hrmsApi.post<{ success: boolean; data: JvDetail }>("/api/finance/journal-vouchers", payload);
      const saved = res.data!;
      if (opts.thenSubmit) {
        await hrmsApi.post(`/api/finance/journal-vouchers/${saved.id}/submit`, {});
      }
      return { id: saved.id, thenSubmit: opts.thenSubmit };
    },
    onSuccess: ({ id, thenSubmit }) => {
      toast({ title: thenSubmit ? "Journal voucher submitted for approval" : "Draft saved" });
      qc.invalidateQueries({ queryKey: ["journal-vouchers"] });
      qc.invalidateQueries({ queryKey: ["journal-voucher-summary"] });
      onSaved(id);
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const narrationOk = narration.trim().length >= 5;
  const linesOk = lines.filter((l) => l.accountKey && (Number(l.debitAmount) > 0 || Number(l.creditAmount) > 0)).length >= 2;
  const canSaveDraft = narrationOk && linesOk && !!voucherDate;
  const canSubmitNow = canSaveDraft && totals.debit > 0 && totals.difference === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-full max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Journal Voucher ${voucher?.voucherNumber ?? ""}` : "New Journal Voucher"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Voucher Date</Label>
              <Input type="date" max={todayIso()} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={jvType} onValueChange={(v) => setJvType(v as JvType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JV_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference No. (optional)</Label>
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Invoice / audit note no." className="h-9" />
            </div>
            <div>
              <Label>Branch (optional)</Label>
              <Select value={branchId || ALL} onValueChange={(v) => setBranchId(v === ALL ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Company-wide" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Company-wide</SelectItem>
                  {(options?.branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cost Centre (optional)</Label>
              <Select value={costCentreId || ALL} onValueChange={(v) => setCostCentreId(v === ALL ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>None</SelectItem>
                  {costCentreOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Process (optional)</Label>
              <Select value={processId || ALL} onValueChange={(v) => setProcessId(v === ALL ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>None</SelectItem>
                  {processOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Narration <span className="text-rose-500">*</span></Label>
            <Textarea
              value={narration} onChange={(e) => setNarration(e.target.value)} rows={2}
              placeholder="Why this entry is being made — e.g. “Accrue September electricity bill, invoice not yet received”"
            />
            {!narrationOk && narration.length > 0 && <p className="mt-1 text-xs text-rose-600">At least 5 characters.</p>}
          </div>

          <div>
            <Label className="mb-1.5 block">Lines <span className="text-rose-500">*</span></Label>
            {optionsQuery.isLoading ? (
              <p className="py-4 text-center text-xs text-slate-400">Loading accounts…</p>
            ) : (
              <JournalVoucherLineEditor lines={lines} onChange={setLines} accounts={accounts} disabled={saveMutation.isPending} />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary" className="cursor-pointer"
            disabled={!canSaveDraft || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ thenSubmit: false })}
          >
            Save Draft
          </Button>
          <Button
            className="cursor-pointer bg-blue-600 hover:bg-blue-700"
            disabled={!canSubmitNow || saveMutation.isPending}
            title={!canSubmitNow ? "Debit and credit must balance before submitting" : undefined}
            onClick={() => saveMutation.mutate({ thenSubmit: true })}
          >
            Save &amp; Submit for Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// src/components/finance/client-billing/ProvisionsTab.tsx
/**
 * Step 1 of the legacy I-Spark sequence — the "Provision" menu: Create Provision, Provision
 * Approve, Upload Provision, View & Edit Provision. A proforma can only draw from an APPROVED
 * provision for its own cost centre + month (enforced server-side in drawDownForInvoice).
 */
import { useContext, useRef, useState } from "react";
import { AuthContext } from "@/contexts/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Upload, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  approveProvision, createProvision, decideProvisionEdit, listProvisions, rejectProvision, updateProvision, uploadProvisions,
  INVOICE_TYPES, type InvoiceType, type ProvisionRow, type UploadProvisionRow,
} from "@/lib/clientBillingApi";
import {
  BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions,
} from "./BillingScopeSelects";
import { currentFinanceYear, financeYearOptions, monthLabelOptions } from "./billingFieldOptions";
import { money } from "./shared";

const ALL = "_all";
const PAGE_SIZE = 25;

function ProvisionStatusBadge({ status }: { status: ProvisionRow["provision_status"] }) {
  if (status === "approved") return <StatusBadge status="approved" />;
  if (status === "rejected") return <StatusBadge status="rejected" />;
  return <StatusBadge status="pending" label="Pending approval" />;
}

function FyMonthSelects({ financeYear, monthLabel, onChange, allowAll = false, compact = false }: {
  financeYear: string;
  monthLabel: string;
  onChange: (next: { financeYear: string; monthLabel: string }) => void;
  allowAll?: boolean;
  compact?: boolean;
}) {
  const cls = compact ? "h-8 w-32 text-xs" : "mt-1 h-8 w-full text-sm";
  return (
    <>
      <Select value={financeYear || ALL} onValueChange={(v) => onChange({ financeYear: v === ALL ? "" : v, monthLabel: "" })}>
        <SelectTrigger className={cls} aria-label="Finance year"><SelectValue placeholder="Finance year" /></SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value={ALL}>All years</SelectItem>}
          {financeYearOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={monthLabel || ALL} disabled={!financeYear} onValueChange={(v) => onChange({ financeYear, monthLabel: v === ALL ? "" : v })}>
        <SelectTrigger className={cls} aria-label="Month"><SelectValue placeholder="Month" /></SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value={ALL}>All months</SelectItem>}
          {monthLabelOptions(financeYear).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
    </>
  );
}

/** Parses the Upload Provision CSV: cost_centre_code,finance_year,month_label,amount[,remarks]. */
export function parseProvisionCsv(text: string): UploadProvisionRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const body = first.includes("cost") && first.includes("amount") ? lines.slice(1) : lines;
  return body.map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      costCentreCode: cells[0] ?? "",
      financeYear: cells[1] ?? "",
      monthLabel: cells[2] ?? "",
      amount: Number(String(cells[3] ?? "").replace(/[^\d.]/g, "")),
      remarks: cells.slice(4).join(",") || undefined,
    };
  });
}

export function ProvisionsTab() {
  const { toast } = useToast();
  // Read without useAuth() so the tab still renders where no AuthProvider is mounted (tests).
  const myUserId = String((useContext(AuthContext) as { user?: { id?: string } } | undefined)?.user?.id ?? "");
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ companyName: "", branchId: "", financeYear: currentFinanceYear(), monthLabel: "", status: "pending", search: "", page: 1 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<ProvisionRow | null>(null);
  const [rejectRow, setRejectRow] = useState<ProvisionRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const listQuery = useQuery({
    queryKey: ["client-billing", "provisions", filters],
    queryFn: () => listProvisions({ ...filters, status: filters.status === ALL ? undefined : filters.status, limit: PAGE_SIZE }),
  });
  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveProvision(id),
    onSuccess: () => { toast({ title: "Provision approved" }); refresh(); },
    onError: fail("Approval failed"),
  });
  const editDecision = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "decline" }) => decideProvisionEdit(v.id, v.decision),
    onSuccess: (_r, v) => { toast({ title: v.decision === "approve" ? "Provision edit approved" : "Provision edit declined" }); refresh(); },
    onError: fail("Could not decide the edit"),
  });
  const uploadMutation = useMutation({
    mutationFn: (rowsToUpload: UploadProvisionRow[]) => uploadProvisions(rowsToUpload),
    onSuccess: (res) => {
      const failed = res.data.results.filter((r) => !r.ok);
      toast({
        title: `Uploaded ${res.data.created} provision(s)`,
        description: failed.length ? failed.slice(0, 5).map((r) => `Row ${r.row} (${r.costCentreCode}): ${r.error}`).join(" · ") : "All rows created as pending.",
        variant: failed.length ? "destructive" : undefined,
      });
      refresh();
    },
    onError: fail("Upload failed"),
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseProvisionCsv(await file.text());
    if (parsed.length === 0) { toast({ title: "The file has no rows", variant: "destructive" }); return; }
    uploadMutation.mutate(parsed);
    if (fileRef.current) fileRef.current.value = "";
  }

  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BillingScopeSelects compact companyName={filters.companyName} branchId={filters.branchId} onChange={set} />
          <FyMonthSelects compact allowAll financeYear={filters.financeYear} monthLabel={filters.monthLabel} onChange={set} />
          <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending approval</SelectItem>
              <SelectItem value="edit_pending">Edit waiting approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value={ALL}>All statuses</SelectItem>
            </SelectContent>
          </Select>
          <Input className="h-8 w-44 text-xs" placeholder="Cost centre / client…" aria-label="Search provisions" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={uploadMutation.isPending} onClick={() => fileRef.current?.click()}
            title="CSV columns: cost_centre_code, finance_year (2026-27), month_label (Sep-26), amount, remarks">
            {uploadMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Upload Provision
          </Button>
          <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Create Provision
          </Button>
        </div>
      </div>

      {listQuery.isError && (
        <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {listQuery.error instanceof Error ? listQuery.error.message : "Unable to load provisions"}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Cost centre</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Provision</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No provisions found</TableCell></TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.id} data-approval-id={row.id}>
                  <TableCell className="text-xs">{row.branch_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium">{row.cost_centre_code}</span>
                    <span className="block text-muted-foreground">{row.client_name}</span>
                  </TableCell>
                  <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.provision_amount)}
                    {row.edit_requested_at && (
                      <span className="block text-[11px] font-medium text-amber-700" title={row.edit_remarks ?? ""}>edit → {money(row.edit_amount)} (waiting approval)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.used_amount)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(row.provision_balance)}</TableCell>
                  <TableCell><ProvisionStatusBadge status={row.provision_status} /></TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={row.rejected_reason ?? row.remarks ?? ""}>
                    {row.provision_status === "rejected" ? row.rejected_reason : row.remarks}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {row.edit_requested_at && String(row.edit_requested_by) === myUserId && (
                        <span className="text-xs text-amber-700">Waiting for another approver</span>
                      )}
                      {row.edit_requested_at && String(row.edit_requested_by) !== myUserId && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-emerald-700" aria-label="Approve provision edit"
                            disabled={editDecision.isPending} onClick={() => editDecision.mutate({ id: row.id, decision: "approve" })}>Approve edit</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-700" aria-label="Decline provision edit"
                            disabled={editDecision.isPending} onClick={() => editDecision.mutate({ id: row.id, decision: "decline" })}>Decline</Button>
                        </>
                      )}
                      {row.provision_status !== "rejected" && !row.edit_requested_at && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" aria-label="Edit provision" onClick={() => setEditRow(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {row.provision_status === "pending" && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700" title="Approve" aria-label="Approve provision"
                            disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(row.id)}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700" title="Reject" aria-label="Reject provision" onClick={() => setRejectRow(row)}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
        <span className="text-slate-500">{total} provision(s)</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Prev</Button>
          <span className="font-semibold">{filters.page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={filters.page >= totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
        </div>
      </div>

      <CreateProvisionDialog open={createOpen} onOpenChange={setCreateOpen} onDone={refresh} />
      <EditProvisionDialog row={editRow} onClose={() => setEditRow(null)} onDone={refresh} />
      <RejectProvisionDialog row={rejectRow} onClose={() => setRejectRow(null)} onDone={refresh} />
    </div>
  );
}

function CreateProvisionDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const options = useBillingFilterOptions().data?.data;
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [costCentreId, setCostCentreId] = useState("");
  const [period, setPeriod] = useState({ financeYear: currentFinanceYear(), monthLabel: "" });
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("Revenue");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const reset = () => { setScope({ companyName: "", branchId: "" }); setCostCentreId(""); setPeriod({ financeYear: currentFinanceYear(), monthLabel: "" }); setAmount(""); setRemarks(""); };
  const mutation = useMutation({
    mutationFn: () => createProvision({ costCentreId, ...period, amount: Number(amount), remarks: remarks.trim() || undefined, invoiceType }),
    onSuccess: () => { toast({ title: "Provision created", description: "Pending approval" }); onDone(); reset(); onOpenChange(false); },
    onError: (e: Error) => toast({ title: "Could not create provision", description: e.message, variant: "destructive" }),
  });
  const ccOptions = costCentreSearchOptions(narrowCostCentres(options?.costCentres ?? [], scope.companyName, scope.branchId));
  const canSave = Boolean(costCentreId && period.financeYear && period.monthLabel && Number(amount) > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create Provision</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <BillingScopeSelects labelled companyName={scope.companyName} branchId={scope.branchId} onChange={(s) => { setScope(s); setCostCentreId(""); }} />
          <div className="col-span-2">
            <Label className="text-xs">Cost centre *</Label>
            <SearchableSelect className="mt-1" options={ccOptions} value={costCentreId} onChange={setCostCentreId}
              placeholder="Select cost centre" searchPlaceholder="Search code, client…" emptyText="No cost centre found." aria-label="Cost centre" />
          </div>
          <div><Label className="text-xs">Year *</Label></div>
          <div><Label className="text-xs">Month *</Label></div>
          <FyMonthSelects financeYear={period.financeYear} monthLabel={period.monthLabel} onChange={setPeriod} />
          <div className="col-span-2">
            <Label className="text-xs">Invoice Type *</Label>
            <Select value={invoiceType} onValueChange={(v) => setInvoiceType(v as InvoiceType)}>
              <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Invoice type"><SelectValue /></SelectTrigger>
              <SelectContent>{INVOICE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs" htmlFor="provision-amount">Provision amount (₹, before GST) *</Label>
            <Input id="provision-amount" type="number" min="0" step="0.01" inputMode="decimal" className="mt-1 h-8 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs" htmlFor="provision-remarks">Remarks</Label>
            <Textarea id="provision-remarks" className="mt-1 min-h-[56px] text-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!canSave || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit provision (owner feedback 2026-10-14): show what was approved, what invoices already used
 * and the balance; the user enters how much to ADD (minus to reduce) and sees the new total and
 * new balance before saving. An approved provision's change waits for a second approver.
 */
function EditProvisionDialog({ row, onClose, onDone }: { row: ProvisionRow | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [add, setAdd] = useState("");
  const [remarks, setRemarks] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (row && loadedFor !== row.id) {
    setLoadedFor(row.id);
    setAdd("");
    setRemarks(row.remarks ?? "");
  }
  const p = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  const currentP = p(row?.provision_amount);
  const usedP = p(row?.used_amount);
  const addP = add.trim() === "" || add.trim() === "-" ? 0 : p(add);
  const newTotalP = currentP + addP;
  const newBalanceP = newTotalP - usedP;
  const addValid = add.trim() === "" || Number.isFinite(Number(add));
  const changed = addP !== 0 || (remarks.trim() || null) !== (row?.remarks ?? null);
  const problem = !addValid ? "Enter a number (use minus to reduce)."
    : newTotalP <= 0 ? "The new total must be above zero."
    : newTotalP < usedP ? `The new total cannot go below ${money(usedP / 100)} already used by invoices.`
    : !changed ? "Enter an amount to add, or change the remarks." : null;
  const approved = row?.provision_status === "approved";
  const mutation = useMutation({
    mutationFn: () => updateProvision(row!.id, { amount: newTotalP / 100, remarks: remarks.trim() || null }),
    onSuccess: (res) => {
      toast({ title: res.data.editPending ? "Edit sent for approval" : "Provision updated",
        description: res.data.editPending ? `New total ${money(newTotalP / 100)} applies after a second person approves it.` : `New total ${money(newTotalP / 100)}.` });
      onDone(); onClose();
    },
    onError: (e: Error) => toast({ title: "Could not update provision", description: e.message, variant: "destructive" }),
  });
  const stat = (label: string, v: number, cls = "") => (
    <div className="rounded-md border px-3 py-2"><p className="text-[11px] text-slate-600">{label}</p><p className={`text-sm font-semibold tabular-nums ${cls}`}>{money(v / 100)}</p></div>
  );
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => { if (!o) { setLoadedFor(null); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit provision · {row?.cost_centre_code} · {row?.month_label}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {stat(approved ? "Approved amount" : "Current amount", currentP)}
          {stat("Used by invoices", usedP)}
          {stat("Balance", currentP - usedP)}
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs" htmlFor="edit-provision-add">Amount to add (₹) <span className="text-slate-500">— use minus to reduce</span></Label>
            <Input id="edit-provision-add" inputMode="decimal" className="mt-1 h-8 text-sm" placeholder="e.g. 50000 or -20000" value={add} onChange={(e) => setAdd(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2">
            <div><p className="text-[11px] text-slate-600">New total</p><p className="text-base font-semibold tabular-nums">{money(newTotalP / 100)}</p></div>
            <div><p className="text-[11px] text-slate-600">New balance</p><p className={`text-base font-semibold tabular-nums ${newBalanceP < 0 ? "text-rose-700" : ""}`}>{money(newBalanceP / 100)}</p></div>
          </div>
          <div>
            <Label className="text-xs" htmlFor="edit-provision-remarks">Remarks</Label>
            <Textarea id="edit-provision-remarks" className="mt-1 min-h-[56px] text-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          {approved && <p className="text-xs text-amber-800">This provision is approved, so the change applies only after a second person approves it.</p>}
          {problem && <p className="text-xs text-slate-600">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={Boolean(problem) || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{approved ? "Send for approval" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectProvisionDialog({ row, onClose, onDone }: { row: ProvisionRow | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => rejectProvision(row!.id, reason.trim()),
    onSuccess: () => { toast({ title: "Provision rejected" }); setReason(""); onDone(); onClose(); },
    onError: (e: Error) => toast({ title: "Could not reject provision", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reject provision · {row?.cost_centre_code} · {row?.month_label}</DialogTitle></DialogHeader>
        <Label className="text-xs" htmlFor="reject-provision-reason">Reason *</Label>
        <Textarea id="reject-provision-reason" className="min-h-[72px] text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}><X className="mr-1 h-3.5 w-3.5" />Cancel</Button>
          <Button size="sm" variant="destructive" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

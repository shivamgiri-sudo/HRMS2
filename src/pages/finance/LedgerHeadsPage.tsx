// src/pages/finance/LedgerHeadsPage.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type LedgerHead = {
  id: string;
  account_name: string;
  account_type: "expense" | "payable" | "receivable" | "income" | "bank_charge" | "other";
  tally_ledger_name: string;
  active_status: boolean;
};

const ACCOUNT_TYPES = ["expense", "payable", "receivable", "income", "bank_charge", "other"] as const;
const TYPE_LABELS: Record<string, string> = {
  expense: "Expense", payable: "Payable", receivable: "Receivable", income: "Income", bank_charge: "Bank Charge", other: "Other",
};

const emptyForm = { id: "", accountName: "", accountType: "" as string, tallyLedgerName: "" };

export default function LedgerHeadsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const listQuery = useQuery({
    queryKey: ["ledger-heads"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: LedgerHead[] }>("/api/finance/payable-accounts?includeInactive=1")).data ?? [],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { accountName: form.accountName.trim(), accountType: form.accountType, tallyLedgerName: form.tallyLedgerName.trim() };
      if (form.id) return (await hrmsApi.put(`/api/finance/payable-accounts/${form.id}`, payload)).data;
      return (await hrmsApi.post("/api/finance/payable-accounts", payload)).data;
    },
    onSuccess: () => {
      toast({ title: form.id ? "Ledger head updated" : "Ledger head created" });
      qc.invalidateQueries({ queryKey: ["ledger-heads"] });
      setFormOpen(false); setForm(emptyForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => hrmsApi.put(`/api/finance/payable-accounts/${id}`, { activeStatus: active }),
    onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: ["ledger-heads"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const heads = listQuery.data ?? [];

  return (
    <DashboardLayout>
    <div className="space-y-6 p-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7" />
            <div>
              <h1 className="text-xl font-bold">Ledger Heads</h1>
              <p className="text-sm text-blue-100">The chart-of-accounts entries Payment Vouchers and Bank Reconciliation adjustments post against.</p>
            </div>
          </div>
          <Button className="cursor-pointer bg-white text-blue-700 hover:bg-blue-50" onClick={() => { setForm(emptyForm); setFormOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> New Ledger Head
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tally Ledger Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {heads.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-slate-400">No ledger heads yet</TableCell></TableRow>
            )}
            {heads.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-medium">{h.account_name}</TableCell>
                <TableCell>{TYPE_LABELS[h.account_type] ?? h.account_type}</TableCell>
                <TableCell>{h.tally_ledger_name}</TableCell>
                <TableCell>
                  {h.active_status
                    ? <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge>
                    : <Badge className="bg-slate-100 text-slate-600"><XCircle className="mr-1 h-3 w-3" />Inactive</Badge>}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => { setForm({ id: h.id, accountName: h.account_name, accountType: h.account_type, tallyLedgerName: h.tally_ledger_name }); setFormOpen(true); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => toggleActiveMutation.mutate({ id: h.id, active: !h.active_status })}>
                    {h.active_status ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit Ledger Head" : "New Ledger Head"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs text-slate-500">Account Name</Label>
              <Input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} placeholder="e.g. GST Payable" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-slate-500">Account Type</Label>
              <Select value={form.accountType} onValueChange={(v) => setForm((f) => ({ ...f, accountType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-slate-500">Tally Ledger Name</Label>
              <Input value={form.tallyLedgerName} onChange={(e) => setForm((f) => ({ ...f, tallyLedgerName: e.target.value }))} placeholder="Exact ledger name as it exists in Tally" />
            </div>
          </div>
          <DialogFooter>
            <Button className="cursor-pointer" disabled={!form.accountName.trim() || !form.accountType || !form.tallyLedgerName.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {form.id ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}

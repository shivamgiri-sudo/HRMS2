// src/pages/finance/BankDirectoryPage.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type Bank = {
  id: string;
  bank_name: string;
  bank_code: string | null;
  ifsc_prefix: string | null;
  active_status: boolean;
};

const emptyForm = { id: "", bankName: "", bankCode: "", ifscPrefix: "" };

export default function BankDirectoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const listQuery = useQuery({
    queryKey: ["bank-directory"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Bank[] }>("/api/finance/bank-master?includeInactive=1")).data ?? [],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { bankName: form.bankName.trim(), bankCode: form.bankCode.trim() || null, ifscPrefix: form.ifscPrefix.trim() || null };
      if (form.id) return (await hrmsApi.put(`/api/finance/bank-master/${form.id}`, payload)).data;
      return (await hrmsApi.post("/api/finance/bank-master", payload)).data;
    },
    onSuccess: () => {
      toast({ title: form.id ? "Bank updated" : "Bank added" });
      qc.invalidateQueries({ queryKey: ["bank-directory"] });
      setFormOpen(false); setForm(emptyForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => hrmsApi.put(`/api/finance/bank-master/${id}`, { activeStatus: active }),
    onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: ["bank-directory"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const banks = listQuery.data ?? [];

  return (
    <DashboardLayout>
    <div className="space-y-6 p-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7" />
            <div>
              <h1 className="text-xl font-bold">Bank Directory</h1>
              <p className="text-sm text-blue-100">The banks offered when setting up a company bank account.</p>
            </div>
          </div>
          <Button className="cursor-pointer bg-white text-blue-700 hover:bg-blue-50" onClick={() => { setForm(emptyForm); setFormOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Bank
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>IFSC Prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {banks.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-slate-400">No banks yet</TableCell></TableRow>
            )}
            {banks.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.bank_name}</TableCell>
                <TableCell>{b.bank_code ?? "—"}</TableCell>
                <TableCell>{b.ifsc_prefix ?? "—"}</TableCell>
                <TableCell>
                  {b.active_status
                    ? <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge>
                    : <Badge className="bg-slate-100 text-slate-600"><XCircle className="mr-1 h-3 w-3" />Inactive</Badge>}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => { setForm({ id: b.id, bankName: b.bank_name, bankCode: b.bank_code ?? "", ifscPrefix: b.ifsc_prefix ?? "" }); setFormOpen(true); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => toggleActiveMutation.mutate({ id: b.id, active: !b.active_status })}>
                    {b.active_status ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit Bank" : "Add Bank"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs text-slate-500">Bank Name</Label>
              <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. IDFC First Bank" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-slate-500">Bank Code (optional)</Label>
              <Input value={form.bankCode} onChange={(e) => setForm((f) => ({ ...f, bankCode: e.target.value }))} placeholder="e.g. IDFC" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-slate-500">IFSC Prefix (optional, 4 letters)</Label>
              <Input value={form.ifscPrefix} onChange={(e) => setForm((f) => ({ ...f, ifscPrefix: e.target.value.toUpperCase() }))} placeholder="e.g. IDFB" maxLength={4} />
            </div>
          </div>
          <DialogFooter>
            <Button className="cursor-pointer" disabled={!form.bankName.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {form.id ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}

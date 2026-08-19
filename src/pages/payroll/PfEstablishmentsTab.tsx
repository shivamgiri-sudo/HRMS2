/**
 * PfEstablishmentsTab — admin CRUD for pf_establishment_master.
 *
 * This table ships empty (backend/sql/370_pf_creation_automation.sql is DDL
 * only, 0 rows in production). It has no seeded/placeholder row and this
 * screen does not create one on its own — it exists so Finance/Payroll can
 * enter the organisation's real EPFO establishment code once they have it.
 * Until someone submits the form below, the table stays empty and the ECR
 * download tab keeps showing "No establishments configured", exactly as
 * before.
 *
 * Feeds the same read path EcrDownloadTab.tsx already calls
 * (GET /api/payroll/pf/establishments -> pfCreationService.getEstablishments()),
 * so once a row is added here it appears there with no further changes.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { useBranches } from "@/hooks/useOrgMasters";
import { Building2, Loader2, Pencil, Plus, Power, Info } from "lucide-react";

interface Establishment {
  id: string;
  establishment_code: string;
  establishment_name: string;
  branch_id: string | null;
  branch_name: string | null;
  legal_entity: string | null;
  address: string | null;
  region_office: string | null;
  active_status: number;
  created_at: string;
  updated_at: string;
}

interface EstablishmentsResponse {
  success: boolean;
  data: Establishment[];
}

const EMPTY_FORM = {
  establishment_code: "",
  establishment_name: "",
  branch_id: "",
  legal_entity: "",
  address: "",
  region_office: "",
};

export default function PfEstablishmentsTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Establishment | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: branchesData } = useBranches();
  const branches = branchesData ?? [];

  const { data, isLoading, error } = useQuery<EstablishmentsResponse>({
    queryKey: ["pf-establishments-all"],
    queryFn: () => hrmsApi.get<EstablishmentsResponse>("/api/payroll/pf/establishments/all"),
  });
  const establishments = data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (est: Establishment) => {
    setEditing(est);
    setForm({
      establishment_code: est.establishment_code,
      establishment_name: est.establishment_name,
      branch_id: est.branch_id ?? "",
      legal_entity: est.legal_entity ?? "",
      address: est.address ?? "",
      region_office: est.region_office ?? "",
    });
    setDialogOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pf-establishments-all"] });
    // Also refresh the ECR tab's dropdown so a newly added/edited establishment
    // shows up there immediately without a full page reload.
    queryClient.invalidateQueries({ queryKey: ["pf-establishments"] });
  };

  const handleSave = async () => {
    if (!form.establishment_code.trim() || !form.establishment_name.trim()) {
      toast.error("Establishment code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        establishment_code: form.establishment_code.trim(),
        establishment_name: form.establishment_name.trim(),
        branch_id: form.branch_id || null,
        legal_entity: form.legal_entity.trim() || null,
        address: form.address.trim() || null,
        region_office: form.region_office.trim() || null,
      };
      if (editing) {
        await hrmsApi.put(`/api/payroll/pf/establishments/${editing.id}`, payload);
        toast.success("Establishment updated.");
      } else {
        await hrmsApi.post("/api/payroll/pf/establishments", payload);
        toast.success("Establishment created.");
      }
      setDialogOpen(false);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Unable to save establishment.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (est: Establishment) => {
    setTogglingId(est.id);
    try {
      const nextStatus = est.active_status === 1 ? 0 : 1;
      await hrmsApi.patch(`/api/payroll/pf/establishments/${est.id}/status`, { active_status: nextStatus });
      toast.success(nextStatus === 1 ? "Establishment activated." : "Establishment deactivated.");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Unable to change establishment status.");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">PF / EPFO Establishment Configuration</p>
          <p className="mt-0.5 text-blue-700">
            Add the organisation's real EPFO establishment code(s) here — obtained from Finance /
            the EPFO registration certificate. This is required before the ECR Download tab can
            generate a file; nothing is pre-filled or invented for you.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Establishments</h3>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Establishment
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-xl border bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(error as Error).message || "Unable to load establishments."}
        </div>
      ) : establishments.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          No establishments configured yet. Click "Add Establishment" once Finance shares the
          real EPFO establishment code.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Branch</th>
                <th className="px-4 py-2.5">Region Office</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {establishments.map((est) => (
                <tr key={est.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs">{est.establishment_code}</td>
                  <td className="px-4 py-2.5">{est.establishment_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{est.branch_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{est.region_office ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={est.active_status === 1
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-100 text-slate-500"}
                    >
                      {est.active_status === 1 ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => openEdit(est)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        disabled={togglingId === est.id}
                        onClick={() => toggleActive(est)}
                      >
                        {togglingId === est.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Power className="h-3.5 w-3.5" />}
                        {est.active_status === 1 ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Establishment" : "Add PF Establishment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Establishment Code <span className="text-red-500">*</span></Label>
                <Input
                  value={form.establishment_code}
                  onChange={(e) => setForm((f) => ({ ...f, establishment_code: e.target.value }))}
                  placeholder="e.g. MH/12345"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Region Office</Label>
                <Input
                  value={form.region_office}
                  onChange={(e) => setForm((f) => ({ ...f, region_office: e.target.value }))}
                  placeholder="e.g. Mumbai"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Establishment Name <span className="text-red-500">*</span></Label>
              <Input
                value={form.establishment_name}
                onChange={(e) => setForm((f) => ({ ...f, establishment_name: e.target.value }))}
                placeholder="Legal establishment name as registered with EPFO"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Legal Entity</Label>
              <Input
                value={form.legal_entity}
                onChange={(e) => setForm((f) => ({ ...f, legal_entity: e.target.value }))}
                placeholder="Registered company/entity name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Branch (optional)</Label>
              <Select
                value={form.branch_id || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name ?? b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Registered Address</Label>
              <Textarea
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                rows={3}
                placeholder="Address on the EPFO registration certificate"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Create Establishment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

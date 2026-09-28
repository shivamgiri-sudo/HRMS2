/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const VENDOR_TYPES = ["supplier", "service", "contractor", "other"] as const;
const PAYMENT_TERMS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "Immediate", "Advance", "Custom"] as const;

interface VendorFormState {
  vendor_name: string;
  vendor_type: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  gst_number: string;
  pan_number: string;
  payment_terms: string;
}

const EMPTY_FORM: VendorFormState = {
  vendor_name: "", vendor_type: "supplier", contact_name: "", contact_email: "",
  contact_phone: "", address: "", gst_number: "", pan_number: "", payment_terms: "",
};

interface MyRequest {
  id: string; request_type: "create" | "update"; payload: Record<string, any>;
  status: "pending" | "approved" | "rejected"; raised_at: string;
  reviewed_at?: string | null; review_notes?: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

/**
 * Lets a Branch Admin (or anyone else in the backend's RAISE_ROLES — see
 * vendor-approval.routes.ts) submit a new-vendor request without direct access to
 * /vendors. The request sits pending until a Finance Head approves it (vendor-approval.service.ts
 * writes the vendor row only on approval) or rejects it with a reason.
 */
export function RaiseVendorRequestTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-approval-my-requests"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/vendor-approval/my-requests");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as MyRequest[];
    },
  });
  const requests = data ?? [];

  const raiseMutation = useMutation({
    mutationFn: (payload: VendorFormState) =>
      hrmsApi.post("/api/finance/vendor-approval/raise", { requestType: "create", payload }),
    onSuccess: () => {
      toast.success("Vendor request sent to Finance Head for approval");
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["vendor-approval-my-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not raise the request"),
  });

  function setField<K extends keyof VendorFormState>(field: K, value: VendorFormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function submit() {
    if (!form.vendor_name.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    raiseMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <div className="rounded border bg-white p-4">
        <p className="text-sm font-semibold text-slate-700 mb-3">Raise a new vendor request</p>
        <p className="text-xs text-slate-500 mb-4">
          This does not create the vendor directly — it goes to a Finance Head for review and
          approval first.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[11px]">Vendor Name *</Label>
            <Input
              className="h-8 text-sm mt-1"
              value={form.vendor_name}
              onChange={(e) => setField("vendor_name", e.target.value)}
              placeholder="e.g. Acme Supplies Pvt Ltd"
            />
          </div>
          <div>
            <Label className="text-[11px]">Vendor Type</Label>
            <Select value={form.vendor_type} onValueChange={(v) => setField("vendor_type", v)}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VENDOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Payment Terms</Label>
            <Select value={form.payment_terms} onValueChange={(v) => setField("payment_terms", v)}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Contact Name</Label>
            <Input className="h-8 text-sm mt-1" value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Contact Email</Label>
            <Input className="h-8 text-sm mt-1" type="email" value={form.contact_email} onChange={(e) => setField("contact_email", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Contact Phone</Label>
            <Input className="h-8 text-sm mt-1" value={form.contact_phone} onChange={(e) => setField("contact_phone", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">GST Number</Label>
            <Input className="h-8 text-sm mt-1" value={form.gst_number} onChange={(e) => setField("gst_number", e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label className="text-[11px]">PAN Number</Label>
            <Input className="h-8 text-sm mt-1" value={form.pan_number} onChange={(e) => setField("pan_number", e.target.value.toUpperCase())} />
          </div>
          <div className="col-span-3">
            <Label className="text-[11px]">Address</Label>
            <Input className="h-8 text-sm mt-1" value={form.address} onChange={(e) => setField("address", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={raiseMutation.isPending}
            onClick={submit}
          >
            {raiseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send for Approval
          </Button>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">My requests</p>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : requests.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-400">You haven't raised any vendor requests yet.</div>
        ) : (
          <div className="rounded border bg-white overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_100px_1fr] gap-0 border-b bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {["Vendor Name", "Raised At", "Status", "Review Notes"].map((col) => (
                <div key={col} className="px-3 py-2">{col}</div>
              ))}
            </div>
            {requests.map((req) => (
              <div key={req.id} className="grid grid-cols-[1fr_120px_100px_1fr] gap-0 border-b text-sm">
                <div className="px-3 py-2.5 font-medium text-slate-800">{req.payload?.vendor_name ?? "—"}</div>
                <div className="px-3 py-2.5 text-xs text-slate-500">
                  {req.raised_at ? format(new Date(req.raised_at), "dd MMM yy") : "—"}
                </div>
                <div className="px-3 py-2.5">
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[req.status] ?? ""}`}>{req.status}</Badge>
                </div>
                <div className="px-3 py-2.5 text-xs text-slate-600">{req.review_notes ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

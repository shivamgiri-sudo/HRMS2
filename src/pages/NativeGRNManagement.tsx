/**
 * GRN Management — two tabs:
 *  1. Create / Edit Draft GRN
 *  2. Approval Queue (submit / approve / reject / cancel)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FilePlus,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPENSE_HEADS = [
  "Rent", "Salaries & Wages", "Utilities", "Office Supplies", "Travel & Conveyance",
  "Marketing & Advertising", "IT & Software", "Repairs & Maintenance", "Training",
  "Miscellaneous",
];

const PAYMENT_TERMS_OPTIONS = [7, 15, 30, 45, 60, 90];

const STATUS_CHIP: Record<string, string> = {
  draft:     "bg-slate-50 text-slate-600 border-slate-200",
  submitted: "bg-amber-50 text-amber-700 border-amber-200",
  approved:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected:  "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-400 border-slate-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`rounded-full text-[10px] font-semibold capitalize ${STATUS_CHIP[status] ?? ""}`}>
      {status}
    </Badge>
  );
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TH({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">{children}</th>;
}
function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-xs text-slate-700 border-b border-slate-100 align-top ${className ?? ""}`}>{children}</td>;
}

// ── GRN Form (Create / Submit) ─────────────────────────────────────────────────

interface GrnFormState {
  grnType: "vendor" | "imprest";
  branchId: string;
  vendorId: string;
  vendorName: string;
  head: string;
  subHead: string;
  amount: string;
  billDate: string;
  paymentTermsDays: string;
  remarks: string;
  financialYear: string;
}

const EMPTY_FORM: GrnFormState = {
  grnType: "vendor",
  branchId: "",
  vendorId: "",
  vendorName: "",
  head: "",
  subHead: "",
  amount: "",
  billDate: "",
  paymentTermsDays: "30",
  remarks: "",
  financialYear: getCurrentFinancialYear(),
};

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

function CreateGrnTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdGrnNumber, setCreatedGrnNumber] = useState<string | null>(null);

  const { data: branchData } = useQuery({
    queryKey: ["branches-list"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const branches: any[] = branchData?.data ?? branchData ?? [];

  const { data: vendorData } = useQuery({
    queryKey: ["vendors-list"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });
  const vendors: any[] = vendorData?.data ?? vendorData ?? [];

  const set = (k: keyof GrnFormState) => (v: string) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.branchId) throw new Error("Branch is required");
      if (!form.head) throw new Error("Expense head is required");
      if (!form.amount || isNaN(Number(form.amount))) throw new Error("Valid amount is required");

      const payload = {
        grnType: form.grnType,
        branchId: form.branchId,
        vendorId: form.vendorId || undefined,
        vendorName: form.vendorName || undefined,
        head: form.head,
        subHead: form.subHead || undefined,
        amount: Number(form.amount),
        billDate: form.billDate || undefined,
        paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
        remarks: form.remarks || undefined,
        financialYear: form.financialYear,
      };
      const result = await hrmsApi.post<{ id: string; grnNumber: string }>("/api/finance/grns", payload);

      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await hrmsApi.postForm(`/api/finance/grns/${result.id}/attachment`, fd);
      }
      return result;
    },
    onSuccess: (data) => {
      toast({ title: `GRN created: ${data.grnNumber}` });
      setCreatedId(data.id);
      setCreatedGrnNumber(data.grnNumber);
      setForm(EMPTY_FORM);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "GRN submitted for approval" });
      setCreatedId(null);
      setCreatedGrnNumber(null);
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-2xl">
      <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-5">
        <FilePlus className="size-4 text-[#073f78]" /> Create New GRN
      </h2>

      {createdId && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>GRN <strong>{createdGrnNumber}</strong> created as draft.</span>
          <Button
            size="sm"
            className="ml-auto bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
            onClick={() => submitMutation.mutate(createdId)}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
            Submit for Approval
          </Button>
          <button onClick={() => { setCreatedId(null); setCreatedGrnNumber(null); }} className="text-emerald-600 hover:text-emerald-800">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* GRN Type */}
        <div>
          <Label className="text-xs">GRN Type <span className="text-rose-500">*</span></Label>
          <Select value={form.grnType} onValueChange={set("grnType")}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vendor">Vendor GRN</SelectItem>
              <SelectItem value="imprest">Imprest GRN</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Financial Year */}
        <div>
          <Label className="text-xs">Financial Year <span className="text-rose-500">*</span></Label>
          <Input className="h-8 text-xs mt-1" value={form.financialYear} onChange={e => set("financialYear")(e.target.value)} placeholder="e.g. 2526" />
        </div>

        {/* Branch */}
        <div>
          <Label className="text-xs">Branch <span className="text-rose-500">*</span></Label>
          <Select value={form.branchId} onValueChange={set("branchId")}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name ?? b.branch_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Vendor */}
        {form.grnType === "vendor" ? (
          <div>
            <Label className="text-xs">Vendor</Label>
            <Select value={form.vendorId} onValueChange={v => { set("vendorId")(v); const vendor = vendors.find((x: any) => x.id === v); if (vendor) set("vendorName")(vendor.vendor_name ?? vendor.name ?? ""); }}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>{v.vendor_name ?? v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="h-7 text-xs mt-1.5" value={form.vendorName} onChange={e => set("vendorName")(e.target.value)} placeholder="Or type vendor name manually" />
          </div>
        ) : (
          <div>
            <Label className="text-xs">Imprest Holder / Purpose</Label>
            <Input className="h-8 text-xs mt-1" value={form.vendorName} onChange={e => set("vendorName")(e.target.value)} placeholder="Name / purpose" />
          </div>
        )}

        {/* Head */}
        <div>
          <Label className="text-xs">Expense Head <span className="text-rose-500">*</span></Label>
          <Select value={form.head} onValueChange={set("head")}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select head" /></SelectTrigger>
            <SelectContent>
              {EXPENSE_HEADS.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Sub Head */}
        <div>
          <Label className="text-xs">Sub Head</Label>
          <Input className="h-8 text-xs mt-1" value={form.subHead} onChange={e => set("subHead")(e.target.value)} placeholder="Optional sub-category" />
        </div>

        {/* Amount */}
        <div>
          <Label className="text-xs">Amount (₹) <span className="text-rose-500">*</span></Label>
          <Input type="number" step="0.01" className="h-8 text-xs mt-1" value={form.amount} onChange={e => set("amount")(e.target.value)} placeholder="0.00" />
        </div>

        {/* Bill Date */}
        <div>
          <Label className="text-xs">Bill / Invoice Date</Label>
          <Input type="date" className="h-8 text-xs mt-1" value={form.billDate} onChange={e => set("billDate")(e.target.value)} />
        </div>

        {/* Payment Terms */}
        {form.grnType === "vendor" && (
          <div>
            <Label className="text-xs">Payment Terms (days)</Label>
            <Select value={form.paymentTermsDays} onValueChange={set("paymentTermsDays")}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS_OPTIONS.map(d => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
                <SelectItem value="0">Immediate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Attachment */}
        <div>
          <Label className="text-xs">Invoice / Bill Attachment</Label>
          <label className="mt-1 flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-2 text-xs text-slate-600 transition-colors">
            <Upload className="size-3.5 text-slate-400" />
            {file ? <span className="truncate max-w-[180px] text-slate-800">{file.name}</span> : "Upload PDF / Image"}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file && (
              <button type="button" onClick={e => { e.preventDefault(); setFile(null); }} className="ml-auto text-slate-400 hover:text-rose-500">
                <X className="size-3" />
              </button>
            )}
          </label>
        </div>

        {/* Remarks — full width */}
        <div className="sm:col-span-2">
          <Label className="text-xs">Remarks</Label>
          <Textarea className="mt-1 text-xs min-h-[60px]" value={form.remarks} onChange={e => set("remarks")(e.target.value)} placeholder="Internal notes…" />
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <Button
          className="bg-[#073f78] hover:bg-[#052d57] text-white"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />}
          Save as Draft
        </Button>
        <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>Reset</Button>
      </div>
    </div>
  );
}

// ── Approval Queue Tab ─────────────────────────────────────────────────────────

function ApprovalQueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [grnTypeFilter, setGrnTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [reviewTarget, setReviewTarget] = useState<any | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["grn-list", statusFilter, grnTypeFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (grnTypeFilter) qs.set("grnType", grnTypeFilter);
      if (search) qs.set("search", search);
      qs.set("limit", "50");
      return hrmsApi.get<any>(`/api/finance/grns?${qs}`);
    },
  });
  const rows: any[] = data?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => { toast({ title: "GRN submitted" }); void qc.invalidateQueries({ queryKey: ["grn-list"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, reviewNote }: any) =>
      hrmsApi.post(`/api/finance/grns/${id}/review`, { decision, reviewNote }),
    onSuccess: (_, v) => {
      toast({ title: `GRN ${v.decision}` });
      setReviewTarget(null);
      setReviewNote("");
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/cancel`, {}),
    onSuccess: () => { toast({ title: "GRN cancelled" }); void qc.invalidateQueries({ queryKey: ["grn-list"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <ClipboardList className="size-4 text-[#073f78]" /> GRN Approval Queue
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="h-7 text-xs w-44"
            placeholder="Search GRN / vendor / head…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Select value={grnTypeFilter} onValueChange={setGrnTypeFilter}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All types</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
              <SelectItem value="imprest">Imprest</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["", "draft", "submitted", "approved", "rejected", "cancelled"].map(s => (
                <SelectItem key={s || "_all"} value={s}>{s || "All statuses"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["grn-list"] })}>
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-14 text-center text-slate-400 text-sm">
          <FileText className="size-8 mx-auto mb-2 opacity-30" />
          No GRNs for selected filters
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{["GRN No.", "Type", "Branch", "Vendor / Holder", "Head", "Amount", "Bill Date", "Due Date", "FY", "Status", "Actions"].map(h => <TH key={h}>{h}</TH>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <TD className="font-mono font-semibold text-[#073f78] whitespace-nowrap">{r.grn_number}</TD>
                  <TD>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.grn_type}</Badge>
                  </TD>
                  <TD>{r.branch_name ?? r.branch_id}</TD>
                  <TD className="max-w-[120px] truncate">{r.vendor_name ?? "—"}</TD>
                  <TD>{r.head}</TD>
                  <TD className="text-right font-mono font-semibold">₹{fmt(r.amount)}</TD>
                  <TD>{fmtDate(r.bill_date)}</TD>
                  <TD>{fmtDate(r.due_date)}</TD>
                  <TD className="font-mono">{r.financial_year}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD>
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] text-blue-700 border-blue-200 hover:bg-blue-50"
                          onClick={() => submitMutation.mutate(r.id)}
                          disabled={submitMutation.isPending}
                        >
                          <Send className="size-2.5 mr-1" /> Submit
                        </Button>
                      )}
                      {r.status === "submitted" && (
                        <Button
                          size="sm"
                          className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => { setReviewTarget(r); setReviewDecision("approved"); setReviewNote(""); }}
                        >
                          Review
                        </Button>
                      )}
                      {r.attachment_path && (
                        <button
                          onClick={() => window.open(`/api/finance/grns/${r.id}/attachment`, "_blank")}
                          className="text-blue-600 hover:text-blue-800 p-1 rounded"
                        >
                          <FileText className="size-3.5" />
                        </button>
                      )}
                      {["draft", "submitted"].includes(r.status) && (
                        <button
                          onClick={() => { if (confirm("Cancel this GRN?")) cancelMutation.mutate(r.id); }}
                          className="text-slate-400 hover:text-rose-500 p-1 rounded"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={v => !v && setReviewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Review GRN — {reviewTarget?.grn_number}
            </DialogTitle>
          </DialogHeader>
          {reviewTarget && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 border border-slate-200 text-sm">
                <div><p className="text-xs text-slate-500">Vendor / Holder</p><p className="font-medium">{reviewTarget.vendor_name ?? "—"}</p></div>
                <div><p className="text-xs text-slate-500">Head</p><p>{reviewTarget.head}</p></div>
                <div><p className="text-xs text-slate-500">Amount</p><p className="font-semibold text-[#073f78]">₹{fmt(reviewTarget.amount)}</p></div>
                <div><p className="text-xs text-slate-500">Due Date</p><p>{fmtDate(reviewTarget.due_date)}</p></div>
              </div>
              <div>
                <Label className="text-xs">Decision</Label>
                <Select value={reviewDecision} onValueChange={(v: any) => setReviewDecision(v)}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Review Note (optional)</Label>
                <Textarea className="mt-1 text-xs min-h-[60px]" value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Notes for the record…" />
              </div>
              {reviewDecision === "approved" && reviewTarget.grn_type === "vendor" && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
                  Approving this vendor GRN will automatically create a payment tracking entry in Vendor Payment Tracking.
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              className={reviewDecision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
              onClick={() => reviewMutation.mutate({ id: reviewTarget.id, decision: reviewDecision, reviewNote })}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              {reviewDecision === "approved" ? "Approve GRN" : "Reject GRN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

export default function NativeGRNManagement() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 shadow-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f2fc] text-[#073f78]">
            <FilePlus className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">GRN Management</h1>
            <p className="text-xs text-slate-500">Goods Receipt Notes — create, submit and approve vendor / imprest GRNs</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs defaultValue="create">
          <TabsList className="grid grid-cols-2 h-auto mb-6 bg-white border border-slate-200 rounded-xl p-1 gap-1 w-fit">
            <TabsTrigger value="create"  className="text-[11px] rounded-lg py-2 px-5 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">
              <FilePlus className="size-3.5 mr-1.5" /> Create GRN
            </TabsTrigger>
            <TabsTrigger value="queue"   className="text-[11px] rounded-lg py-2 px-5 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">
              <ClipboardList className="size-3.5 mr-1.5" /> Approval Queue
            </TabsTrigger>
          </TabsList>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <TabsContent value="create"><CreateGrnTab /></TabsContent>
            <TabsContent value="queue"><ApprovalQueueTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * GRN Management — two tabs:
 *  1. Create / Edit Draft GRN
 *  2. Approval Queue (submit / approve / reject / cancel)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  FilePlus,
  FileText,
  IndianRupee,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
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
  "Rent",
  "Salaries & Wages",
  "Utilities",
  "Office Supplies",
  "Travel & Conveyance",
  "Marketing & Advertising",
  "IT & Software",
  "Repairs & Maintenance",
  "Training",
  "Miscellaneous",
];

const SUB_HEAD_MAP: Record<string, string[]> = {
  Rent: ["Head Office Rent", "Branch Rent", "Warehouse Rent", "Guest House Rent"],
  "Salaries & Wages": ["Regular Staff", "Contract Staff", "Overtime", "Incentives & Bonuses"],
  Utilities: ["Electricity", "Water", "Internet & Broadband", "Telephone / Mobile"],
  "Office Supplies": ["Stationery", "Printing & Cartridges", "Furniture", "Equipment"],
  "Travel & Conveyance": [
    "Local Conveyance",
    "Outstation Travel",
    "Fuel",
    "Cab / Auto",
    "Air Travel",
    "Hotel",
  ],
  "Marketing & Advertising": [
    "Digital Marketing",
    "Print Media",
    "Events & Sponsorship",
    "Branding",
  ],
  "IT & Software": ["Software Licenses", "Hardware", "Cloud Services", "IT Support & AMC"],
  "Repairs & Maintenance": [
    "Building Maintenance",
    "Equipment Maintenance",
    "Vehicle Maintenance",
    "AMC Contracts",
  ],
  Training: ["Internal Training", "External Training", "Online Courses", "Workshop / Seminar"],
  Miscellaneous: [
    "Bank Charges",
    "Professional Fees",
    "Legal Expenses",
    "Audit Fees",
    "Other",
  ],
};

const PAYMENT_TERMS_OPTIONS = [7, 15, 30, 45, 60, 90];

const STATUS_CONFIG: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  draft: {
    dot: "bg-slate-400",
    badge: "bg-slate-50 text-slate-600 border-slate-200",
    label: "Draft",
  },
  submitted: {
    dot: "bg-amber-400",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Submitted",
  },
  approved: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Approved",
  },
  rejected: {
    dot: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Rejected",
  },
  cancelled: {
    dot: "bg-slate-300",
    badge: "bg-slate-100 text-slate-400 border-slate-200",
    label: "Cancelled",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cfg.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

// ── Sub Head Field ─────────────────────────────────────────────────────────────

interface SubHeadFieldProps {
  head: string;
  value: string;
  onChange: (v: string) => void;
}

function SubHeadField({ head, value, onChange }: SubHeadFieldProps) {
  const options = head ? (SUB_HEAD_MAP[head] ?? []) : [];
  const [showCustom, setShowCustom] = useState(false);

  if (!head || options.length === 0) {
    return (
      <Input
        className="h-9 text-sm mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional sub-category"
      />
    );
  }

  if (showCustom) {
    return (
      <div className="mt-1 flex gap-2">
        <Input
          className="h-9 text-sm flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type custom sub-head…"
          autoFocus
        />
        <Button
          type="button"
          variant="outline"
          className="h-9 px-3 text-xs"
          onClick={() => {
            setShowCustom(false);
            onChange("");
          }}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    );
  }

  const selectedIsCustom = value && !options.includes(value);

  return (
    <Select
      value={selectedIsCustom ? "_other" : value || "_none"}
      onValueChange={(v) => {
        if (v === "_other") {
          setShowCustom(true);
          onChange("");
        } else if (v === "_none") {
          onChange("");
        } else {
          onChange(v);
        }
      }}
    >
      <SelectTrigger className="h-9 text-sm mt-1">
        <SelectValue placeholder="Select sub-head" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_none">— Select sub-head —</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
        <SelectItem value="_other">Other (specify)</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Section Divider ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 flex items-center gap-3 pt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#073f78]">
        {children}
      </span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

// ── Form Field Wrapper ─────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
  span2,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : "col-span-1"}>
      <Label className="text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500"> *</span>}
      </Label>
      {children}
    </div>
  );
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
    setForm((prev) => ({ ...prev, [k]: v }));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.branchId) throw new Error("Branch is required");
      if (!form.head) throw new Error("Expense head is required");
      if (!form.amount || isNaN(Number(form.amount)))
        throw new Error("Valid amount is required");

      const payload = {
        grnType: form.grnType,
        branchId: form.branchId,
        vendorId: form.vendorId || undefined,
        vendorName: form.vendorName || undefined,
        head: form.head,
        subHead: form.subHead || undefined,
        amount: Number(form.amount),
        billDate: form.billDate || undefined,
        paymentTermsDays: form.paymentTermsDays
          ? Number(form.paymentTermsDays)
          : undefined,
        remarks: form.remarks || undefined,
        financialYear: form.financialYear,
      };
      const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
        "/api/finance/grns",
        payload
      );

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
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "GRN submitted for approval" });
      setCreatedId(null);
      setCreatedGrnNumber(null);
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto">
      {/* Success banner */}
      {createdId && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              GRN <span className="font-mono">{createdGrnNumber}</span> saved as draft
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Submit for approval to proceed with payment processing.
            </p>
          </div>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4 text-sm font-medium gap-1.5 shadow-sm"
            onClick={() => submitMutation.mutate(createdId)}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Submit for Approval
          </Button>
          <button
            onClick={() => {
              setCreatedId(null);
              setCreatedGrnNumber(null);
            }}
            className="rounded-full p-1 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Form card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-[#073f78]/5 to-transparent px-6 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-[#073f78]/10">
            <FilePlus className="size-4.5 text-[#073f78]" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Create New GRN</h2>
            <p className="text-xs text-slate-500">
              Fill in all required fields to create a Goods Receipt Note
            </p>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {/* ── Section: GRN Details ── */}
            <SectionLabel>GRN Details</SectionLabel>

            <Field label="GRN Type" required>
              <Select value={form.grnType} onValueChange={set("grnType")}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">Vendor GRN</SelectItem>
                  <SelectItem value="imprest">Imprest GRN</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Financial Year" required>
              <Input
                className="h-9 text-sm mt-1"
                value={form.financialYear}
                onChange={(e) => set("financialYear")(e.target.value)}
                placeholder="e.g. 2025-26"
              />
            </Field>

            {/* ── Section: Party Details ── */}
            <SectionLabel>Party Details</SectionLabel>

            <Field label="Branch" required>
              <Select value={form.branchId} onValueChange={set("branchId")}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name ?? b.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {form.grnType === "vendor" ? (
              <Field label="Vendor">
                <Select
                  value={form.vendorId || "_none"}
                  onValueChange={(v) => {
                    if (v === "_none") {
                      set("vendorId")("");
                      return;
                    }
                    set("vendorId")(v);
                    const vendor = vendors.find((x: any) => x.id === v);
                    if (vendor)
                      set("vendorName")(vendor.vendor_name ?? vendor.name ?? "");
                  }}
                >
                  <SelectTrigger className="h-9 text-sm mt-1">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Select vendor —</SelectItem>
                    {vendors.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.vendor_name ?? v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-9 text-sm mt-2"
                  value={form.vendorName}
                  onChange={(e) => set("vendorName")(e.target.value)}
                  placeholder="Or type vendor name manually"
                />
              </Field>
            ) : (
              <Field label="Imprest Holder / Purpose">
                <Input
                  className="h-9 text-sm mt-1"
                  value={form.vendorName}
                  onChange={(e) => set("vendorName")(e.target.value)}
                  placeholder="Name / purpose"
                />
              </Field>
            )}

            {/* ── Section: Expense Classification ── */}
            <SectionLabel>Expense Classification</SectionLabel>

            <Field label="Expense Head" required>
              <Select
                value={form.head || "_none"}
                onValueChange={(v) => {
                  if (v === "_none") {
                    set("head")("");
                    set("subHead")("");
                  } else {
                    set("head")(v);
                    set("subHead")("");
                  }
                }}
              >
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder="Select expense head" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select head —</SelectItem>
                  {EXPENSE_HEADS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Sub Head">
              <SubHeadField
                head={form.head}
                value={form.subHead}
                onChange={set("subHead")}
              />
            </Field>

            {/* ── Section: Amount & Dates ── */}
            <SectionLabel>Amount &amp; Dates</SectionLabel>

            <Field label="Amount (₹)" required>
              <div className="relative mt-1">
                <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="number"
                  step="0.01"
                  className="h-9 pl-7 text-sm"
                  value={form.amount}
                  onChange={(e) => set("amount")(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </Field>

            <Field label="Bill / Invoice Date">
              <Input
                type="date"
                className="h-9 text-sm mt-1"
                value={form.billDate}
                onChange={(e) => set("billDate")(e.target.value)}
              />
            </Field>

            {/* ── Payment Terms & Attachment ── */}
            {form.grnType === "vendor" && (
              <Field label="Payment Terms">
                <Select
                  value={form.paymentTermsDays}
                  onValueChange={set("paymentTermsDays")}
                >
                  <SelectTrigger className="h-9 text-sm mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Immediate</SelectItem>
                    {PAYMENT_TERMS_OPTIONS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Invoice / Bill Attachment">
              <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:border-[#073f78]/30">
                <Upload className="size-4 shrink-0 text-slate-400" />
                {file ? (
                  <span className="truncate max-w-[180px] text-slate-800 text-xs font-medium">
                    {file.name}
                  </span>
                ) : (
                  <span className="text-xs">
                    Upload PDF / Image{" "}
                    <span className="text-slate-400">(optional)</span>
                  </span>
                )}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFile(null);
                    }}
                    className="ml-auto rounded-full p-0.5 text-slate-400 hover:text-rose-500 transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
            </Field>

            {/* ── Remarks ── */}
            <SectionLabel>Notes</SectionLabel>
            <Field label="Remarks" span2>
              <Textarea
                className="mt-1 text-sm min-h-[72px] resize-none"
                value={form.remarks}
                onChange={(e) => set("remarks")(e.target.value)}
                placeholder="Internal notes or additional context…"
              />
            </Field>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <Button
            variant="outline"
            className="h-9 gap-2 text-slate-600 border-slate-200 hover:bg-slate-100"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFile(null);
            }}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
          <Button
            className="h-9 bg-[#073f78] hover:bg-[#052d57] text-white gap-2 px-6 shadow-sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Save as Draft
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Approval Queue Tab ─────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "_all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function ApprovalQueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [grnTypeFilter, setGrnTypeFilter] = useState("_all");
  const [search, setSearch] = useState("");
  const [reviewTarget, setReviewTarget] = useState<any | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">(
    "approved"
  );
  const [reviewNote, setReviewNote] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["grn-list", statusFilter, grnTypeFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (statusFilter !== "_all") qs.set("status", statusFilter);
      if (grnTypeFilter !== "_all") qs.set("grnType", grnTypeFilter);
      if (search) qs.set("search", search);
      qs.set("limit", "50");
      return hrmsApi.get<any>(`/api/finance/grns?${qs}`);
    },
  });
  const rows: any[] = data?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "GRN submitted" });
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
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
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/grns/${id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "GRN cancelled" });
      void qc.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">GRN Approval Queue</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review, submit, approve or reject GRN entries
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 pl-8 text-sm w-52"
              placeholder="Search GRN / vendor / head…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Type filter */}
          <Select value={grnTypeFilter} onValueChange={setGrnTypeFilter}>
            <SelectTrigger className="h-9 text-sm w-32">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All types</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
              <SelectItem value="imprest">Imprest</SelectItem>
            </SelectContent>
          </Select>
          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 border-slate-200"
            onClick={() => qc.invalidateQueries({ queryKey: ["grn-list"] })}
          >
            <RefreshCw
              className={`size-4 text-slate-500 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Status pill tabs */}
      <div className="mb-4 flex items-center gap-1 flex-wrap">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          const cfg =
            tab.value !== "_all" ? STATUS_CONFIG[tab.value] : null;
          return (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                active
                  ? "bg-[#073f78] border-[#073f78] text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              {cfg && !active && (
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              )}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 shadow-sm">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
            <FileText className="size-6 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">No GRNs found</p>
          <p className="text-xs text-slate-400 mt-1">
            Try adjusting your filters or create a new GRN
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-[#073f78]">
                {[
                  "GRN No.",
                  "Type",
                  "Branch",
                  "Vendor / Holder",
                  "Head",
                  "Amount (₹)",
                  "Bill Date",
                  "Due Date",
                  "FY",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[11px] font-semibold text-white/90 whitespace-nowrap first:rounded-tl-2xl last:rounded-tr-2xl"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-50">
              {rows.map((r: any) => (
                <tr
                  key={r.id}
                  className="group hover:bg-slate-50/70 transition-colors"
                >
                  <td className="px-4 py-3 text-xs font-mono font-bold text-[#073f78] whitespace-nowrap border-b border-slate-100">
                    {r.grn_number}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${
                        r.grn_type === "vendor"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-purple-50 text-purple-700 border-purple-200"
                      }`}
                    >
                      {r.grn_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 border-b border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="size-3 text-slate-400 shrink-0" />
                      {r.branch_name ?? r.branch_id}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 border-b border-slate-100 max-w-[140px]">
                    <span className="truncate block">{r.vendor_name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 border-b border-slate-100">
                    {r.head}
                    {r.sub_head && (
                      <span className="block text-[10px] text-slate-400">
                        {r.sub_head}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-slate-900 text-right border-b border-slate-100">
                    {fmt(r.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 border-b border-slate-100 whitespace-nowrap">
                    {fmtDate(r.bill_date)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 border-b border-slate-100 whitespace-nowrap">
                    {fmtDate(r.due_date)}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-600 border-b border-slate-100">
                    {r.financial_year}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-1">
                      {r.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] text-blue-700 border-blue-200 hover:bg-blue-50 hover:border-blue-300 gap-1"
                          onClick={() => submitMutation.mutate(r.id)}
                          disabled={submitMutation.isPending}
                        >
                          <Send className="size-3" /> Submit
                        </Button>
                      )}
                      {r.status === "submitted" && (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                          onClick={() => {
                            setReviewTarget(r);
                            setReviewDecision("approved");
                            setReviewNote("");
                          }}
                        >
                          <Eye className="size-3" /> Review
                        </Button>
                      )}
                      {r.attachment_path && (
                        <button
                          onClick={() =>
                            window.open(
                              `/api/finance/grns/${r.id}/attachment`,
                              "_blank"
                            )
                          }
                          className="flex size-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition-colors"
                          title="View attachment"
                        >
                          <FileText className="size-3.5" />
                        </button>
                      )}
                      {["draft", "submitted"].includes(r.status) && (
                        <button
                          onClick={() => {
                            if (confirm("Cancel this GRN?"))
                              cancelMutation.mutate(r.id);
                          }}
                          className="flex size-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 transition-colors"
                          title="Cancel GRN"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog
        open={!!reviewTarget}
        onOpenChange={(v) => !v && setReviewTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100">
                <ClipboardList className="size-4 text-emerald-700" />
              </div>
              Review GRN — {reviewTarget?.grn_number}
            </DialogTitle>
          </DialogHeader>

          {reviewTarget && (
            <div className="space-y-4">
              {/* GRN details grid */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  GRN Details
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      Vendor / Holder
                    </p>
                    <p className="text-sm font-medium text-slate-800">
                      {reviewTarget.vendor_name ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      GRN Type
                    </p>
                    <p className="text-sm font-medium capitalize text-slate-800">
                      {reviewTarget.grn_type}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      Expense Head
                    </p>
                    <p className="text-sm text-slate-800">{reviewTarget.head}</p>
                    {reviewTarget.sub_head && (
                      <p className="text-[11px] text-slate-500">
                        {reviewTarget.sub_head}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Amount</p>
                    <p className="text-base font-bold text-[#073f78]">
                      ₹{fmt(reviewTarget.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      Bill Date
                    </p>
                    <p className="text-sm text-slate-800">
                      {fmtDate(reviewTarget.bill_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      Due Date
                    </p>
                    <p className="text-sm text-slate-800">
                      {fmtDate(reviewTarget.due_date)}
                    </p>
                  </div>
                </div>
                {reviewTarget.remarks && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-[10px] text-slate-500 mb-0.5">Remarks</p>
                    <p className="text-xs text-slate-700">{reviewTarget.remarks}</p>
                  </div>
                )}
              </div>

              {/* Decision */}
              <div>
                <Label className="text-xs font-semibold text-slate-700">
                  Decision <span className="text-rose-500">*</span>
                </Label>
                <Select
                  value={reviewDecision}
                  onValueChange={(v: any) => setReviewDecision(v)}
                >
                  <SelectTrigger className="h-9 text-sm mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve GRN</SelectItem>
                    <SelectItem value="rejected">Reject GRN</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Review note */}
              <div>
                <Label className="text-xs font-semibold text-slate-700">
                  Review Note{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </Label>
                <Textarea
                  className="mt-1 text-sm min-h-[72px] resize-none"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Notes for the record…"
                />
              </div>

              {/* Info banner for vendor approval */}
              {reviewDecision === "approved" &&
                reviewTarget.grn_type === "vendor" && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                    <AlertCircle className="size-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-800">
                      Approving this vendor GRN will automatically create a
                      payment tracking entry in Vendor Payment Tracking.
                    </p>
                  </div>
                )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setReviewTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={`h-9 px-5 gap-1.5 ${
                reviewDecision === "approved"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-rose-600 hover:bg-rose-700 text-white"
              }`}
              onClick={() =>
                reviewMutation.mutate({
                  id: reviewTarget.id,
                  decision: reviewDecision,
                  reviewNote,
                })
              }
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : reviewDecision === "approved" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <XCircle className="size-4" />
              )}
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
      {/* Page header */}
      <div className="relative overflow-hidden border-b border-slate-200 bg-white shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #073f78 0, #073f78 1px, transparent 0, transparent 50%)",
            backgroundSize: "8px 8px",
          }}
        />
        <div className="relative px-6 py-5">
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-[11px] text-slate-400">
            <span>Finance</span>
            <ChevronRight className="size-3" />
            <span className="text-[#073f78] font-medium">GRN Management</span>
          </nav>
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-[#073f78] shadow-md shadow-[#073f78]/20">
              <FilePlus className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                GRN Management
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Create, submit and approve Goods Receipt Notes for vendor and
                imprest transactions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        <Tabs defaultValue="create">
          <TabsList className="mb-6 h-auto bg-white border border-slate-200 rounded-xl p-1 gap-1 w-fit shadow-sm">
            <TabsTrigger
              value="create"
              className="rounded-lg px-5 py-2 text-xs font-semibold text-slate-600 gap-1.5 data-[state=active]:bg-[#073f78] data-[state=active]:text-white data-[state=active]:shadow-sm transition-all"
            >
              <FilePlus className="size-3.5" /> Create GRN
            </TabsTrigger>
            <TabsTrigger
              value="queue"
              className="rounded-lg px-5 py-2 text-xs font-semibold text-slate-600 gap-1.5 data-[state=active]:bg-[#073f78] data-[state=active]:text-white data-[state=active]:shadow-sm transition-all"
            >
              <ClipboardList className="size-3.5" /> Approval Queue
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <CreateGrnTab />
          </TabsContent>
          <TabsContent value="queue">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
              <ApprovalQueueTab />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

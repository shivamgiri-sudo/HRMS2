import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BadgeIndianRupee,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  Filter,
  IndianRupee,
  Landmark,
  Percent,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface ClientInvoice {
  id: number;
  client_name: string;
  branch_name: string;
  cost_centre: string;
  invoice_month: string;
  finance_year: string;
  invoice_amount: number;
  db_bill_status: string;
  hrms_status: string;
  amount_received: number;
  payment_date: string | null;
  last_updated: string | null;
}

interface PaymentTrend {
  month: string;
  invoiced: number;
  received: number;
  pending: number;
  collection_rate: number;
}

interface SeatRate {
  branch: string;
  cost_centre: string;
  process_name?: string;
  client: string;
  service: string;
  particulars: string;
  seats: number;
  rate_per_seat: number;
  monthly_value: number;
}

interface ClientSummary {
  client_name: string;
  total_invoiced: number;
  total_received: number;
  pending: number;
  invoice_count: number;
  avg_collection_days: number;
}

const FINANCE_YEARS = ["2026-27", "2025-26", "2024-25"];
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "partial", label: "Partial", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "paid", label: "Paid", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "overdue", label: "Overdue", color: "bg-rose-100 text-rose-700 border-rose-200" },
  { value: "disputed", label: "Disputed", color: "bg-purple-100 text-purple-700 border-purple-200" },
];

function formatCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

function formatLakh(value: number) {
  return `₹${(value / 100000).toFixed(2)}L`;
}

function StatusBadge({ status }: { status: string }) {
  const config = PAYMENT_STATUSES.find((s) => s.value === status) ?? PAYMENT_STATUSES[0];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${config.color}`}>
      {status === "paid" && <CheckCircle2 className="h-3 w-3" />}
      {status === "pending" && <Clock className="h-3 w-3" />}
      {status === "partial" && <Percent className="h-3 w-3" />}
      {status === "overdue" && <AlertCircle className="h-3 w-3" />}
      {status === "disputed" && <XCircle className="h-3 w-3" />}
      {config.label}
    </span>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof IndianRupee;
  trend?: { value: number; label: string };
  color: string;
}) {
  return (
    <Card className="border-0 bg-gradient-to-br from-white to-slate-50/50 shadow-lg shadow-slate-200/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
            <p className="text-2xl font-black tracking-tight text-slate-900">{value}</p>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            {trend && (
              <div className="flex items-center gap-1 text-xs">
                <TrendingUp className={`h-3 w-3 ${trend.value >= 0 ? "text-emerald-500" : "text-rose-500"}`} />
                <span className={trend.value >= 0 ? "text-emerald-600" : "text-rose-600"}>
                  {trend.value >= 0 ? "+" : ""}{trend.value}%
                </span>
                <span className="text-slate-400">{trend.label}</span>
              </div>
            )}
          </div>
          <div className={`rounded-xl p-3 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentUpdateDialog({
  invoice,
  open,
  onOpenChange,
  onSubmit,
}: {
  invoice: ClientInvoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
}) {
  const [status, setStatus] = useState(invoice?.hrms_status ?? "pending");
  const [amount, setAmount] = useState(invoice?.amount_received?.toString() ?? "0");
  const [paymentDate, setPaymentDate] = useState(invoice?.payment_date ?? "");
  const [paymentMode, setPaymentMode] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [remarks, setRemarks] = useState("");

  const handleSubmit = () => {
    if (!invoice) return;
    onSubmit({
      invoice_ref_id: invoice.id,
      client_name: invoice.client_name,
      branch_name: invoice.branch_name,
      cost_centre: invoice.cost_centre,
      invoice_month: invoice.invoice_month,
      finance_year: invoice.finance_year,
      invoice_amount: invoice.invoice_amount,
      payment_status: status,
      amount_received: Number(amount),
      payment_date: paymentDate || null,
      payment_mode: paymentMode || null,
      transaction_ref: transactionRef || null,
      remarks: remarks || null,
    });
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-sky-500" />
            Update Payment Status
          </DialogTitle>
          <DialogDescription>
            Update payment details for invoice #{invoice.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-500">Client:</span>
                <span className="ml-2 font-medium">{invoice.client_name}</span>
              </div>
              <div>
                <span className="text-slate-500">Branch:</span>
                <span className="ml-2 font-medium">{invoice.branch_name}</span>
              </div>
              <div>
                <span className="text-slate-500">Month:</span>
                <span className="ml-2 font-medium">{invoice.invoice_month}</span>
              </div>
              <div>
                <span className="text-slate-500">Invoice Amount:</span>
                <span className="ml-2 font-bold text-emerald-600">
                  {formatCurrency(invoice.invoice_amount)}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount Received</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-9"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT</SelectItem>
                    <SelectItem value="RTGS">RTGS</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Transaction Reference</Label>
                <Input
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                  placeholder="UTR / Cheque No."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="bg-sky-500 hover:bg-sky-600">
            Update Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoicesTab() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    financeYear: "2026-27",
    month: "",
    clientName: "",
    branchName: "",
    page: 1,
  });
  const [selectedInvoice, setSelectedInvoice] = useState<ClientInvoice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["client-invoices", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.financeYear) params.set("financeYear", filters.financeYear);
      if (filters.month) params.set("month", filters.month);
      if (filters.clientName) params.set("clientName", filters.clientName);
      if (filters.branchName) params.set("branchName", filters.branchName);
      params.set("page", filters.page.toString());
      params.set("limit", "25");
      const res = await hrmsApi.get(`/api/finance/client-payments/invoices?${params}`);
      return res.data as {
        invoices: ClientInvoice[];
        total: number;
        summary: { totalInvoiced: number; totalReceived: number; totalPending: number };
      };
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await hrmsApi.post("/api/finance/client-payments/update", payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Payment status updated");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || "Failed to update payment");
    },
  });

  const invoices = data?.invoices ?? [];
  const summary = data?.summary ?? { totalInvoiced: 0, totalReceived: 0, totalPending: 0 };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          title="Total Invoiced"
          value={formatLakh(summary.totalInvoiced)}
          icon={FileText}
          color="bg-sky-100 text-sky-600"
        />
        <KpiCard
          title="Received"
          value={formatLakh(summary.totalReceived)}
          icon={CheckCircle2}
          color="bg-emerald-100 text-emerald-600"
        />
        <KpiCard
          title="Pending"
          value={formatLakh(summary.totalPending)}
          icon={Clock}
          color="bg-amber-100 text-amber-600"
        />
        <KpiCard
          title="Collection Rate"
          value={`${summary.totalInvoiced > 0 ? Math.round((summary.totalReceived / summary.totalInvoiced) * 100) : 0}%`}
          icon={Percent}
          color="bg-purple-100 text-purple-600"
        />
      </div>

      <Card className="border-0 shadow-lg shadow-slate-200/50">
        <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-white pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-sky-500" />
              Client Invoices
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filters.financeYear}
                onValueChange={(v) => setFilters((f) => ({ ...f, financeYear: v, page: 1 }))}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_YEARS.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.month}
                onValueChange={(v) => setFilters((f) => ({ ...f, month: v, page: 1 }))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search client..."
                  className="w-[180px] pl-9"
                  value={filters.clientName}
                  onChange={(e) => setFilters((f) => ({ ...f, clientName: e.target.value, page: 1 }))}
                />
              </div>
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Client / Branch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Cost Centre
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
                    Period
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Invoice Amt
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Received
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      No invoices found
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{inv.client_name || "—"}</div>
                        <div className="text-xs text-slate-500">{inv.branch_name}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{inv.cost_centre}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline">{inv.invoice_month} {inv.finance_year}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(inv.invoice_amount, true)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                        {inv.amount_received > 0 ? formatCurrency(inv.amount_received, true) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={inv.hrms_status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedInvoice(inv);
                            setDialogOpen(true);
                          }}
                        >
                          <CreditCard className="mr-1 h-4 w-4" />
                          Update
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <PaymentUpdateDialog
        invoice={selectedInvoice}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(data) => updateMutation.mutate(data)}
      />
    </div>
  );
}

function TrendsTab() {
  const [clientName, setClientName] = useState("");
  const [branchName, setBranchName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["payment-trends", clientName, branchName],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (clientName) params.set("clientName", clientName);
      if (branchName) params.set("branchName", branchName);
      params.set("months", "12");
      const res = await hrmsApi.get(`/api/finance/client-payments/trends?${params}`);
      return res.data.trends as PaymentTrend[];
    },
  });

  const trends = data ?? [];
  const maxValue = Math.max(...trends.map((t) => t.invoiced), 1);

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg shadow-slate-200/50">
        <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-white pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-sky-500" />
              Payment Collection Trends (Last 12 Months)
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter by client..."
                className="w-[180px]"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-300" />
            </div>
          ) : trends.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-slate-500">
              No trend data available
            </div>
          ) : (
            <div className="space-y-4">
              {trends.map((trend) => (
                <div key={trend.month} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{trend.month}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-slate-500">
                        Invoiced: <span className="font-semibold text-slate-700">{formatLakh(trend.invoiced)}</span>
                      </span>
                      <span className="text-slate-500">
                        Received: <span className="font-semibold text-emerald-600">{formatLakh(trend.received)}</span>
                      </span>
                      <Badge
                        variant={trend.collection_rate >= 80 ? "default" : trend.collection_rate >= 50 ? "secondary" : "destructive"}
                        className="text-xs"
                      >
                        {trend.collection_rate}% collected
                      </Badge>
                    </div>
                  </div>
                  <div className="relative h-6 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-slate-200"
                      style={{ width: `${(trend.invoiced / maxValue) * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                      style={{ width: `${(trend.received / maxValue) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-summary"],
    queryFn: async () => {
      const res = await hrmsApi.get("/api/finance/client-payments/clients");
      return res.data.clients as ClientSummary[];
    },
  });

  const clients = data ?? [];

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg shadow-slate-200/50">
        <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-white pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-sky-500" />
            Client-wise Collection Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Client
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Invoices
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Total Invoiced
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Received
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Pending
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
                    Collection %
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : clients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      No client data available
                    </td>
                  </tr>
                ) : (
                  clients.map((client) => {
                    const collectionPct = client.total_invoiced > 0
                      ? Math.round((client.total_received / client.total_invoiced) * 100)
                      : 0;
                    return (
                      <tr key={client.client_name} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {client.client_name}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {client.invoice_count}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatLakh(client.total_invoiced)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                          {formatLakh(client.total_received)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-600">
                          {formatLakh(client.pending)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={`h-full rounded-full ${
                                  collectionPct >= 80
                                    ? "bg-emerald-500"
                                    : collectionPct >= 50
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                                }`}
                                style={{ width: `${collectionPct}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold">{collectionPct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SeatRatesTab() {
  const [financeYear, setFinanceYear] = useState("2026-27");
  const [month, setMonth] = useState("Jul");

  const { data, isLoading } = useQuery({
    queryKey: ["seat-rates", financeYear, month],
    queryFn: async () => {
      const res = await hrmsApi.get(
        `/api/finance/client-payments/seat-rates?financeYear=${financeYear}&month=${month}`
      );
      return res.data.rates as SeatRate[];
    },
    enabled: !!financeYear && !!month,
  });

  const { data: prediction } = useQuery({
    queryKey: ["predictive-revenue", financeYear, month],
    queryFn: async () => {
      const res = await hrmsApi.get(
        `/api/finance/client-payments/predictive-revenue?financeYear=${financeYear}&month=${month}`
      );
      return res.data as {
        total_seats: number;
        average_rate: number;
        predicted_revenue: number;
        branch_breakdown: Array<{ branch: string; seats: number; predicted: number }>;
      };
    },
    enabled: !!financeYear && !!month,
  });

  const rates = data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          title="Total Seats"
          value={prediction?.total_seats?.toLocaleString() ?? "—"}
          icon={Users}
          color="bg-sky-100 text-sky-600"
        />
        <KpiCard
          title="Avg Rate/Seat"
          value={prediction ? formatCurrency(prediction.average_rate) : "—"}
          icon={IndianRupee}
          color="bg-emerald-100 text-emerald-600"
        />
        <KpiCard
          title="Predicted Revenue"
          value={prediction ? formatLakh(prediction.predicted_revenue) : "—"}
          subtitle="Based on seat × rate"
          icon={TrendingUp}
          color="bg-purple-100 text-purple-600"
        />
        <KpiCard
          title="Active Processes"
          value={rates.length.toString()}
          icon={Building2}
          color="bg-amber-100 text-amber-600"
        />
      </div>

      <Card className="border-0 shadow-lg shadow-slate-200/50">
        <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-white pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Landmark className="h-5 w-5 text-sky-500" />
              Seat Rates by Process
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={financeYear} onValueChange={setFinanceYear}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_YEARS.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Branch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Client / Process
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Cost Centre
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    Billing Particulars
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Seats
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Rate/Seat
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                    Monthly Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      No seat rate data available for {month} {financeYear}
                    </td>
                  </tr>
                ) : (
                  rates.map((rate, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-900">{rate.branch}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{rate.client || "—"}</div>
                        {rate.process_name && rate.process_name !== rate.client && (
                          <div className="text-xs text-slate-500">{rate.process_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{rate.cost_centre}</td>
                      <td className="max-w-[250px] truncate px-4 py-3 text-slate-600" title={rate.particulars}>
                        {rate.particulars}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sky-600">
                        {rate.seats.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatCurrency(rate.rate_per_seat)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                        {formatCurrency(rate.monthly_value, true)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ClientPaymentManagementPage() {
  const [activeTab, setActiveTab] = useState("invoices");

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Client Payment Management
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Track invoice payments, collection trends, and predictive revenue
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
              <Banknote className="mr-1 h-3 w-3" />
              Finance Head Portal
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-slate-100/80 p-1">
            <TabsTrigger value="invoices" className="rounded-lg">
              <FileText className="mr-2 h-4 w-4" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="trends" className="rounded-lg">
              <TrendingUp className="mr-2 h-4 w-4" />
              Collection Trends
            </TabsTrigger>
            <TabsTrigger value="clients" className="rounded-lg">
              <Users className="mr-2 h-4 w-4" />
              Client Summary
            </TabsTrigger>
            <TabsTrigger value="rates" className="rounded-lg">
              <Landmark className="mr-2 h-4 w-4" />
              Seat Rates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="mt-6">
            <InvoicesTab />
          </TabsContent>
          <TabsContent value="trends" className="mt-6">
            <TrendsTab />
          </TabsContent>
          <TabsContent value="clients" className="mt-6">
            <ClientsTab />
          </TabsContent>
          <TabsContent value="rates" className="mt-6">
            <SeatRatesTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

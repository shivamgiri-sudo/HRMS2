import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Minus } from "lucide-react";

interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employee: {
    name: string;
    email: string;
    avatar?: string;
  };
  month: string;
  monthNum: number;
  year: number;
  basic: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: "paid" | "pending" | "processing";
  paidAt?: string;
}

interface PayslipViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: PayrollRecord | null;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "paid":
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Paid</Badge>;
    case "processing":
      return <Badge className="bg-primary/10 text-primary border-primary/20">Processed</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
};

export function PayslipViewDialog({ open, onOpenChange, record }: PayslipViewDialogProps) {
  const { data: salaryStructure, isLoading } = useQuery({
    queryKey: ["salary-structure-view", record?.employeeId],
    queryFn: async () => {
      if (!record?.employeeId) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/payroll/structures");
      return res.data ?? null;
    },
    enabled: !!record?.employeeId && open,
  });

  if (!record) return null;

  const getAllowanceBreakdown = () => {
    if (!salaryStructure) return [];
    const items = [];
    if (salaryStructure.hra) items.push({ label: "House Rent Allowance (HRA)", amount: Number(salaryStructure.hra) });
    if (salaryStructure.transport_allowance) items.push({ label: "Transport Allowance", amount: Number(salaryStructure.transport_allowance) });
    if (salaryStructure.medical_allowance) items.push({ label: "Medical Allowance", amount: Number(salaryStructure.medical_allowance) });
    if (salaryStructure.other_allowances) items.push({ label: "Other Allowances", amount: Number(salaryStructure.other_allowances) });
    return items;
  };

  const getDeductionBreakdown = () => {
    if (!salaryStructure) return [];
    const items = [];
    if (salaryStructure.tax_deduction) items.push({ label: "Tax Deduction", amount: Number(salaryStructure.tax_deduction) });
    if (salaryStructure.other_deductions) items.push({ label: "Other Deductions", amount: Number(salaryStructure.other_deductions) });
    return items;
  };

  const allowanceBreakdown = getAllowanceBreakdown();
  const deductionBreakdown = getDeductionBreakdown();
  const grossSalary = record.basic + record.allowances;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Payslip - {record.month}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Employee Details */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <h3 className="font-semibold mb-3">Employee Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <span className="ml-2 font-medium">{record.employee.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Employee Code:</span>
                <span className="ml-2 font-medium">{record.employeeCode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span>
                <span className="ml-2 font-medium">{record.employee.email}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Pay Period:</span>
                <span className="ml-2 font-medium">{record.month}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Status:</span>
                <span className="ml-2">{getStatusBadge(record.status)}</span>
                {record.paidAt && (
                  <span className="ml-2 text-muted-foreground text-xs">({record.paidAt})</span>
                )}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Earnings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-600">
                  <Plus className="h-4 w-4" />
                  <span className="font-semibold">Earnings</span>
                </div>
                <div className="space-y-2 rounded-lg border bg-background p-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Basic Salary</span>
                    <span className="font-medium">{formatCurrency(record.basic)}</span>
                  </div>
                  {allowanceBreakdown.length > 0 ? (
                    allowanceBreakdown.map((item) => (
                      <div key={item.label} className="flex justify-between">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium text-emerald-600">+{formatCurrency(item.amount)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Allowances</span>
                      <span className="font-medium text-emerald-600">+{formatCurrency(record.allowances)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Gross Salary</span>
                    <span>{formatCurrency(grossSalary)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-destructive">
                  <Minus className="h-4 w-4" />
                  <span className="font-semibold">Deductions</span>
                </div>
                <div className="space-y-2 rounded-lg border bg-background p-4">
                  {deductionBreakdown.length > 0 ? (
                    <>
                      {deductionBreakdown.map((item) => (
                        <div key={item.label} className="flex justify-between">
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="font-medium text-destructive">-{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                      <Separator />
                    </>
                  ) : null}
                  <div className="flex justify-between font-semibold">
                    <span>Total Deductions</span>
                    <span className="text-destructive">-{formatCurrency(record.deductions)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Net Salary */}
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-lg">Net Salary</span>
              <span className="font-bold text-2xl text-primary">
                {formatCurrency(record.netSalary)}
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center italic">
            This is a computer-generated payslip view.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

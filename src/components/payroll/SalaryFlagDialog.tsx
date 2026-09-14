import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { AlertTriangle } from "lucide-react";

type FlagCategory = "attendance" | "incentive" | "deduction" | "net_pay" | "other";

interface Props {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeCode?: string;
  month: string;
  runId?: string;
  processId?: string;
  branchId?: string;
  onSuccess?: () => void;
}

const CATEGORIES: { value: FlagCategory; label: string }[] = [
  { value: "attendance", label: "Attendance" },
  { value: "incentive", label: "Incentive" },
  { value: "deduction", label: "Deduction" },
  { value: "net_pay", label: "Net Pay" },
  { value: "other", label: "Other" },
];

export function SalaryFlagDialog({
  open,
  onClose,
  employeeId,
  employeeCode,
  month,
  runId,
  processId,
  branchId,
  onSuccess,
}: Props) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<FlagCategory | "">("");
  const [description, setDescription] = useState("");
  const [expectedValue, setExpectedValue] = useState("");

  const flagMutation = useMutation({
    mutationFn: (payload: object) =>
      hrmsApi.post("/api/payroll/salary-verification/flags", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-verify-employee", employeeId, month] });
      qc.invalidateQueries({ queryKey: ["salary-verify-register", month] });
      qc.invalidateQueries({ queryKey: ["salary-verify-summary", month] });
      onSuccess?.();
      handleClose();
    },
  });

  function handleClose() {
    setCategory("");
    setDescription("");
    setExpectedValue("");
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !description.trim()) return;
    flagMutation.mutate({
      employeeId,
      employeeCode,
      runMonth: month,
      runId,
      processId,
      branchId,
      category,
      description: description.trim(),
      expectedValue: expectedValue ? parseFloat(expectedValue) : undefined,
    });
  }

  const isValid = !!category && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Flag Discrepancy
          </DialogTitle>
          {employeeCode && (
            <p className="text-sm text-muted-foreground">Employee: {employeeCode}</p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Category <span className="text-red-500">*</span></Label>
            <Select value={category} onValueChange={(v) => setCategory(v as FlagCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Description <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="Describe the discrepancy…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Expected Value (optional)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="₹ amount if applicable"
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || flagMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {flagMutation.isPending ? "Submitting…" : "Raise Flag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Clock, IndianRupee, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OvertimeUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineId: string;
  employeeCode: string;
  employeeName: string;
  currentOvertimeHours?: number;
  currentOvertimeAmount?: number;
  currentGross?: number;
  currentNet?: number;
  onSuccess?: () => void;
  otMinHours?: number;
  otRoundingUnit?: number;
}

export const OvertimeUpdateDialog = ({
  open,
  onOpenChange,
  lineId,
  employeeCode,
  employeeName,
  currentOvertimeHours = 0,
  currentOvertimeAmount = 0,
  currentGross = 0,
  currentNet = 0,
  onSuccess,
  otMinHours = 0,
  otRoundingUnit = 0,
}: OvertimeUpdateDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [overtimeHours, setOvertimeHours] = useState(currentOvertimeHours.toString());
  const [overtimeAmount, setOvertimeAmount] = useState(currentOvertimeAmount.toString());

  const hours = parseFloat(overtimeHours) || 0;
  const amount = parseFloat(overtimeAmount) || 0;

  // Rounding preview (UX only — server is authoritative)
  const computeRoundedHours = (raw: number) => {
    if (raw <= 0) return 0;
    if (otMinHours > 0 && raw < otMinHours) return 0;
    if (otRoundingUnit > 0) return Math.floor(raw / otRoundingUnit) * otRoundingUnit;
    return raw;
  };
  const roundedHours = computeRoundedHours(hours);
  const hasRoundingConfig = otMinHours > 0 || otRoundingUnit > 0;

  // Calculate preview values
  const oldOvertimeAmount = currentOvertimeAmount || 0;
  const newGross = currentGross - oldOvertimeAmount + amount;
  const newNet = currentNet - oldOvertimeAmount + amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (hours < 0 || hours > 200) {
      toast({
        title: "Invalid Hours",
        description: "Overtime hours must be between 0 and 200",
        variant: "destructive",
      });
      return;
    }

    if (amount < 0) {
      toast({
        title: "Invalid Amount",
        description: "Overtime amount must be greater than or equal to 0",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      await hrmsApi.patch(`/payroll/lines/${lineId}/overtime`, {
        overtimeHours: hours,
        overtimeAmount: amount,
      });

      toast({
        title: "Overtime Updated",
        description: `Successfully updated overtime for ${employeeCode}`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Failed to update overtime:", error);
      toast({
        title: "Update Failed",
        description: error.response?.data?.message || "Failed to update overtime. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setOvertimeHours(currentOvertimeHours.toString());
    setOvertimeAmount(currentOvertimeAmount.toString());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Update Overtime</DialogTitle>
          <DialogDescription>
            Update overtime hours and amount for <span className="font-semibold text-slate-900">{employeeName}</span> ({employeeCode})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Overtime Hours */}
            <div className="space-y-2">
              <Label htmlFor="overtime-hours" className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                Overtime Hours
              </Label>
              <Input
                id="overtime-hours"
                type="number"
                step="0.5"
                min="0"
                max="200"
                value={overtimeHours}
                onChange={(e) => setOvertimeHours(e.target.value)}
                placeholder="0.0"
                className="text-right"
              />
              {hasRoundingConfig && hours > 0 ? (
                <p className={`text-xs font-medium ${roundedHours === 0 ? "text-red-500" : roundedHours < hours ? "text-amber-600" : "text-slate-500"}`}>
                  {roundedHours === 0
                    ? `Below minimum (${otMinHours}h) — will count as 0h`
                    : roundedHours < hours
                    ? `After rounding: ${roundedHours}h (min ${otMinHours}h, floor to ${otRoundingUnit}h unit)`
                    : `Effective: ${roundedHours}h`}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Maximum 200 hours per month
                </p>
              )}
            </div>

            {/* Overtime Amount */}
            <div className="space-y-2">
              <Label htmlFor="overtime-amount" className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-slate-500" />
                Overtime Amount
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">₹</span>
                <Input
                  id="overtime-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={overtimeAmount}
                  onChange={(e) => setOvertimeAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 text-right"
                />
              </div>
              <p className="text-xs text-slate-500">
                Payment amount for overtime worked
              </p>
            </div>

            {/* Preview */}
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-xs text-slate-700">
                <div className="space-y-2">
                  <p className="font-semibold text-blue-900">Impact Preview:</p>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="text-slate-600">Current Gross:</div>
                    <div className="font-mono text-right">₹{currentGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>

                    <div className="text-slate-600">New Gross:</div>
                    <div className={`font-mono text-right font-semibold ${newGross > currentGross ? 'text-green-700' : newGross < currentGross ? 'text-red-700' : ''}`}>
                      ₹{newGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>

                    <div className="col-span-2 border-t border-blue-200 my-1"></div>

                    <div className="text-slate-600">Current Net:</div>
                    <div className="font-mono text-right">₹{currentNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>

                    <div className="text-slate-600">New Net:</div>
                    <div className={`font-mono text-right font-semibold ${newNet > currentNet ? 'text-green-700' : newNet < currentNet ? 'text-red-700' : ''}`}>
                      ₹{newNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>

                    {amount !== oldOvertimeAmount && (
                      <>
                        <div className="col-span-2 border-t border-blue-200 my-1"></div>
                        <div className="text-slate-600">Change:</div>
                        <div className={`font-mono text-right font-bold ${amount > oldOvertimeAmount ? 'text-green-700' : 'text-red-700'}`}>
                          {amount > oldOvertimeAmount ? '+' : ''}₹{(amount - oldOvertimeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            {/* Warning for high overtime */}
            {hours > 100 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-900">
                  <strong>High Overtime Alert:</strong> This employee has {hours} hours of overtime. Please verify this is correct.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Overtime
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

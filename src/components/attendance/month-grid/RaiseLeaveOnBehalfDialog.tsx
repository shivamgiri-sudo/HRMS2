import { useState } from "react";
import { format, subDays } from "date-fns";
import { CalendarIcon, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLeaveTypes } from "@/hooks/useLeaveRequests";
import { estimateLeaveDays, useRaiseLeaveOnBehalf } from "@/hooks/useLeaveOnBehalf";
import { cn } from "@/lib/utils";

/**
 * Raise leave for a direct report. Deliberately does not show a leave-balance figure —
 * the caller (manager/TL) has no access to their report's balance (leave.routes.ts's
 * /balance/:employeeId is privileged-or-self only), and this request isn't real until
 * the employee consents anyway. The employee's own balance is checked at that point,
 * the same way it would be for a self-submitted request.
 */
export function RaiseLeaveOnBehalfDialog({
  open, onOpenChange, employeeId, employeeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
}) {
  const { toast } = useToast();
  const { data: leaveTypes, isLoading: loadingTypes } = useLeaveTypes();
  const raise = useRaiseLeaveOnBehalf();

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(0);
  const [estimating, setEstimating] = useState(false);

  async function pickRange(start?: Date, end?: Date) {
    setStartDate(start);
    setEndDate(end);
    if (start && end) {
      setEstimating(true);
      try {
        setDays(await estimateLeaveDays(start, end));
      } finally {
        setEstimating(false);
      }
    } else {
      setDays(0);
    }
  }

  function reset() {
    setLeaveTypeId(""); setStartDate(undefined); setEndDate(undefined); setReason(""); setDays(0);
  }

  const isValid = leaveTypeId && startDate && endDate && days > 0 && reason.trim().length >= 10;

  async function submit() {
    if (!isValid || !startDate || !endDate) return;
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      await raise.mutateAsync({
        employeeId, leaveTypeId, fromDate: fmt(startDate), toDate: fmt(endDate),
        totalDays: days, reason: reason.trim(),
      });
      toast({
        title: "Sent for their consent",
        description: `${employeeName} will see this in Leave Requests and needs to approve it before it's submitted.`,
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not raise this leave request",
        description: e instanceof Error ? e.message : "The request failed.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Raise leave for {employeeName}</DialogTitle>
          <DialogDescription>
            This does not submit a leave request yet — {employeeName} has to approve it first.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-indigo-200 bg-indigo-50">
          <ShieldCheck className="h-4 w-4 text-indigo-600" />
          <AlertDescription className="text-indigo-900 text-xs">
            {employeeName} will get a notification and must consent before this is submitted for approval.
            You'll be told either way.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Leave Type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
              <SelectContent>
                {loadingTypes ? (
                  <SelectItem value="loading" disabled>Loading…</SelectItem>
                ) : (leaveTypes ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single" selected={startDate}
                    onSelect={(d) => pickRange(d, endDate && d && d > endDate ? undefined : endDate)}
                    disabled={(d) => d < subDays(new Date(), 30)}
                    initialFocus className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single" selected={endDate}
                    onSelect={(d) => pickRange(startDate, d)}
                    disabled={(d) => d < (startDate || subDays(new Date(), 30))}
                    initialFocus className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {startDate && endDate && (
            <p className="text-sm text-muted-foreground">
              {estimating ? "Estimating…" : (
                days > 0
                  ? <>Duration: <span className="font-medium text-foreground">{days} day{days !== 1 ? "s" : ""}</span></>
                  : "Selected range has no working days — pick a different range."
              )}
            </p>
          )}

          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being raised on their behalf? (min. 10 characters)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!isValid || raise.isPending} className="bg-indigo-600 hover:bg-indigo-700">
            {raise.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Send for consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

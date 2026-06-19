import { useState, useMemo } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, Send, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInDays, subDays, startOfDay, eachDayOfInterval, isWeekend, parseISO, isSameDay } from "date-fns";
import { normalizeDate } from "@/lib/utils";
import { useLeaveTypes, useSubmitLeaveRequest } from "@/hooks/useLeaveRequests";
import { useLeaveEligibility } from "@/hooks/useLeaveEligibility";
import { useQuery } from "@tanstack/react-query";
import { useCompanyHolidays } from "@/hooks/useCompanyHolidays";
import { Badge } from "@/components/ui/badge";
import { useIsReadOnly } from "@/contexts/AuthContext";

const UNPAID_LEAVE_NAME = "Unpaid Leave";

interface LeaveRequestFormProps {
  employeeId: string;
}

export function LeaveRequestForm({ employeeId }: LeaveRequestFormProps) {
  const [leaveTypeId, setLeaveTypeId] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [reason, setReason] = useState("");

  const { data: allLeaveTypes, isLoading: isLoadingTypes } = useLeaveTypes();
  const { data: eligibility } = useLeaveEligibility(employeeId);
  const submitMutation = useSubmitLeaveRequest();
  const { data: holidays = [] } = useCompanyHolidays();
  const isReadOnly = useIsReadOnly();

  const currentYear = new Date().getFullYear();

  // Resolve (or lazily create) the special "Unpaid Leave" leave type.
  // Unpaid leave is always available to everyone, with no day limit.
  const { data: unpaidLeaveType } = useQuery({
    queryKey: ["unpaid-leave-type"],
    queryFn: async () => {
      const result = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; leave_name: string; max_days_per_year: number | null; carry_forward: boolean; paid_leave: boolean }> }>('/api/leave/types');
      const types = result.data ?? [];
      const existing = types.find(t => t.leave_name === 'Unpaid Leave');
      if (existing) return existing;
      const created = await hrmsApi.post<{ success: boolean; data: { id: string; leave_name: string; max_days_per_year: number | null; carry_forward: boolean; paid_leave: boolean } }>('/api/leave/types', {
        leave_name: 'Unpaid Leave',
        max_days_per_year: null,
        carry_forward: false,
        requires_approval: true,
        paid_leave: false,
      });
      return created.data;
    },
  });

  // Filter allocated paid leave types, then append the always-available Unpaid Leave option.
  const leaveTypes = useMemo(() => {
    const eligibleIds = new Set((eligibility ?? []).map((e) => e.leave_type_id));
    const allocated = (allLeaveTypes ?? []).filter(
      (t) => eligibleIds.has(t.id) && t.id !== unpaidLeaveType?.id
    );
    if (unpaidLeaveType) {
      allocated.push({
        id: unpaidLeaveType.id,
        name: unpaidLeaveType.name,
        is_paid: false,
        days_per_year: 0,
        description: "Unlimited",
      });
    }
    return allocated;
  }, [allLeaveTypes, eligibility, unpaidLeaveType]);

  // Fetch actual leave balances from ledger (includes db_bill synced used_days)
  const { data: ledgerBalances } = useQuery({
    queryKey: ["leave-balances", employeeId, currentYear],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/balance/${employeeId}?year=${currentYear}`
      );
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  const isUnpaid = !!unpaidLeaveType && leaveTypeId === unpaidLeaveType.id;

  const leaveBalances = useMemo(() => {
    const balances: Record<string, { total: number; used: number; remaining: number }> = {};
    if (!ledgerBalances) return balances;
    for (const row of ledgerBalances) {
      const allocated = Number(row.allocated_days ?? 0);
      const used = Number(row.used_days ?? 0);
      const adjusted = Number(row.adjusted_days ?? 0);
      const available = row.available_days != null
        ? Number(row.available_days)
        : allocated + adjusted - used;
      balances[row.leave_type_id] = {
        total: allocated + adjusted,
        used,
        remaining: available,
      };
    }
    return balances;
  }, [ledgerBalances]);


  const daysCount = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const holidayDates = holidays.map((h) => parseISO(normalizeDate(h.event_date)));
    return eachDayOfInterval({ start: startDate, end: endDate })
      .filter((d) => !isWeekend(d) && !holidayDates.some((hd) => isSameDay(d, hd))).length;
  }, [startDate, endDate, holidays]);

  const isRetroactiveRequest = useMemo(() => {
    if (!startDate) return false;
    const today = startOfDay(new Date());
    return startDate < today;
  }, [startDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!leaveTypeId || !startDate || !endDate) return;

    const selectedLeaveType = leaveTypes?.find(t => t.id === leaveTypeId);

    await submitMutation.mutateAsync({
      employeeId,
      leaveTypeId,
      leaveTypeName: selectedLeaveType?.name || "Leave",
      startDate,
      endDate,
      reason,
    });

    // Reset form
    setLeaveTypeId("");
    setStartDate(undefined);
    setEndDate(undefined);
    setReason("");
  };

  const selectedBalance = leaveTypeId && !isUnpaid ? leaveBalances[leaveTypeId] : null;
  const exceedsBalance = !!selectedBalance && daysCount > 0 && (selectedBalance.remaining - daysCount) < 0;
  const isValid = leaveTypeId && startDate && endDate && daysCount > 0 && reason.trim().length >= 10 && !exceedsBalance;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Request Time Off
        </CardTitle>
        <CardDescription>Submit a new leave request for approval</CardDescription>
      </CardHeader>
      <CardContent>
        {isReadOnly && (
          <Alert className="mb-4 border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-900">
              Your account is in read-only mode. You cannot submit leave requests.
            </AlertDescription>
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Leave balance summary */}
          {leaveTypes && leaveTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {leaveTypes.map((type) => {
                const isSelected = type.id === leaveTypeId;
                const isUnpaidType = type.id === unpaidLeaveType?.id;
                if (isUnpaidType) {
                  return (
                    <Badge
                      key={type.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer text-xs py-1 px-2.5"
                      onClick={() => setLeaveTypeId(type.id)}
                    >
                      {type.name}: ∞
                    </Badge>
                  );
                }
                const bal = leaveBalances[type.id];
                if (!bal) return null;
                return (
                  <Badge
                    key={type.id}
                    variant={isSelected ? "default" : "secondary"}
                    className={cn(
                      "cursor-pointer text-xs py-1 px-2.5",
                      bal.remaining <= 0 && "opacity-60"
                    )}
                    onClick={() => setLeaveTypeId(type.id)}
                  >
                    {type.name}: {bal.remaining}/{bal.total}
                  </Badge>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <Label>Leave Type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {isLoadingTypes ? (
                  <SelectItem value="loading" disabled>Loading...</SelectItem>
                ) : leaveTypes.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No leave types allocated. Contact HR.
                  </SelectItem>
                ) : (
                  leaveTypes.map((type) => {
                    const isUnpaidType = type.id === unpaidLeaveType?.id;
                    if (isUnpaidType) {
                      return (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name} (Unpaid · Unlimited)
                        </SelectItem>
                      );
                    }
                    const bal = leaveBalances[type.id];
                    const exhausted = bal && bal.remaining <= 0;
                    return (
                      <SelectItem key={type.id} value={type.id} disabled={!!exhausted}>
                        {type.name} {type.is_paid ? "(Paid)" : "(Unpaid)"}
                        {exhausted ? " — No leaves left" : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedBalance && (
            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Remaining</span>
                <span className={cn("font-semibold", selectedBalance.remaining <= 0 ? "text-destructive" : "text-primary")}>
                  {selectedBalance.remaining} of {selectedBalance.total} days
                </span>
              </div>
              {daysCount > 0 && (
                <div className="flex items-center justify-between mt-1 pt-1 border-t">
                  <span className="text-muted-foreground">After this request</span>
                  <span className={cn("font-semibold", (selectedBalance.remaining - daysCount) < 0 ? "text-destructive" : "text-primary")}>
                    {selectedBalance.remaining - daysCount} days
                  </span>
                </div>
              )}
            </div>
          )}

          {exceedsBalance && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Not enough leave balance. You can apply for at most {selectedBalance?.remaining} day{selectedBalance?.remaining !== 1 ? "s" : ""}.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => {
                      setStartDate(date);
                      if (date && endDate && date > endDate) {
                        setEndDate(undefined);
                      }
                    }}
                    disabled={(date) => date < subDays(new Date(), 30)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={(date) => date < (startDate || subDays(new Date(), 30))}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {daysCount > 0 && (
            <p className="text-sm text-muted-foreground">
              Duration: <span className="font-medium text-foreground">{daysCount} day{daysCount !== 1 ? "s" : ""}</span>
            </p>
          )}

          {isRetroactiveRequest && (
            <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 dark:text-amber-400">
                This is a retroactive leave request for past dates. Additional approval may be required.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a reason for your leave request (min. 10 characters)..."
              rows={3}
              minLength={10}
            />
            {reason.trim().length > 0 && reason.trim().length < 10 && (
              <p className="text-xs text-destructive">Reason must be at least 10 characters ({reason.trim().length}/10)</p>
            )}
          </div>

          <Button type="submit" disabled={!isValid || submitMutation.isPending || isReadOnly} className="w-full">
            {submitMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {isReadOnly ? "Cannot Submit (Read-Only)" : "Submit Request"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

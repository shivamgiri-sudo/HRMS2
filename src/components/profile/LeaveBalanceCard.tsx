import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Loader2, TrendingUp } from "lucide-react";
import { useLeaveBalances } from "@/hooks/useLeaveBalances";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface LeaveBalanceCardProps {
  employeeId: string;
}

export function LeaveBalanceCard({ employeeId }: LeaveBalanceCardProps) {
  const { data: balances, isLoading } = useLeaveBalances(employeeId);
  const currentYear = new Date().getFullYear();
  const displayYear = balances && balances.length > 0 ? balances[0].year : currentYear;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Leave Balance
          </CardTitle>
          <CardDescription>
            Available leave days for {displayYear}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {balances && balances.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((balance) => {
                const isEL = balance.leave_code === "EL";
                const isCLML = ["CL", "ML"].includes(balance.leave_code || "");
                const currentMonth = new Date().getMonth() + 1; // 1-12
                const accruedMonths = Math.min(currentMonth, 12);
                const accruedToDate = isCLML ? accruedMonths : balance.allocated_days;
                const usedPct = balance.allocated_days > 0
                  ? Math.min((balance.used_days / balance.allocated_days) * 100, 100)
                  : 0;

                return (
                  <div key={balance.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{balance.leave_type?.name || "Leave"}</span>
                      <div className="flex items-center gap-1">
                        {balance.leave_type?.is_paid && (
                          <Badge variant="secondary" className="text-xs">Paid</Badge>
                        )}
                      </div>
                    </div>

                    <Progress value={usedPct} className="h-2" />

                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{balance.used_days.toFixed(1)} used</span>
                      <span className="font-medium text-foreground">
                        {balance.available_days.toFixed(1)} available
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Allocated: {balance.allocated_days.toFixed(1)} days
                      {balance.annual_entitlement != null &&
                        balance.annual_entitlement !== balance.allocated_days && (
                          <span className="text-slate-400">
                            {" "}(annual: {balance.annual_entitlement} days)
                          </span>
                        )}
                      {balance.adjusted_days !== 0 && (
                        <span className={balance.adjusted_days > 0 ? " text-green-600" : " text-red-500"}>
                          {" "}({balance.adjusted_days > 0 ? "+" : ""}{balance.adjusted_days.toFixed(1)} adj)
                        </span>
                      )}
                    </p>

                    {/* CL/ML accrual info — shows accrued-to-date vs full year */}
                    {isCLML && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 cursor-help border border-amber-100">
                            <TrendingUp className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                            <span className="text-xs text-amber-700">
                              {accruedToDate.toFixed(0)}/{balance.allocated_days.toFixed(0)} accrued
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          <p>
                            {balance.leave_type?.name} accrues 1 day per month.
                            Through {MONTH_NAMES[accruedMonths]}, you've accrued {accruedToDate.toFixed(0)} of {balance.allocated_days.toFixed(0)} annual days.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* EL accrual info — current year's accumulation, usable from next year */}
                    {isEL && balance.el_accruing_days != null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1.5 cursor-help border border-blue-100">
                            <TrendingUp className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                            <span className="text-xs text-blue-700">
                              {balance.el_accruing_days.toFixed(1)} days accumulating
                              {balance.el_last_credited_month
                                ? ` (through ${MONTH_NAMES[balance.el_last_credited_month]})`
                                : ""}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          <p>
                            EL accumulates throughout the year at 1.5 days/month.
                            This amount will be credited as spendable EL on Jan 1, {displayYear + 1}.
                            It cannot be used this year.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <CalendarDays className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>No leave balances found</p>
              <p className="text-sm">Contact HR to configure your leave entitlements</p>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

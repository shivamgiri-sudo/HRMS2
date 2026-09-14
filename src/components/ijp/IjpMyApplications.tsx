import { useState } from "react";
import { AlertCircle, Briefcase, Calendar, Check, Clock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMyIjpApplications, useWithdrawIjpApplication } from "./useIjp";
import type { IjpApplicationStatus, IjpApplicationWithDetails } from "./types";

const STATUS_CONFIG: Record<
  IjpApplicationStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Check }
> = {
  submitted: { label: "Submitted", variant: "secondary", icon: Clock },
  pending_manager: { label: "Pending Manager", variant: "secondary", icon: Clock },
  manager_approved: { label: "Manager Approved", variant: "default", icon: Check },
  manager_rejected: { label: "Manager Rejected", variant: "destructive", icon: X },
  under_review: { label: "Under Review", variant: "secondary", icon: Clock },
  shortlisted: { label: "Shortlisted", variant: "default", icon: Check },
  interview_scheduled: { label: "Interview Scheduled", variant: "default", icon: Calendar },
  selected: { label: "Selected", variant: "default", icon: Check },
  rejected: { label: "Rejected", variant: "destructive", icon: X },
  withdrawn: { label: "Withdrawn", variant: "outline", icon: X },
  offer_extended: { label: "Offer Extended", variant: "default", icon: Briefcase },
  offer_accepted: { label: "Offer Accepted", variant: "default", icon: Check },
  offer_declined: { label: "Offer Declined", variant: "outline", icon: X },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: IjpApplicationStatus }) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "secondary" as const, icon: Clock };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function canWithdraw(status: IjpApplicationStatus): boolean {
  return ["submitted", "pending_manager", "manager_approved", "under_review"].includes(status);
}

function ApplicationCard({
  application,
  onWithdraw,
  isWithdrawing,
}: {
  application: IjpApplicationWithDetails;
  onWithdraw: (id: string) => void;
  isWithdrawing: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold">{application.job_title}</CardTitle>
            <CardDescription className="mt-1">
              <span className="text-xs">{application.posting_code}</span>
            </CardDescription>
          </div>
          <StatusBadge status={application.status} />
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Applied on:</span>{" "}
            <span className="font-medium">{formatDate(application.applied_at)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Your tenure:</span>{" "}
            <span className="font-medium">{application.tenure_months} months</span>
          </div>
          {application.current_department_name && (
            <div>
              <span className="text-muted-foreground">From dept:</span>{" "}
              <span className="font-medium">{application.current_department_name}</span>
            </div>
          )}
          {application.current_process_name && (
            <div>
              <span className="text-muted-foreground">From process:</span>{" "}
              <span className="font-medium">{application.current_process_name}</span>
            </div>
          )}
        </div>

        {application.status === "pending_manager" && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-md text-xs text-amber-700">
            <AlertCircle className="h-4 w-4" />
            <span>
              Awaiting approval from {application.manager_name || "your manager"}
            </span>
          </div>
        )}

        {application.status === "manager_rejected" && application.manager_remarks && (
          <div className="p-2 bg-red-50 rounded-md text-xs text-red-700">
            <p className="font-medium">Manager remarks:</p>
            <p>{application.manager_remarks}</p>
          </div>
        )}

        {application.status === "interview_scheduled" && application.interview_scheduled_at && (
          <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-md text-xs text-blue-700">
            <Calendar className="h-4 w-4" />
            <span>
              Interview scheduled for {formatDate(application.interview_scheduled_at)}
            </span>
          </div>
        )}

        {application.review_remarks && (
          <div className="p-2 bg-muted rounded-md text-xs">
            <p className="font-medium text-muted-foreground">HR Remarks:</p>
            <p>{application.review_remarks}</p>
          </div>
        )}

        {application.status === "selected" && (
          <div className="flex items-center gap-2 p-2 bg-green-50 rounded-md text-xs text-green-700">
            <Check className="h-4 w-4" />
            <span>Congratulations! You have been selected for this position.</span>
          </div>
        )}

        {canWithdraw(application.status) && (
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onWithdraw(application.id)}
              disabled={isWithdrawing}
            >
              {isWithdrawing ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Withdrawing...
                </>
              ) : (
                "Withdraw Application"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IjpMyApplications() {
  const { data: applications, isLoading, error } = useMyIjpApplications();
  const withdrawMutation = useWithdrawIjpApplication();
  const [withdrawId, setWithdrawId] = useState<string | null>(null);

  const handleWithdraw = (id: string) => {
    setWithdrawId(id);
  };

  const confirmWithdraw = async () => {
    if (!withdrawId) return;
    try {
      await withdrawMutation.mutateAsync(withdrawId);
      setWithdrawId(null);
    } catch {
      // error handled by mutation state
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[150px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Unable to load your applications</p>
        </CardContent>
      </Card>
    );
  }

  if (!applications || applications.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">You haven't applied to any internal positions yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Check out available opportunities and apply
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeApps = applications.filter(
    (a) => !["withdrawn", "rejected", "offer_declined"].includes(a.status)
  );
  const closedApps = applications.filter((a) =>
    ["withdrawn", "rejected", "offer_declined"].includes(a.status)
  );

  return (
    <>
      <div className="space-y-6">
        {activeApps.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">
              Active Applications ({activeApps.length})
            </h3>
            <div className="space-y-4">
              {activeApps.map((app) => (
                <ApplicationCard
                  key={app.id}
                  application={app}
                  onWithdraw={handleWithdraw}
                  isWithdrawing={withdrawMutation.isPending && withdrawId === app.id}
                />
              ))}
            </div>
          </div>
        )}

        {closedApps.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">
              Past Applications ({closedApps.length})
            </h3>
            <div className="space-y-4">
              {closedApps.map((app) => (
                <ApplicationCard
                  key={app.id}
                  application={app}
                  onWithdraw={handleWithdraw}
                  isWithdrawing={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!withdrawId} onOpenChange={() => setWithdrawId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw Application?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to withdraw this application? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmWithdraw}>Withdraw</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {withdrawMutation.isError && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {(withdrawMutation.error as Error)?.message || "Failed to withdraw application"}
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Loader2,
  Mail,
  Phone,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useIjpPostingDetail,
  useIjpPostingApplications,
  useUpdateApplicationStatus,
} from "./useIjp";
import type { IjpApplicationStatus, IjpApplicationWithDetails } from "./types";

const STATUS_CONFIG: Record<
  IjpApplicationStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  submitted: { label: "Submitted", variant: "secondary" },
  pending_manager: { label: "Pending Manager", variant: "secondary" },
  manager_approved: { label: "Manager Approved", variant: "default" },
  manager_rejected: { label: "Manager Rejected", variant: "destructive" },
  under_review: { label: "Under Review", variant: "secondary" },
  shortlisted: { label: "Shortlisted", variant: "default" },
  interview_scheduled: { label: "Interview Scheduled", variant: "default" },
  selected: { label: "Selected", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
  offer_extended: { label: "Offer Extended", variant: "default" },
  offer_accepted: { label: "Offer Accepted", variant: "default" },
  offer_declined: { label: "Offer Declined", variant: "outline" },
};

const NEXT_STATUS_OPTIONS: Record<IjpApplicationStatus, IjpApplicationStatus[]> = {
  submitted: ["under_review", "rejected"],
  pending_manager: ["under_review", "rejected"],
  manager_approved: ["under_review", "shortlisted", "rejected"],
  manager_rejected: [],
  under_review: ["shortlisted", "rejected"],
  shortlisted: ["interview_scheduled", "selected", "rejected"],
  interview_scheduled: ["selected", "rejected"],
  selected: ["offer_extended"],
  rejected: [],
  withdrawn: [],
  offer_extended: ["offer_accepted", "offer_declined"],
  offer_accepted: [],
  offer_declined: [],
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
  const config = STATUS_CONFIG[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function UpdateStatusDialog({
  open,
  onOpenChange,
  application,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: IjpApplicationWithDetails | null;
  onSuccess: () => void;
}) {
  const [status, setStatus] = useState<IjpApplicationStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const updateMutation = useUpdateApplicationStatus();

  const availableStatuses = application ? NEXT_STATUS_OPTIONS[application.status] : [];

  const handleSubmit = async () => {
    if (!application || !status) return;

    try {
      await updateMutation.mutateAsync({
        applicationId: application.id,
        status,
        remarks: remarks || undefined,
        interviewScheduledAt: interviewDate ? new Date(interviewDate).toISOString() : undefined,
      });
      setStatus("");
      setRemarks("");
      setInterviewDate("");
      onOpenChange(false);
      onSuccess();
    } catch {
      // error handled by mutation state
    }
  };

  if (!application) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Application Status</DialogTitle>
          <DialogDescription>
            Change the status of {application.employee_name}'s application
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Current Status:</span>{" "}
                <StatusBadge status={application.status} />
              </div>
              <div>
                <span className="text-muted-foreground">Applied:</span>{" "}
                <span className="font-medium">{formatDate(application.applied_at)}</span>
              </div>
            </div>
          </div>

          {availableStatuses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No status transitions available from the current status.
            </p>
          ) : (
            <>
              <div>
                <Label>New Status *</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as IjpApplicationStatus)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_CONFIG[s]?.label || s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {status === "interview_scheduled" && (
                <div>
                  <Label htmlFor="interview_date">Interview Date *</Label>
                  <Input
                    id="interview_date"
                    type="datetime-local"
                    value={interviewDate}
                    onChange={(e) => setInterviewDate(e.target.value)}
                  />
                </div>
              )}

              <div>
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional remarks..."
                  className="min-h-[80px]"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          {availableStatuses.length > 0 && (
            <Button
              onClick={handleSubmit}
              disabled={!status || updateMutation.isPending || (status === "interview_scheduled" && !interviewDate)}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Status"
              )}
            </Button>
          )}
        </DialogFooter>

        {updateMutation.isError && (
          <p className="text-sm text-red-600 mt-2">
            {(updateMutation.error as Error)?.message || "Failed to update status"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApplicationRow({
  application,
  onUpdateStatus,
}: {
  application: IjpApplicationWithDetails;
  onUpdateStatus: (app: IjpApplicationWithDetails) => void;
}) {
  const canUpdate = NEXT_STATUS_OPTIONS[application.status].length > 0;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{application.employee_name}</p>
            <p className="text-xs text-muted-foreground">{application.employee_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          <p>{application.current_department_name || "—"}</p>
          <p className="text-xs text-muted-foreground">{application.current_process_name || "—"}</p>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          <p>{application.current_designation_name || "—"}</p>
          <p className="text-xs text-muted-foreground">{application.tenure_months}m tenure</p>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={application.status} />
      </TableCell>
      <TableCell className="text-sm">{formatDate(application.applied_at)}</TableCell>
      <TableCell>
        {canUpdate ? (
          <Button size="sm" variant="outline" onClick={() => onUpdateStatus(application)}>
            Update
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No actions</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function IjpApplicationsReview({
  postingId,
  onBack,
}: {
  postingId: string;
  onBack: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedApp, setSelectedApp] = useState<IjpApplicationWithDetails | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: posting, isLoading: postingLoading } = useIjpPostingDetail(postingId);
  const { data: applicationsData, isLoading: appsLoading, refetch } = useIjpPostingApplications(postingId, {
    status: statusFilter || undefined,
  });

  const handleUpdateStatus = (app: IjpApplicationWithDetails) => {
    setSelectedApp(app);
    setDialogOpen(true);
  };

  if (postingLoading || appsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!posting) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Posting not found</p>
          <Button variant="outline" onClick={onBack} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Postings
        </Button>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{posting.job_title}</CardTitle>
                <CardDescription className="mt-1">
                  {posting.posting_code} • {posting.department_name || "Any Department"}{" "}
                  {posting.branch_name && `• ${posting.branch_name}`}
                </CardDescription>
              </div>
              <Badge variant={posting.status === "open" ? "default" : "secondary"}>
                {posting.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1">
                <User className="h-4 w-4 text-muted-foreground" />
                {posting.vacancies} {posting.vacancies === 1 ? "vacancy" : "vacancies"}
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Min {posting.min_tenure_months} months tenure
              </div>
              {posting.closes_at && (
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Closes {formatDate(posting.closes_at)}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold">
            Applications ({applicationsData?.total ?? 0})
          </h2>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="pending_manager">Pending Manager</SelectItem>
              <SelectItem value="manager_approved">Manager Approved</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="shortlisted">Shortlisted</SelectItem>
              <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
              <SelectItem value="selected">Selected</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {applicationsData?.applications && applicationsData.applications.length > 0 ? (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department / Process</TableHead>
                  <TableHead>Designation / Tenure</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applicationsData.applications.map((app) => (
                  <ApplicationRow
                    key={app.id}
                    application={app}
                    onUpdateStatus={handleUpdateStatus}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No applications found</p>
            </CardContent>
          </Card>
        )}
      </div>

      <UpdateStatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        application={selectedApp}
        onSuccess={() => refetch()}
      />
    </>
  );
}

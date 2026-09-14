import { useState } from "react";
import { Briefcase, Calendar, Check, ChevronRight, Clock, MapPin, Users, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEligibleIjpPostings, useApplyToIjp } from "./useIjp";
import type { EligiblePostingResponse } from "./types";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function EligibilityBadge({ eligible, reasons }: { eligible: boolean; reasons: string[] }) {
  if (eligible) {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        <Check className="mr-1 h-3 w-3" /> Eligible
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200" title={reasons.join(", ")}>
      <X className="mr-1 h-3 w-3" /> Not Eligible
    </Badge>
  );
}

function OpportunityCard({
  item,
  onApply,
}: {
  item: EligiblePostingResponse;
  onApply: (posting: EligiblePostingResponse) => void;
}) {
  const { posting, eligibility, already_applied, existing_application_status } = item;
  const daysLeft = daysUntil(posting.closes_at);
  const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft > 0;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold truncate">{posting.job_title}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 mt-1 text-sm">
              {posting.department_name && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  {posting.department_name}
                </span>
              )}
              {posting.branch_name && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {posting.branch_name}
                </span>
              )}
            </CardDescription>
          </div>
          <EligibilityBadge eligible={eligibility.eligible} reasons={eligibility.reasons} />
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {posting.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{posting.description}</p>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {posting.vacancies} {posting.vacancies === 1 ? "vacancy" : "vacancies"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            Min {posting.min_tenure_months} months tenure
          </span>
          {posting.closes_at && (
            <span className={`flex items-center gap-1 ${isUrgent ? "text-amber-600 font-medium" : ""}`}>
              <Calendar className="h-3.5 w-3.5" />
              {isUrgent ? `${daysLeft} days left` : `Closes ${formatDate(posting.closes_at)}`}
            </span>
          )}
        </div>

        {posting.require_manager_approval && (
          <div className="flex items-center gap-1 text-xs text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Requires manager approval
          </div>
        )}

        {!eligibility.eligible && eligibility.reasons.length > 0 && (
          <div className="bg-red-50 rounded-md p-2 text-xs text-red-700">
            <p className="font-medium mb-1">Why you're not eligible:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {eligibility.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {already_applied ? (
            <Badge variant="secondary">
              Applied: {existing_application_status?.replace(/_/g, " ")}
            </Badge>
          ) : eligibility.eligible ? (
            <Button size="sm" onClick={() => onApply(item)}>
              Apply Now <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Not Eligible
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{posting.posting_code}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ApplyDialog({
  open,
  onOpenChange,
  posting,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posting: EligiblePostingResponse | null;
  onConfirm: (note: string) => void;
  isLoading: boolean;
}) {
  const [note, setNote] = useState("");

  if (!posting) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply to {posting.posting.job_title}</DialogTitle>
          <DialogDescription>
            You're applying for an internal position. {posting.posting.require_manager_approval && "Your manager will need to approve this application."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Department:</span>{" "}
                <span className="font-medium">{posting.posting.department_name || "Any"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Branch:</span>{" "}
                <span className="font-medium">{posting.posting.branch_name || "Any"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Your Tenure:</span>{" "}
                <span className="font-medium">{posting.eligibility.tenure_months} months</span>
              </div>
              <div>
                <span className="text-muted-foreground">Required:</span>{" "}
                <span className="font-medium">{posting.posting.min_tenure_months} months</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="application-note">Application Note (Optional)</Label>
            <Textarea
              id="application-note"
              placeholder="Tell us why you're interested in this role..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[100px]"
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/2000</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(note)} disabled={isLoading}>
            {isLoading ? "Submitting..." : "Submit Application"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IjpOpportunities() {
  const { data: postings, isLoading, error } = useEligibleIjpPostings();
  const applyMutation = useApplyToIjp();
  const [selectedPosting, setSelectedPosting] = useState<EligiblePostingResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleApply = (posting: EligiblePostingResponse) => {
    setSelectedPosting(posting);
    setDialogOpen(true);
  };

  const handleConfirmApply = async (note: string) => {
    if (!selectedPosting) return;
    try {
      await applyMutation.mutateAsync({
        postingId: selectedPosting.posting.id,
        applicationNote: note || undefined,
      });
      setDialogOpen(false);
      setSelectedPosting(null);
    } catch {
      // error handled by mutation state
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[180px] w-full" />
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Unable to load internal opportunities</p>
        </CardContent>
      </Card>
    );
  }

  if (!postings || postings.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No internal opportunities available at this time</p>
          <p className="text-xs text-muted-foreground mt-1">Check back later for new openings</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ScrollArea className="h-[500px] pr-4">
        <div className="space-y-4">
          {postings.map((item) => (
            <OpportunityCard key={item.posting.id} item={item} onApply={handleApply} />
          ))}
        </div>
      </ScrollArea>

      <ApplyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        posting={selectedPosting}
        onConfirm={handleConfirmApply}
        isLoading={applyMutation.isPending}
      />

      {applyMutation.isError && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {(applyMutation.error as Error)?.message || "Failed to submit application"}
        </div>
      )}

      {applyMutation.isSuccess && (
        <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-md text-sm">
          Application submitted successfully!
        </div>
      )}
    </>
  );
}

export function IjpOpportunitiesCompact() {
  const { data: postings, isLoading } = useEligibleIjpPostings();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const eligibleCount = postings?.filter((p) => p.eligibility.eligible && !p.already_applied).length ?? 0;
  const appliedCount = postings?.filter((p) => p.already_applied).length ?? 0;

  if (!postings || postings.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No internal opportunities
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Open positions</span>
        <span className="font-semibold">{postings.length}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">You're eligible for</span>
        <span className="font-semibold text-green-600">{eligibleCount}</span>
      </div>
      {appliedCount > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Already applied</span>
          <span className="font-semibold text-blue-600">{appliedCount}</span>
        </div>
      )}
      <a
        href="/people/ijp"
        className="block text-center text-xs text-primary font-medium hover:underline pt-2"
      >
        View all opportunities
      </a>
    </div>
  );
}

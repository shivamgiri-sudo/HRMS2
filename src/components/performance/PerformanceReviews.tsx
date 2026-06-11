import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, FileText, Loader2, CheckCircle, Target } from "lucide-react";
import { usePerformanceReviews, useAcknowledgeReview } from "@/hooks/usePerformance";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RatingStars } from "./RatingStars";
import { format } from "date-fns";
import { toast } from "sonner";

interface PerformanceReviewsProps {
  employeeId: string;
  employeeName?: string;
}

interface KpiRating {
  id: string;
  review_id: string;
  goal_id: string;
  employee_rating: number | null;
  manager_rating: number | null;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary border-primary/20",
  acknowledged: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export function PerformanceReviews({ employeeId, employeeName = "Employee" }: PerformanceReviewsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: reviews, isLoading } = usePerformanceReviews(employeeId);
  const acknowledgeMutation = useAcknowledgeReview();
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  // Fetch employee's KPIs
  const { data: goals } = useQuery({
    queryKey: ["goals", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/goals/goals");
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  // Fetch KPI ratings for expanded review
  const { data: kpiRatings } = useQuery({
    queryKey: ["review-kpi-ratings", expandedReview],
    queryFn: async () => {
      if (!expandedReview) return [];
      const result = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/performance-feedback/reports`);
      return result.data ?? [];
    },
    enabled: !!expandedReview,
  });

  // Upsert employee rating
  const upsertRating = useMutation({
    mutationFn: async ({ reviewId, goalId, rating }: { reviewId: string; goalId: string; rating: number }) => {
      await hrmsApi.post('/api/kpi/scores', {
        metric_id: goalId,
        score: rating,
        notes: `Review ${reviewId}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-kpi-ratings", expandedReview] });
      toast.success("Rating saved");
    },
    onError: (error) => {
      toast.error("Failed to save rating: " + error.message);
    },
  });

  if (isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-muted-foreground text-sm">Not rated</span>;
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star key={star} className={`h-4 w-4 ${star <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
        ))}
        <span className="ml-1 text-sm font-medium">{rating}/5</span>
      </div>
    );
  };

  // Check if a review allows employee self-rating (draft or published, not yet acknowledged)
  const canSelfRate = (status: string) => status === "draft" || status === "published" || status === "final";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Performance Reviews</CardTitle>
        <CardDescription>View your performance evaluations and rate your KPIs</CardDescription>
      </CardHeader>
      <CardContent>
        {reviews && reviews.length > 0 ? (
          <div className="space-y-4">
            {reviews.map((review) => {
              const isExpanded = expandedReview === review.id;
              const ratingsMap = isExpanded
                ? Object.fromEntries((kpiRatings || []).map(r => [r.goal_id, r]))
                : {};

              return (
                <div key={review.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{review.review_period}</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(review.review_date), "MMMM d, yyyy")}
                        {review.reviewer && <> • Reviewed by {review.reviewer.first_name} {review.reviewer.last_name}</>}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusColors[review.status]}>{review.status}</Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Overall Rating:</span>
                    {renderStars(review.overall_rating)}
                  </div>

                  {/* KPI Ratings Section */}
                  {goals && goals.length > 0 && (
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedReview(isExpanded ? null : review.id)}
                        className="gap-2"
                      >
                        <Target className="h-4 w-4" />
                        {isExpanded ? "Hide KPI Ratings" : `Rate KPIs (${goals.length})`}
                      </Button>

                      {isExpanded && (
                        <div className="space-y-2 mt-2 rounded-md border p-3 bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-2">
                            {canSelfRate(review.status)
                              ? "Rate each KPI based on your self-assessment:"
                              : "KPI ratings for this review:"}
                          </p>
                          {goals.map((goal) => {
                            const rating = ratingsMap[goal.id];
                            return (
                              <div key={goal.id} className="flex items-center justify-between gap-3 p-2 rounded border bg-background">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{goal.title}</p>
                                  <p className="text-xs text-muted-foreground">{goal.category}</p>
                                </div>
                                <div className="flex flex-col gap-1 items-end">
                                  <RatingStars
                                    label="Self"
                                    value={rating?.employee_rating ?? null}
                                    onChange={canSelfRate(review.status)
                                      ? (r) => upsertRating.mutate({ reviewId: review.id, goalId: goal.id, rating: r })
                                      : undefined}
                                    readonly={!canSelfRate(review.status)}
                                    size="sm"
                                  />
                                  <RatingStars
                                    label="Manager"
                                    value={rating?.manager_rating ?? null}
                                    readonly
                                    size="sm"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {review.strengths && (
                    <div className="space-y-1"><p className="text-sm font-medium text-emerald-600">Strengths</p><p className="text-sm text-muted-foreground">{review.strengths}</p></div>
                  )}
                  {review.areas_for_improvement && (
                    <div className="space-y-1"><p className="text-sm font-medium text-amber-600">Areas for Improvement</p><p className="text-sm text-muted-foreground">{review.areas_for_improvement}</p></div>
                  )}
                  {review.comments && (
                    <div className="space-y-1"><p className="text-sm font-medium">Comments</p><p className="text-sm text-muted-foreground">{review.comments}</p></div>
                  )}

                  {review.status === "submitted" && user && (
                    <div className="pt-2 border-t">
                      <Button size="sm" onClick={() => acknowledgeMutation.mutate({ reviewId: review.id, userId: user.id, employeeName, reviewPeriod: review.review_period })} disabled={acknowledgeMutation.isPending}>
                        <CheckCircle className="h-4 w-4 mr-2" />{acknowledgeMutation.isPending ? "Acknowledging..." : "Acknowledge Review"}
                      </Button>
                    </div>
                  )}

                  {review.acknowledged_at && (
                    <div className="pt-2 border-t text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 inline mr-1 text-emerald-600" />
                      Acknowledged on {format(new Date(review.acknowledged_at), "MMMM d, yyyy")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" /><p>No performance reviews yet</p><p className="text-sm">Reviews will appear here once your manager initiates one</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

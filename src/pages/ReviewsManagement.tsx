import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Star, Loader2, FileText, ShieldX } from "lucide-react";
import { useAllPerformanceReviews, useCreateReview } from "@/hooks/usePerformance";
import { useEmployees } from "@/hooks/useEmployees";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

const REVIEW_PERIODS = [
  "Q1 2024",
  "Q2 2024",
  "Q3 2024",
  "Q4 2024",
  "Q1 2025",
  "Q2 2025",
  "Q3 2025",
  "Q4 2025",
  "Annual 2024",
  "Annual 2025",
];

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary border-primary/20",
  acknowledged: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

const ReviewsManagement = () => {
  const { user } = useAuth();
  const { isAdminOrHR, isLoading: isRoleLoading } = useIsAdminOrHR();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formData, setFormData] = useState({
    employee_id: "",
    review_period: "",
    review_date: new Date().toISOString().split("T")[0],
    overall_rating: 0,
    strengths: "",
    areas_for_improvement: "",
    comments: "",
    status: "draft",
  });

  const { data: reviews, isLoading } = useAllPerformanceReviews();
  const { data: employees } = useEmployees();
  const createMutation = useCreateReview();

  // Filter reviews by status
  const filteredReviews = reviews?.filter((review: any) => 
    statusFilter === "all" ? true : review.status === statusFilter
  );

  // Get current user's employee ID
  const { data: currentEmployee } = useQuery({
    queryKey: ["my-employee-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? null;
    },
    enabled: !!user?.id,
  });

  const resetForm = () => {
    setFormData({
      employee_id: "",
      review_period: "",
      review_date: new Date().toISOString().split("T")[0],
      overall_rating: 0,
      strengths: "",
      areas_for_improvement: "",
      comments: "",
      status: "draft",
    });
  };

  const handleSubmit = async () => {
    if (!formData.employee_id || !formData.review_period) return;

    await createMutation.mutateAsync({
      employee_id: formData.employee_id,
      reviewer_id: currentEmployee?.id || null,
      review_period: formData.review_period,
      review_date: formData.review_date,
      overall_rating: formData.overall_rating || null,
      strengths: formData.strengths || undefined,
      areas_for_improvement: formData.areas_for_improvement || undefined,
      comments: formData.comments || undefined,
      status: formData.status,
    });

    setIsDialogOpen(false);
    resetForm();
  };

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-muted-foreground">-</span>;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-3.5 w-3.5 ${
              star <= rating ? "text-amber-500 fill-amber-500" : "text-muted-foreground"
            }`}
          />
        ))}
      </div>
    );
  };

  const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="p-1 hover:scale-110 transition-transform"
        >
          <Star
            className={`h-6 w-6 ${
              star <= value ? "text-amber-500 fill-amber-500" : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
      {value > 0 && (
        <span className="ml-2 text-sm text-muted-foreground">{value}/5</span>
      )}
    </div>
  );

  if (isRoleLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdminOrHR) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Reviews Management</h2>
            <p className="text-muted-foreground">Create and manage performance reviews</p>
          </div>
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldX className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">Access Denied</h3>
              <p className="mt-2 text-muted-foreground">
                Only HR and Admin users can manage performance reviews.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Reviews Management</h2>
            <p className="text-muted-foreground">Create and manage employee performance reviews</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Review
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredReviews && filteredReviews.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReviews.map((review: any) => (
                    <TableRow key={review.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {review.employee?.first_name?.[0]}{review.employee?.last_name?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {review.employee?.first_name} {review.employee?.last_name}
                            </p>
                            <p className="text-xs text-muted-foreground">{review.employee?.designation}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{review.review_period}</TableCell>
                      <TableCell>{format(new Date(review.review_date), "MMM d, yyyy")}</TableCell>
                      <TableCell>{renderStars(review.overall_rating)}</TableCell>
                      <TableCell>
                        {review.reviewer 
                          ? `${review.reviewer.first_name} ${review.reviewer.last_name}`
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[review.status]}>
                          {review.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Reviews Yet</h3>
              <p className="mt-2 text-muted-foreground">Create the first performance review</p>
            </CardContent>
          </Card>
        )}

        {/* Create Review Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Performance Review</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select
                    value={formData.employee_id}
                    onValueChange={(value) => setFormData({ ...formData, employee_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Review Period</Label>
                  <Select
                    value={formData.review_period}
                    onValueChange={(value) => setFormData({ ...formData, review_period: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      {REVIEW_PERIODS.map((period) => (
                        <SelectItem key={period} value={period}>
                          {period}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Review Date</Label>
                  <Input
                    type="date"
                    value={formData.review_date}
                    onChange={(e) => setFormData({ ...formData, review_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Overall Rating</Label>
                <StarRating
                  value={formData.overall_rating}
                  onChange={(v) => setFormData({ ...formData, overall_rating: v })}
                />
              </div>

              <div className="space-y-2">
                <Label>Strengths</Label>
                <Textarea
                  value={formData.strengths}
                  onChange={(e) => setFormData({ ...formData, strengths: e.target.value })}
                  placeholder="What are the employee's key strengths?"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Areas for Improvement</Label>
                <Textarea
                  value={formData.areas_for_improvement}
                  onChange={(e) => setFormData({ ...formData, areas_for_improvement: e.target.value })}
                  placeholder="What areas could the employee improve?"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Additional Comments</Label>
                <Textarea
                  value={formData.comments}
                  onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                  placeholder="Any additional feedback or comments..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!formData.employee_id || !formData.review_period || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Review
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default ReviewsManagement;

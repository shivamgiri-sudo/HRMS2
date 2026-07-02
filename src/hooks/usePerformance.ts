import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export interface Goal {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  progress: number;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  employee_rating: number | null;
  manager_rating: number | null;
}

export interface PerformanceReview {
  id: string;
  employee_id: string;
  reviewer_id: string | null;
  review_period: string;
  review_date: string;
  overall_rating: number | null;
  strengths: string | null;
  areas_for_improvement: string | null;
  comments: string | null;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  reviewer?: { first_name: string; last_name: string } | null;
}

export function useGoals(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["goals", employeeId],
    queryFn: async () => {
      if (!employeeId) return [];

      const res = await hrmsApi.get<{ data: any[] }>(`/api/goals/goals?employee_id=${employeeId}`);
      return (res.data ?? []) as Goal[];
    },
    enabled: !!employeeId,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (goal: {
      employee_id: string;
      title: string;
      description?: string;
      category?: string;
      priority?: string;
      due_date?: string;
    }) => {
      const res = await hrmsApi.post<{ data: any }>("/api/goals/goals", goal);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["goals", variables.employee_id] });
      toast.success("Goal created successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to create goal: " + error.message);
    },
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, employeeId, ...updates }: { id: string; employeeId: string; [key: string]: unknown }) => {
      await hrmsApi.patch(`/api/goals/goals/${id}`, updates);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["goals", variables.employeeId] });
      toast.success("Goal updated");
    },
    onError: (error: Error) => {
      toast.error("Failed to update goal: " + error.message);
    },
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, employeeId }: { id: string; employeeId: string }) => {
      try {
        await hrmsApi.delete(`/api/goals/goals/${id}`);
      } catch {
        // Fallback: soft-delete via PATCH if DELETE is not available
        await hrmsApi.patch(`/api/goals/goals/${id}`, { status: "deleted" });
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["goals", variables.employeeId] });
      toast.success("Goal deleted");
    },
    onError: (error: Error) => {
      toast.error("Failed to delete goal: " + error.message);
    },
  });
}

export function usePerformanceReviews(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["performance-reviews", employeeId],
    queryFn: async () => {
      if (!employeeId) return [];

      const res = await hrmsApi.get<{ data: any[] }>(
        `/api/performance-feedback/reports?employeeId=${employeeId}`
      );
      return (res.data ?? []) as PerformanceReview[];
    },
    enabled: !!employeeId,
  });
}

export function useAllPerformanceReviews() {
  return useQuery({
    queryKey: ["all-performance-reviews"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/performance-feedback/reports");
      return res.data ?? [];
    },
  });
}

export function useCreateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (review: {
      employee_id: string;
      reviewer_id: string | null;
      reviewer_name?: string;
      review_period: string;
      review_date: string;
      overall_rating: number | null;
      strengths?: string;
      areas_for_improvement?: string;
      comments?: string;
      status?: string;
    }) => {
      const { reviewer_name, ...reviewData } = review;

      const res = await hrmsApi.post<{ data: any }>("/api/performance-feedback/reports", reviewData);
      const data = res.data;

      // Fire-and-forget notification via communication dispatch
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "performance_review_created",
        recipient_employee_ids: [review.employee_id],
        data: {
          review_id: data?.id,
          employee_id: review.employee_id,
          reviewer_name: reviewer_name || "HR Team",
          review_period: review.review_period,
          overall_rating: review.overall_rating,
          status: review.status || "draft",
        },
        channel: "email",
      }).catch(() => {});

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["all-performance-reviews"] });
      toast.success("Performance review created successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to create review: " + error.message);
    },
  });
}

export function useUpdateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      review_period?: string;
      overall_rating?: number | null;
      strengths?: string;
      areas_for_improvement?: string;
      comments?: string;
      status?: string;
    }) => {
      await hrmsApi.patch(`/api/performance-feedback/reports/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["all-performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["team-reviews-by-manager"] });
      toast.success("Review updated successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to update review: " + error.message);
    },
  });
}

export function useAcknowledgeReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      reviewId,
      userId,
      employeeName,
      reviewPeriod,
    }: {
      reviewId: string;
      userId: string;
      employeeName: string;
      reviewPeriod: string;
    }) => {
      await hrmsApi.patch(`/api/performance-feedback/reports/${reviewId}`, {
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userId,
        status: "acknowledged",
      });

      // Fire-and-forget notification
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "performance_review_acknowledged",
        recipient_employee_ids: [],
        data: {
          review_id: reviewId,
          employee_name: employeeName,
          review_period: reviewPeriod,
        },
        channel: "email",
      }).catch(() => {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["all-performance-reviews"] });
      toast.success("Review acknowledged");
    },
    onError: (error: Error) => {
      toast.error("Failed to acknowledge review: " + error.message);
    },
  });
}

export function useDeleteReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reviewId: string) => {
      await hrmsApi.patch(`/api/performance-feedback/reports/${reviewId}`, { status: "deleted" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["all-performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["team-reviews-by-manager"] });
      toast.success("Review deleted");
    },
    onError: (error: Error) => {
      toast.error("Failed to delete review: " + error.message);
    },
  });
}

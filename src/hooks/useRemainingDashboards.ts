import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

// Quality Analytics
export function useQualityAnalytics(enabled = true) {
  return useQuery({
    queryKey: ["quality", "analytics"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success?: boolean; data?: any }>("/quality-dashboard/analytics");
      return res.data ?? res;
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

// Operations Analytics
export function useOperationsAnalytics(enabled = true) {
  return useQuery({
    queryKey: ["operations", "analytics"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success?: boolean; data?: any }>("/operations/analytics");
      return res.data ?? res;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

// Recruiter Analytics
export function useRecruiterAnalytics(enabled = true) {
  return useQuery({
    queryKey: ["recruiter", "analytics"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success?: boolean; data?: any }>("/ats/recruiter-analytics");
      return res.data ?? res;
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

// Super Admin Analytics
export function useSuperAdminAnalytics(enabled = true) {
  return useQuery({
    queryKey: ["superadmin", "analytics"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success?: boolean; data?: any }>("/admin/super-admin/analytics");
      return res.data ?? res;
    },
    enabled,
    staleTime: 3 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

// IT Manager Analytics
export function useItAnalytics(enabled = true) {
  return useQuery({
    queryKey: ["it", "analytics"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success?: boolean; data?: any }>("/provisioning/it-manager/analytics");
      return res.data ?? res;
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

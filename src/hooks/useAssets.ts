import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/utils";
import { useMemo } from "react";

export interface Asset {
  id: string;
  name: string;
  type: "laptop" | "monitor" | "phone" | "accessory" | string;
  serialNumber: string;
  purchaseDate: string;
  cost: number;
  status: "available" | "assigned" | "maintenance" | "repair" | "retired" | "lost";
  notes?: string;
  assignedTo?: {
    name: string;
    avatar?: string;
  };
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/assets-mgmt");
      return (res.data ?? []).map((a: any): Asset => ({
        id: a.id,
        name: a.asset_name,
        type: (a.asset_category ?? "accessory").toLowerCase() as Asset["type"],
        serialNumber: a.serial_number ?? "",
        purchaseDate: a.purchase_date
          ? format(parseLocalDate(a.purchase_date), "MMM d, yyyy")
          : "Unknown",
        cost: Number(a.purchase_cost ?? 0),
        status: (a.status ?? "available") as Asset["status"],
        notes: a.notes ?? undefined,
        assignedTo: (() => {
          const ca = typeof a.current_assignment === "string"
            ? (() => { try { return JSON.parse(a.current_assignment); } catch { return null; } })()
            : a.current_assignment;
          return ca ? { name: ca.employee_name ?? String(ca.employee_id) } : undefined;
        })(),
      }));
    },
  });
}

export function useAssetStats() {
  const { data: assets, isLoading, error } = useAssets();
  const stats = useMemo(() => {
    if (!assets) return null;
    return {
      total: assets.length,
      available: assets.filter((a) => a.status === "available").length,
      assigned: assets.filter((a) => a.status === "assigned").length,
      maintenance: assets.filter((a) => a.status === "maintenance" || a.status === "repair").length,
      laptops: assets.filter((a) => a.type === "laptop").length,
      monitors: assets.filter((a) => a.type === "monitor").length,
      phones: assets.filter((a) => a.type === "phone").length,
    };
  }, [assets]);
  return { data: stats, isLoading, error };
}

export interface CreateAssetData {
  name: string;
  category: string;
  serial_number?: string;
  purchase_date?: string;
  purchase_cost?: number;
  vendor?: string;
  warranty_end_date?: string;
  notes?: string;
}

export function useCreateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAssetData) => {
      const res = await hrmsApi.post<{ data: any }>("/api/assets-mgmt", {
        asset_name: data.name,
        asset_category: data.category,
        serial_number: data.serial_number ?? null,
        purchase_date: data.purchase_date ?? null,
        purchase_cost: data.purchase_cost ?? null,
        vendor: data.vendor ?? null,
        warranty_expiry: data.warranty_end_date ?? null,
        notes: data.notes ?? null,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}

export interface UpdateAssetData {
  id: string;
  name?: string;
  category?: string;
  serial_number?: string;
  purchase_date?: string;
  purchase_cost?: number;
  vendor?: string;
  warranty_end_date?: string;
  notes?: string;
  status?: Asset["status"];
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateAssetData) => {
      return hrmsApi.put<{ data: any }>(`/api/assets-mgmt/${id}`, {
        asset_name: data.name ?? null,
        status: data.status ?? null,
        notes: data.notes ?? null,
        serial_number: data.serial_number ?? null,
        asset_category: data.category ?? null,
        purchase_date: data.purchase_date ?? null,
        purchase_cost: data.purchase_cost ?? null,
        vendor: data.vendor ?? null,
        warranty_expiry: data.warranty_end_date ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => hrmsApi.delete<{ data: any }>(`/api/assets-mgmt/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}

export interface AssignAssetData {
  assetId: string;
  employeeId: string;
  notes?: string;
}

export function useAssignAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assetId, employeeId, notes }: AssignAssetData) => {
      return hrmsApi.post(`/api/assets-mgmt/${assetId}/assign`, {
        employee_id: employeeId,
        notes: notes ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    },
  });
}

export function useReturnAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assetId: string) => {
      return hrmsApi.post(`/api/assets-mgmt/${assetId}/return`, { condition: "good" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      queryClient.invalidateQueries({ queryKey: ["asset-history"] });
    },
  });
}

export interface AssetAssignment {
  id: string;
  assignedDate: string;
  returnedDate: string | null;
  notes: string | null;
  employee: {
    name: string;
    avatar?: string;
  };
}

export function useAssetHistory(assetId: string | null) {
  return useQuery({
    queryKey: ["asset-history", assetId],
    queryFn: async (): Promise<AssetAssignment[]> => {
      if (!assetId) return [];
      const res = await hrmsApi.get<{ data: any[] }>(`/api/assets-mgmt/${assetId}/history`);
      return (res.data ?? []).map((row: any) => ({
        id: row.id,
        assignedDate: row.assigned_date ? format(parseLocalDate(row.assigned_date), "MMM d, yyyy") : "",
        returnedDate: row.returned_date ? format(parseLocalDate(row.returned_date), "MMM d, yyyy") : null,
        notes: row.notes ?? null,
        employee: {
          name: row.employee_name || row.employee_code || "Unknown employee",
          avatar: row.avatar_url ?? row.photo_url ?? undefined,
        },
      }));
    },
    enabled: !!assetId,
  });
}

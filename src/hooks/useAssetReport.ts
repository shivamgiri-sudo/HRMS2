import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/utils";

export interface AssetReportRecord {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  serialNumber: string;
  status: string;
  purchaseDate: string;
  purchaseCost: number;
  warrantyEndDate: string;
  vendor: string;
  assignedTo?: string;
}

export interface AssetReport {
  totalAssets: number;
  totalValue: number;
  byStatus: { status: string; count: number }[];
  byCategory: { category: string; count: number }[];
  records: AssetReportRecord[];
}

export function useAssetReport() {
  return useQuery({
    queryKey: ["asset-report"],
    queryFn: async (): Promise<AssetReport> => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/assets-mgmt");
      const assets = res.data ?? [];
      const totalAssets = assets.length;
      const totalValue = assets.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0);
      const statusCounts = new Map<string, number>();
      assets.forEach((a) => { statusCounts.set(a.status, (statusCounts.get(a.status) || 0) + 1); });
      const byStatus = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));
      const categoryCounts = new Map<string, number>();
      assets.forEach((a) => { categoryCounts.set(a.category, (categoryCounts.get(a.category) || 0) + 1); });
      const byCategory = Array.from(categoryCounts.entries()).map(([category, count]) => ({ category, count }));
      const records: AssetReportRecord[] = assets.map((asset) => ({
        id: asset.id,
        assetCode: asset.asset_code,
        name: asset.name,
        category: asset.category,
        serialNumber: asset.serial_number || "-",
        status: asset.status,
        purchaseDate: asset.purchase_date ? format(parseLocalDate(asset.purchase_date), "MMM d, yyyy") : "-",
        purchaseCost: Number(asset.purchase_cost) || 0,
        warrantyEndDate: asset.warranty_end_date ? format(parseLocalDate(asset.warranty_end_date), "MMM d, yyyy") : "-",
        vendor: asset.vendor || "-",
        assignedTo: asset.assigned_to_name || "-",
      }));
      return { totalAssets, totalValue, byStatus, byCategory, records };
    },
  });
}

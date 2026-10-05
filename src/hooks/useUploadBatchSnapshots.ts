import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface UploadBatchSnapshot {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string | null;
  batch_status: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported_rows: number;
  status_breakdown: Record<string, number> | null;
  error_breakdown: Record<string, number> | null;
  sample_errors: Array<{ row_no: number; errors: string }> | null;
  rows_at_purge: number;
  rows_deleted: number;
  rows_purged_at: string | null;
  batch_created_at: string | null;
  snapshot_at: string;
}

interface SnapshotListResponse {
  success: boolean;
  data: {
    snapshots: UploadBatchSnapshot[];
    total: number;
  };
}

export function useUploadBatchSnapshots(
  type?: string,
  limit: number = 50,
  offset: number = 0
) {
  return useQuery({
    queryKey: ["upload-batch-snapshots", type, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      if (type) params.set("type", type);

      // hrmsApi returns the parsed body (no axios-style .data wrapper). "@/lib/api-client" never existed.
      const response = await hrmsApi.get<SnapshotListResponse>(
        `/api/bulk-upload/snapshots?${params}`
      );
      return response.data;
    },
    staleTime: 10 * 60 * 1000, // 10min
    gcTime: 15 * 60 * 1000,
  });
}

export function useUploadBatchSnapshot(snapshotId: string) {
  return useQuery({
    queryKey: ["upload-batch-snapshot", snapshotId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: UploadBatchSnapshot }>(
        `/api/bulk-upload/snapshots/${encodeURIComponent(snapshotId)}`
      );
      return response.data;
    },
    enabled: !!snapshotId,
    staleTime: 30 * 60 * 1000, // 30min (snapshots immutable)
    gcTime: 60 * 60 * 1000,
  });
}

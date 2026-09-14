import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** Branch Budget foundation (PR 9): per-user saved grid-matrix views (pinned columns, filters).
 *  Generic across modules via `moduleKey` — Branch Budget's grid matrix is the first consumer. */
export interface SavedViewRecord {
  id: string;
  userId: string;
  moduleKey: string;
  viewName: string;
  config: unknown;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useSavedViews(moduleKey: string) {
  const queryClient = useQueryClient();

  const savedViewsQuery = useQuery({
    queryKey: ["saved-views", moduleKey],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: SavedViewRecord[] }>(
        `/api/finance/pnl/saved-views?moduleKey=${encodeURIComponent(moduleKey)}`
      );
      return response.data;
    },
  });

  const saveView = useMutation({
    mutationFn: async ({ viewName, config }: { viewName: string; config: unknown }) => {
      const response = await hrmsApi.post<{ success: boolean; data: SavedViewRecord }>(
        "/api/finance/pnl/saved-views",
        { moduleKey, viewName, config }
      );
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-views", moduleKey] }),
  });

  const deleteView = useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/api/finance/pnl/saved-views/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-views", moduleKey] }),
  });

  return { savedViewsQuery, saveView, deleteView };
}

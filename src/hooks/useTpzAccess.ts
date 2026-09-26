import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface TpzCompanyAccess { key: string; label: string; dashboards: boolean; upload: boolean; mis: boolean }
export interface TpzAccessMe {
  /** The user may open at least one process / section of TPZ Process. */
  hasAccess: boolean;
  /** A role-based user who has not been narrowed: the page keeps its existing role + page-permission checks for them. */
  roleBased: boolean;
  /** A role-based user an admin has narrowed to their grants. */
  restricted: boolean;
  /** The processes the user may open, with what they may do in each. */
  companies: TpzCompanyAccess[];
}

/** What the signed-in user may do in TPZ Process (Process Performance V2). The API enforces the same rules independently. */
export function useTpzAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tpz-access", "me", user?.id ?? null],
    enabled: !!user?.id,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<TpzAccessMe> => {
      const res = await hrmsApi.get<{ success: boolean; data: TpzAccessMe }>("/api/tpz-access/me");
      return res.data;
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { APP_VERSION, checkForUpdates, VersionResponse } from "@/lib/version";

export function useVersionCheck(enabled: boolean = true) {
  return useQuery<VersionResponse | null>({
    // include APP_VERSION to prevent stale cached nulls across releases/builds
    queryKey: ["version-check", APP_VERSION],
    queryFn: checkForUpdates,
    enabled,
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchInterval: 1000 * 60 * 60 * 6, // Check every 6 hours
    retry: 1,
  });
}

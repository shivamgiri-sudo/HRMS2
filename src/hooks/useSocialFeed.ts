import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type SocialPlatform = "facebook" | "instagram" | "youtube";
export type SocialPlatformFilter = SocialPlatform | "all";

export interface SocialPost {
  id: string;
  platform: SocialPlatform;
  platform_post_id: string;
  content_text: string | null;
  media_url: string | null;
  post_url: string;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  fetched_at: string;
}

interface FeedResponse {
  posts: SocialPost[];
  total: number;
}

export function useSocialFeed(platform: SocialPlatformFilter = "all", page = 1, limit = 10) {
  return useQuery<FeedResponse>({
    queryKey: ["social-feed", platform, page, limit],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(
        `/api/social-feed/posts?platform=${platform}&page=${page}&limit=${limit}`,
      );
      return {
        posts: (res?.posts ?? []) as SocialPost[],
        total: Number(res?.total ?? 0),
      };
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export interface PlatformConfig {
  id: string;
  platform: SocialPlatform;
  page_id: string;
  access_token: string | null;
  token_expiry: string | null;
  enabled: boolean;
  last_synced_at: string | null;
}

interface AdminConfigResponse {
  configs: PlatformConfig[];
  counts: Record<string, number>;
}

export function useSocialFeedAdminConfig() {
  return useQuery<AdminConfigResponse>({
    queryKey: ["social-feed-admin-config"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/social-feed/admin/config");
      return {
        configs: (res?.configs ?? []) as PlatformConfig[],
        counts: (res?.counts ?? {}) as Record<string, number>,
      };
    },
    staleTime: 60_000,
  });
}

export function useSaveSocialConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      platform: SocialPlatform;
      page_id: string;
      plain_token?: string;
      token_expiry?: string | null;
      enabled?: boolean;
    }) => {
      await hrmsApi.post("/api/social-feed/admin/config", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-feed-admin-config"] });
    },
  });
}

export function useSyncSocialFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<any>("/api/social-feed/admin/sync", {});
      return res?.synced as Record<string, number>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-feed"] });
      qc.invalidateQueries({ queryKey: ["social-feed-admin-config"] });
    },
  });
}

// ── Public profile links (social_profile_link, migration 1656) ─────────────

export const SOCIAL_LINK_PLATFORMS = [
  "website",
  "linkedin",
  "instagram",
  "twitter",
  "facebook",
  "youtube",
] as const;

export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number];

export interface SocialProfileLink {
  platform: SocialLinkPlatform;
  label: string;
  profile_url: string;
  handle: string | null;
  display_order: number;
  enabled: boolean;
}

/**
 * Compiled-in fallback, used when the endpoint is unreachable or migration 1656
 * has not been applied. Kept identical to the seed rows in that migration and to
 * SOCIAL_LINK_DEFAULTS on the backend — the login page must render its icon row
 * even when the API is down, so these values cannot simply be dropped.
 */
export const SOCIAL_LINK_DEFAULTS: Record<
  SocialLinkPlatform,
  { label: string; profile_url: string; handle: string; display_order: number }
> = {
  website:   { label: "Website",   profile_url: "https://mascallnet.ai",                        handle: "mascallnet.ai", display_order: 1 },
  linkedin:  { label: "LinkedIn",  profile_url: "https://www.linkedin.com/company/mas-callnet", handle: "mas-callnet",   display_order: 2 },
  instagram: { label: "Instagram", profile_url: "https://instagram.com/mascallnet",             handle: "@mascallnet",   display_order: 3 },
  twitter:   { label: "X",         profile_url: "https://twitter.com/MASCallnet",               handle: "@MASCallnet",   display_order: 4 },
  facebook:  { label: "Facebook",  profile_url: "https://www.facebook.com/TeamMas9",            handle: "TeamMas9",      display_order: 5 },
  youtube:   { label: "YouTube",   profile_url: "https://youtube.com/@MasCallnet",              handle: "@MasCallnet",   display_order: 6 },
};

export function defaultSocialLinks(): SocialProfileLink[] {
  return SOCIAL_LINK_PLATFORMS.map((platform) => ({
    platform,
    ...SOCIAL_LINK_DEFAULTS[platform],
    enabled: true,
  }));
}

/**
 * Reads the public links. Uses the unauthenticated endpoint so the same hook
 * works on the login screen, and never surfaces an error state — a failed read
 * resolves to the bundled defaults.
 */
export function useSocialProfileLinks() {
  return useQuery<SocialProfileLink[]>({
    queryKey: ["social-profile-links"],
    queryFn: async () => {
      try {
        const res = await hrmsApi.get<any>("/api/public/social-links");
        const links = (res?.links ?? []) as SocialProfileLink[];
        return links.length ? links : defaultSocialLinks();
      } catch {
        return defaultSocialLinks();
      }
    },
    initialData: defaultSocialLinks,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

/** Convenience: platform -> link, always complete (defaults fill any gap). */
export function useSocialLinkMap(): Record<SocialLinkPlatform, SocialProfileLink> {
  const { data } = useSocialProfileLinks();
  const map = {} as Record<SocialLinkPlatform, SocialProfileLink>;
  for (const platform of SOCIAL_LINK_PLATFORMS) {
    map[platform] = { platform, ...SOCIAL_LINK_DEFAULTS[platform], enabled: true };
  }
  for (const link of data ?? []) {
    if (map[link.platform]) map[link.platform] = link;
  }
  return map;
}

export function useAdminSocialProfileLinks() {
  return useQuery<SocialProfileLink[]>({
    queryKey: ["social-profile-links-admin"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/social-feed/admin/profile-links");
      return (res?.links ?? []) as SocialProfileLink[];
    },
    staleTime: 60_000,
  });
}

export function useSaveSocialProfileLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (links: Array<{
      platform: SocialLinkPlatform;
      profile_url: string;
      handle?: string | null;
      enabled?: boolean;
    }>) => {
      await hrmsApi.put("/api/social-feed/admin/profile-links", { links });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-profile-links"] });
      qc.invalidateQueries({ queryKey: ["social-profile-links-admin"] });
    },
  });
}

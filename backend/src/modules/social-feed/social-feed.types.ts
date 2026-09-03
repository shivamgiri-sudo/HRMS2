export type SocialPlatform = 'facebook' | 'instagram' | 'youtube';

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

export interface PlatformConfig {
  id: string;
  platform: SocialPlatform;
  page_id: string;
  access_token: string | null;
  token_expiry: string | null;
  enabled: boolean;
  last_synced_at: string | null;
}

export interface SaveConfigInput {
  platform: SocialPlatform;
  page_id: string;
  access_token?: string | null;
  token_expiry?: string | null;
  enabled?: boolean;
}

export interface FetchedPost {
  platform_post_id: string;
  content_text: string | null;
  media_url: string | null;
  post_url: string;
  like_count: number;
  comment_count: number;
  published_at: string | null;
}

// ── Public profile links (social_profile_link, migration 1656) ─────────────
// Distinct from PlatformConfig above: that one holds API credentials for the
// three platforms the sync job can pull posts from, this one holds the public
// URLs the login page and the feed cards link out to, for six destinations.

export const SOCIAL_LINK_PLATFORMS = [
  'website',
  'linkedin',
  'instagram',
  'twitter',
  'facebook',
  'youtube',
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

export interface SaveProfileLinkInput {
  platform: SocialLinkPlatform;
  profile_url: string;
  handle?: string | null;
  enabled?: boolean;
}

/**
 * Label + ordering + fallback URL for each link, mirroring the seed rows in
 * migration 1656. Used to upsert a row whose seed is missing rather than
 * silently updating zero rows, and as the payload the public endpoint serves
 * when the table has not been created yet.
 */
export const SOCIAL_LINK_DEFAULTS: Record<SocialLinkPlatform, { label: string; profile_url: string; handle: string; display_order: number }> = {
  website:   { label: 'Website',   profile_url: 'https://mascallnet.ai',                        handle: 'mascallnet.ai', display_order: 1 },
  linkedin:  { label: 'LinkedIn',  profile_url: 'https://www.linkedin.com/company/mas-callnet', handle: 'mas-callnet',   display_order: 2 },
  instagram: { label: 'Instagram', profile_url: 'https://instagram.com/mascallnet',             handle: '@mascallnet',   display_order: 3 },
  twitter:   { label: 'X',         profile_url: 'https://twitter.com/MASCallnet',               handle: '@MASCallnet',   display_order: 4 },
  facebook:  { label: 'Facebook',  profile_url: 'https://www.facebook.com/TeamMas9',            handle: 'TeamMas9',      display_order: 5 },
  youtube:   { label: 'YouTube',   profile_url: 'https://youtube.com/@MasCallnet',              handle: '@MasCallnet',   display_order: 6 },
};

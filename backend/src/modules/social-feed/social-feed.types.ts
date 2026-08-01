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

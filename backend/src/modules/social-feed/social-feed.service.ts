import { decryptSecretPayload } from '../external-db/external-db.service.js';
import { encryptSecretPayload } from '../external-db/external-db.service.js';
import * as repo from './social-feed.repository.js';
import { fetchFacebookPosts } from './social-feed.adapters/facebook.adapter.js';
import { fetchInstagramPosts } from './social-feed.adapters/instagram.adapter.js';
import { fetchYouTubePosts } from './social-feed.adapters/youtube.adapter.js';
import type { SocialPlatform, SaveConfigInput, SocialProfileLink, SaveProfileLinkInput } from './social-feed.types.js';
import { SOCIAL_LINK_PLATFORMS, SOCIAL_LINK_DEFAULTS } from './social-feed.types.js';

async function syncPlatform(platform: SocialPlatform): Promise<number> {
  const config = await repo.getConfig(platform);
  if (!config) return 0;

  let posts;
  switch (platform) {
    case 'facebook': {
      if (!config.access_token) return 0;
      const token = String(decryptSecretPayload(config.access_token)['token'] ?? config.access_token);
      posts = await fetchFacebookPosts(config.page_id, token);
      break;
    }
    case 'instagram': {
      if (!config.access_token) return 0;
      const token = String(decryptSecretPayload(config.access_token)['token'] ?? config.access_token);
      posts = await fetchInstagramPosts(config.page_id, token);
      break;
    }
    case 'youtube': {
      posts = await fetchYouTubePosts(config.page_id);
      break;
    }
    default:
      return 0;
  }

  for (const post of posts) {
    await repo.upsertPost(platform, post);
  }
  await repo.markSynced(platform);
  return posts.length;
}

export async function syncAllPlatforms(): Promise<Record<SocialPlatform, number>> {
  const platforms: SocialPlatform[] = ['facebook', 'instagram', 'youtube'];
  const results: Record<string, number> = {};

  await Promise.allSettled(
    platforms.map(async (p) => {
      try {
        results[p] = await syncPlatform(p);
      } catch (err) {
        console.error(`[social-feed] sync ${p} failed:`, err);
        results[p] = 0;
      }
    }),
  );

  return results as Record<SocialPlatform, number>;
}

export async function getPosts(
  platform: SocialPlatform | 'all',
  page: number,
  limit: number,
) {
  return repo.getPosts(platform, page, limit);
}

export async function getAdminConfigs() {
  const configs = await repo.getAllConfigs();
  return configs.map((c) => ({
    ...c,
    access_token: c.access_token ? '***' : null,
  }));
}

export async function saveAdminConfig(input: SaveConfigInput & { plainToken?: string }) {
  const { plainToken, ...rest } = input;
  const toSave: SaveConfigInput = { ...rest };
  if (plainToken) {
    toSave.access_token = encryptSecretPayload({ token: plainToken });
  }
  await repo.saveConfig(toSave);
}

export async function getPostCounts() {
  const platforms: SocialPlatform[] = ['facebook', 'instagram', 'youtube'];
  const counts: Record<string, number> = {};
  await Promise.all(
    platforms.map(async (p) => {
      counts[p] = await repo.getPostCount(p);
    }),
  );
  return counts;
}

// ── Public profile links (social_profile_link, migration 1656) ─────────────

/**
 * The six public company social URLs, always complete: any platform the table
 * has no row for (migration 1656 unapplied, or a row deleted by hand) is filled
 * from SOCIAL_LINK_DEFAULTS, which carries the same values the frontend bundle
 * falls back to. Callers therefore never have to handle a partial list.
 */
export async function getProfileLinks(): Promise<SocialProfileLink[]> {
  const stored = await repo.getProfileLinks();
  const byPlatform = new Map(stored.map((l) => [l.platform, l]));

  return SOCIAL_LINK_PLATFORMS.map((platform) => {
    const row = byPlatform.get(platform);
    if (row) return row;
    const d = SOCIAL_LINK_DEFAULTS[platform];
    return {
      platform,
      label: d.label,
      profile_url: d.profile_url,
      handle: d.handle,
      display_order: d.display_order,
      enabled: true,
    };
  }).sort((a, b) => a.display_order - b.display_order);
}

export async function saveProfileLinks(
  links: SaveProfileLinkInput[],
  updatedBy: string | null,
): Promise<void> {
  for (const link of links) {
    await repo.saveProfileLink(link, updatedBy);
  }
}

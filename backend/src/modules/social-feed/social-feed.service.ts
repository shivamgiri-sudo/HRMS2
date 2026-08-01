import { decryptSecretPayload } from '../external-db/external-db.service.js';
import { encryptSecretPayload } from '../external-db/external-db.service.js';
import * as repo from './social-feed.repository.js';
import { fetchFacebookPosts } from './social-feed.adapters/facebook.adapter.js';
import { fetchInstagramPosts } from './social-feed.adapters/instagram.adapter.js';
import { fetchYouTubePosts } from './social-feed.adapters/youtube.adapter.js';
import type { SocialPlatform, SaveConfigInput } from './social-feed.types.js';

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

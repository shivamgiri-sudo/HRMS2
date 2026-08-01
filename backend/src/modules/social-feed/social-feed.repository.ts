import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, OkPacket } from 'mysql2';
import type { SocialPost, PlatformConfig, FetchedPost, SocialPlatform, SaveConfigInput } from './social-feed.types.js';

export async function getPosts(
  platform: SocialPlatform | 'all',
  page: number,
  limit: number,
): Promise<{ posts: SocialPost[]; total: number }> {
  const offset = (page - 1) * limit;
  const wherePlatform = platform !== 'all' ? 'AND platform = ?' : '';
  const params: unknown[] = platform !== 'all' ? [platform, limit, offset] : [limit, offset];

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, platform, platform_post_id, content_text, media_url, post_url,
            like_count, comment_count, published_at, fetched_at
     FROM social_feed_post
     WHERE is_active = 1 ${wherePlatform}
     ORDER BY published_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  const countParams: unknown[] = platform !== 'all' ? [platform] : [];
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM social_feed_post WHERE is_active = 1 ${wherePlatform}`,
    countParams,
  );

  return {
    posts: rows as SocialPost[],
    total: Number((countRows[0] as any)?.total ?? 0),
  };
}

export async function upsertPost(platform: SocialPlatform, post: FetchedPost): Promise<void> {
  const id = uuidv4();
  await db.query<OkPacket>(
    `INSERT INTO social_feed_post
       (id, platform, platform_post_id, content_text, media_url, post_url, like_count, comment_count, published_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       content_text  = VALUES(content_text),
       media_url     = VALUES(media_url),
       like_count    = VALUES(like_count),
       comment_count = VALUES(comment_count),
       fetched_at    = NOW()`,
    [
      id,
      platform,
      post.platform_post_id,
      post.content_text,
      post.media_url,
      post.post_url,
      post.like_count,
      post.comment_count,
      post.published_at,
    ],
  );
}

export async function getAllConfigs(): Promise<PlatformConfig[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, platform, page_id, access_token, token_expiry, enabled, last_synced_at
     FROM social_platform_config
     ORDER BY platform`,
  );
  return rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) })) as PlatformConfig[];
}

export async function getConfig(platform: SocialPlatform): Promise<PlatformConfig | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, platform, page_id, access_token, token_expiry, enabled, last_synced_at
     FROM social_platform_config
     WHERE platform = ? AND enabled = 1`,
    [platform],
  );
  if (!rows.length) return null;
  return { ...rows[0], enabled: Boolean(rows[0].enabled) } as PlatformConfig;
}

export async function saveConfig(input: SaveConfigInput): Promise<void> {
  const id = uuidv4();
  await db.query<OkPacket>(
    `INSERT INTO social_platform_config (id, platform, page_id, access_token, token_expiry, enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       page_id      = VALUES(page_id),
       access_token = COALESCE(VALUES(access_token), access_token),
       token_expiry = VALUES(token_expiry),
       enabled      = VALUES(enabled)`,
    [
      id,
      input.platform,
      input.page_id,
      input.access_token ?? null,
      input.token_expiry ?? null,
      input.enabled !== false ? 1 : 0,
    ],
  );
}

export async function markSynced(platform: SocialPlatform): Promise<void> {
  await db.query<OkPacket>(
    `UPDATE social_platform_config SET last_synced_at = NOW() WHERE platform = ?`,
    [platform],
  );
}

export async function getPostCount(platform: SocialPlatform): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM social_feed_post WHERE platform = ? AND is_active = 1`,
    [platform],
  );
  return Number((rows[0] as any)?.cnt ?? 0);
}

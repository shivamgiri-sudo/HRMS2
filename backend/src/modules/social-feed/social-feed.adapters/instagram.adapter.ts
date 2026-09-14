import type { FetchedPost } from '../social-feed.types.js';

export async function fetchInstagramPosts(
  igUserId: string,
  accessToken: string,
): Promise<FetchedPost[]> {
  const fields = 'id,caption,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,media_type';
  const url = `https://graph.facebook.com/v19.0/${igUserId}/media?fields=${fields}&limit=20&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram Graph API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data?: any[] };
  const posts: FetchedPost[] = [];

  for (const item of json.data ?? []) {
    if (!item.permalink) continue;
    // For VIDEO posts, thumbnail_url is the preview image; media_url is the video itself.
    const imageUrl: string | null = item.media_type === 'VIDEO'
      ? (item.thumbnail_url ?? null)
      : (item.media_url ?? null);

    posts.push({
      platform_post_id: String(item.id),
      content_text: item.caption ?? null,
      media_url: imageUrl,
      post_url: item.permalink,
      like_count: Number(item.like_count ?? 0),
      comment_count: Number(item.comments_count ?? 0),
      published_at: item.timestamp ? new Date(item.timestamp).toISOString().slice(0, 19).replace('T', ' ') : null,
    });
  }

  return posts;
}

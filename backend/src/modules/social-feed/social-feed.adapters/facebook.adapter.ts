import type { FetchedPost } from '../social-feed.types.js';

export async function fetchFacebookPosts(
  pageId: string,
  accessToken: string,
): Promise<FetchedPost[]> {
  const fields = 'message,full_picture,permalink_url,created_time,reactions.summary(true),comments.summary(true)';
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=${fields}&limit=20&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook Graph API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data?: any[] };
  const posts: FetchedPost[] = [];

  for (const item of json.data ?? []) {
    if (!item.permalink_url) continue;
    posts.push({
      platform_post_id: String(item.id),
      content_text: item.message ?? null,
      media_url: item.full_picture ?? null,
      post_url: item.permalink_url,
      like_count: Number(item.reactions?.summary?.total_count ?? 0),
      comment_count: Number(item.comments?.summary?.total_count ?? 0),
      published_at: item.created_time ? new Date(item.created_time).toISOString().slice(0, 19).replace('T', ' ') : null,
    });
  }

  return posts;
}

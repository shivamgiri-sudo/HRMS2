import type { FetchedPost } from '../social-feed.types.js';

// YouTube exposes a free public Atom feed per channel — no API key required.
const YT_FEED = 'https://www.youtube.com/feeds/videos.xml';

function extractText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() || null : null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function splitEntries(feedXml: string): string[] {
  const entries: string[] = [];
  let rest = feedXml;
  while (true) {
    const start = rest.indexOf('<entry>');
    const end = rest.indexOf('</entry>');
    if (start === -1 || end === -1) break;
    entries.push(rest.slice(start + 7, end));
    rest = rest.slice(end + 8);
  }
  return entries;
}

export async function fetchYouTubePosts(channelId: string): Promise<FetchedPost[]> {
  const url = `${YT_FEED}?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(url, { headers: { Accept: 'application/atom+xml' } });

  if (!res.ok) {
    throw new Error(`YouTube RSS feed error ${res.status} for channel ${channelId}`);
  }

  const xml = await res.text();
  const entries = splitEntries(xml);
  const posts: FetchedPost[] = [];

  for (const entry of entries.slice(0, 20)) {
    const videoId = extractText(entry, 'yt:videoId');
    if (!videoId) continue;

    const title = extractText(entry, 'title');
    const published = extractText(entry, 'published');
    // Always use maxresdefault — hqdefault from RSS is often a 9KB grey placeholder.
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const description = extractText(entry, 'media:description');
    const postUrl = `https://www.youtube.com/watch?v=${videoId}`;

    posts.push({
      platform_post_id: videoId,
      content_text: description ?? title,
      media_url: thumbnail,
      post_url: postUrl,
      like_count: 0,
      comment_count: 0,
      published_at: published ? new Date(published).toISOString().slice(0, 19).replace('T', ' ') : null,
    });
  }

  return posts;
}

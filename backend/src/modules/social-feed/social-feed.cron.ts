import { syncAllPlatforms } from './social-feed.service.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startSocialFeedCron(): void {
  // Initial sync after 60s startup delay to avoid slowing server boot.
  const initialDelay = setTimeout(async () => {
    console.log('[social-feed-cron] initial sync started');
    try {
      const results = await syncAllPlatforms();
      console.log('[social-feed-cron] initial sync done', results);
    } catch (err) {
      console.error('[social-feed-cron] initial sync error:', err);
    }
  }, 60_000);

  const interval = setInterval(async () => {
    console.log('[social-feed-cron] scheduled sync started');
    try {
      const results = await syncAllPlatforms();
      console.log('[social-feed-cron] scheduled sync done', results);
    } catch (err) {
      console.error('[social-feed-cron] scheduled sync error:', err);
    }
  }, INTERVAL_MS);

  // Ensure the timers do not keep the process alive if it's shutting down.
  if (typeof initialDelay.unref === 'function') initialDelay.unref();
  if (typeof interval.unref === 'function') interval.unref();
}

import { QualityCache } from '../../../lib/cache/quality-cache';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('QualityCache', () => {
  let cache: QualityCache;

  beforeEach(() => {
    cache = new QualityCache();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe('set and get', () => {
    it('stores and retrieves value', async () => {
      const key = 'test:key:1';
      const value = { score: 85, rank: 15 };
      const ttlSeconds = 300;

      await cache.set(key, value, ttlSeconds);
      const result = await cache.get(key);

      expect(result).toEqual(value);
    });

    it('returns null for missing key', async () => {
      const result = await cache.get('nonexistent:key');
      expect(result).toBeNull();
    });

    it('respects TTL expiration', async () => {
      const key = 'test:ttl:key';
      const value = { test: true };

      await cache.set(key, value, 1); // 1 second TTL
      const immediate = await cache.get(key);
      expect(immediate).toEqual(value);

      await new Promise(resolve => setTimeout(resolve, 1100)); // Wait for expiry
      const expired = await cache.get(key);
      expect(expired).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('clears key pattern', async () => {
      await cache.set('agent:1:score', { data: 1 }, 300);
      await cache.set('agent:1:weakness', { data: 2 }, 300);
      await cache.set('agent:2:score', { data: 3 }, 300);

      await cache.invalidate('agent:1:*');

      const score = await cache.get('agent:1:score');
      const weakness = await cache.get('agent:1:weakness');
      const other = await cache.get('agent:2:score');

      expect(score).toBeNull();
      expect(weakness).toBeNull();
      expect(other).toEqual({ data: 3 });
    });
  });

  describe('getOrSet', () => {
    it('returns cached value if exists', async () => {
      const key = 'test:getor:1';
      const cached = { score: 85 };

      await cache.set(key, cached, 300);

      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { score: 90 }; // Different value
      };

      const result = await cache.getOrSet(key, fetcher, 300);

      expect(result).toEqual(cached);
      expect(callCount).toBe(0); // Fetcher not called
    });

    it('fetches and caches if missing', async () => {
      const key = 'test:getor:2';
      let callCount = 0;

      const fetcher = async () => {
        callCount++;
        return { score: 90 };
      };

      const result = await cache.getOrSet(key, fetcher, 300);

      expect(result).toEqual({ score: 90 });
      expect(callCount).toBe(1);

      const cached = await cache.get(key);
      expect(cached).toEqual({ score: 90 });
    });
  });
});

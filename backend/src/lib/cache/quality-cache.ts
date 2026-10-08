/**
 * Quality Cache — in-memory LRU cache for quality dashboard APIs.
 * TTL: 2-10 min per endpoint, max 200 entries (bounded, no memory leak).
 */

import { logger } from '../logger.js';

export type CacheValue = Record<string, unknown> | unknown[];

const MAX_ENTRIES = 200;

class MemoryCache {
  private store = new Map<string, { value: CacheValue; expiresAt: number }>();

  async set(key: string, value: CacheValue, ttlSeconds: number): Promise<void> {
    // Evict oldest entry when at capacity (simple FIFO approximation of LRU)
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.delete(key); // re-insert to update insertion order for FIFO eviction
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get<T extends CacheValue>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value as T;
  }

  async invalidate(pattern: string): Promise<void> {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    for (const k of Array.from(this.store.keys())) {
      if (regex.test(k)) this.store.delete(k);
    }
  }

  async disconnect(): Promise<void> {
    this.store.clear();
  }
}

export class QualityCache {
  private client: MemoryCache | null = null;
  private isConnected = false;

  constructor() {
    this.init();
  }

  private init() {
    try {
      // Use in-memory cache for now (Redis not in dependencies)
      // When Redis is added, replace with redis.createClient()
      this.client = new MemoryCache();
      this.isConnected = true;
      logger.info('Cache initialized (in-memory)');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize cache');
    }
  }

  async set(key: string, value: CacheValue, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.set(key, value, ttlSeconds);
    } catch (err) {
      logger.error({ err, key }, 'Cache set failed');
    }
  }

  async get<T extends CacheValue>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;

    try {
      return await this.client.get<T>(key);
    } catch (err) {
      logger.error({ err, key }, 'Cache get failed');
      return null;
    }
  }

  async getOrSet<T extends CacheValue>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const fresh = await fetcher();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async invalidate(pattern: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.invalidate(pattern);
      logger.info({ pattern }, 'Cache invalidated');
    } catch (err) {
      logger.error({ err, pattern }, 'Cache invalidate failed');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }
}

export const cacheInstance = new QualityCache();

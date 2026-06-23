/**
 * Quality Cache Wrapper
 * Redis-backed caching for quality dashboard APIs
 * TTL: 2-10 min per endpoint
 */

import { logger } from '../logger.js';

export type CacheValue = Record<string, any> | Array<any>;

/**
 * In-memory fallback cache for testing and environments without Redis
 */
class MemoryCache {
  private store = new Map<string, { value: CacheValue; expiresAt: number }>();

  async set(key: string, value: CacheValue, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
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
    const keys = Array.from(this.store.keys()).filter(k => regex.test(k));
    keys.forEach(k => this.store.delete(k));
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
      logger.error('Failed to initialize cache:', err);
    }
  }

  async set(key: string, value: CacheValue, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.set(key, value, ttlSeconds);
    } catch (err) {
      logger.error(`Cache set failed for ${key}:`, err);
    }
  }

  async get<T extends CacheValue>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;

    try {
      return await this.client.get<T>(key);
    } catch (err) {
      logger.error(`Cache get failed for ${key}:`, err);
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
      logger.info(`Cache invalidated pattern ${pattern}`);
    } catch (err) {
      logger.error(`Cache invalidate failed for pattern ${pattern}:`, err);
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

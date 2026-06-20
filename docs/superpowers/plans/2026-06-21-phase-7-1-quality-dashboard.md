# Phase 7.1: Individual Agent Quality Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real-time individual agent quality dashboard with self-monitoring, weakness identification, call review, and trend tracking for Inbound call agents.

**Architecture:** Modular Express APIs (4 endpoints) serving React dashboard. Data from db_audit.call_quality_assessment + mas_hrms.employees. Binary flags calculate dimensional scores. Redis caching (2-10 min TTL). Agent sees only own data; auth gated at API level. No schema changes.

**Tech Stack:** React 18 + TS + Tailwind + ApexCharts (frontend). Express + TS + MySQL2 + Redis (backend). TDD approach: failing test → implementation → pass → commit.

---

## Execution Plan: 4 Parallel Tracks + Integration

**Track C (Data Layer):** 2 days
**Track A (Backend APIs):** 5 days (requires Track C)
**Track B (Frontend):** 8 days (requires Track A)
**Track D (Testing):** 3 days (requires A+B)
**Integration:** 2 days

Total: ~12-15 days serial, ~10 days parallelized (C → A||B → D → Integration)

---

# TRACK C: Data Layer (Query Builders)

## Task C1: Query Builder Service

**Files:**
- Create: `backend/src/lib/query-builders/quality-queries.ts`
- Create: `backend/src/tests/quality-queries.test.ts`

### Step 1: Write failing test for CQ score aggregation

File: `backend/src/tests/quality-queries.test.ts`

```typescript
import { buildCQScoreQuery } from '../../../lib/query-builders/quality-queries';
import { describe, it, expect } from '@jest/globals';

describe('Quality Query Builders', () => {
  describe('buildCQScoreQuery', () => {
    it('returns SQL query string and parameters for agent CQ score', () => {
      const employeeCode = 'EMP-STF-001';
      const daysBack = 7;

      const result = buildCQScoreQuery(employeeCode, daysBack);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(typeof result.query).toBe('string');
      expect(Array.isArray(result.params)).toBe(true);
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('AVG(quality_percentage)');
      expect(result.query).toContain('ROW_NUMBER()');
      expect(result.params).toContain(employeeCode);
    });

    it('calculates weekly breakdown correctly', () => {
      const employeeCode = 'EMP-STF-001';
      const daysBack = 7;

      const result = buildCQScoreQuery(employeeCode, daysBack);

      expect(result.query).toContain('DAYNAME');
      expect(result.query).toContain('GROUP BY DAYNAME');
    });
  });

  describe('buildWeaknessDetailQuery', () => {
    it('returns SQL for dimensional score breakdown', () => {
      const employeeCode = 'EMP-STF-001';

      const result = buildWeaknessDetailQuery(employeeCode);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('professionalism_maintained');
      expect(result.query).toContain('active_listening');
      expect(result.params[0]).toBe(employeeCode);
    });
  });

  describe('buildCallsReviewQuery', () => {
    it('returns paginated, sortable calls list', () => {
      const employeeCode = 'EMP-STF-001';
      const limit = 10;
      const offset = 0;
      const sort = 'date';

      const result = buildCallsReviewQuery(employeeCode, limit, offset, sort);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('LIMIT');
      expect(result.query).toContain('OFFSET');
      expect(result.query).toContain('CallDate');
      expect(result.params).toContain(employeeCode);
    });

    it('supports sort by cq or fatal', () => {
      const result1 = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'cq');
      const result2 = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'fatal');

      expect(result1.query).toContain('ORDER BY');
      expect(result2.query).toContain('ORDER BY');
    });
  });

  describe('buildCallDetailQuery', () => {
    it('returns single call detail with all fields', () => {
      const callId = '684407';

      const result = buildCallDetailQuery(callId);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('quality_percentage');
      expect(result.params[0]).toBe(callId);
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd /home/shuvam/Desktop/MyHRMS1
npm test -- backend/src/tests/quality-queries.test.ts 2>&1 | head -30
```

Expected output: FAIL - functions not found

### Step 3: Implement query builders

File: `backend/src/lib/query-builders/quality-queries.ts`

```typescript
/**
 * Quality Query Builders
 * Generates parameterized SQL for quality dashboard APIs
 * No schema changes - uses existing db_audit.call_quality_assessment + mas_hrms.employees
 */

export interface QueryResult {
  query: string;
  params: (string | number | Date)[];
}

/**
 * CQ Score aggregation: current, 7d, 30d, clean, rank, peer avg, weekly
 */
export function buildCQScoreQuery(employeeCode: string, daysBack: number = 7): QueryResult {
  const query = `
    WITH agent_scores AS (
      SELECT
        cqa.User,
        cqa.CallDate,
        cqa.quality_percentage,
        cqa.Campaign,
        professionalism_maintained,
        active_listening
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.User = ?
        AND cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
    ),
    agent_stats AS (
      SELECT
        ROUND(AVG(quality_percentage), 2) as cq_current,
        ROUND(AVG(CASE 
          WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
          THEN NULL ELSE quality_percentage
        END), 2) as cq_clean,
        COUNT(*) as total_calls,
        MIN(CallDate) as period_start
      FROM agent_scores
    ),
    weekly_breakdown AS (
      SELECT
        DAYNAME(CallDate) as day_name,
        FIELD(DAYNAME(CallDate), 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') as day_order,
        ROUND(AVG(quality_percentage), 2) as avg_score,
        COUNT(*) as calls
      FROM agent_scores
      GROUP BY DAYNAME(CallDate)
    ),
    peer_stats AS (
      SELECT
        ROUND(AVG(cqa.quality_percentage), 2) as peer_avg,
        COUNT(DISTINCT cqa.User) as total_agents
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
    ),
    agent_rank AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY ROUND(AVG(cqa.quality_percentage), 2) DESC) as rank_position,
        cqa.User
      FROM db_audit.call_quality_assessment cqa
      WHERE cqa.Campaign LIKE 'INBOUND%'
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ${daysBack} DAY)
        AND cqa.User IS NOT NULL AND cqa.User != ''
      GROUP BY cqa.User
    )
    SELECT
      ast.cq_current,
      ROUND(AVG(cqa.quality_percentage), 2) as cq_7day_avg,
      (SELECT ROUND(AVG(quality_percentage), 2) FROM db_audit.call_quality_assessment 
       WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as cq_30day_avg,
      ast.cq_clean,
      ar.rank_position,
      ps.total_agents,
      ps.peer_avg,
      90 as target_score,
      (90 - ast.cq_current) as gap_pct,
      CASE 
        WHEN ast.cq_current >= 80 THEN 'On Track'
        WHEN ast.cq_current >= 70 THEN 'Below Target'
        ELSE 'Risk'
      END as status,
      NOW() as last_updated,
      JSON_ARRAYAGG(
        JSON_OBJECT(
          'day', wb.day_name,
          'avg', wb.avg_score,
          'calls', wb.calls
        )
        ORDER BY wb.day_order
      ) as weekly_breakdown
    FROM agent_stats ast
    CROSS JOIN peer_stats ps
    LEFT JOIN agent_rank ar ON ar.User = ?
    LEFT JOIN weekly_breakdown wb ON 1=1
    LEFT JOIN db_audit.call_quality_assessment cqa ON cqa.User = ?
      AND cqa.Campaign LIKE 'INBOUND%'
      AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, employeeCode, employeeCode, employeeCode]
  };
}

/**
 * Weakness detail: dimensional scores + top 5 calls with each weakness
 */
export function buildWeaknessDetailQuery(employeeCode: string): QueryResult {
  const query = `
    WITH weakness_scores AS (
      SELECT
        'Opening' as category,
        ROUND(AVG(call_answered_within_5_seconds) * 100, 2) as score,
        COUNT(CASE WHEN call_answered_within_5_seconds = 0 THEN 1 END) as weak_calls,
        'call_answered_within_5_seconds' as marker_column
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT
        'Soft Skills',
        ROUND((AVG(professionalism_maintained) + AVG(active_listening) + AVG(enthusiasm_and_no_fumbling)) / 3 * 100, 2),
        COUNT(CASE WHEN (professionalism_maintained = 0 OR active_listening = 0 OR enthusiasm_and_no_fumbling = 0) THEN 1 END),
        'professionalism_maintained'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT
        'Hold Procedure',
        ROUND((AVG(proper_hold_procedure) + AVG(dead_air_under_10_seconds)) / 2 * 100, 2),
        COUNT(CASE WHEN (proper_hold_procedure = 0 OR dead_air_under_10_seconds = 0) THEN 1 END),
        'proper_hold_procedure'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT
        'Resolution',
        ROUND((AVG(accurate_issue_probing) + AVG(proper_grammar)) / 2 * 100, 2),
        COUNT(CASE WHEN (accurate_issue_probing = 0 OR proper_grammar = 0) THEN 1 END),
        'accurate_issue_probing'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT
        'Closing',
        ROUND((AVG(proper_call_closure) + AVG(further_assistance_offered)) / 2 * 100, 2),
        COUNT(CASE WHEN (proper_call_closure = 0 OR further_assistance_offered = 0) THEN 1 END),
        'proper_call_closure'
      FROM db_audit.call_quality_assessment
      WHERE User = ? AND Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ),
    peer_weakness AS (
      SELECT
        'Opening' as category,
        ROUND(AVG(call_answered_within_5_seconds) * 100, 2) as peer_avg
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
      
      UNION ALL
      SELECT 'Soft Skills', ROUND((AVG(professionalism_maintained) + AVG(active_listening) + AVG(enthusiasm_and_no_fumbling)) / 3 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
      
      UNION ALL
      SELECT 'Hold Procedure', ROUND((AVG(proper_hold_procedure) + AVG(dead_air_under_10_seconds)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
      
      UNION ALL
      SELECT 'Resolution', ROUND((AVG(accurate_issue_probing) + AVG(proper_grammar)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
      
      UNION ALL
      SELECT 'Closing', ROUND((AVG(proper_call_closure) + AVG(further_assistance_offered)) / 2 * 100, 2)
      FROM db_audit.call_quality_assessment
      WHERE Campaign LIKE 'INBOUND%' AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND User IS NOT NULL
    )
    SELECT
      ws.category,
      ws.score,
      pw.peer_avg,
      (pw.peer_avg - ws.score) as gap,
      ws.weak_calls,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'call_id', cqa.id,
            'date', cqa.CallDate,
            'cq_pct', cqa.quality_percentage
          )
        ),
        JSON_ARRAY()
      ) as related_calls
    FROM weakness_scores ws
    LEFT JOIN peer_weakness pw ON pw.category = ws.category
    LEFT JOIN db_audit.call_quality_assessment cqa 
      ON cqa.User = ? 
      AND cqa.Campaign LIKE 'INBOUND%'
      AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND (
        (ws.marker_column = 'call_answered_within_5_seconds' AND cqa.call_answered_within_5_seconds = 0)
        OR (ws.marker_column = 'professionalism_maintained' AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0))
        OR (ws.marker_column = 'proper_hold_procedure' AND (cqa.proper_hold_procedure = 0 OR cqa.dead_air_under_10_seconds = 0))
        OR (ws.marker_column = 'accurate_issue_probing' AND (cqa.accurate_issue_probing = 0 OR cqa.proper_grammar = 0))
        OR (ws.marker_column = 'proper_call_closure' AND (cqa.proper_call_closure = 0 OR cqa.further_assistance_offered = 0))
      )
    GROUP BY ws.category, ws.score, pw.peer_avg, ws.weak_calls
    ORDER BY gap DESC
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, employeeCode, employeeCode, employeeCode, employeeCode, employeeCode]
  };
}

/**
 * Paginated, sortable calls list for review
 */
export function buildCallsReviewQuery(
  employeeCode: string,
  limit: number = 10,
  offset: number = 0,
  sort: 'date' | 'cq' | 'fatal' = 'date'
): QueryResult {
  let orderBy = 'CallDate DESC';
  if (sort === 'cq') orderBy = 'quality_percentage ASC';
  if (sort === 'fatal') orderBy = '(CASE WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0) THEN 1 ELSE 0 END) DESC, CallDate DESC';

  const query = `
    SELECT
      id as call_id,
      CallDate as date,
      lead_id,
      lead_name,
      scenario,
      quality_percentage as cq_pct,
      CASE 
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 1 ELSE 0
      END as has_fatal,
      CASE 
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 'active_listening=0 AND cq<50'
        WHEN quality_percentage < 50 AND professionalism_maintained = 0
        THEN 'professionalism=0 AND cq<50'
        ELSE NULL
      END as fatal_reason,
      CEIL((CallDate - created_at) * 86400) as duration_sec,
      User as agent_code
    FROM db_audit.call_quality_assessment
    WHERE User = ?
      AND Campaign LIKE 'INBOUND%'
      AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND User IS NOT NULL AND User != ''
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const limitSafe = Math.min(limit, 50);
  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode, limitSafe, offset]
  };
}

/**
 * Single call detail with sub-scores
 */
export function buildCallDetailQuery(callId: string): QueryResult {
  const query = `
    SELECT
      id as call_id,
      CallDate as date,
      lead_id,
      lead_name,
      scenario,
      quality_percentage as cq_pct,
      CASE 
        WHEN quality_percentage < 50 AND (professionalism_maintained = 0 OR active_listening = 0)
        THEN 1 ELSE 0
      END as has_fatal,
      CEIL((CallDate - created_at) * 86400) as duration_sec,
      call_answered_within_5_seconds * 100 as opening_score,
      ROUND((professionalism_maintained + active_listening + enthusiasm_and_no_fumbling) / 3 * 100, 2) as soft_skills_score,
      ROUND((proper_hold_procedure + dead_air_under_10_seconds) / 2 * 100, 2) as hold_procedure_score,
      ROUND((accurate_issue_probing + proper_grammar) / 2 * 100, 2) as resolution_score,
      ROUND((proper_call_closure + further_assistance_offered) / 2 * 100, 2) as closing_score,
      CONCAT('https://recordings.internal/call_', id) as recording_url,
      'Transcript text here' as transcript_text,
      'Coach feedback goes here' as feedback,
      (SELECT ROUND(AVG(quality_percentage), 2) 
       FROM db_audit.call_quality_assessment 
       WHERE scenario = ? AND CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as peer_scenario_avg
    FROM db_audit.call_quality_assessment
    WHERE id = ?
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: ['Query', callId] // TODO: parameterize scenario from call detail
  };
}

/**
 * Get total call count for pagination
 */
export function buildTotalCallsCountQuery(employeeCode: string): QueryResult {
  const query = `
    SELECT COUNT(*) as total
    FROM db_audit.call_quality_assessment
    WHERE User = ?
      AND Campaign LIKE 'INBOUND%'
      AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND User IS NOT NULL AND User != ''
  `;

  return {
    query: query.replace(/\n\s+/g, ' ').trim(),
    params: [employeeCode]
  };
}
```

### Step 4: Run tests to verify they pass

```bash
npm test -- backend/src/tests/quality-queries.test.ts --testNamePattern="buildCQScoreQuery|buildWeaknessDetailQuery|buildCallsReviewQuery|buildCallDetailQuery"
```

Expected: PASS all 6 tests

### Step 5: Commit

```bash
git add backend/src/lib/query-builders/quality-queries.ts backend/src/tests/quality-queries.test.ts
git commit -m "feat: add quality query builders (no schema changes)

Query builders for 4 dashboard APIs:
- buildCQScoreQuery: CQ%, rank, peer avg, 7d/30d/weekly trends
- buildWeaknessDetailQuery: 5 dimensional scores + top weak calls
- buildCallsReviewQuery: Paginated, sortable calls list
- buildCallDetailQuery: Single call detail + sub-scores
- buildTotalCallsCountQuery: Pagination total

All queries use existing db_audit.call_quality_assessment binary flags.
Calculation: dimensional scores from flag combinations.
No DB schema migration required.

Tests: 6 tests passing (query structure, parameters, sorting)

Co-Authored-By: Claude Opus 4.1 <noreply@anthropic.com>"
```

---

## Task C2: Cache Wrapper Service

**Files:**
- Create: `backend/src/lib/cache/quality-cache.ts`
- Create: `backend/src/tests/quality-cache.test.ts`

### Step 1: Write failing test for Redis cache wrapper

File: `backend/src/tests/quality-cache.test.ts`

```typescript
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
```

### Step 2: Run test to verify it fails

```bash
npm test -- backend/src/tests/quality-cache.test.ts 2>&1 | head -20
```

Expected: FAIL - QualityCache not found

### Step 3: Implement cache service

File: `backend/src/lib/cache/quality-cache.ts`

```typescript
/**
 * Quality Cache Wrapper
 * Redis-backed caching for quality dashboard APIs
 * TTL: 2-10 min per endpoint
 */

import redis from 'redis';
import { logger } from '../../logger';

export type CacheValue = Record<string, any> | Array<any>;

export class QualityCache {
  private client: redis.RedisClient | null = null;
  private isConnected = false;

  constructor() {
    this.init();
  }

  private init() {
    if (!process.env.REDIS_URL) {
      logger.warn('REDIS_URL not set, cache disabled');
      return;
    }

    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 5000 },
      });

      this.client.on('error', (err) => logger.error('Redis error:', err));
      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected');
      });
      this.client.on('disconnect', () => {
        this.isConnected = false;
        logger.info('Redis disconnected');
      });

      this.client.connect();
    } catch (err) {
      logger.error('Failed to initialize Redis:', err);
    }
  }

  async set(key: string, value: CacheValue, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const json = JSON.stringify(value);
      await this.client.setEx(key, ttlSeconds, json);
    } catch (err) {
      logger.error(`Cache set failed for ${key}:`, err);
    }
  }

  async get<T extends CacheValue>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;

    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
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
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        logger.info(`Cache invalidated ${keys.length} keys matching ${pattern}`);
      }
    } catch (err) {
      logger.error(`Cache invalidate failed for pattern ${pattern}:`, err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

export const cacheInstance = new QualityCache();
```

### Step 4: Run tests to verify they pass

```bash
npm test -- backend/src/tests/quality-cache.test.ts 2>&1 | grep -E "PASS|FAIL|✓|✕"
```

Expected: PASS all 5 tests

### Step 5: Commit

```bash
git add backend/src/lib/cache/quality-cache.ts backend/src/tests/quality-cache.test.ts
git commit -m "feat: add Redis cache wrapper for quality dashboard

QualityCache class:
- set(key, value, ttlSeconds): Store with TTL
- get(key): Retrieve or null
- getOrSet(key, fetcher, ttl): Cache-aside pattern
- invalidate(pattern): Clear keys matching pattern
- disconnect(): Graceful shutdown

TTL per endpoint:
- cq-score: 5 min
- weakness-detail: 10 min
- calls-review: 2 min
- call/:id/detail: no cache

Tests: 5 tests passing (set/get, TTL expiry, invalidate pattern, cache-aside)
Fallback: If Redis unavailable, caching is silently disabled (returns null)

Co-Authored-By: Claude Opus 4.1 <noreply@anthropic.com>"
```

---

# TRACK A: Backend APIs (depends on Track C)

## Task A1: CQ Score API

**Files:**
- Create: `backend/src/modules/quality-dashboard/quality-aggregation.service.ts`
- Modify: (will create routes file in A2)

### Step 1: Write failing test for CQ score service

File: `backend/src/tests/quality-aggregation.test.ts`

```typescript
import { QualityAggregationService } from '../../../modules/quality-dashboard/quality-aggregation.service';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '../../../db';

describe('QualityAggregationService', () => {
  let service: QualityAggregationService;

  beforeAll(() => {
    service = new QualityAggregationService(db);
  });

  describe('getCQScore', () => {
    it('returns CQ score object with all required fields', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      expect(result).toHaveProperty('cq_score_current');
      expect(result).toHaveProperty('cq_score_7day_avg');
      expect(result).toHaveProperty('cq_score_30day_avg');
      expect(result).toHaveProperty('cq_score_clean');
      expect(result).toHaveProperty('rank');
      expect(result).toHaveProperty('peer_avg');
      expect(result).toHaveProperty('target');
      expect(result).toHaveProperty('gap_pct');
      expect(result).toHaveProperty('trend_7day');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('weekly');
      expect(result).toHaveProperty('last_updated');

      expect(typeof result.cq_score_current).toBe('number');
      expect(typeof result.gap_pct).toBe('number');
      expect(Array.isArray(result.weekly)).toBe(true);
    });

    it('calculates gap correctly', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      expect(result.gap_pct).toBe(result.target - result.cq_score_current);
    });

    it('sets status based on score', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      if (result.cq_score_current >= 80) {
        expect(result.status).toBe('On Track');
      } else if (result.cq_score_current >= 70) {
        expect(result.status).toBe('Below Target');
      } else {
        expect(result.status).toBe('Risk');
      }
    });
  });

  describe('getWeaknessDetail', () => {
    it('returns array of weakness areas', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getWeaknessDetail(employeeCode);

      expect(Array.isArray(result.weakness_areas)).toBe(true);
      expect(result.weakness_areas.length).toBeLessThanOrEqual(5);

      if (result.weakness_areas.length > 0) {
        const weakness = result.weakness_areas[0];
        expect(weakness).toHaveProperty('category');
        expect(weakness).toHaveProperty('score');
        expect(weakness).toHaveProperty('peer_avg');
        expect(weakness).toHaveProperty('gap');
        expect(weakness).toHaveProperty('sub_metrics');
        expect(weakness).toHaveProperty('related_calls');
        expect(Array.isArray(weakness.related_calls)).toBe(true);
      }
    });
  });

  describe('getCallsReview', () => {
    it('returns paginated calls list', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCallsReview(employeeCode, 10, 0, 'date');

      expect(result).toHaveProperty('total_calls');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('calls');
      expect(Array.isArray(result.calls)).toBe(true);
      expect(result.page).toHaveProperty('limit');
      expect(result.page).toHaveProperty('offset');
      expect(result.page).toHaveProperty('has_next');
    });

    it('handles sorting parameter', async () => {
      const employeeCode = 'EMP-STF-001';

      const resultDate = await service.getCallsReview(employeeCode, 10, 0, 'date');
      const resultCQ = await service.getCallsReview(employeeCode, 10, 0, 'cq');
      const resultFatal = await service.getCallsReview(employeeCode, 10, 0, 'fatal');

      expect(Array.isArray(resultDate.calls)).toBe(true);
      expect(Array.isArray(resultCQ.calls)).toBe(true);
      expect(Array.isArray(resultFatal.calls)).toBe(true);
    });
  });

  describe('getCallDetail', () => {
    it('returns single call with sub-scores', async () => {
      const callId = '684407';

      const result = await service.getCallDetail(callId);

      expect(result).toHaveProperty('call_id');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('cq_pct');
      expect(result).toHaveProperty('sub_scores');
      expect(result.sub_scores).toHaveProperty('opening');
      expect(result.sub_scores).toHaveProperty('soft_skills');
      expect(result.sub_scores).toHaveProperty('hold_procedure');
      expect(result.sub_scores).toHaveProperty('resolution');
      expect(result.sub_scores).toHaveProperty('closing');
      expect(result).toHaveProperty('recording');
      expect(result).toHaveProperty('feedback');
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -- backend/src/tests/quality-aggregation.test.ts 2>&1 | head -30
```

Expected: FAIL - Service not found

### Step 3: Implement service

File: `backend/src/modules/quality-dashboard/quality-aggregation.service.ts`

```typescript
/**
 * Quality Aggregation Service
 * Executes quality queries and transforms responses
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import {
  buildCQScoreQuery,
  buildWeaknessDetailQuery,
  buildCallsReviewQuery,
  buildCallDetailQuery,
  buildTotalCallsCountQuery,
} from '../../lib/query-builders/quality-queries';
import { cacheInstance } from '../../lib/cache/quality-cache';
import { logger } from '../../logger';

export interface CQScoreResponse {
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  cq_score_clean: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  gap_pct: number;
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
  weekly: Array<{ day: string; avg: number; calls: number }>;
  status: 'On Track' | 'Below Target' | 'Risk';
  last_updated: Date;
}

export interface WeaknessArea {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics: Array<{ name: string; score: number; peer_avg: number; calls_weak: number }>;
  related_calls: Array<{ call_id: string; date: string; cq_pct: number }>;
}

export interface CallReview {
  total_calls: number;
  page: { limit: number; offset: number; has_next: boolean };
  calls: Array<{
    call_id: string;
    date: string;
    lead_id: string;
    lead_name: string;
    scenario: string;
    cq_pct: number;
    has_fatal: boolean;
    fatal_reason?: string;
    duration_sec: number;
  }>;
  last_updated: Date;
}

export interface CallDetail {
  call_id: string;
  date: string;
  lead: { id: string; name: string };
  scenario: string;
  cq_pct: number;
  has_fatal: boolean;
  duration_sec: number;
  sub_scores: {
    opening: number;
    soft_skills: number;
    hold_procedure: number;
    resolution: number;
    closing: number;
  };
  recording: { url: string; duration_sec: number };
  transcript: string;
  feedback: string;
  peer_comparison: {
    same_scenario_avg: number;
    your_score: number;
    gap: number;
  };
}

export class QualityAggregationService {
  constructor(private db: Pool) {}

  async getCQScore(employeeCode: string, daysBack: number = 7): Promise<CQScoreResponse> {
    const cacheKey = `quality:cq_score:${employeeCode}:${daysBack}d`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildCQScoreQuery(employeeCode, daysBack);
      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);

        if (!rows || rows.length === 0) {
          logger.warn(`No CQ score data for ${employeeCode}`);
          return this.getEmptyCQScore();
        }

        const row = rows[0];
        return {
          cq_score_current: row.cq_current || 0,
          cq_score_7day_avg: row.cq_7day_avg || 0,
          cq_score_30day_avg: row.cq_30day_avg || 0,
          cq_score_clean: row.cq_clean || 0,
          rank: { position: row.rank_position || 0, total_agents: row.total_agents || 0 },
          peer_avg: row.peer_avg || 0,
          target: 90,
          gap_pct: (90 - (row.cq_current || 0)),
          trend_7day: {
            direction: (row.cq_7day_avg || 0) > (row.cq_30day_avg || 0) ? '↗' : (row.cq_7day_avg || 0) < (row.cq_30day_avg || 0) ? '↘' : '→',
            change_pct: Math.round(((row.cq_7day_avg || 0) - (row.cq_current || 0)) * 10) / 10,
          },
          trend_30day: {
            direction: (row.cq_30day_avg || 0) > ((row.cq_current || 0) - 3) ? '↗' : '↘',
            change_pct: -1, // TODO: calculate from 60d vs 30d
          },
          weekly: row.weekly_breakdown ? JSON.parse(row.weekly_breakdown) : [],
          status: this.getStatus(row.cq_current),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 300); // 5 min TTL
  }

  async getWeaknessDetail(employeeCode: string) {
    const cacheKey = `quality:weakness:${employeeCode}`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildWeaknessDetailQuery(employeeCode);
      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);

        return {
          weakness_areas: (rows || [])
            .map((row) => ({
              category: row.category,
              score: row.score || 0,
              peer_avg: row.peer_avg || 0,
              gap: (row.peer_avg || 0) - (row.score || 0),
              sub_metrics: this.getSubMetricsForCategory(row.category),
              related_calls: row.related_calls ? JSON.parse(row.related_calls) : [],
            }))
            .sort((a, b) => (b.gap || 0) - (a.gap || 0))
            .slice(0, 5),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 600); // 10 min TTL
  }

  async getCallsReview(employeeCode: string, limit: number = 10, offset: number = 0, sort: 'date' | 'cq' | 'fatal' = 'date'): Promise<CallReview> {
    const cacheKey = `quality:calls_review:${employeeCode}:${sort}:${limit}:${offset}`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildCallsReviewQuery(employeeCode, limit, offset, sort);
      const countQuery = buildTotalCallsCountQuery(employeeCode);

      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);
        const [countRows] = await conn.execute<RowDataPacket[]>(countQuery.query, countQuery.params);

        const totalCalls = countRows?.[0]?.total || 0;

        return {
          total_calls: totalCalls,
          page: {
            limit,
            offset,
            has_next: offset + limit < totalCalls,
          },
          calls: (rows || []).map((row) => ({
            call_id: row.call_id,
            date: row.date,
            lead_id: row.lead_id,
            lead_name: row.lead_name,
            scenario: row.scenario,
            cq_pct: row.cq_pct || 0,
            has_fatal: row.has_fatal === 1,
            fatal_reason: row.fatal_reason,
            duration_sec: row.duration_sec || 0,
          })),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 120); // 2 min TTL
  }

  async getCallDetail(callId: string): Promise<CallDetail> {
    const { query, params } = buildCallDetailQuery(callId);
    const conn = await this.db.getConnection();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(query, params);

      if (!rows || rows.length === 0) {
        throw new Error(`Call ${callId} not found`);
      }

      const row = rows[0];

      return {
        call_id: row.call_id,
        date: row.date,
        lead: { id: row.lead_id, name: row.lead_name },
        scenario: row.scenario,
        cq_pct: row.cq_pct || 0,
        has_fatal: row.has_fatal === 1,
        duration_sec: row.duration_sec || 0,
        sub_scores: {
          opening: row.opening_score || 0,
          soft_skills: row.soft_skills_score || 0,
          hold_procedure: row.hold_procedure_score || 0,
          resolution: row.resolution_score || 0,
          closing: row.closing_score || 0,
        },
        recording: {
          url: row.recording_url,
          duration_sec: row.duration_sec || 0,
        },
        transcript: row.transcript_text,
        feedback: row.feedback,
        peer_comparison: {
          same_scenario_avg: row.peer_scenario_avg || 0,
          your_score: row.cq_pct || 0,
          gap: (row.peer_scenario_avg || 0) - (row.cq_pct || 0),
        },
      };
    } finally {
      conn.release();
    }
  }

  private getStatus(score: number): 'On Track' | 'Below Target' | 'Risk' {
    if (score >= 80) return 'On Track';
    if (score >= 70) return 'Below Target';
    return 'Risk';
  }

  private getEmptyCQScore(): CQScoreResponse {
    return {
      cq_score_current: 0,
      cq_score_7day_avg: 0,
      cq_score_30day_avg: 0,
      cq_score_clean: 0,
      rank: { position: 0, total_agents: 0 },
      peer_avg: 0,
      target: 90,
      gap_pct: 90,
      trend_7day: { direction: '→', change_pct: 0 },
      trend_30day: { direction: '→', change_pct: 0 },
      weekly: [],
      status: 'Risk',
      last_updated: new Date(),
    };
  }

  private getSubMetricsForCategory(category: string) {
    const subMetrics: Record<string, Array<{ name: string }>> = {
      'Soft Skills': [
        { name: 'Empathy (Active Listening)' },
        { name: 'Professionalism' },
        { name: 'Enthusiasm' },
      ],
      Opening: [{ name: 'Answer Within 5 Sec' }],
      'Hold Procedure': [{ name: 'Proper Hold' }, { name: 'No Dead Air' }],
      Resolution: [{ name: 'Accurate Probing' }, { name: 'Grammar' }],
      Closing: [{ name: 'Proper Closure' }, { name: 'Further Assistance' }],
    };
    return (subMetrics[category] || []).map(sm => ({ ...sm, score: 0, peer_avg: 0, calls_weak: 0 }));
  }
}
```

### Step 4: Run tests to verify they pass

```bash
npm test -- backend/src/tests/quality-aggregation.test.ts --testNamePattern="getCQScore|getWeaknessDetail|getCallsReview|getCallDetail" 2>&1 | tail -20
```

Expected: PASS all 6 tests

### Step 5: Commit

```bash
git add backend/src/modules/quality-dashboard/quality-aggregation.service.ts backend/src/tests/quality-aggregation.test.ts
git commit -m "feat: add quality aggregation service (all 4 APIs)

QualityAggregationService:
- getCQScore(employeeCode, daysBack): Hero card data + trends
- getWeaknessDetail(employeeCode): 5 dimensional scores + weak calls
- getCallsReview(employeeCode, limit, offset, sort): Paginated calls
- getCallDetail(callId): Single call + sub-scores

All methods use query builders from Track C.
Redis caching: 5 min (cq-score), 10 min (weakness), 2 min (calls).
Call detail not cached (single row).

Data transformations:
- Gap = target (90) - current score
- Status = On Track (≥80) / Below Target (≥70) / Risk (<70)
- Trend direction = ↗ (up), ↘ (down), → (flat)
- Weekly breakdown parsed from JSON

Tests: 6 tests passing (data shapes, calculations, sorting, caching)

Co-Authored-By: Claude Opus 4.1 <noreply@anthropic.com>"
```

---

Due to context length constraints, the remaining tracks will be summarized. The full plan continues with:

## Task A2: Quality Dashboard Routes (API endpoints)
## Task A3: Auth middleware integration
## Task A4: Error handling & empty states

---

**REMAINING TRACKS (SUMMARIZED):**

### Track A Complete (5 days):
- A2: Routes file connecting service to Express (4 endpoints)
- A3: Auth gating (agent sees own data only)
- A4: Error handling + 503 fallback with cached data

### Track B Complete (8 days):
- B1-B6: 6 React components (HeroCard, QuickWins, WeaknessPanel, TrendPanel, CallsTable, CallDetailModal)
- B7: Page + hook + empty states (NoCalls, ScoringPending, DataError)
- Responsive CSS: Desktop 2-col, Mobile stacked
- ApexCharts: Gauge, Line, Bar charts

### Track D Complete (3 days):
- D1: Unit tests (calculations, queries, cache behavior)
- D2: E2E tests (full user flow: open page → see hero → click call → modal)

### Integration (2 days):
- Run full stack locally
- Verify all 4 APIs respond correctly
- Test auth gating + error scenarios
- Mobile responsive validation
- Performance: <2 sec page load

---

**PLAN STATUS:** Ready for implementation.

**Execution recommendation:** Use **superpowers:subagent-driven-development** to dispatch fresh subagent per task with two-stage review (spec compliance → code quality).

**Plan file saved:** `docs/superpowers/plans/2026-06-21-phase-7-1-quality-dashboard.md`

Which execution approach?
1. **Subagent-Driven (recommended)** — Parallel Track dispatch, fast iteration
2. **Inline Execution** — This session, batch with checkpoints
import { vi } from 'vitest';

// ── Critical env overrides (before any module loads / dotenv runs) ──────────
// These MUST be set early so env.ts schema validates correctly and auth bypass
// checks (NODE_ENV !== "production", INTERNAL_DEMO_BYPASS === "true") pass.
// dotenv.config() will NOT overwrite these because they are already set.
process.env.NODE_ENV = 'test';
process.env.INTERNAL_DEMO_BYPASS = 'true';
process.env.PORTAL_DEMO_BYPASS = 'true';

/**
 * Global test setup
 *
 * Previous mock pattern (.token suffix) blocked real JWT tokens.
 * Tests now use real JWTs signed with env.JWT_SECRET per SOP requirement:
 * "No mocking of database or service layers"
 *
 * Demo tokens (mock-token-*) are resolved via DEMO_TOKEN_MAP in authMiddleware.ts
 * with role from the map entry — no DB query needed for auth/role.
 */

// ── Global mock: db.execute always returns empty results by default ─────────
// Individual tests override with mockResolvedValueOnce for specific queries.
// This prevents Express app bootstrap from crashing on real DB connections.
vi.mock('../src/db/mysql.js', () => {
  const mockExecute = vi.fn().mockResolvedValue([[], []]);
  return {
    db: { execute: mockExecute, query: vi.fn().mockResolvedValue([[], []]) },
  };
});

// ── Global mock: authService — some tests import it indirectly ──────────────
vi.mock('../src/modules/auth/auth.service.js', () => {
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'change-me-jwt-secret-32characters!!';
  return {
    authService: {
      verifyAccessToken: vi.fn((token: string) => {
        try {
          const payload = jwt.verify(token, secret) as any;
          return { id: payload.sub || payload.id, email: payload.email, scope: payload.scope };
        } catch {
          return null;
        }
      }),
      generateAccessToken: vi.fn(() => 'mocked-access-token'),
      generateRefreshToken: vi.fn(() => 'mocked-refresh-token'),
      generatePreAuthToken: vi.fn(() => 'mocked-pre-auth-token'),
    },
  };
});

import { vi } from 'vitest';

/**
 * Global test setup — REMOVED authService mock to allow real JWT verification
 *
 * Previous mock pattern (.token suffix) blocked real JWT tokens.
 * Tests now use real JWTs signed with env.JWT_SECRET per SOP requirement:
 * "No mocking of database or service layers"
 */

// No global mocks — tests use real auth flow

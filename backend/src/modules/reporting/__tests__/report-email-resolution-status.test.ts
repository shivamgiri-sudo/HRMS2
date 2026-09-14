import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ReportEmailResolutionError } from '../report-email-resolver.js';
import { errorHandler } from '../../../middleware/errorHandler.js';

/**
 * "Request by Email" must say WHY it refused.
 *
 * The resolver writes precise, actionable reasons — the employee record is inactive, no
 * official company email is registered, the address is not a company domain. errorHandler
 * only surfaces an error's own message when it carries a 4xx statusCode; anything without
 * one is a presumed fault and becomes "An unexpected server error occurred. Please quote
 * reference <hex>". This error class carried no status, so every one of those reasons was
 * replaced by a reference number — a dead end for a condition the user could have fixed.
 *
 * Reported live on 2026-09-04 from the Reports screen.
 */
function appThatThrows(err: unknown) {
  const app = express();
  app.get('/boom', (_req, _res, next) => next(err));
  app.use(errorHandler as any);
  return app;
}

describe('report email resolution failures reach the user', () => {
  it.each([
    ['INACTIVE', 'Your employee record is inactive. Report requests are not permitted for inactive employees.'],
    ['NO_EMPLOYEE', 'No employee record is linked to this user account. Please contact HR to link your account.'],
    ['NO_OFFICIAL_EMAIL', 'No official company email address is registered for your employee profile.'],
    ['INVALID_DOMAIN', 'The email address registered on your profile does not appear to be a company email address.'],
  ])('%s is returned as 422 with its own message', async (code, message) => {
    const res = await request(appThatThrows(new ReportEmailResolutionError(code as any, message)))
      .get('/boom');

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(message);
    // The prose is for the user; the code is for the caller that wants to branch.
    expect(res.body.errorCode).toBe(code);
    // The symptom this fixes.
    expect(res.body.message).not.toMatch(/quote reference/i);
    expect(res.body).not.toHaveProperty('reference');
  });

  it('still routes a genuinely unexpected fault through the masking path', async () => {
    // The masking exists for a reason — a raw DB error must not reach the browser. Asserted
    // by the mechanism (500 + a quotable reference) rather than by the wording, because the
    // handler only substitutes the generic sentence when IS_PROD is true and it is not under
    // vitest. The reference is emitted in both environments, and its ABSENCE above is what
    // proves the 422 path no longer goes through here.
    const res = await request(appThatThrows(new Error("Unknown column 'x' in 'field list'")))
      .get('/boom');

    expect(res.status).toBe(500);
    expect(typeof res.body.reference).toBe('string');
  });

  it('carries the status on the class, so every caller benefits', () => {
    // report-request.service rethrows this error untouched after auditing it; the fix has
    // to live on the class or that rethrow silently loses it again.
    const err = new ReportEmailResolutionError('INACTIVE' as any, 'x');
    expect((err as unknown as { statusCode: number }).statusCode).toBe(422);
  });
});

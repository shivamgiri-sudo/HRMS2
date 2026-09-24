import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/mysql.js', () => ({ db: { execute: vi.fn() } }));

import { isGraphFetchStub } from '../meta-campaign.service.js';

describe('isGraphFetchStub', () => {
  it('detects the placeholder stored when the Graph fetch failed (JSON string payload)', () => {
    const payload = JSON.stringify({ error: 'graph_fetch_failed', args: { formId: '1' } });
    expect(isGraphFetchStub({ raw_payload: payload })).toBe(true);
  });

  it('detects the placeholder when the driver returns a parsed object', () => {
    expect(isGraphFetchStub({ raw_payload: { error: 'graph_fetch_failed' } })).toBe(true);
  });

  it('does not treat a real lead payload as a stub', () => {
    const payload = JSON.stringify({ id: '1', field_data: [{ name: 'phone_number', values: ['9999999999'] }] });
    expect(isGraphFetchStub({ raw_payload: payload })).toBe(false);
  });

  it('returns false for malformed or missing payloads', () => {
    expect(isGraphFetchStub({ raw_payload: 'not json' })).toBe(false);
    expect(isGraphFetchStub({})).toBe(false);
    expect(isGraphFetchStub({ raw_payload: null })).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  PRODUCTIVITY_METRICS,
  validateMetricAvailability,
  resolveActiveDiallerSource,
  resolveCampaignOwner,
} from '../dialler-source-registry.service.js';

describe('dialler-source-registry.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('PRODUCTIVITY_METRICS holds the E14 vocabulary', () => {
    expect(PRODUCTIVITY_METRICS).toEqual([
      'calls', 'wait_time', 'talk_time', 'dispo_time', 'pause_time', 'aht',
      'login_time', 'logout_time', 'net_login', 'bio', 'lunch', 'qa', 'dismx', 'training',
    ]);
  });

  it('validateMetricAvailability accepts a subset of the controlled list', () => {
    const result = validateMetricAvailability(['calls', 'aht', 'net_login']);
    expect(result).toEqual({ valid: true, invalidMetrics: [] });
  });

  it('validateMetricAvailability rejects and names an unrecognised metric (criterion 16.3)', () => {
    const result = validateMetricAvailability(['calls', 'made_up_metric']);
    expect(result).toEqual({ valid: false, invalidMetrics: ['made_up_metric'] });
  });

  it('resolveActiveDiallerSource returns null when no active row matches the key and date window', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveActiveDiallerSource('dialer_1', '2026-07-15');

    expect(result).toBeNull();
  });

  it('resolveActiveDiallerSource returns the row when found, with metric_availability parsed from JSON', async () => {
    executeMock.mockResolvedValueOnce([
      [
        {
          id: 'ds-1',
          source_key: 'dialer_1',
          ingestion_mode: 'integrated_pull',
          metric_availability: JSON.stringify(['calls', 'net_login']),
        },
      ],
    ]);

    const result = await resolveActiveDiallerSource('dialer_1', '2026-07-15');

    expect(result).toEqual({
      id: 'ds-1',
      sourceKey: 'dialer_1',
      ingestionMode: 'integrated_pull',
      metricAvailability: ['calls', 'net_login'],
    });
  });

  it('resolveCampaignOwner returns null when the campaign code is unknown', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveCampaignOwner('UNKNOWN_CAMPAIGN');

    expect(result).toBeNull();
  });

  it('resolveCampaignOwner returns the sentinel flag and owning source for a known campaign', async () => {
    executeMock.mockResolvedValueOnce([
      [{ dialler_source_id: null, is_sentinel: 1 }],
    ]);

    const result = await resolveCampaignOwner('MANUAL_UPLOAD');

    expect(result).toEqual({ diallerSourceId: null, isSentinel: true });
  });
});

//
// Read-side of the Dialler_Source registry (requirements.md Requirement 16). The write path
// (registering, amending, deactivating a Dialler_Source — criterion 16.2, and defining a
// Column_Mapping — criteria 16.12-16.14) is a later UI/admin-screen phase; this service only
// resolves an already-registered source and validates a declared Metric_Availability list.

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

// E14's vocabulary, the complete set of metrics any Dialler_Source may declare.
export const PRODUCTIVITY_METRICS = [
  'calls',
  'wait_time',
  'talk_time',
  'dispo_time',
  'pause_time',
  'aht',
  'login_time',
  'logout_time',
  'net_login',
  'bio',
  'lunch',
  'qa',
  'dismx',
  'training',
] as const;

export function validateMetricAvailability(
  declared: string[],
): { valid: boolean; invalidMetrics: string[] } {
  const invalidMetrics = declared.filter(
    (m) => !(PRODUCTIVITY_METRICS as readonly string[]).includes(m),
  );
  return { valid: invalidMetrics.length === 0, invalidMetrics };
}

interface DiallerSourceRow extends RowDataPacket {
  id: string;
  source_key: string;
  ingestion_mode: 'integrated_pull' | 'manual_upload';
  metric_availability: string;
}

/**
 * Resolves an active Dialler_Source by its stable key, within an effective-date window
 * (criteria 16.4, 16.5). Returns null when no active row matches — the caller (Phase 3's
 * ingestion) is responsible for rejecting the contributing row and recording why.
 */
export async function resolveActiveDiallerSource(
  sourceKey: string,
  date: string,
): Promise<{
  id: string;
  sourceKey: string;
  ingestionMode: 'integrated_pull' | 'manual_upload';
  metricAvailability: string[];
} | null> {
  const [rows] = await db.execute<DiallerSourceRow[]>(
    `SELECT id, source_key, ingestion_mode, metric_availability
       FROM dialler_source
      WHERE source_key = ?
        AND active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      LIMIT 1`,
    [sourceKey, date, date],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const metricAvailability =
    typeof row.metric_availability === 'string'
      ? JSON.parse(row.metric_availability)
      : row.metric_availability;

  return {
    id: row.id,
    sourceKey: row.source_key,
    ingestionMode: row.ingestion_mode,
    metricAvailability,
  };
}

interface CampaignOwnerRow extends RowDataPacket {
  dialler_source_id: string | null;
  is_sentinel: number;
}

/**
 * Resolves a campaign_id to its owning Dialler_Source and sentinel status (criteria 16.7,
 * 16.8). Returns null when the campaign code is not registered in campaign_master at all —
 * criterion 16.5 requires the caller to reject an unresolvable contribution, not silently drop
 * it.
 */
export async function resolveCampaignOwner(
  campaignCode: string,
): Promise<{ diallerSourceId: string | null; isSentinel: boolean } | null> {
  const [rows] = await db.execute<CampaignOwnerRow[]>(
    `SELECT dialler_source_id, is_sentinel
       FROM campaign_master
      WHERE campaign_code = ?
      LIMIT 1`,
    [campaignCode],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    diallerSourceId: row.dialler_source_id,
    isSentinel: row.is_sentinel === 1,
  };
}

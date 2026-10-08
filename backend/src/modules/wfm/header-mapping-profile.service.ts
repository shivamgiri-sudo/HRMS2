import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface HeaderMappingProfile {
  id: number;
  processId: string | null;
  profileName: string;
  sourceIdentifier: string | null;
  columnMappings: Record<string, string>;
  shiftAliasOverrides: Record<string, string> | null;
  statusAliasOverrides: Record<string, string> | null;
  blankHandling: 'UNASSIGNED' | 'NO_CHANGE';
  hdMapsTo: 'HALF_DAY' | 'NEEDS_MAPPING';
  isDefault: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Parse a row from the database, converting snake_case columns to camelCase
 * and parsing JSON columns.
 */
function parseProfileRow(row: any): HeaderMappingProfile {
  return {
    id: row.id,
    processId: row.process_id || null,
    profileName: row.profile_name,
    sourceIdentifier: row.source_identifier || null,
    columnMappings: typeof row.column_mappings === 'string'
      ? JSON.parse(row.column_mappings)
      : row.column_mappings,
    shiftAliasOverrides: row.shift_alias_overrides
      ? (typeof row.shift_alias_overrides === 'string'
          ? JSON.parse(row.shift_alias_overrides)
          : row.shift_alias_overrides)
      : null,
    statusAliasOverrides: row.status_alias_overrides
      ? (typeof row.status_alias_overrides === 'string'
          ? JSON.parse(row.status_alias_overrides)
          : row.status_alias_overrides)
      : null,
    blankHandling: row.blank_handling || 'UNASSIGNED',
    hdMapsTo: row.hd_maps_to || 'NEEDS_MAPPING',
    isDefault: row.is_default === 1 || row.is_default === true,
    isActive: row.is_active === 1 || row.is_active === true,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

/**
 * List all active header mapping profiles, optionally filtered by processId.
 */
export async function listProfiles(processId?: string): Promise<HeaderMappingProfile[]> {
  const conds: string[] = ['is_active = 1'];
  const params: unknown[] = [];

  if (processId) {
    conds.push('process_id = ?');
    params.push(processId);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_header_mapping_profile ${where} ORDER BY created_at DESC`,
    params,
  );

  return (rows as any[]).map(parseProfileRow);
}

/**
 * Create a new header mapping profile.
 * Throws error with statusCode 409 if duplicate (processId + profileName).
 */
export async function createProfile(data: {
  processId?: string;
  profileName: string;
  columnMappings: Record<string, string>;
  shiftAliasOverrides?: Record<string, string>;
  statusAliasOverrides?: Record<string, string>;
  blankHandling?: 'UNASSIGNED' | 'NO_CHANGE';
  hdMapsTo?: 'HALF_DAY' | 'NEEDS_MAPPING';
  isDefault?: boolean;
  createdBy: string;
}): Promise<HeaderMappingProfile> {
  // Check for duplicate (processId + profileName)
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM wfm_header_mapping_profile
     WHERE process_id <=> ? AND profile_name = ? AND is_active = 1`,
    [data.processId || null, data.profileName],
  );

  if (existing.length > 0) {
    const error = new Error(
      `Profile with name "${data.profileName}" already exists for this process`,
    ) as Error & { statusCode?: number };
    error.statusCode = 409;
    throw error;
  }

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO wfm_header_mapping_profile
       (process_id, profile_name, source_identifier, column_mappings, shift_alias_overrides,
        status_alias_overrides, blank_handling, hd_maps_to, is_default, is_active, created_by)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      data.processId || null,
      data.profileName,
      JSON.stringify(data.columnMappings),
      data.shiftAliasOverrides ? JSON.stringify(data.shiftAliasOverrides) : null,
      data.statusAliasOverrides ? JSON.stringify(data.statusAliasOverrides) : null,
      data.blankHandling || 'UNASSIGNED',
      data.hdMapsTo || 'NEEDS_MAPPING',
      data.isDefault ? 1 : 0,
      data.createdBy,
    ],
  );

  const id = result.insertId;

  // Fetch and return the created profile
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_header_mapping_profile WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    throw new Error('Failed to retrieve created profile');
  }

  return parseProfileRow(rows[0]);
}

/**
 * Update partial fields of a header mapping profile.
 */
export async function updateProfile(
  id: number,
  updates: Partial<Omit<HeaderMappingProfile, 'id' | 'createdAt' | 'createdBy'>>,
): Promise<HeaderMappingProfile> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.profileName !== undefined) {
    setClauses.push('profile_name = ?');
    params.push(updates.profileName);
  }
  if (updates.sourceIdentifier !== undefined) {
    setClauses.push('source_identifier = ?');
    params.push(updates.sourceIdentifier || null);
  }
  if (updates.columnMappings !== undefined) {
    setClauses.push('column_mappings = ?');
    params.push(JSON.stringify(updates.columnMappings));
  }
  if (updates.shiftAliasOverrides !== undefined) {
    setClauses.push('shift_alias_overrides = ?');
    params.push(updates.shiftAliasOverrides ? JSON.stringify(updates.shiftAliasOverrides) : null);
  }
  if (updates.statusAliasOverrides !== undefined) {
    setClauses.push('status_alias_overrides = ?');
    params.push(updates.statusAliasOverrides ? JSON.stringify(updates.statusAliasOverrides) : null);
  }
  if (updates.blankHandling !== undefined) {
    setClauses.push('blank_handling = ?');
    params.push(updates.blankHandling);
  }
  if (updates.hdMapsTo !== undefined) {
    setClauses.push('hd_maps_to = ?');
    params.push(updates.hdMapsTo);
  }
  if (updates.isDefault !== undefined) {
    setClauses.push('is_default = ?');
    params.push(updates.isDefault ? 1 : 0);
  }

  // If no updates, just fetch and return
  if (setClauses.length === 0) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_header_mapping_profile WHERE id = ?`,
      [id],
    );
    if (!rows.length) {
      throw new Error(`Profile with id ${id} not found`);
    }
    return parseProfileRow(rows[0]);
  }

  params.push(id);
  await db.execute(
    `UPDATE wfm_header_mapping_profile SET ${setClauses.join(', ')} WHERE id = ?`,
    params,
  );

  // Fetch and return the updated profile
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_header_mapping_profile WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    throw new Error(`Profile with id ${id} not found`);
  }

  return parseProfileRow(rows[0]);
}

/**
 * Soft-delete a header mapping profile (set is_active = 0).
 */
export async function deleteProfile(id: number): Promise<void> {
  await db.execute(`UPDATE wfm_header_mapping_profile SET is_active = 0 WHERE id = ?`, [id]);
}

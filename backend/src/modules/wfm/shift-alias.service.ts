import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface ShiftAlias {
  id: number;
  shiftId: string;
  alias: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
}

/**
 * List all shift aliases, optionally filtered by shiftId
 */
export async function listAliases(shiftId?: string): Promise<ShiftAlias[]> {
  let query = 'SELECT id, shift_id as shiftId, alias, is_active as isActive, created_at as createdAt, created_by as createdBy FROM wfm_shift_alias';
  const params: unknown[] = [];

  if (shiftId) {
    query += ' WHERE shift_id = ?';
    params.push(shiftId);
  }

  query += ' ORDER BY created_at DESC';

  const [rows] = await db.query<RowDataPacket[]>(query, params);
  return (rows as any[]).map((row: any) => ({
    id: row.id,
    shiftId: row.shiftId,
    alias: row.alias,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }));
}

/**
 * Create a new shift alias
 */
export async function createAlias(
  shiftId: string,
  alias: string,
  createdBy: string
): Promise<ShiftAlias> {
  // Check for duplicate alias
  const [existing] = await db.query<RowDataPacket[]>(
    'SELECT id FROM wfm_shift_alias WHERE alias = ?',
    [alias]
  );

  if (existing.length > 0) {
    const error = new Error('Alias already exists');
    (error as any).statusCode = 409;
    throw error;
  }

  const [result] = await db.executeRun(
    'INSERT INTO wfm_shift_alias (shift_id, alias, is_active, created_by) VALUES (?, ?, 1, ?)',
    [shiftId, alias, createdBy]
  );

  const id = (result as any).insertId;
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, shift_id as shiftId, alias, is_active as isActive, created_at as createdAt, created_by as createdBy FROM wfm_shift_alias WHERE id = ?',
    [id]
  );

  const row = (rows as any[])[0];

  return {
    id: row.id,
    shiftId: row.shiftId,
    alias: row.alias,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

/**
 * Update a shift alias
 */
export async function updateAlias(
  id: number,
  updates: { alias?: string; isActive?: boolean }
): Promise<ShiftAlias> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.alias !== undefined) {
    fields.push('alias = ?');
    params.push(updates.alias);
  }

  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    params.push(updates.isActive ? 1 : 0);
  }

  if (fields.length === 0) {
    throw new Error('No updates provided');
  }

  params.push(id);

  await db.executeRun(
    `UPDATE wfm_shift_alias SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, shift_id as shiftId, alias, is_active as isActive, created_at as createdAt, created_by as createdBy FROM wfm_shift_alias WHERE id = ?',
    [id]
  );

  const row = (rows as any[])[0];
  return {
    id: row.id,
    shiftId: row.shiftId,
    alias: row.alias,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

/**
 * Delete a shift alias
 */
export async function deleteAlias(id: number): Promise<void> {
  await db.executeRun('DELETE FROM wfm_shift_alias WHERE id = ?', [id]);
}

/**
 * Resolve shift aliases - case-insensitive mapping from alias string to shiftId
 */
export async function resolveAliases(
  aliases: string[]
): Promise<Map<string, string | null>> {
  if (aliases.length === 0) {
    return new Map();
  }

  // Uppercase all input aliases
  const upperAliases = aliases.map((a) => a.toUpperCase());

  // Query with case-insensitive match
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT alias, shift_id FROM wfm_shift_alias WHERE UPPER(alias) IN (?) AND is_active = 1',
    [upperAliases]
  );

  // Build result map
  const result = new Map<string, string | null>();

  // Initialize all with null
  for (const alias of aliases) {
    result.set(alias, null);
  }

  // Fill in found results
  for (const row of rows as any[]) {
    // Find the original alias (case-insensitive)
    const originalAlias = aliases.find(
      (a) => a.toUpperCase() === row.alias.toUpperCase()
    );
    if (originalAlias) {
      result.set(originalAlias, row.shift_id);
    }
  }

  return result;
}

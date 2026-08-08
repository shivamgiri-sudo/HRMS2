/**
 * Daily Tips / Did You Know Service
 *
 * Micro-learning content delivered daily:
 * - One tip per day, same for all employees
 * - Categories: productivity, tech, communication, company, industry, wellness, fun_fact
 * - Points awarded for reading (2 pts/day)
 * - Archive of past tips browsable
 */

import { randomUUID } from 'crypto';
import { sqlLimitOffset } from "../../db/pagination.js";
import { db } from '../../db/mysql.js';
import { addPoints } from './gamification.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// ============================================================================
// Types
// ============================================================================

export type TipCategory = 'productivity' | 'tech' | 'communication' | 'company' | 'industry' | 'wellness' | 'fun_fact' | 'general';

export interface DailyTip {
  id: string;
  tip_date: string;
  category: TipCategory;
  title: string;
  content: string;
  media_url: string | null;
  learn_more_url: string | null;
  source: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TipReadStatus {
  tip: DailyTip;
  alreadyRead: boolean;
  readAt: string | null;
  pointsAwarded: number;
}

export interface ReadTipResult {
  alreadyRead: boolean;
  pointsAwarded: number;
  tip: DailyTip;
}

interface TipRow extends RowDataPacket, DailyTip {}

interface TipReadRow extends RowDataPacket {
  id: string;
  tip_id: string;
  employee_id: string;
  points_awarded: number;
  read_at: string;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get today's tip with read status for an employee
 */
export async function getTodayTip(employeeId: string): Promise<TipReadStatus | null> {
  const today = new Date().toISOString().split('T')[0];

  // Get today's tip
  const [tipRows] = await db.execute<TipRow[]>(
    `SELECT * FROM daily_tip WHERE tip_date = ?`,
    [today]
  );

  if (tipRows.length === 0) {
    return null;
  }

  const tip = tipRows[0];

  // Check if already read
  const [readRows] = await db.execute<TipReadRow[]>(
    `SELECT * FROM daily_tip_read WHERE tip_id = ? AND employee_id = ?`,
    [tip.id, employeeId]
  );

  const readRecord = readRows[0];

  return {
    tip,
    alreadyRead: !!readRecord,
    readAt: readRecord?.read_at || null,
    pointsAwarded: readRecord?.points_awarded || 0,
  };
}

/**
 * Mark tip as read and award points
 */
export async function markTipAsRead(employeeId: string, tipId: string): Promise<ReadTipResult> {
  // Get the tip
  const [tipRows] = await db.execute<TipRow[]>(
    `SELECT * FROM daily_tip WHERE id = ?`,
    [tipId]
  );

  if (tipRows.length === 0) {
    throw new Error('Tip not found');
  }

  const tip = tipRows[0];

  // Check if already read
  const [existingRows] = await db.execute<TipReadRow[]>(
    `SELECT * FROM daily_tip_read WHERE tip_id = ? AND employee_id = ?`,
    [tipId, employeeId]
  );

  if (existingRows.length > 0) {
    return {
      alreadyRead: true,
      pointsAwarded: 0,
      tip,
    };
  }

  // Record the read
  const readId = randomUUID();
  const pointsToAward = 2;

  await db.execute<ResultSetHeader>(
    `INSERT INTO daily_tip_read (id, tip_id, employee_id, points_awarded, read_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [readId, tipId, employeeId, pointsToAward]
  );

  // Award points
  await addPoints(
    employeeId,
    pointsToAward,
    'tip_read',
    `Read daily tip: ${tip.title}`,
    readId
  );

  return {
    alreadyRead: false,
    pointsAwarded: pointsToAward,
    tip,
  };
}

/**
 * Get tip archive (past tips)
 */
export async function getTipArchive(
  options: {
    category?: TipCategory;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ tips: DailyTip[]; total: number }> {
  const { category, limit = 20, offset = 0 } = options;
  const today = new Date().toISOString().split('T')[0];

  let whereClause = 'WHERE tip_date <= ?';
  const params: (string | number)[] = [today];

  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  // Get total count
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM daily_tip ${whereClause}`,
    params
  );
  const total = countRows[0]?.total || 0;

  // Get tips
  const [tipRows] = await db.execute<TipRow[]>(
    `SELECT * FROM daily_tip ${whereClause}
     ORDER BY tip_date DESC
     ${sqlLimitOffset(limit, offset)}`,
    params
  );

  return { tips: tipRows, total };
}

/**
 * Get employee's read history
 */
export async function getReadHistory(
  employeeId: string,
  limit: number = 30
): Promise<Array<DailyTip & { read_at: string }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.*, tr.read_at
     FROM daily_tip t
     JOIN daily_tip_read tr ON tr.tip_id = t.id
     WHERE tr.employee_id = ?
     ORDER BY tr.read_at DESC
     LIMIT ?`,
    [employeeId, limit]
  );

  return rows as Array<DailyTip & { read_at: string }>;
}

/**
 * Create a new tip (admin)
 */
export async function createTip(
  data: {
    tip_date: string;
    category: TipCategory;
    title: string;
    content: string;
    media_url?: string;
    learn_more_url?: string;
    source?: string;
  },
  createdBy: string
): Promise<DailyTip> {
  const tipId = randomUUID();

  await db.execute<ResultSetHeader>(
    `INSERT INTO daily_tip (id, tip_date, category, title, content, media_url, learn_more_url, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tipId,
      data.tip_date,
      data.category,
      data.title,
      data.content,
      data.media_url || null,
      data.learn_more_url || null,
      data.source || null,
      createdBy,
    ]
  );

  const [rows] = await db.execute<TipRow[]>(
    `SELECT * FROM daily_tip WHERE id = ?`,
    [tipId]
  );

  return rows[0];
}

/**
 * Update a tip (admin)
 */
export async function updateTip(
  tipId: string,
  data: Partial<{
    tip_date: string;
    category: TipCategory;
    title: string;
    content: string;
    media_url: string | null;
    learn_more_url: string | null;
    source: string | null;
  }>
): Promise<DailyTip | null> {
  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (data.tip_date !== undefined) {
    updates.push('tip_date = ?');
    params.push(data.tip_date);
  }
  if (data.category !== undefined) {
    updates.push('category = ?');
    params.push(data.category);
  }
  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(data.title);
  }
  if (data.content !== undefined) {
    updates.push('content = ?');
    params.push(data.content);
  }
  if (data.media_url !== undefined) {
    updates.push('media_url = ?');
    params.push(data.media_url);
  }
  if (data.learn_more_url !== undefined) {
    updates.push('learn_more_url = ?');
    params.push(data.learn_more_url);
  }
  if (data.source !== undefined) {
    updates.push('source = ?');
    params.push(data.source);
  }

  if (updates.length === 0) {
    const [rows] = await db.execute<TipRow[]>(
      `SELECT * FROM daily_tip WHERE id = ?`,
      [tipId]
    );
    return rows[0] || null;
  }

  params.push(tipId);

  await db.execute<ResultSetHeader>(
    `UPDATE daily_tip SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  const [rows] = await db.execute<TipRow[]>(
    `SELECT * FROM daily_tip WHERE id = ?`,
    [tipId]
  );

  return rows[0] || null;
}

/**
 * Delete a tip (admin)
 */
export async function deleteTip(tipId: string): Promise<boolean> {
  // Delete read records first
  await db.execute<ResultSetHeader>(
    `DELETE FROM daily_tip_read WHERE tip_id = ?`,
    [tipId]
  );

  const [result] = await db.execute<ResultSetHeader>(
    `DELETE FROM daily_tip WHERE id = ?`,
    [tipId]
  );

  return result.affectedRows > 0;
}

/**
 * Get tip statistics
 */
export async function getTipStats(): Promise<{
  totalTips: number;
  totalReads: number;
  categoryBreakdown: Record<string, number>;
  avgReadsPerTip: number;
}> {
  const [totalRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM daily_tip`
  );

  const [readRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM daily_tip_read`
  );

  const [categoryRows] = await db.execute<RowDataPacket[]>(
    `SELECT category, COUNT(*) as count FROM daily_tip GROUP BY category`
  );

  const totalTips = totalRows[0]?.total || 0;
  const totalReads = readRows[0]?.total || 0;

  const categoryBreakdown: Record<string, number> = {};
  for (const row of categoryRows) {
    categoryBreakdown[row.category] = row.count;
  }

  return {
    totalTips,
    totalReads,
    categoryBreakdown,
    avgReadsPerTip: totalTips > 0 ? Math.round(totalReads / totalTips) : 0,
  };
}

export const dailyTipsService = {
  getTodayTip,
  markTipAsRead,
  getTipArchive,
  getReadHistory,
  createTip,
  updateTip,
  deleteTip,
  getTipStats,
};

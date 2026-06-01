// =====================================================
// Gamification Service
// File: gamification.service.ts
// Description: Points, tiers, and leaderboard management
// =====================================================

import { db } from '../../db/mysql.js';
import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import {
  GamificationPointsLedger,
  GamificationTierMaster,
  EmployeeTierStatus,
  TransactionType,
  CreateTierDTO,
  UpdateTierDTO,
  LeaderboardEntry,
  PaginatedResult,
  PointsLedgerFilters,
} from './engagement.types.js';

// =====================================================
// POINTS METHODS
// =====================================================

/**
 * Add points to employee and trigger tier upgrade check
 */
export async function addPoints(
  employeeId: string,
  points: number,
  transactionType: TransactionType,
  description?: string,
  referenceId?: string
): Promise<GamificationPointsLedger> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Calculate new balance
    const [balanceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points_delta), 0) as total_points
       FROM gamification_points_ledger
       WHERE employee_id = ?`,
      [employeeId]
    );
    const currentBalance = balanceRows[0]?.total_points || 0;
    const newBalance = currentBalance + points;

    // 2. Insert transaction
    const transactionId = randomUUID();
    await conn.execute(
      `INSERT INTO gamification_points_ledger (
        transaction_id, employee_id, points_delta, transaction_type,
        reference_id, description, balance_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [transactionId, employeeId, points, transactionType, referenceId, description, newBalance]
    );

    // 3. Auto tier upgrade
    await checkTierUpgrade(employeeId, newBalance, conn);

    await conn.commit();

    // 4. Return transaction record
    const [ledgerRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_points_ledger WHERE transaction_id = ?`,
      [transactionId]
    );

    return ledgerRows[0] as GamificationPointsLedger;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Get current points balance for employee
 */
export async function getPointsBalance(employeeId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(points_delta), 0) as total_points
     FROM gamification_points_ledger
     WHERE employee_id = ?`,
    [employeeId]
  );
  return rows[0]?.total_points || 0;
}

/**
 * Get points transaction history with pagination
 */
export async function getPointsHistory(
  employeeId: string,
  filters?: PointsLedgerFilters,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResult<GamificationPointsLedger>> {
  let sql = `SELECT * FROM gamification_points_ledger WHERE employee_id = ?`;
  const params: unknown[] = [employeeId];

  // Apply filters
  if (filters?.transaction_type) {
    sql += ` AND transaction_type = ?`;
    params.push(filters.transaction_type);
  }
  if (filters?.date_from) {
    sql += ` AND created_at >= ?`;
    params.push(filters.date_from);
  }
  if (filters?.date_to) {
    sql += ` AND created_at <= ?`;
    params.push(filters.date_to);
  }

  // Count total
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const [countRows] = await db.execute<RowDataPacket[]>(countSql, params);
  const total = countRows[0]?.total || 0;

  // Paginate
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, (page - 1) * limit);

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);

  return {
    data: rows as GamificationPointsLedger[],
    total,
    page,
    limit,
  };
}

/**
 * Get leaderboard - top N employees by points
 */
export async function getLeaderboard(
  period: 'all-time' | 'month' | 'quarter' = 'all-time',
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  let dateFilter = '';
  if (period === 'month') {
    dateFilter = `AND gpl.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
  } else if (period === 'quarter') {
    dateFilter = `AND gpl.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)`;
  }

  const sql = `
    SELECT
      gpl.employee_id,
      CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')) as employee_name,
      gpl.total_points as total_points,
      COALESCE(gtm.tier_name, 'No Tier') as current_tier,
      ROW_NUMBER() OVER (ORDER BY gpl.total_points DESC) as \`rank\`,
      COALESCE(badges.badges_earned, 0) as badges_earned
    FROM (
      SELECT employee_id, SUM(points_delta) as total_points
      FROM gamification_points_ledger
      WHERE 1=1 ${dateFilter.replaceAll('gpl.', '')}
      GROUP BY employee_id
    ) gpl
    LEFT JOIN employees e ON gpl.employee_id = e.id
    LEFT JOIN employee_tier_status ets ON gpl.employee_id = ets.employee_id
    LEFT JOIN gamification_tier_master gtm ON ets.current_tier_id = gtm.tier_id
    LEFT JOIN (
      SELECT employee_id, COUNT(*) as badges_earned
      FROM employee_badge_earned
      GROUP BY employee_id
    ) badges ON gpl.employee_id = badges.employee_id
    ORDER BY total_points DESC
    LIMIT ?
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [limit]);
  return rows as LeaderboardEntry[];
}

// =====================================================
// TIER METHODS
// =====================================================

/**
 * Get all tiers
 */
export async function getTiers(activeOnly: boolean = false): Promise<GamificationTierMaster[]> {
  let sql = `SELECT * FROM gamification_tier_master`;
  if (activeOnly) {
    sql += ` WHERE is_active = 1`;
  }
  sql += ` ORDER BY tier_level ASC`;

  const [rows] = await db.execute<RowDataPacket[]>(sql);
  return rows as GamificationTierMaster[];
}

/**
 * Get single tier by ID
 */
export async function getTierById(tierId: string): Promise<GamificationTierMaster | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM gamification_tier_master WHERE tier_id = ?`,
    [tierId]
  );
  return rows[0] ? (rows[0] as GamificationTierMaster) : null;
}

/**
 * Create new tier
 */
export async function createTier(data: CreateTierDTO): Promise<GamificationTierMaster> {
  const tierId = randomUUID();
  await db.executeRun(
    `INSERT INTO gamification_tier_master (
      tier_id, tier_name, tier_level, min_points, max_points,
      tier_color, tier_icon, benefits_json, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      tierId,
      data.tier_name,
      data.tier_level,
      data.min_points,
      data.max_points || null,
      data.tier_color || null,
      data.tier_icon || null,
      data.benefits_json ? JSON.stringify(data.benefits_json) : null,
      data.is_active ?? true,
    ]
  );

  const created = await getTierById(tierId);
  if (!created) throw new Error('Failed to create tier');
  return created;
}

/**
 * Update tier
 */
export async function updateTier(
  tierId: string,
  updates: UpdateTierDTO
): Promise<GamificationTierMaster | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.tier_name !== undefined) {
    fields.push('tier_name = ?');
    params.push(updates.tier_name);
  }
  if (updates.tier_level !== undefined) {
    fields.push('tier_level = ?');
    params.push(updates.tier_level);
  }
  if (updates.min_points !== undefined) {
    fields.push('min_points = ?');
    params.push(updates.min_points);
  }
  if (updates.max_points !== undefined) {
    fields.push('max_points = ?');
    params.push(updates.max_points);
  }
  if (updates.tier_color !== undefined) {
    fields.push('tier_color = ?');
    params.push(updates.tier_color);
  }
  if (updates.tier_icon !== undefined) {
    fields.push('tier_icon = ?');
    params.push(updates.tier_icon);
  }
  if (updates.benefits_json !== undefined) {
    fields.push('benefits_json = ?');
    params.push(JSON.stringify(updates.benefits_json));
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(updates.is_active);
  }

  if (fields.length === 0) {
    return await getTierById(tierId);
  }

  fields.push('updated_at = NOW()');
  params.push(tierId);

  const sql = `UPDATE gamification_tier_master SET ${fields.join(', ')} WHERE tier_id = ?`;
  await db.executeRun(sql, params);

  return await getTierById(tierId);
}

/**
 * Get employee current tier with progress
 */
export async function getEmployeeTier(employeeId: string): Promise<{
  current_tier: GamificationTierMaster | null;
  total_points: number;
  points_to_next_tier: number | null;
  progress_percentage: number;
}> {
  // Get current points
  const totalPoints = await getPointsBalance(employeeId);

  // Get tier status
  const [statusRows] = await db.execute<RowDataPacket[]>(
    `SELECT ets.*, gtm.*
     FROM employee_tier_status ets
     LEFT JOIN gamification_tier_master gtm ON ets.current_tier_id = gtm.tier_id
     WHERE ets.employee_id = ?`,
    [employeeId]
  );

  if (statusRows.length === 0) {
    // No tier yet - check if they qualify for any
    const [tierRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_tier_master
       WHERE is_active = 1 AND min_points <= ?
       ORDER BY tier_level DESC LIMIT 1`,
      [totalPoints]
    );

    const currentTier = tierRows[0] ? (tierRows[0] as GamificationTierMaster) : null;

    // Find next tier
    let pointsToNext = null;
    let progressPercentage = 0;

    if (currentTier) {
      const [nextTierRows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM gamification_tier_master
         WHERE is_active = 1 AND tier_level > ?
         ORDER BY tier_level ASC LIMIT 1`,
        [currentTier.tier_level]
      );

      if (nextTierRows.length > 0) {
        const nextTier = nextTierRows[0] as GamificationTierMaster;
        pointsToNext = nextTier.min_points - totalPoints;
        progressPercentage = Math.min(
          100,
          Math.round(((totalPoints - currentTier.min_points) / (nextTier.min_points - currentTier.min_points)) * 100)
        );
      }
    }

    return {
      current_tier: currentTier,
      total_points: totalPoints,
      points_to_next_tier: pointsToNext,
      progress_percentage: progressPercentage,
    };
  }

  const status = statusRows[0] as EmployeeTierStatus & GamificationTierMaster;
  const currentTier: GamificationTierMaster = {
    tier_id: status.tier_id,
    tier_name: status.tier_name,
    tier_level: status.tier_level,
    min_points: status.min_points,
    max_points: status.max_points,
    tier_color: status.tier_color,
    tier_icon: status.tier_icon,
    benefits_json: status.benefits_json,
    is_active: status.is_active,
    created_at: status.created_at,
    updated_at: status.updated_at,
  };

  // Find next tier
  const [nextTierRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM gamification_tier_master
     WHERE is_active = 1 AND tier_level > ?
     ORDER BY tier_level ASC LIMIT 1`,
    [currentTier.tier_level]
  );

  let pointsToNext = null;
  let progressPercentage = 0;

  if (nextTierRows.length > 0) {
    const nextTier = nextTierRows[0] as GamificationTierMaster;
    pointsToNext = nextTier.min_points - totalPoints;
    progressPercentage = Math.min(
      100,
      Math.round(((totalPoints - currentTier.min_points) / (nextTier.min_points - currentTier.min_points)) * 100)
    );
  }

  return {
    current_tier: currentTier,
    total_points: totalPoints,
    points_to_next_tier: pointsToNext,
    progress_percentage: progressPercentage,
  };
}

/**
 * Check and upgrade employee tier if threshold crossed
 * (Internal function called after points added)
 */
export async function checkTierUpgrade(
  employeeId: string,
  newTotalPoints: number,
  connection?: PoolConnection
): Promise<void> {
  const conn = connection || (await db.getConnection());
  const shouldRelease = !connection;

  try {
    // Find highest tier employee qualifies for
    const [tierRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_tier_master
       WHERE is_active = 1 AND min_points <= ?
       ORDER BY tier_level DESC LIMIT 1`,
      [newTotalPoints]
    );

    if (tierRows.length === 0) {
      if (shouldRelease) conn.release();
      return; // No tier to upgrade to
    }

    const newTier = tierRows[0] as GamificationTierMaster;

    // Check current tier
    const [statusRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM employee_tier_status WHERE employee_id = ?`,
      [employeeId]
    );

    if (statusRows.length === 0) {
      // First time tier assignment
      const statusId = randomUUID();

      // Find next tier
      const [nextTierRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM gamification_tier_master
         WHERE is_active = 1 AND tier_level > ?
         ORDER BY tier_level ASC LIMIT 1`,
        [newTier.tier_level]
      );

      const pointsToNext = nextTierRows.length > 0
        ? (nextTierRows[0] as GamificationTierMaster).min_points - newTotalPoints
        : null;

      await conn.execute(
        `INSERT INTO employee_tier_status (
          status_id, employee_id, current_tier_id, total_points,
          points_to_next_tier, tier_achieved_at, last_updated
        ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [statusId, employeeId, newTier.tier_id, newTotalPoints, pointsToNext]
      );
    } else {
      // Check if upgrade needed
      const currentStatus = statusRows[0] as EmployeeTierStatus;

      const [currentTierRows] = await conn.execute<RowDataPacket[]>(
        `SELECT tier_level FROM gamification_tier_master WHERE tier_id = ?`,
        [currentStatus.current_tier_id]
      );

      const currentTierLevel = currentTierRows[0]?.tier_level || 0;

      if (newTier.tier_level > currentTierLevel) {
        // Upgrade!
        const [nextTierRows] = await conn.execute<RowDataPacket[]>(
          `SELECT * FROM gamification_tier_master
           WHERE is_active = 1 AND tier_level > ?
           ORDER BY tier_level ASC LIMIT 1`,
          [newTier.tier_level]
        );

        const pointsToNext = nextTierRows.length > 0
          ? (nextTierRows[0] as GamificationTierMaster).min_points - newTotalPoints
          : null;

        await conn.execute(
          `UPDATE employee_tier_status
           SET current_tier_id = ?, total_points = ?, points_to_next_tier = ?,
               tier_achieved_at = NOW(), last_updated = NOW()
           WHERE employee_id = ?`,
          [newTier.tier_id, newTotalPoints, pointsToNext, employeeId]
        );
      } else {
        // Just update points
        const [nextTierRows] = await conn.execute<RowDataPacket[]>(
          `SELECT * FROM gamification_tier_master
           WHERE is_active = 1 AND tier_level > ?
           ORDER BY tier_level ASC LIMIT 1`,
          [currentTierLevel]
        );

        const pointsToNext = nextTierRows.length > 0
          ? (nextTierRows[0] as GamificationTierMaster).min_points - newTotalPoints
          : null;

        await conn.execute(
          `UPDATE employee_tier_status
           SET total_points = ?, points_to_next_tier = ?, last_updated = NOW()
           WHERE employee_id = ?`,
          [newTotalPoints, pointsToNext, employeeId]
        );
      }
    }

    if (shouldRelease) conn.release();
  } catch (error) {
    if (shouldRelease) conn.release();
    throw error;
  }
}

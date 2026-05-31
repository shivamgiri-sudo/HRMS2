// =====================================================
// Badge Service
// File: badge.service.ts
// Description: Badge management and auto-award logic
// =====================================================

import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type {
  BadgeMaster,
  EmployeeBadgeEarned,
  CreateBadgeDTO,
  UpdateBadgeDTO,
  AwardBadgeDTO,
  BadgeFilters,
  BadgeCriteria,
} from './engagement.types.js';
import crypto from 'crypto';

// =====================================================
// BADGE MANAGEMENT
// =====================================================

/**
 * Get badges with optional filters
 */
export async function getBadges(filters?: BadgeFilters): Promise<BadgeMaster[]> {
  let sql = `
    SELECT badge_id, badge_name, badge_description, badge_icon,
           badge_category, points_value, criteria_json, is_active,
           created_at, updated_at
    FROM badge_master
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (filters?.badge_category) {
    sql += ' AND badge_category = ?';
    params.push(filters.badge_category);
  }

  if (filters?.is_active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(filters.is_active);
  }

  if (filters?.search) {
    sql += ' AND (badge_name LIKE ? OR badge_description LIKE ?)';
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  sql += ' ORDER BY badge_category, badge_name';

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);

  return rows.map((row) => ({
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));
}

/**
 * Get single badge by ID
 */
export async function getBadgeById(badgeId: string): Promise<BadgeMaster | null> {
  const sql = `
    SELECT badge_id, badge_name, badge_description, badge_icon,
           badge_category, points_value, criteria_json, is_active,
           created_at, updated_at
    FROM badge_master
    WHERE badge_id = ?
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [badgeId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Create new badge
 */
export async function createBadge(data: CreateBadgeDTO): Promise<BadgeMaster> {
  const badgeId = crypto.randomUUID();
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO badge_master (
      badge_id, badge_name, badge_description, badge_icon,
      badge_category, points_value, criteria_json, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    badgeId,
    data.badge_name,
    data.badge_description || null,
    data.badge_icon || null,
    data.badge_category,
    data.points_value,
    data.criteria_json ? JSON.stringify(data.criteria_json) : null,
    data.is_active ?? true,
    now,
    now,
  ];

  await db.executeRun(sql, params);

  const badge = await getBadgeById(badgeId);
  if (!badge) throw new Error('Failed to create badge');

  return badge;
}

/**
 * Update badge
 */
export async function updateBadge(
  badgeId: string,
  updates: UpdateBadgeDTO
): Promise<BadgeMaster | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.badge_name !== undefined) {
    fields.push('badge_name = ?');
    params.push(updates.badge_name);
  }
  if (updates.badge_description !== undefined) {
    fields.push('badge_description = ?');
    params.push(updates.badge_description);
  }
  if (updates.badge_icon !== undefined) {
    fields.push('badge_icon = ?');
    params.push(updates.badge_icon);
  }
  if (updates.badge_category !== undefined) {
    fields.push('badge_category = ?');
    params.push(updates.badge_category);
  }
  if (updates.points_value !== undefined) {
    fields.push('points_value = ?');
    params.push(updates.points_value);
  }
  if (updates.criteria_json !== undefined) {
    fields.push('criteria_json = ?');
    params.push(updates.criteria_json ? JSON.stringify(updates.criteria_json) : null);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(updates.is_active);
  }

  if (fields.length === 0) {
    return getBadgeById(badgeId);
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(badgeId);

  const sql = `UPDATE badge_master SET ${fields.join(', ')} WHERE badge_id = ?`;

  await db.executeRun(sql, params);

  return getBadgeById(badgeId);
}

/**
 * Deactivate badge (soft delete)
 */
export async function deactivateBadge(badgeId: string): Promise<boolean> {
  const sql = `UPDATE badge_master SET is_active = 0, updated_at = ? WHERE badge_id = ?`;
  const [result] = await db.executeRun(sql, [new Date().toISOString(), badgeId]);
  return (result as ResultSetHeader).affectedRows > 0;
}

// =====================================================
// BADGE AWARDING
// =====================================================

/**
 * Award badge manually
 */
export async function awardBadge(data: AwardBadgeDTO): Promise<EmployeeBadgeEarned> {
  // Check if employee exists
  const [empRows] = await db.execute<RowDataPacket[]>(
    'SELECT employee_id FROM employee_master WHERE employee_id = ?',
    [data.employee_id]
  );
  if (empRows.length === 0) {
    throw new Error(`Employee ${data.employee_id} not found`);
  }

  // Check if badge exists and is active
  const badge = await getBadgeById(data.badge_id);
  if (!badge) {
    throw new Error(`Badge ${data.badge_id} not found`);
  }
  if (!badge.is_active) {
    throw new Error(`Badge ${data.badge_id} is not active`);
  }

  // Check if already earned
  const [existingRows] = await db.execute<RowDataPacket[]>(
    'SELECT earned_id FROM employee_badge_earned WHERE employee_id = ? AND badge_id = ?',
    [data.employee_id, data.badge_id]
  );
  if (existingRows.length > 0) {
    throw new Error(`Employee ${data.employee_id} already has badge ${data.badge_id}`);
  }

  const earnedId = crypto.randomUUID();
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO employee_badge_earned (
      earned_id, employee_id, badge_id, earned_at,
      reason, awarded_by, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    earnedId,
    data.employee_id,
    data.badge_id,
    now,
    data.reason || null,
    data.awarded_by || null,
    data.metadata_json ? JSON.stringify(data.metadata_json) : null,
  ];

  await db.executeRun(sql, params);

  // TODO: Award points via points service when implemented

  return {
    earned_id: earnedId,
    employee_id: data.employee_id,
    badge_id: data.badge_id,
    earned_at: now,
    reason: data.reason || null,
    awarded_by: data.awarded_by || null,
    metadata_json: data.metadata_json || null,
  };
}

/**
 * Get employee's badges
 */
export async function getEmployeeBadges(employeeId: string): Promise<
  Array<
    EmployeeBadgeEarned & {
      badge_name: string;
      badge_icon: string | null;
      badge_category: string;
      points_value: number;
    }
  >
> {
  const sql = `
    SELECT
      ebe.earned_id, ebe.employee_id, ebe.badge_id, ebe.earned_at,
      ebe.reason, ebe.awarded_by, ebe.metadata_json,
      bm.badge_name, bm.badge_icon, bm.badge_category, bm.points_value
    FROM employee_badge_earned ebe
    JOIN badge_master bm ON ebe.badge_id = bm.badge_id
    WHERE ebe.employee_id = ?
    ORDER BY ebe.earned_at DESC
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [employeeId]);

  return rows.map((row) => ({
    earned_id: row.earned_id as string,
    employee_id: row.employee_id as string,
    badge_id: row.badge_id as string,
    earned_at: row.earned_at as string,
    reason: row.reason as string | null,
    awarded_by: row.awarded_by as string | null,
    metadata_json: row.metadata_json as Record<string, any> | null,
    badge_name: row.badge_name as string,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as string,
    points_value: row.points_value as number,
  }));
}

// =====================================================
// AUTO-AWARD LOGIC
// =====================================================

/**
 * Check and award auto-badges based on activity type
 */
export async function checkAutoAwards(
  employeeId: string,
  activityType: string
): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  switch (activityType) {
    case 'performance_review':
      awarded.push(...(await checkPerformanceBadges(employeeId)));
      break;
    case 'attendance':
      awarded.push(...(await checkAttendanceBadges(employeeId)));
      break;
    case 'survey_completed':
      awarded.push(...(await checkSurveyBadges(employeeId)));
      break;
    case 'tenure':
      awarded.push(...(await checkTenureBadges(employeeId)));
      break;
    default:
      break;
  }

  return awarded;
}

/**
 * Check performance badges (top_performer, revenue_champion)
 */
async function checkPerformanceBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Top Performer: Rating >= 4.5 in last review
  const [perfRows] = await db.execute<RowDataPacket[]>(
    `SELECT overall_rating
     FROM performance_review
     WHERE employee_id = ?
     ORDER BY review_date DESC
     LIMIT 1`,
    [employeeId]
  );

  if (perfRows.length > 0 && perfRows[0].overall_rating >= 4.5) {
    const badge = await findBadgeByName('Top Performer');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Achieved rating >= 4.5 in performance review',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  // Revenue Champion: Check if top 10% in revenue (dialer_db.user_revenue)
  // Note: dialer_db is read-only external DB
  const [revenueRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM dialer_db.user_revenue WHERE revenue > ur.revenue) as better_count,
       (SELECT COUNT(*) FROM dialer_db.user_revenue) as total_count
     FROM dialer_db.user_revenue ur
     WHERE ur.user_id = ?`,
    [employeeId]
  );

  if (revenueRows.length > 0) {
    const betterCount = revenueRows[0].better_count as number;
    const totalCount = revenueRows[0].total_count as number;
    const percentile = (betterCount / totalCount) * 100;

    if (percentile <= 10) {
      const badge = await findBadgeByName('Revenue Champion');
      if (badge) {
        try {
          const earned = await awardBadge({
            employee_id: employeeId,
            badge_id: badge.badge_id,
            reason: 'Top 10% in revenue generation',
            awarded_by: 'system',
          });
          awarded.push(earned);
        } catch (err) {
          // Badge already awarded or other error - skip
        }
      }
    }
  }

  return awarded;
}

/**
 * Check attendance badges (early_bird, perfect_attendance)
 */
async function checkAttendanceBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Early Bird: 90%+ check-ins before 9:00 AM in last 30 days
  const [earlyRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) as total_days,
       SUM(CASE WHEN TIME(check_in_time) < '09:00:00' THEN 1 ELSE 0 END) as early_count
     FROM attendance
     WHERE employee_id = ?
       AND check_in_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND check_in_time IS NOT NULL`,
    [employeeId]
  );

  if (earlyRows.length > 0 && earlyRows[0].total_days >= 20) {
    const earlyPercentage = (earlyRows[0].early_count / earlyRows[0].total_days) * 100;
    if (earlyPercentage >= 90) {
      const badge = await findBadgeByName('Early Bird');
      if (badge) {
        try {
          const earned = await awardBadge({
            employee_id: employeeId,
            badge_id: badge.badge_id,
            reason: '90%+ check-ins before 9 AM in last 30 days',
            awarded_by: 'system',
          });
          awarded.push(earned);
        } catch (err) {
          // Badge already awarded or other error - skip
        }
      }
    }
  }

  // Perfect Attendance: No absences in last 90 days
  const [absenceRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as absence_count
     FROM attendance
     WHERE employee_id = ?
       AND check_in_time IS NULL
       AND date >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
    [employeeId]
  );

  if (absenceRows.length > 0 && absenceRows[0].absence_count === 0) {
    const badge = await findBadgeByName('Perfect Attendance');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'No absences in last 90 days',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check survey badges (survey_champion)
 */
async function checkSurveyBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Survey Champion: Completed 10+ surveys
  const [surveyRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT survey_id) as survey_count
     FROM survey_response
     WHERE employee_id = ?`,
    [employeeId]
  );

  if (surveyRows.length > 0 && surveyRows[0].survey_count >= 10) {
    const badge = await findBadgeByName('Survey Champion');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Completed 10+ surveys',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check tenure badges (6_month, 1_year, 2_year, 5_year)
 */
async function checkTenureBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Get employee join date
  const [empRows] = await db.execute<RowDataPacket[]>(
    'SELECT date_of_joining FROM employee_master WHERE employee_id = ?',
    [employeeId]
  );

  if (empRows.length === 0) return awarded;

  const joinDate = new Date(empRows[0].date_of_joining as string);
  const now = new Date();
  const tenureMonths =
    (now.getFullYear() - joinDate.getFullYear()) * 12 + (now.getMonth() - joinDate.getMonth());

  const tenureMilestones = [
    { months: 6, name: '6 Month Champion' },
    { months: 12, name: '1 Year Veteran' },
    { months: 24, name: '2 Year Veteran' },
    { months: 60, name: '5 Year Legend' },
  ];

  for (const milestone of tenureMilestones) {
    if (tenureMonths >= milestone.months) {
      const badge = await findBadgeByName(milestone.name);
      if (badge) {
        try {
          const earned = await awardBadge({
            employee_id: employeeId,
            badge_id: badge.badge_id,
            reason: `${milestone.months} months of service`,
            awarded_by: 'system',
          });
          awarded.push(earned);
        } catch (err) {
          // Badge already awarded or other error - skip
        }
      }
    }
  }

  return awarded;
}

/**
 * Helper: Find badge by name
 */
async function findBadgeByName(badgeName: string): Promise<BadgeMaster | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT badge_id, badge_name, badge_description, badge_icon,
            badge_category, points_value, criteria_json, is_active,
            created_at, updated_at
     FROM badge_master
     WHERE badge_name = ? AND is_active = 1`,
    [badgeName]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

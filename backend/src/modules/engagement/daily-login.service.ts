/**
 * Daily Login Rewards & Streak Service
 *
 * Awards points for daily logins with streak multipliers:
 * - Base: 5 points/day
 * - 7-day streak: 2x multiplier
 * - 30-day streak: 3x multiplier
 * - 100-day streak: 4x multiplier
 *
 * Points integrate with existing gamification_points_ledger
 */

import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { checkTierUpgrade } from './gamification.service.js';
import { awardBadge, getBadges } from './badge.service.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// ============================================================================
// Types
// ============================================================================

export interface LoginRewardResult {
  alreadyClaimedToday: boolean;
  pointsAwarded: number;
  basePoints: number;
  multiplier: number;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  newBadgeEarned?: { id: string; name: string; icon: string };
  nextMilestone?: { days: number; multiplier: number };
}

export interface StreakStatus {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
  todayClaimed: boolean;
  nextMilestone?: { days: number; multiplier: number };
}

interface DailyLoginRow extends RowDataPacket {
  id: string;
  employee_id: string;
  login_date: string;
  points_awarded: number;
  streak_day: number;
  streak_multiplier: number;
}

interface TierStatusRow extends RowDataPacket {
  current_streak: number;
  longest_streak: number;
  last_login_date: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const BASE_POINTS = 5;

const STREAK_MILESTONES = [
  { days: 7, multiplier: 2.0, badgeName: '7-Day Streak', badgeIcon: 'flame' },
  { days: 30, multiplier: 3.0, badgeName: '30-Day Streak', badgeIcon: 'zap' },
  { days: 100, multiplier: 4.0, badgeName: '100-Day Streak', badgeIcon: 'trophy' },
  { days: 365, multiplier: 5.0, badgeName: 'Year Streak', badgeIcon: 'crown' },
];

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Claim daily login reward
 */
export async function claimDailyLogin(employeeId: string): Promise<LoginRewardResult> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Check if already claimed today
    const [existingRows] = await conn.query<DailyLoginRow[]>(
      `SELECT * FROM employee_daily_login WHERE employee_id = ? AND login_date = ?`,
      [employeeId, today]
    );

    if (existingRows.length > 0) {
      await conn.rollback();
      const streakStatus = await getStreakStatus(employeeId);
      return {
        alreadyClaimedToday: true,
        pointsAwarded: 0,
        basePoints: BASE_POINTS,
        multiplier: 1,
        currentStreak: streakStatus.currentStreak,
        longestStreak: streakStatus.longestStreak,
        streakBroken: false,
        nextMilestone: streakStatus.nextMilestone,
      };
    }

    // Get current streak info
    const [tierRows] = await conn.query<TierStatusRow[]>(
      `SELECT current_streak, longest_streak, last_login_date
       FROM employee_tier_status WHERE employee_id = ?`,
      [employeeId]
    );

    let currentStreak = 1;
    let longestStreak = 0;
    let streakBroken = false;

    if (tierRows.length > 0) {
      const lastLogin = tierRows[0].last_login_date;
      longestStreak = tierRows[0].longest_streak || 0;

      if (lastLogin === yesterday) {
        // Continuing streak
        currentStreak = (tierRows[0].current_streak || 0) + 1;
      } else if (lastLogin === today) {
        // Already logged in today (shouldn't happen due to check above)
        currentStreak = tierRows[0].current_streak || 1;
      } else {
        // Streak broken - reset to 1
        streakBroken = tierRows[0].current_streak > 1;
        currentStreak = 1;
      }
    }

    // Calculate multiplier based on streak
    let multiplier = 1.0;
    for (const milestone of STREAK_MILESTONES) {
      if (currentStreak >= milestone.days) {
        multiplier = milestone.multiplier;
      }
    }

    const pointsAwarded = Math.round(BASE_POINTS * multiplier);

    // Update longest streak
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }

    // Insert daily login record
    const loginId = randomUUID();
    await conn.query<ResultSetHeader>(
      `INSERT INTO employee_daily_login (id, employee_id, login_date, points_awarded, streak_day, streak_multiplier)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [loginId, employeeId, today, pointsAwarded, currentStreak, multiplier]
    );

    // Update tier status (streak columns)
    if (tierRows.length > 0) {
      await conn.query<ResultSetHeader>(
        `UPDATE employee_tier_status
         SET current_streak = ?, longest_streak = ?, last_login_date = ?
         WHERE employee_id = ?`,
        [currentStreak, longestStreak, today, employeeId]
      );
    } else {
      // Create tier status if it doesn't exist yet
      // Use gamification_tier_master (correct table; gamification_tier is a legacy table)
      const [tierIdRows] = await conn.query<RowDataPacket[]>(
        `SELECT tier_id FROM gamification_tier_master WHERE is_active = 1 ORDER BY min_points ASC LIMIT 1`
      );
      const defaultTierId = tierIdRows[0]?.tier_id;
      if (!defaultTierId) throw new Error('No gamification tiers configured');
      await conn.query<ResultSetHeader>(
        `INSERT INTO employee_tier_status (id, employee_id, current_tier_id, current_streak, longest_streak, last_login_date)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE current_streak = ?, longest_streak = ?, last_login_date = ?`,
        [randomUUID(), employeeId, defaultTierId, currentStreak, longestStreak, today, currentStreak, longestStreak, today]
      );
    }

    // Award points — inline within the same connection/transaction to avoid
    // a nested-transaction deadlock (addPoints opens its own conn and tries to
    // UPDATE employee_tier_status while we already hold a lock on that row).
    const [balanceRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points_delta), 0) AS total_points
       FROM gamification_points_ledger WHERE employee_id = ?`,
      [employeeId]
    );
    const currentBalance = Number(balanceRows[0]?.total_points) || 0;
    const newBalance = currentBalance + pointsAwarded;
    const transactionId = randomUUID();
    await conn.query<ResultSetHeader>(
      `INSERT INTO gamification_points_ledger
         (transaction_id, employee_id, points_delta, transaction_type,
          reference_id, description, balance_after, created_at)
       VALUES (?, ?, ?, 'daily_login', ?, ?, ?, NOW())`,
      [transactionId, employeeId, pointsAwarded, loginId,
       `Daily login reward (Day ${currentStreak}, ${multiplier}x multiplier)`, newBalance]
    );
    // checkTierUpgrade accepts an existing connection so it shares our transaction
    await checkTierUpgrade(employeeId, newBalance, conn);

    // Check for streak badge awards
    let newBadgeEarned: { id: string; name: string; icon: string } | undefined;

    for (const milestone of STREAK_MILESTONES) {
      if (currentStreak === milestone.days) {
        // Award streak badge - look up badge by name using search filter
        try {
          const badges = await getBadges({ search: milestone.badgeName });
          const badge = badges.find(b => b.badge_name === milestone.badgeName);
          if (badge) {
            await awardBadge({
              employee_id: employeeId,
              badge_id: badge.badge_id,
              reason: `Achieved ${milestone.days}-day login streak`,
            });
            newBadgeEarned = { id: badge.badge_id, name: badge.badge_name, icon: badge.badge_icon || 'award' };
          }
        } catch (e) {
          // Badge already awarded or doesn't exist, continue
        }
        break;
      }
    }

    await conn.commit();

    // Calculate next milestone
    const nextMilestone = STREAK_MILESTONES.find(m => m.days > currentStreak);

    return {
      alreadyClaimedToday: false,
      pointsAwarded,
      basePoints: BASE_POINTS,
      multiplier,
      currentStreak,
      longestStreak,
      streakBroken,
      newBadgeEarned,
      nextMilestone: nextMilestone ? { days: nextMilestone.days, multiplier: nextMilestone.multiplier } : undefined,
    };

  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Get current streak status without claiming
 */
export async function getStreakStatus(employeeId: string): Promise<StreakStatus> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Check if claimed today
  const [todayRows] = await db.query<DailyLoginRow[]>(
    `SELECT * FROM employee_daily_login WHERE employee_id = ? AND login_date = ?`,
    [employeeId, today]
  );

  const todayClaimed = todayRows.length > 0;

  // Get streak info
  const [tierRows] = await db.query<TierStatusRow[]>(
    `SELECT current_streak, longest_streak, last_login_date
     FROM employee_tier_status WHERE employee_id = ?`,
    [employeeId]
  );

  let currentStreak = 0;
  let longestStreak = 0;
  let lastLoginDate: string | null = null;

  if (tierRows.length > 0) {
    const row = tierRows[0];
    lastLoginDate = row.last_login_date;
    longestStreak = row.longest_streak || 0;

    // Only count streak if it's still active (last login was today or yesterday)
    if (lastLoginDate === today || lastLoginDate === yesterday) {
      currentStreak = row.current_streak || 0;
    }
  }

  // Calculate next milestone
  const nextMilestone = STREAK_MILESTONES.find(m => m.days > currentStreak);

  return {
    currentStreak,
    longestStreak,
    lastLoginDate,
    todayClaimed,
    nextMilestone: nextMilestone ? { days: nextMilestone.days, multiplier: nextMilestone.multiplier } : undefined,
  };
}

/**
 * Get login history for an employee
 */
export async function getLoginHistory(
  employeeId: string,
  limit: number = 30
): Promise<DailyLoginRow[]> {
  const [rows] = await db.query<DailyLoginRow[]>(
    `SELECT * FROM employee_daily_login
     WHERE employee_id = ?
     ORDER BY login_date DESC
     LIMIT ?`,
    [employeeId, limit]
  );
  return rows;
}

/**
 * Get leaderboard by streak length
 */
export async function getStreakLeaderboard(
  limit: number = 10
): Promise<Array<{ employeeId: string; employeeName: string; currentStreak: number; longestStreak: number }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       ts.employee_id as employeeId,
       e.full_name as employeeName,
       ts.current_streak as currentStreak,
       ts.longest_streak as longestStreak
     FROM employee_tier_status ts
     JOIN employees e ON e.id = ts.employee_id
     WHERE ts.current_streak > 0
     ORDER BY ts.current_streak DESC, ts.longest_streak DESC
     LIMIT ?`,
    [limit]
  );
  return rows as any[];
}

export const dailyLoginService = {
  claimDailyLogin,
  getStreakStatus,
  getLoginHistory,
  getStreakLeaderboard,
};

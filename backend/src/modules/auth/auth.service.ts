import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { env } from '../../config/env.js';

// Use PORTAL_JWT_SECRET as base if JWT_SECRET not defined yet
// This avoids breaking existing auth flows while adding new ones
const JWT_SECRET = (process.env.JWT_SECRET || env.PORTAL_JWT_SECRET || 'change-me-jwt-secret-32characters!!');
const JWT_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_DAYS = 7;
const RESET_EXPIRES_HOURS = 24;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; isBlocked: boolean; mustChangePassword?: boolean };
}

function mysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeEmail(value: string): string {
  return value.toLowerCase().trim();
}

async function ensureEmployeeRole(userId: string): Promise<void> {
  try {
    const [roleRows] = await db.execute<RowDataPacket[]>(
      'SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1',
      ['employee']
    );
    if (!roleRows[0]) return;
    await db.execute(
      'INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (UUID(), ?, ?, 1) ON DUPLICATE KEY UPDATE active_status = 1',
      [userId, 'employee']
    );
  } catch {
    // Non-fatal. Login account preparation must not fail only because role catalog is unavailable.
  }
}

async function createOrRepairEmployeeAuthUser(employee: RowDataPacket, email: string): Promise<string | null> {
  const existingUserId = employee.user_id ? String(employee.user_id) : '';

  if (existingUserId) {
    const [byId] = await db.execute<RowDataPacket[]>(
      'SELECT id, is_blocked FROM auth_user WHERE id = ? LIMIT 1',
      [existingUserId]
    );
    if (byId[0]) {
      if (Number(byId[0].is_blocked ?? 0) === 1) return null;
      await db.execute('UPDATE auth_user SET email = ?, must_change_password = 1 WHERE id = ?', [email, existingUserId]);
      await ensureEmployeeRole(existingUserId);
      return existingUserId;
    }
  }

  const [byEmail] = await db.execute<RowDataPacket[]>(
    'SELECT id, is_blocked FROM auth_user WHERE email = ? LIMIT 1',
    [email]
  );
  if (byEmail[0]) {
    if (Number(byEmail[0].is_blocked ?? 0) === 1) return null;
    const userId = String(byEmail[0].id);
    await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employee.id]);
    await db.execute('UPDATE auth_user SET must_change_password = 1 WHERE id = ?', [userId]);
    await ensureEmployeeRole(userId);
    return userId;
  }

  const userId = crypto.randomUUID();
  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  await db.execute<ResultSetHeader>(
    'INSERT INTO auth_user (id, email, password_hash, must_change_password) VALUES (?, ?, ?, 1)',
    [userId, email, randomPasswordHash]
  );
  await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employee.id]);
  await ensureEmployeeRole(userId);
  return userId;
}

export const authService = {
  async login(identifier: string, password: string): Promise<AuthTokens> {
    // identifier can be email OR employee_code — try both
    const trimmed = identifier.trim();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT au.id, au.email, au.password_hash, au.is_blocked,
              COALESCE(au.must_change_password, 0) AS must_change_password,
              e.active_status
         FROM auth_user au
         LEFT JOIN employees e ON e.user_id = au.id
        WHERE LOWER(au.email) = LOWER(?)
        UNION
       SELECT au.id, au.email, au.password_hash, au.is_blocked,
              COALESCE(au.must_change_password, 0) AS must_change_password,
              e.active_status
         FROM auth_user au
         JOIN employees e ON e.user_id = au.id
        WHERE UPPER(e.employee_code) = UPPER(?)
        LIMIT 1`,
      [trimmed, trimmed]
    );
    const user = rows[0];
    if (!user) throw new Error('Invalid credentials');
    if (user.is_blocked) throw new Error('Account is blocked');

    // CRITICAL: Block inactive employees from logging in
    if (user.active_status === 0 || user.active_status === false) {
      throw new Error('Account is inactive. Please contact HR for assistance.');
    }

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) throw new Error('Invalid credentials');

    await db.execute('UPDATE auth_user SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const accessToken = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const rawRefresh = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    await db.execute<ResultSetHeader>(
      'INSERT INTO auth_refresh_token (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, ?)',
      [user.id, tokenHash, mysqlDateTime(expiresAt)]
    );

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: { id: user.id, email: user.email, isBlocked: user.is_blocked === 1, mustChangePassword: Number(user.must_change_password ?? 0) === 1 },
    };
  },

  async refreshAccess(rawRefreshToken: string): Promise<{ accessToken: string }> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT rt.user_id, au.email FROM auth_refresh_token rt
         JOIN auth_user au ON au.id = rt.user_id
        WHERE rt.token_hash = ? AND rt.revoked = 0 AND rt.expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    if (!rows[0]) throw new Error('Invalid or expired refresh token');

    const accessToken = jwt.sign(
      { sub: rows[0].user_id, email: rows[0].email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return { accessToken };
  },

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    await db.execute('UPDATE auth_refresh_token SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
  },

  verifyAccessToken(token: string): { id: string; email: string } | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
      return { id: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  },

  async register(email: string, password: string, userId?: string): Promise<string> {
    const hash = await bcrypt.hash(password, 10);
    const id = userId || crypto.randomUUID();
    await db.execute<ResultSetHeader>(
      'INSERT INTO auth_user (id, email, password_hash) VALUES (?, ?, ?)',
      [id, normalizeEmail(email), hash]
    );
    return id;
  },

  async registerFromATS(
    email: string,
    password: string,
    onboardingToken: string,
  ): Promise<string> {
    // Validate token exists and is not expired
    const [tokenRows] = await db.execute<RowDataPacket[]>(
      `SELECT b.candidate_id, b.onboarding_token_expires_at, c.email AS candidate_email
       FROM ats_onboarding_bridge b
       JOIN ats_candidate c ON c.id = b.candidate_id
       WHERE b.onboarding_token = ?`,
      [onboardingToken],
    );
    if (!tokenRows.length) {
      throw Object.assign(new Error('Invalid onboarding token'), { status: 400 });
    }
    const tokenRow = (tokenRows as RowDataPacket[])[0];
    if (new Date(tokenRow.onboarding_token_expires_at) < new Date()) {
      throw Object.assign(new Error('Onboarding token expired'), { status: 410 });
    }
    if (tokenRow.candidate_email && tokenRow.candidate_email !== email) {
      throw Object.assign(new Error('Email must match your candidate registration email'), { status: 400 });
    }

    const userId = await this.register(email, password);

    // Link auth user to candidate record
    await db.execute(
      `UPDATE ats_candidate SET user_id = ?, updated_at = NOW() WHERE id = ?`,
      [userId, tokenRow.candidate_id],
    );

    return userId;
  },

  async createPasswordResetTokenByUserId(userId: string, hours = RESET_EXPIRES_HOURS): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Use MySQL's DATE_ADD with UTC_TIMESTAMP to avoid timezone issues
    await db.execute(
      'INSERT INTO auth_password_reset (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))',
      [userId, tokenHash, hours]
    );
    return rawToken;
  },

  async forgotPassword(email: string): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM auth_user WHERE LOWER(email) = LOWER(?) AND is_blocked = 0 LIMIT 1',
      [normalizedEmail]
    );
    if (rows[0]) return this.createPasswordResetTokenByUserId(rows[0].id, 1);

    // First-time employee access fallback. If launch bootstrap has not yet created
    // auth_user, prepare employee account from employees.email/official_email.
    // Includes both active and inactive employees (35K+ total).
    const [employeeRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, email, official_email, user_id, active_status
         FROM employees
        WHERE (LOWER(email) = LOWER(?) OR LOWER(official_email) = LOWER(?))
        LIMIT 1`,
      [normalizedEmail, normalizedEmail]
    );
    const employee = employeeRows[0];
    if (!employee) return null; // silent — don't leak whether email exists

    const userId = await createOrRepairEmployeeAuthUser(employee, normalizedEmail);
    if (!userId) return null;
    return this.createPasswordResetTokenByUserId(userId, 1);
  },

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT user_id FROM auth_password_reset WHERE token_hash = ? AND used = 0 AND expires_at > UTC_TIMESTAMP() LIMIT 1',
      [tokenHash]
    );
    if (!rows[0]) throw new Error('Invalid or expired reset token');
    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE auth_user SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, rows[0].user_id]);
    await db.execute('UPDATE auth_password_reset SET used = 1 WHERE token_hash = ?', [tokenHash]);
  },
};

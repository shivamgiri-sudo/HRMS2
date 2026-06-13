import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { env } from '../../config/env.js';

// Always use the validated env value so production safety checks are respected
const JWT_SECRET = env.JWT_SECRET;
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

async function createOrRepairEmployeeAuthUser(
  employee: RowDataPacket,
  email: string,
  forcePasswordChange = true
): Promise<string | null> {
  const existingUserId = employee.user_id ? String(employee.user_id) : '';

  if (existingUserId) {
    const [byId] = await db.execute<RowDataPacket[]>(
      'SELECT id, is_blocked, must_change_password FROM auth_user WHERE id = ? LIMIT 1',
      [existingUserId]
    );
    if (byId[0]) {
      if (Number(byId[0].is_blocked ?? 0) === 1) return null;
      const mustChange = forcePasswordChange ? 1 : (Number(byId[0].must_change_password ?? 0));
      await db.execute('UPDATE auth_user SET email = ?, must_change_password = ? WHERE id = ?', [email, mustChange, existingUserId]);
      await ensureEmployeeRole(existingUserId);
      return existingUserId;
    }
  }

  const [byEmail] = await db.execute<RowDataPacket[]>(
    'SELECT id, is_blocked, must_change_password FROM auth_user WHERE email = ? LIMIT 1',
    [email]
  );
  if (byEmail[0]) {
    if (Number(byEmail[0].is_blocked ?? 0) === 1) return null;
    const userId = String(byEmail[0].id);
    await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employee.id]);
    const mustChange = forcePasswordChange ? 1 : (Number(byEmail[0].must_change_password ?? 0));
    await db.execute('UPDATE auth_user SET must_change_password = ? WHERE id = ?', [mustChange, userId]);
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
    // identifier can be email OR employee_code OR official_email — try all
    const trimmed = identifier.trim();

    // 1) Primary search via auth_user.email + employee_code + employee emails
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
        UNION
       SELECT au.id, au.email, au.password_hash, au.is_blocked,
              COALESCE(au.must_change_password, 0) AS must_change_password,
              e.active_status
         FROM auth_user au
         JOIN employees e ON e.user_id = au.id
        WHERE LOWER(e.email) = LOWER(?)
        UNION
       SELECT au.id, au.email, au.password_hash, au.is_blocked,
              COALESCE(au.must_change_password, 0) AS must_change_password,
              e.active_status
         FROM auth_user au
         JOIN employees e ON e.user_id = au.id
        WHERE LOWER(e.email) = LOWER(?)
        LIMIT 1`,
      [trimmed, trimmed, trimmed, trimmed]
    );
    let user = rows[0];

    // 2) Fallback: if identifier matches an active employee but no auth link exists, auto-repair
    if (!user) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, email, user_id, active_status
           FROM employees
          WHERE active_status = 1
            AND (UPPER(employee_code) = UPPER(?)
                 OR LOWER(email) = LOWER(?))
          LIMIT 1`,
        [trimmed, trimmed]
      );
      const employee = empRows[0];
      if (employee) {
        const preferredEmail = normalizeEmail(employee.email ?? "");
        if (preferredEmail) {
          const repairedUserId = await createOrRepairEmployeeAuthUser(employee, preferredEmail, false);
          if (repairedUserId) {
            // Re-query the repaired account directly
            const [repairRows] = await db.execute<RowDataPacket[]>(
              `SELECT au.id, au.email, au.password_hash, au.is_blocked,
                      COALESCE(au.must_change_password, 0) AS must_change_password,
                      e.active_status
                 FROM auth_user au
                 JOIN employees e ON e.user_id = au.id
                WHERE au.id = ?
                LIMIT 1`,
              [repairedUserId]
            );
            user = repairRows[0];
          }
        }
      }
    }

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
    await db.execute(
      'INSERT INTO auth_password_reset (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
      [userId, tokenHash, hours]
    );
    return rawToken;
  },

  async forgotPassword(email: string): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);

    // Always verify the employee is active before issuing a reset token —
    // terminated employees must not be able to reset their password.
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, email, user_id, active_status
         FROM employees
        WHERE active_status = 1
          AND LOWER(email) = LOWER(?)
        LIMIT 1`,
      [normalizedEmail]
    );
    const employee = empRows[0];
    if (!employee) return null; // silent — don't leak whether email exists

    // If auth_user already linked and not blocked, issue token directly
    if (employee.user_id) {
      const [authRows] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM auth_user WHERE id = ? AND is_blocked = 0 LIMIT 1',
        [employee.user_id]
      );
      if (authRows[0]) return this.createPasswordResetTokenByUserId(authRows[0].id, 1);
    }

    // First-time access: auto-create auth_user so employee can set their password
    const userId = await createOrRepairEmployeeAuthUser(employee, normalizedEmail);
    if (!userId) return null;
    return this.createPasswordResetTokenByUserId(userId, 1);
  },

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT apr.user_id, au.password_hash AS current_hash
         FROM auth_password_reset apr
         JOIN auth_user au ON au.id = apr.user_id
        WHERE apr.token_hash = ? AND apr.used = 0 AND apr.expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    if (!rows[0]) throw new Error('Invalid or expired reset token');

    const isSameAsCurrentPassword = await bcrypt.compare(newPassword, rows[0].current_hash as string);
    if (isSameAsCurrentPassword) {
      throw Object.assign(
        new Error('New password must be different from your current password'),
        { statusCode: 400 }
      );
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE auth_user SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, rows[0].user_id]);
    await db.execute('UPDATE auth_password_reset SET used = 1 WHERE token_hash = ?', [tokenHash]);
  },
};

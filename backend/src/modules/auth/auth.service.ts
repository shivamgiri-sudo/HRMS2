import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { env } from '../../config/env.js';

const JWT_SECRET = env.JWT_SECRET;
const JWT_EXPIRES_IN = '15m';
const PRE_AUTH_EXPIRES_IN = '10m'; // short-lived — only for 2FA challenge exchange
const REFRESH_EXPIRES_DAYS = 7;
const RESET_EXPIRES_HOURS = 24;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    isBlocked: boolean;
    mustChangePassword?: boolean;
    isReadOnly?: boolean;
    twoFactorRequired?: boolean;
    twoFactorVerified?: boolean;
  };
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

    const mustChangePassword = Number(user.must_change_password ?? 0) === 1;

    // Check global 2FA toggle in org_settings
    const [tfaSettingRows] = await db.execute<RowDataPacket[]>(
      "SELECT setting_value FROM org_settings WHERE setting_key = 'two_factor_enabled' LIMIT 1"
    );
    const tfaEnabled = (tfaSettingRows as RowDataPacket[])[0]?.setting_value !== 'false';
    const twoFactorRequired = tfaEnabled && !mustChangePassword;

    if (twoFactorRequired) {
      // Issue a scoped pre_auth token — NOT a full access token.
      // This token ONLY allows calling /api/auth/2fa/* endpoints.
      // The full accessToken is only issued after verifyTwoFactorChallenge().
      const preAuthToken = jwt.sign(
        { sub: user.id, email: user.email, scope: 'pre_auth' },
        JWT_SECRET,
        { expiresIn: PRE_AUTH_EXPIRES_IN }
      );
      return {
        accessToken: preAuthToken,
        refreshToken: rawRefresh,
        user: {
          id: user.id,
          email: user.email,
          isBlocked: user.is_blocked === 1,
          mustChangePassword,
          isReadOnly: false,
          twoFactorRequired: true,
          twoFactorVerified: false,
        },
      };
    }

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: user.id,
        email: user.email,
        isBlocked: user.is_blocked === 1,
        mustChangePassword,
        isReadOnly: false,
        twoFactorRequired: false,
        twoFactorVerified: true,
      },
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

  // Called after verifyTwoFactorChallenge() succeeds — trades pre_auth token for full access token.
  async exchangePreAuthToken(preAuthToken: string): Promise<{ accessToken: string }> {
    let payload: { sub: string; email: string; scope?: string };
    try {
      payload = jwt.verify(preAuthToken, JWT_SECRET) as { sub: string; email: string; scope?: string };
    } catch {
      throw Object.assign(new Error('Invalid or expired pre-auth token'), { statusCode: 401 });
    }
    if (payload.scope !== 'pre_auth') {
      throw Object.assign(new Error('Token is not a pre-auth token'), { statusCode: 400 });
    }
    // Confirm 2FA challenge is in verified state for this user
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM auth_two_factor_challenge
        WHERE user_id = ? AND status = 'verified'
          AND verified_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        ORDER BY verified_at DESC LIMIT 1`,
      [payload.sub]
    );
    if (!(rows as RowDataPacket[]).length) {
      throw Object.assign(new Error('2FA not verified or verification expired'), { statusCode: 401 });
    }
    const accessToken = jwt.sign(
      { sub: payload.sub, email: payload.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return { accessToken };
  },

  verifyAccessToken(token: string): { id: string; email: string; scope?: string } | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; scope?: string };
      return { id: payload.sub, email: payload.email, scope: payload.scope };
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
      'INSERT INTO auth_password_reset (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))',
      [userId, tokenHash, hours]
    );
    return rawToken;
  },

  async forgotPassword(email: string): Promise<{ token: string; deliverTo: string } | null> {
    const normalizedEmail = normalizeEmail(email);
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, email FROM auth_user WHERE LOWER(email) = LOWER(?) AND is_blocked = 0 LIMIT 1',
      [normalizedEmail]
    );
    if (rows[0]) {
      const token = await this.createPasswordResetTokenByUserId(rows[0].id, 1);
      return { token, deliverTo: String(rows[0].email) };
    }

    // First-time employee access fallback. Check all email columns so employees
    // whose login email is stored in official_email are also matched.
    const [employeeRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, user_id, active_status,
              COALESCE(NULLIF(TRIM(official_email),''), NULLIF(TRIM(email),'')) AS resolved_email
         FROM employees
        WHERE LOWER(email) = LOWER(?)
           OR LOWER(official_email) = LOWER(?)
        LIMIT 1`,
      [normalizedEmail, normalizedEmail]
    );
    const employee = employeeRows[0];
    if (!employee) return null; // silent — don't leak whether email exists

    const resolvedEmail = employee.resolved_email
      ? String(employee.resolved_email).toLowerCase().trim()
      : normalizedEmail;

    const userId = await createOrRepairEmployeeAuthUser(employee, resolvedEmail);
    if (!userId) return null;
    const token = await this.createPasswordResetTokenByUserId(userId, 1);
    return { token, deliverTo: resolvedEmail };
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

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT password_hash FROM auth_user WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) throw new Error('User not found');
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) throw new Error('Current password is incorrect');
    const hash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE auth_user SET password_hash = ?, must_change_password = 0 WHERE id = ?',
      [hash, userId]
    );
  },

  async forgotPasswordOtp(phoneOrEmail: string): Promise<{ success: boolean; message: string }> {
    // Find user by phone (employees.mobile) or email
    let userId: string | null = null;
    try {
      // Try auth_user by email
      const [byEmail] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM auth_user WHERE email = ? LIMIT 1',
        [phoneOrEmail.toLowerCase().trim()]
      );
      if (Array.isArray(byEmail) && byEmail.length) userId = (byEmail[0] as any).id;

      // Try employees by mobile if not found
      if (!userId) {
        const [byPhone] = await db.execute<RowDataPacket[]>(
          'SELECT user_id FROM employees WHERE mobile = ? AND user_id IS NOT NULL LIMIT 1',
          [phoneOrEmail.trim()]
        );
        if (Array.isArray(byPhone) && byPhone.length) userId = (byPhone[0] as any).user_id;
      }
    } catch { /* intentional: don't leak existence */ }

    // Always return success to prevent phone/email enumeration
    if (!userId) {
      return { success: true, message: 'If an account exists, an OTP has been sent.' };
    }

    // Rate-limit: max 3 attempts in last 10 minutes
    try {
      const [recent] = await db.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as cnt FROM auth_otp_reset WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)',
        [userId]
      );
      if ((recent as any[])[0]?.cnt >= 3) {
        return { success: true, message: 'If an account exists, an OTP has been sent.' };
      }
    } catch {
      // Table not yet migrated — allow one-time OTP without rate-limit until 303 is applied
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const salt = userId + phoneOrEmail;
    const otpHash = crypto.createHash('sha256').update(otp + salt).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    try {
      await db.execute(
        'INSERT INTO auth_otp_reset (id, user_id, phone, otp_hash, expires_at, used, attempts) VALUES (UUID(), ?, ?, ?, ?, 0, 0)',
        [userId, phoneOrEmail.trim(), otpHash, expiresAt]
      );
    } catch {
      // Graceful: table not yet created — OTP can't be stored; return generic success
      return { success: true, message: 'If an account exists, an OTP has been sent.' };
    }

    // Log OTP in dev (NEVER in production)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AUTH OTP DEV] OTP for ${phoneOrEmail}: ${otp}`);
    }

    return { success: true, message: 'If an account exists, an OTP has been sent.' };
  },

  async verifyOtpAndResetPassword(phoneOrEmail: string, otp: string, newPassword: string): Promise<void> {
    // Find user
    let userId: string | null = null;
    try {
      const [byEmail] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM auth_user WHERE email = ? LIMIT 1',
        [phoneOrEmail.toLowerCase().trim()]
      );
      if (Array.isArray(byEmail) && byEmail.length) userId = (byEmail[0] as any).id;
      if (!userId) {
        const [byPhone] = await db.execute<RowDataPacket[]>(
          'SELECT user_id FROM employees WHERE mobile = ? AND user_id IS NOT NULL LIMIT 1',
          [phoneOrEmail.trim()]
        );
        if (Array.isArray(byPhone) && byPhone.length) userId = (byPhone[0] as any).user_id;
      }
    } catch { /* pass */ }

    if (!userId) throw Object.assign(new Error('Invalid OTP'), { statusCode: 400 });

    // Increment attempts on all recent unused OTPs before checking
    await db.execute(
      'UPDATE auth_otp_reset SET attempts = attempts + 1 WHERE user_id = ? AND used = 0 AND expires_at > NOW()',
      [userId]
    );

    // Check max attempts (5)
    const [tooMany] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM auth_otp_reset WHERE user_id = ? AND used = 0 AND expires_at > NOW() AND attempts > 5 LIMIT 1',
      [userId]
    );
    if (Array.isArray(tooMany) && tooMany.length) {
      throw Object.assign(new Error('Too many attempts. Request a new OTP.'), { statusCode: 429 });
    }

    // Verify OTP hash
    const salt = userId + phoneOrEmail;
    const otpHash = crypto.createHash('sha256').update(otp + salt).digest('hex');

    const [matching] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM auth_otp_reset WHERE user_id = ? AND otp_hash = ? AND used = 0 AND expires_at > NOW() LIMIT 1',
      [userId, otpHash]
    );
    if (!Array.isArray(matching) || !matching.length) {
      throw Object.assign(new Error('Invalid or expired OTP'), { statusCode: 400 });
    }

    // Mark OTP used
    await db.execute('UPDATE auth_otp_reset SET used = 1 WHERE id = ?', [(matching[0] as any).id]);

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute('UPDATE auth_user SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, userId]);
  },
};

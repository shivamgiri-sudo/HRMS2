import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { env } from '../../config/env.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import type { Request } from 'express';
import https from 'https';

async function getUserPrimaryRole(userId: string): Promise<string | null> {
  try {
    const [rows] = await db.execute<RoleRow[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1
       ORDER BY FIELD(role_key,'super_admin','admin','payroll_head','hr','wfm','manager','employee') LIMIT 1`,
      [userId]
    );
    return rows[0]?.role_key ?? null;
  } catch { return null; }
}

async function geoLookupIp(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return resolve('Local Network');
    }
    const timeout = setTimeout(() => resolve(null), 2000);
    https.get(`https://ipapi.co/${ip}/json/`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return resolve(null);
          const parts = [parsed.city, parsed.region, parsed.country_name].filter(Boolean);
          resolve(parts.length ? parts.join(', ') : null);
        } catch { resolve(null); }
      });
    }).on('error', () => { clearTimeout(timeout); resolve(null); });
  });
}

const JWT_SECRET = env.JWT_SECRET;
const OTP_HMAC_SECRET = env.OTP_HMAC_SECRET;
const JWT_EXPIRES_IN = '15m';
const PRE_AUTH_EXPIRES_IN = '10m'; // short-lived — only for 2FA challenge exchange
const REFRESH_EXPIRES_DAYS = 7;
const RESET_EXPIRES_HOURS = 24;

interface RoleRow extends RowDataPacket {
  role_key: string;
}

interface AuthUserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  is_blocked: number | null;
  must_change_password: number | null;
  active_status: number | null;
  failed_login_attempts: number | null;
  locked_until: string | null;
}

interface OrgSettingRow extends RowDataPacket {
  setting_value: string | null;
}

interface AuthUserIdRow extends RowDataPacket {
  id: string;
  is_blocked: number | null;
}

interface RefreshRow extends RowDataPacket {
  user_id: string;
  email: string;
}

interface OnboardingTokenRow extends RowDataPacket {
  candidate_id: string;
  onboarding_token_expires_at: string;
  candidate_email: string | null;
}

interface ResetTokenRow extends RowDataPacket {
  user_id: string;
}

interface OtpUserIdRow extends RowDataPacket {
  id: string;
}

interface OtpEmployeeRow extends RowDataPacket {
  user_id: string | null;
}

interface OtpCountRow extends RowDataPacket {
  cnt: number;
}

interface OtpMatchRow extends RowDataPacket {
  id: string;
}

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

/**
 * Parse user agent string to extract device name in human-readable format
 * Returns strings like "Chrome on Windows", "Safari on iPhone", "Firefox on macOS"
 */
function parseUserAgent(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown Device';

  const ua = userAgent.toLowerCase();

  // Detect browser
  let browser = 'Unknown Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('opera') || ua.includes('opr/')) browser = 'Opera';

  // Detect OS
  let os = 'Unknown OS';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('iphone')) os = 'iPhone';
  else if (ua.includes('ipad')) os = 'iPad';
  else if (ua.includes('android')) os = 'Android';

  return `${browser} on ${os}`;
}

/**
 * Generate device fingerprint from user agent and IP address
 * Used to identify same device across sessions
 */
function generateDeviceFingerprint(req: Request): string {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.ip || '';
  const raw = `${userAgent}:${ip}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

async function ensureEmployeeRole(userId: string): Promise<void> {
  try {
    const [roleRows] = await db.execute<RoleRow[]>(
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
    const [byId] = await db.execute<AuthUserIdRow[]>(
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

  const [byEmail] = await db.execute<AuthUserIdRow[]>(
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
  async login(identifier: string, password: string, req?: Request): Promise<AuthTokens> {
    // identifier can be email OR employee_code — try both
    const trimmed = identifier.trim();

    try {
      // SUCCESS PATH: All of the following code is inside this try block.
      // If any step throws, execution jumps to the catch block below (line 376).
      const [rows] = await db.execute<AuthUserRow[]>(
        `SELECT au.id, au.email, au.password_hash, au.is_blocked,
                COALESCE(au.must_change_password, 0) AS must_change_password,
                COALESCE(au.is_read_only, 0) AS is_read_only,
                COALESCE(au.failed_login_attempts, 0) AS failed_login_attempts,
                au.locked_until,
                e.active_status
           FROM auth_user au
           LEFT JOIN employees e ON e.user_id = au.id
          WHERE LOWER(au.email) = LOWER(?)
          UNION
         SELECT au.id, au.email, au.password_hash, au.is_blocked,
                COALESCE(au.must_change_password, 0) AS must_change_password,
                COALESCE(au.is_read_only, 0) AS is_read_only,
                COALESCE(au.failed_login_attempts, 0) AS failed_login_attempts,
                au.locked_until,
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

      // Per-account lockout: check before password comparison to prevent timing oracle
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        throw new Error('Account temporarily locked due to multiple failed attempts. Please try again later or contact HR.');
      }

      // CRITICAL: Block inactive employees from logging in
      if (Number(user.active_status ?? 1) === 0) {
        throw new Error('Account is inactive. Please contact HR for assistance.');
      }

      const valid = await bcrypt.compare(password, user.password_hash as string);
      if (!valid) {
        // Increment failed attempts; lock for 15 minutes after 5 consecutive failures
        await db.execute(
          `UPDATE auth_user
              SET failed_login_attempts = failed_login_attempts + 1,
                  locked_until = IF(failed_login_attempts + 1 >= 5,
                                    DATE_ADD(NOW(), INTERVAL 15 MINUTE),
                                    locked_until)
            WHERE id = ?`,
          [user.id]
        );
        throw new Error('Invalid credentials');
      }

      // Successful auth — clear lockout state
      await db.execute(
        'UPDATE auth_user SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
        [user.id]
      );

      const accessToken = jwt.sign(
        { sub: user.id, email: user.email, is_read_only: Boolean((user as any).is_read_only) },
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

      // Create device session record if request object available
      if (req) {
        const deviceName = parseUserAgent(req.headers['user-agent']);
        const deviceFingerprint = generateDeviceFingerprint(req);

        try {
          await db.execute(
            `INSERT INTO user_device_sessions
               (user_id, refresh_token_hash, device_fingerprint, device_name,
                ip_address, user_agent, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              user.id,
              tokenHash,
              deviceFingerprint,
              deviceName,
              req.ip || null,
              req.headers['user-agent'] || null,
              mysqlDateTime(expiresAt)
            ]
          );
        } catch (error) {
          // Non-blocking: device session tracking failure doesn't break login
          console.error('[auth] Failed to create device session:', error);
        }
      }

      const mustChangePassword = Number(user.must_change_password ?? 0) === 1;

      // Check single device session mode - if enabled, revoke all other sessions
      try {
        const [singleDeviceRows] = await db.execute<OrgSettingRow[]>(
          "SELECT setting_value FROM org_settings WHERE setting_key = 'single_device_session_mode' LIMIT 1"
        );
        const singleDeviceMode = singleDeviceRows[0]?.setting_value === '1' || singleDeviceRows[0]?.setting_value === 'true';

        if (singleDeviceMode) {
          // Revoke all OTHER refresh tokens (not the one we just created)
          const [revokeResult] = await db.execute<ResultSetHeader>(
            `UPDATE auth_refresh_token
                SET revoked = 1
              WHERE user_id = ?
                AND token_hash != ?
                AND revoked = 0`,
            [user.id, tokenHash]
          );

          // Revoke all OTHER device sessions
          await db.execute(
            `UPDATE user_device_sessions
                SET revoked_at = NOW()
              WHERE user_id = ?
                AND refresh_token_hash != ?
                AND revoked_at IS NULL`,
            [user.id, tokenHash]
          );

          const revokedCount = revokeResult.affectedRows || 0;

          if (revokedCount > 0 && req) {
            // Log the auto-revocation
            logSensitiveAction({
              actor_user_id: user.id,
              action_type: "ALL_OTHER_SESSIONS_REVOKED",
              module_key: "AUTH",
              change_summary: {
                reason: "Single device session mode enabled - new login auto-revoked other sessions",
                revoked_count: revokedCount,
                device_name: parseUserAgent(req.headers['user-agent']),
                ip_address: req.ip
              },
              req
            }).catch(() => {});
          }
        }
      } catch (error) {
        // Non-blocking: single device mode failure doesn't break login
        console.error('[auth] Failed to enforce single device mode:', error);
      }

      // Log successful login with role and geo location (non-blocking)
      if (req) {
        const loginIp = req.ip ?? null;
        Promise.all([
          getUserPrimaryRole(user.id),
          loginIp ? geoLookupIp(loginIp) : Promise.resolve(null),
        ]).then(([role, location]) => {
          logSensitiveAction({
            actor_user_id: user.id,
            action_type: "LOGIN_SUCCESS",
            module_key: "AUTH",
            entity_type: "auth_user",
            entity_id: user.id,
            actor_role: role ?? undefined,
            change_summary: {
              email: user.email,
              identifier: trimmed,
              ip: loginIp,
              location: location ?? undefined,
            },
            req,
          }).catch(() => {});
        }).catch(() => {});
      }

      // Check global 2FA toggle in org_settings
      const [tfaSettingRows] = await db.execute<OrgSettingRow[]>(
        "SELECT setting_value FROM org_settings WHERE setting_key = 'two_factor_enabled' LIMIT 1"
      );
      const tfaEnabled = tfaSettingRows[0]?.setting_value !== 'false';
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
            isReadOnly: Boolean((user as any).is_read_only),
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
          isReadOnly: Boolean((user as any).is_read_only),
          twoFactorRequired: false,
          twoFactorVerified: true,
        },
      };
    } catch (error) {
      // ERROR PATH: If any step above threw, we land here.
      // Log the failure and re-throw to let the route handler return 401.
      if (req) {
        logSensitiveAction({
          actor_user_id: '00000000-0000-0000-0000-000000000000', // Unknown user (failed login)
          action_type: "LOGIN_FAILED",
          module_key: "AUTH",
          change_summary: {
            identifier: trimmed,
            reason: error instanceof Error ? error.message : String(error)
          },
          req
        }).catch(() => {}); // Non-blocking
      }
      throw error;
    }
  },

  async refreshAccess(rawRefreshToken: string): Promise<{ accessToken: string }> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const [rows] = await db.execute<RefreshRow[]>(
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

  async logout(rawRefreshToken: string, req?: Request): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    // Get user_id from refresh token before revoking
    const [rows] = await db.execute<RefreshRow[]>(
      `SELECT user_id FROM auth_refresh_token WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    const userId = rows[0]?.user_id as string | undefined;

    await db.execute('UPDATE auth_refresh_token SET revoked = 1 WHERE token_hash = ?', [tokenHash]);

    // Revoke device session
    try {
      await db.execute(
        'UPDATE user_device_sessions SET revoked_at = NOW() WHERE refresh_token_hash = ? AND revoked_at IS NULL',
        [tokenHash]
      );
    } catch (error) {
      // Non-blocking: device session revocation failure doesn't break logout
      console.error('[auth] Failed to revoke device session:', error);
    }

    // Log logout event with role and geo location (non-blocking)
    if (userId && req) {
      const logoutIp = req.ip ?? null;
      Promise.all([
        getUserPrimaryRole(userId),
        logoutIp ? geoLookupIp(logoutIp) : Promise.resolve(null),
      ]).then(([role, location]) => {
        logSensitiveAction({
          actor_user_id: userId!,
          action_type: "LOGOUT",
          module_key: "AUTH",
          entity_type: "auth_user",
          entity_id: userId!,
          actor_role: role ?? undefined,
          change_summary: {
            ip: logoutIp,
            location: location ?? undefined,
          },
          req,
        }).catch(() => {});
      }).catch(() => {});
    }
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
    const [rows] = await db.execute<OnboardingTokenRow[]>(
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
    const tokenRow = tokenRows[0];
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

  async forgotPassword(email: string): Promise<{ token: string; deliverTo: string } | null> {
    const normalizedEmail = normalizeEmail(email);
    const [rows] = await db.execute<ResetTokenRow[]>(
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
    const [rows] = await db.execute<AuthUserRow[]>(
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
      const [byEmail] = await db.execute<OtpUserIdRow[]>(
        'SELECT id FROM auth_user WHERE email = ? LIMIT 1',
        [phoneOrEmail.toLowerCase().trim()]
      );
      if (byEmail.length) userId = byEmail[0].id;

      // Try employees by mobile if not found
      if (!userId) {
        const [byPhone] = await db.execute<OtpEmployeeRow[]>(
          'SELECT user_id FROM employees WHERE mobile = ? AND user_id IS NOT NULL LIMIT 1',
          [phoneOrEmail.trim()]
        );
        if (byPhone.length) userId = byPhone[0].user_id;
      }
    } catch { /* intentional: don't leak existence */ }

    // Always return success to prevent phone/email enumeration
    if (!userId) {
      return { success: true, message: 'If an account exists, an OTP has been sent.' };
    }

    // Rate-limit: max 3 attempts in last 10 minutes
    try {
      const [recent] = await db.execute<OtpCountRow[]>(
        'SELECT COUNT(*) as cnt FROM auth_otp_reset WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)',
        [userId]
      );
      if ((recent[0]?.cnt ?? 0) >= 3) {
        return { success: true, message: 'If an account exists, an OTP has been sent.' };
      }
    } catch {
      // Table not yet migrated — allow one-time OTP without rate-limit until 303 is applied
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto
      .createHmac('sha256', OTP_HMAC_SECRET)
      .update(`${otp}:${userId}:${phoneOrEmail}`)
      .digest('hex');
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
      const [byEmail] = await db.execute<OtpUserIdRow[]>(
        'SELECT id FROM auth_user WHERE email = ? LIMIT 1',
        [phoneOrEmail.toLowerCase().trim()]
      );
      if (byEmail.length) userId = byEmail[0].id;
      if (!userId) {
        const [byPhone] = await db.execute<OtpEmployeeRow[]>(
          'SELECT user_id FROM employees WHERE mobile = ? AND user_id IS NOT NULL LIMIT 1',
          [phoneOrEmail.trim()]
        );
        if (byPhone.length) userId = byPhone[0].user_id;
      }
    } catch { /* pass */ }

    if (!userId) throw Object.assign(new Error('Invalid OTP'), { statusCode: 400 });

    // Increment attempts on all recent unused OTPs before checking
    await db.execute(
      'UPDATE auth_otp_reset SET attempts = attempts + 1 WHERE user_id = ? AND used = 0 AND expires_at > NOW()',
      [userId]
    );

    // Check max attempts (5)
      const [tooMany] = await db.execute<OtpUserIdRow[]>(
      'SELECT id FROM auth_otp_reset WHERE user_id = ? AND used = 0 AND expires_at > NOW() AND attempts > 5 LIMIT 1',
      [userId]
    );
    if (Array.isArray(tooMany) && tooMany.length) {
      throw Object.assign(new Error('Too many attempts. Request a new OTP.'), { statusCode: 429 });
    }

    // Verify OTP hash using HMAC-SHA-256 with timing-safe comparison
    const candidateHash = crypto
      .createHmac('sha256', OTP_HMAC_SECRET)
      .update(`${otp}:${userId}:${phoneOrEmail}`)
      .digest('hex');

    const [otpRows] = await db.execute<(OtpMatchRow & { otp_hash: string })[]>(
      'SELECT id, otp_hash FROM auth_otp_reset WHERE user_id = ? AND used = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const otpRow = Array.isArray(otpRows) ? otpRows[0] : null;

    const hashMatches = otpRow
      ? crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(otpRow.otp_hash, 'hex'))
      : false;

    const matching = hashMatches && otpRow ? [otpRow] : [];
    if (!matching.length) {
      throw Object.assign(new Error('Invalid or expired OTP'), { statusCode: 400 });
    }

    // Mark OTP used
    await db.execute('UPDATE auth_otp_reset SET used = 1 WHERE id = ?', [matching[0].id]);

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute('UPDATE auth_user SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, userId]);
  },
};

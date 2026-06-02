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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; isBlocked: boolean };
}

export const authService = {
  async login(identifier: string, password: string): Promise<AuthTokens> {
    // identifier can be email OR employee_code — try both
    const trimmed = identifier.trim();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT au.id, au.email, au.password_hash, au.is_blocked
         FROM auth_user au
        WHERE au.email = ?
        UNION
       SELECT au.id, au.email, au.password_hash, au.is_blocked
         FROM auth_user au
         JOIN employees e ON e.user_id = au.id
        WHERE e.employee_code = ?
        LIMIT 1`,
      [trimmed.toLowerCase(), trimmed.toUpperCase()]
    );
    const user = rows[0];
    if (!user) throw new Error('Invalid credentials');
    if (user.is_blocked) throw new Error('Account is blocked');

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
      [user.id, tokenHash, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
    );

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: { id: user.id, email: user.email, isBlocked: user.is_blocked === 1 },
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
      [id, email.toLowerCase().trim(), hash]
    );
    return id;
  },
};

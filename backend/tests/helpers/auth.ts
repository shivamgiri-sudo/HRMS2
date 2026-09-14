import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env.js';

const STAFF_SECRET = env.JWT_SECRET;
const PORTAL_SECRET = env.PORTAL_JWT_SECRET;

export const makeToken = (userId: string, email: string) =>
  jwt.sign({ sub: userId, email, iat: Math.floor(Date.now() / 1000) }, STAFF_SECRET, { expiresIn: '1h' });

export const makeCandidateToken = (candidateId: string, email: string) =>
  jwt.sign({ sub: candidateId, email, iat: Math.floor(Date.now() / 1000), type: 'candidate' }, PORTAL_SECRET, { expiresIn: '1h' });

export const adminToken = makeToken('admin-user', 'admin@mascallnet.com');
export const hrToken = makeToken('hr-user', 'hr@mascallnet.com');
export const staffToken = makeToken('staff-user', 'staff@mascallnet.com');
export const financeToken = makeToken('finance-user', 'finance@mascallnet.com');
export const wfmToken = makeToken('wfm-user', 'wfm@mascallnet.com');
export const agentToken = makeToken('agent-user-id', 'agent@mascallnet.com');

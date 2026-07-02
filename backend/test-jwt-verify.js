import jwt from 'jsonwebtoken';
import { authService } from './src/modules/auth/auth.service.js';

const JWT_SECRET = process.env.JWT_SECRET || '3547183d0910b8d3d01d1db5629d07c8e1bfe5093c5534dbde4787ce948173fe38e55030ba28fceb120d96cdbc34cc91';

const token = jwt.sign(
  { sub: 'agent-user-id', email: 'agent@mascallnet.com', employee_code: 'EMP-STF-001', iat: Math.floor(Date.now() / 1000) },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Generated token:', token);
console.log('Verifying with jwt.verify:', jwt.verify(token, JWT_SECRET));
console.log('Verifying with authService:', authService.verifyAccessToken(token));

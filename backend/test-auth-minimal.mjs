import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { env } from './src/config/env.js';
import { qualityAggregationRouter } from './src/modules/quality-dashboard/quality-aggregation.routes.js';
import { db } from './src/db/mysql.js';

const JWT_SECRET = env.JWT_SECRET;
console.log('JWT_SECRET:', JWT_SECRET);

// Seed employee
await db.execute(
  `INSERT IGNORE INTO employees (id, user_id, employee_code, first_name, last_name, email, date_of_joining, active_status, created_at, updated_at)
   VALUES ('emp-agent-001', 'agent-user-id', 'EMP-STF-001', 'Test', 'Agent', 'agent@mascallnet.com', '2025-01-01', 1, NOW(), NOW())`
);

// Generate token
const token = jwt.sign({ sub: 'agent-user-id', email: 'agent@mascallnet.com' }, JWT_SECRET, { expiresIn: '1h' });
console.log('Token:', token);

// Create app
const app = express();
app.use(express.json());
app.use('/api/agent', qualityAggregationRouter);

// Test request
const res = await request(app)
  .get('/api/agent/cq-score')
  .set('Authorization', `Bearer ${token}`);

console.log('Status:', res.status);
console.log('Body:', res.body);

await db.end();

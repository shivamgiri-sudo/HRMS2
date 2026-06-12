// backend/src/modules/external-db/external-db.routes.ts
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import {
  encryptCredentials,
  decryptCredentials,
  invalidatePool,
  testPoolForKey,
  type DbCredentials,
} from './external-db.service.js';
import { SaveDbConfigSchema } from './external-db.validation.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/external-db — list all database connectors
router.get('/', requireRole('admin'), h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, integration_name, config_json, active_status,
            test_ok, test_error, test_at
     FROM integration_config WHERE integration_type = 'database'`
  );
  const data = (rows as any[]).map(row => {
    const config = row.config_json ?? {};
    return {
      integration_key: row.integration_key,
      integration_name: row.integration_name,
      active_status: row.active_status,
      test_ok: row.test_ok,
      test_error: row.test_error,
      test_at: row.test_at,
      config: {
        host: config.host ?? '',
        port: config.port ?? 1433,
        database: config.database ?? '',
        username: config.username ?? '',
        password: config.username ? '••••••••' : '',
        date_column: config.date_column ?? 'event_time',
        employee_code_column: config.employee_code_column ?? 'agent_user',
        tables: config.tables ?? [],
        db_type: config.db_type ?? 'mysql',
      },
    };
  });
  return res.json({ success: true, data });
}));

// GET /api/external-db/:key — load single connector config (password masked)
router.get('/:key', requireRole('admin'), h(async (req, res) => {
  const { key } = req.params;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, integration_name, config_json, active_status,
            test_ok, test_error, test_at
     FROM integration_config WHERE integration_key = ? AND integration_type = 'database'`,
    [key]
  );
  const row = (rows as any[])[0];
  if (!row) return res.status(404).json({ error: 'Connector not found' });

  const config = row.config_json ?? {};
  return res.json({
    success: true,
    data: {
      integration_key: row.integration_key,
      integration_name: row.integration_name,
      active_status: row.active_status,
      test_ok: row.test_ok,
      test_error: row.test_error,
      test_at: row.test_at,
      config: {
        host: config.host ?? '',
        port: config.port ?? 1433,
        database: config.database ?? '',
        username: config.username ?? '',
        password: config.username ? '••••••••' : '',
        date_column: config.date_column ?? 'event_time',
        employee_code_column: config.employee_code_column ?? 'agent_user',
        tables: config.tables ?? [],
        db_type: config.db_type ?? 'mysql',
      },
    },
  });
}));

// PUT /api/external-db/:key — save config + encrypt credentials
router.put('/:key', requireRole('admin'), h(async (req, res) => {
  const { key } = req.params;
  const parsed = SaveDbConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_json, encrypted_credentials FROM integration_config WHERE integration_key = ?`,
    [key]
  );
  const existing = (rows as any[])[0];
  if (!existing) return res.status(404).json({ error: 'Connector not found' });

  const existingConfig = existing.config_json ?? {};
  const input = parsed.data;

  // Resolve password: keep existing encrypted password if blank sent
  let password = input.password ?? '';
  if (!password && existing.encrypted_credentials) {
    try {
      const prev = decryptCredentials(existing.encrypted_credentials);
      password = prev.password;
    } catch {}
  }

  const creds: DbCredentials = {
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    password,
    date_column: input.date_column ?? existingConfig.date_column ?? 'event_time',
    employee_code_column: input.employee_code_column ?? existingConfig.employee_code_column ?? 'agent_user',
    tables: input.tables ?? existingConfig.tables ?? [],
    db_type: existingConfig.db_type ?? 'mysql',
  };

  const encrypted = encryptCredentials(creds);

  const newConfig = {
    ...existingConfig,
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    date_column: creds.date_column,
    employee_code_column: creds.employee_code_column,
    tables: creds.tables,
    db_type: creds.db_type,
  };

  await db.execute(
    `UPDATE integration_config
     SET encrypted_credentials = ?, config_json = ?, active_status = 1, updated_at = NOW()
     WHERE integration_key = ?`,
    [encrypted, JSON.stringify(newConfig), key]
  );

  invalidatePool(key);

  return res.json({ success: true });
}));

// POST /api/external-db/:key/test — test live connection, save result
router.post('/:key/test', requireRole('admin'), h(async (req, res) => {
  const { key } = req.params;
  const result = await testPoolForKey(key);

  await db.execute(
    `UPDATE integration_config
     SET test_ok = ?, test_error = ?, test_at = NOW(), tested_by = ?
     WHERE integration_key = ?`,
    [result.ok ? 1 : 0, result.error ?? null, (req as any).authUser?.id ?? null, key]
  );

  return res.json({ success: true, data: result });
}));

export { router as externalDbRouter };

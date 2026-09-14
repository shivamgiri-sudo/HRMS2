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
import { randomUUID } from 'node:crypto';
import { assertProcessWritable } from '../process-data-source/process-data-source.service.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// POST /api/external-db — register a NEW connector.
//
// Until this existed the routes below could only edit a row that was already
// seeded, so connecting a genuinely new client database required shipping a
// migration. A connector may belong to one process (process_id), which is
// scope-checked here so a process manager can only register one against their
// own process; an estate-wide connector (process_id null, e.g. COSEC, dialer,
// db_bill) stays admin-only because it spans every client.
router.post('/', requireRole('admin', 'super_admin', 'process_manager', 'operations_manager'), h(async (req, res) => {
  const parsed = SaveDbConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
  }
  const input = parsed.data;
  const processId = (req.body?.process_id as string | undefined) || null;
  const name = String(req.body?.integration_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'integration_name is required' });

  const authUser = (req as any).authUser;
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
  if (processId) {
    if (!(await assertProcessWritable(authUser?.id, processId))) {
      return res.status(403).json({ error: 'That process is outside your scope' });
    }
  } else if (!isAdmin) {
    return res.status(403).json({ error: 'Only an admin may create an estate-wide connector' });
  }

  const creds: DbCredentials = {
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    password: input.password ?? '',
    date_column: input.date_column ?? 'event_time',
    employee_code_column: input.employee_code_column ?? 'agent_user',
    tables: input.tables ?? [],
    db_type: input.db_type,
    encrypt: input.encrypt ?? false,
    trust_server_certificate: input.trust_server_certificate ?? true,
  };

  // The password goes only into encrypted_credentials. config_json is read back
  // to the browser by the list and detail routes below, so a secret placed here
  // would be handed to every screen that renders them.
  const config = {
    host: input.host, port: input.port, database: input.database,
    username: input.username, date_column: creds.date_column,
    employee_code_column: creds.employee_code_column, tables: creds.tables,
    db_type: input.db_type, encrypt: creds.encrypt,
    trust_server_certificate: creds.trust_server_certificate,
  };

  const key = `proc_${randomUUID().slice(0, 8)}`;
  await db.execute(
    `INSERT INTO integration_config
       (id, integration_key, integration_name, integration_type, process_id,
        config_json, encrypted_credentials, active_status, created_at, updated_at)
     VALUES (UUID(), ?, ?, 'database', ?, ?, ?, 1, NOW(), NOW())`,
    [key, name, processId, JSON.stringify(config), encryptCredentials(creds)],
  );

  return res.status(201).json({ success: true, data: { integration_key: key } });
}));

// GET /api/external-db — list all database connectors
router.get('/', requireRole('admin'), h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, integration_name, config_json, encrypted_credentials, active_status,
            test_ok, test_error, test_at
     FROM integration_config WHERE integration_type = 'database'`
  );
  const data = (rows as any[]).map(row => {
    const config = row.config_json ?? {};
    const username = config.username ?? config.user ?? '';
    return {
      integration_key: row.integration_key,
      integration_name: row.integration_name,
      active_status: row.active_status,
      test_ok: row.test_ok,
      test_error: row.test_error,
      test_at: row.test_at,
      config_json: {
        host: config.host ?? '',
        port: config.port ?? (config.db_type === 'mssql' ? 1433 : 3306),
        database: config.database ?? '',
        username,
        password: row.encrypted_credentials || username ? '••••••••' : '',
        date_column: config.date_column ?? 'event_time',
        employee_code_column: config.employee_code_column ?? 'agent_user',
        tables: config.tables ?? config.source_tables ?? [],
        db_type: config.db_type ?? 'mysql',
        encrypt: Boolean(config.encrypt),
        trust_server_certificate: config.trust_server_certificate !== false,
      },
    };
  });
  return res.json({ success: true, data });
}));

// GET /api/external-db/:key — load single connector config (password masked)
router.get('/:key', requireRole('admin'), h(async (req, res) => {
  const { key } = req.params;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, integration_name, config_json, encrypted_credentials, active_status,
            test_ok, test_error, test_at
     FROM integration_config WHERE integration_key = ? AND integration_type = 'database'`,
    [key]
  );
  const row = (rows as any[])[0];
  if (!row) return res.status(404).json({ error: 'Connector not found' });

  const config = row.config_json ?? {};
  const username = config.username ?? config.user ?? '';
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
        port: config.port ?? (config.db_type === 'mssql' ? 1433 : 3306),
        database: config.database ?? '',
        username,
        password: row.encrypted_credentials || username ? '••••••••' : '',
        date_column: config.date_column ?? 'event_time',
        employee_code_column: config.employee_code_column ?? 'agent_user',
        tables: config.tables ?? config.source_tables ?? [],
        db_type: config.db_type ?? 'mysql',
        encrypt: Boolean(config.encrypt),
        trust_server_certificate: config.trust_server_certificate !== false,
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
    db_type: input.db_type,
    encrypt: input.encrypt ?? existingConfig.encrypt ?? false,
    trust_server_certificate: input.trust_server_certificate ?? existingConfig.trust_server_certificate ?? true,
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
    encrypt: input.encrypt ?? existingConfig.encrypt ?? false,
    trust_server_certificate: input.trust_server_certificate ?? existingConfig.trust_server_certificate ?? true,
  };

  await db.execute(
    `UPDATE integration_config
     SET encrypted_credentials = ?, config_json = ?, active_status = 1, updated_at = NOW()
     WHERE integration_key = ?`,
    [encrypted, JSON.stringify(newConfig), key]
  );

  await invalidatePool(key);

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

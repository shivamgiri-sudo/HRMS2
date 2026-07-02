// backend/src/modules/external-db/external-db.validation.ts
import { z } from 'zod';

export const SaveDbConfigSchema = z.object({
  db_type: z.enum(['mysql', 'mssql']).default('mysql'),
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  date_column: z.string().optional(),
  employee_code_column: z.string().optional(),
  tables: z.array(z.string()).optional(),
  encrypt: z.boolean().optional(),
  trust_server_certificate: z.boolean().optional(),
});

export type SaveDbConfigInput = z.infer<typeof SaveDbConfigSchema>;

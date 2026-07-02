// backend/src/db/aprDb.ts
import mysql from 'mysql2/promise';
import { getPoolForKey } from '../modules/external-db/external-db.service.js';

export async function getAprPool(): Promise<mysql.Pool> {
  return (await getPoolForKey('apr_productivity')) as mysql.Pool;
}

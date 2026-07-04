/**
 * Direct document migration script.
 * Forces outbound TCP via physical NIC (192.168.1.12) to bypass Docker bridge.
 */
import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BATCH_SIZE = 500;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Create pools with localAddress to force physical NIC
const legacyPool = mysql.createPool({
  host: requiredEnv('LEGACY_MYSQL_HOST'),
  port: Number(process.env.LEGACY_MYSQL_PORT) || 3306,
  user: requiredEnv('LEGACY_MYSQL_USER'),
  password: requiredEnv('LEGACY_MYSQL_PASSWORD'),
  database: requiredEnv('LEGACY_MYSQL_DATABASE'),
  localAddress: process.env.LEGACY_MYSQL_LOCAL_ADDRESS,
  connectionLimit: 3,
  connectTimeout: 15000,
});

const hrmsPool = mysql.createPool({
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
  connectionLimit: 5,
  connectTimeout: 15000,
});

function mapDocCategory(docType: string): string {
  const t = (docType ?? '').toLowerCase();
  if (t.includes('pan'))                                                      return 'pan';
  if (t.includes('aadhar') || t.includes('aadhaar'))                         return 'aadhaar';
  if (t.includes('passport'))                                                 return 'passport';
  if (t.includes('driving') || t === 'dl')                                   return 'driving_license';
  if (t.includes('visa'))                                                     return 'visa';
  if (t.includes('poi') || t.includes('id proof') || t.includes('identity')) return 'identity';
  if (t.includes('poa') || t.includes('address'))                            return 'address_proof';
  if (t.includes('poe') || t.includes('education') || t.includes('qual'))    return 'education';
  if (t.includes('resume') || t.includes('cv') || t.includes('experience'))  return 'experience';
  if (t.includes('bank') || t.includes('cheque') || t.includes('passbook'))  return 'bank';
  if (t.includes('tax') || t.includes('form16'))                             return 'tax';
  if (t.includes('epf') || t.includes(' pf') || t.includes('statutory'))    return 'statutory';
  if (t.includes('medical') || t.includes('health'))                         return 'medical';
  if (t.includes('offer') || t.includes('appointment') || t.includes('joining')) return 'offer_letter';
  if (t.includes('coc') || t.includes('code of conduct') || t.includes('contract') || t.includes('cf_')) return 'contract';
  return 'other';
}

async function buildEmployeeMap(): Promise<Map<string, string>> {
  const [rows] = await hrmsPool.execute<RowDataPacket[]>(
    'SELECT id, employee_code FROM employees WHERE employee_code IS NOT NULL'
  );
  const map = new Map<string, string>();
  for (const row of rows) map.set(String(row.employee_code).toUpperCase(), String(row.id));
  console.log(`[Map] ${map.size} employees loaded from mas_hrms`);
  return map;
}

async function buildSrnoMap(): Promise<Map<number, string>> {
  const [rows] = await legacyPool.query<RowDataPacket[]>(
    'SELECT SrNo, EmpCode FROM employee_master WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );
  const map = new Map<number, string>();
  for (const row of rows) map.set(Number(row.SrNo), String(row.EmpCode).toUpperCase());
  console.log(`[Map] ${map.size} legacy employees loaded from db_bill.employee_master`);
  return map;
}

async function getAlreadyMigrated(source: string): Promise<Set<number>> {
  const [rows] = await hrmsPool.execute<RowDataPacket[]>(
    'SELECT legacy_ref_id FROM employee_documents WHERE legacy_source = ?',
    [source]
  );
  return new Set(rows.map(r => Number(r.legacy_ref_id)));
}

interface DocRow {
  id: string; employee_id: string; doc_type: string; doc_name: string;
  file_url: string | null; created_at: Date; doc_category: string;
  legacy_source: string; legacy_ref_id: number;
}

async function insertBatch(docs: DocRow[]): Promise<{ inserted: number; skipped: number }> {
  if (docs.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0, skipped = 0;
  for (const doc of docs) {
    try {
      const [result] = await hrmsPool.execute<ResultSetHeader>(
        `INSERT IGNORE INTO employee_documents
           (id, employee_id, doc_type, doc_name, file_url, verified, uploaded_by,
            created_at, doc_category, legacy_source, legacy_ref_id)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
        [doc.id, doc.employee_id, doc.doc_type, doc.doc_name, doc.file_url,
         doc.created_at, doc.doc_category, doc.legacy_source, doc.legacy_ref_id]
      );
      if (result.affectedRows > 0) inserted++; else skipped++;
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (code === 'ER_DUP_ENTRY') skipped++;
      else throw error;
    }
  }
  return { inserted, skipped };
}

async function migrateDocumentMaster(empMap: Map<string, string>, srnoMap: Map<number, string>) {
  console.log('\n[document_master] Starting...');
  const already = await getAlreadyMigrated('document_master');
  console.log(`[document_master] Already migrated: ${already.size}`);
  let offset = 0, totalInserted = 0, totalSkipped = 0, totalUnmapped = 0;
  while (true) {
    const [rows] = await legacyPool.query<RowDataPacket[]>(
      'SELECT Id, EmpSrno, DocumentType, DocumentUploaded, DocumentName, SaveDate FROM document_master ORDER BY Id LIMIT ? OFFSET ?',
      [BATCH_SIZE, offset]
    );
    if (rows.length === 0) break;
    const docs: DocRow[] = [];
    for (const row of rows) {
      if (already.has(Number(row.Id))) { totalSkipped++; continue; }
      const empCode = srnoMap.get(Number(row.EmpSrno));
      const employeeId = empCode ? empMap.get(empCode) : undefined;
      if (!employeeId) { totalUnmapped++; continue; }
      let saveDate: Date;
      try { saveDate = row.SaveDate ? new Date(row.SaveDate) : new Date(); if (isNaN(saveDate.getTime())) saveDate = new Date(); }
      catch { saveDate = new Date(); }
      docs.push({
        id: randomUUID(), employee_id: employeeId,
        doc_type: String(row.DocumentType ?? '').trim().slice(0, 100),
        doc_name: String(row.DocumentName ?? row.DocumentType ?? '').trim().slice(0, 255),
        file_url: row.DocumentUploaded ? `legacy://document_master/${row.DocumentUploaded}` : null,
        created_at: saveDate,
        doc_category: mapDocCategory(String(row.DocumentType ?? '')),
        legacy_source: 'document_master', legacy_ref_id: Number(row.Id),
      });
    }
    const { inserted, skipped } = await insertBatch(docs);
    totalInserted += inserted; totalSkipped += skipped;
    offset += rows.length;
    if (offset % 5000 === 0) console.log(`[document_master] ${offset} scanned, ${totalInserted} inserted, ${totalUnmapped} unmapped`);
    if (rows.length < BATCH_SIZE) break;
  }
  console.log(`[document_master] DONE — inserted=${totalInserted} skipped=${totalSkipped} unmapped=${totalUnmapped}`);
  return { inserted: totalInserted, skipped: totalSkipped, unmapped: totalUnmapped };
}

async function migrateQualDocoments(empMap: Map<string, string>) {
  console.log('\n[qual_docoments] Starting...');
  const already = await getAlreadyMigrated('qual_docoments');
  const [rows] = await legacyPool.query<RowDataPacket[]>(
    'SELECT Id, EmpCode, DocType, DocName, filename, saveDate FROM qual_docoments WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );
  const docs: DocRow[] = []; let unmapped = 0;
  for (const row of rows) {
    if (already.has(Number(row.Id))) continue;
    const employeeId = empMap.get(String(row.EmpCode).toUpperCase());
    if (!employeeId) { unmapped++; continue; }
    let saveDate: Date;
    try { saveDate = row.saveDate ? new Date(row.saveDate) : new Date(); if (isNaN(saveDate.getTime())) saveDate = new Date(); }
    catch { saveDate = new Date(); }
    docs.push({
      id: randomUUID(), employee_id: employeeId,
      doc_type: String(row.DocType ?? '').trim().slice(0, 100),
      doc_name: String(row.DocName ?? row.DocType ?? '').trim().slice(0, 255),
      file_url: row.filename ? `legacy://qual_docoments/${row.filename}` : null,
      created_at: saveDate,
      doc_category: mapDocCategory(String(row.DocType ?? '')),
      legacy_source: 'qual_docoments', legacy_ref_id: Number(row.Id),
    });
  }
  const { inserted, skipped } = await insertBatch(docs);
  console.log(`[qual_docoments] DONE — inserted=${inserted} skipped=${skipped} unmapped=${unmapped}`);
  return { inserted, skipped, unmapped };
}

async function migrateEsignature(empMap: Map<string, string>) {
  console.log('\n[Esignature_Document_Master] Starting...');
  const already = await getAlreadyMigrated('esignature');
  const [rows] = await legacyPool.query<RowDataPacket[]>(
    'SELECT Id, EmpCode, DocName, EsignaturePath, CreateDate FROM Esignature_Document_Master WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );
  const docs: DocRow[] = []; let unmapped = 0;
  for (const row of rows) {
    if (already.has(Number(row.Id))) continue;
    const employeeId = empMap.get(String(row.EmpCode).toUpperCase());
    if (!employeeId) { unmapped++; continue; }
    let created: Date;
    try { created = row.CreateDate ? new Date(row.CreateDate) : new Date(); if (isNaN(created.getTime())) created = new Date(); }
    catch { created = new Date(); }
    docs.push({
      id: randomUUID(), employee_id: employeeId,
      doc_type: String(row.DocName ?? '').trim().slice(0, 100),
      doc_name: `${String(row.DocName ?? '').trim()} (E-Signed)`.slice(0, 255),
      file_url: row.EsignaturePath ? String(row.EsignaturePath).trim() : null,
      created_at: created,
      doc_category: mapDocCategory(String(row.DocName ?? '')),
      legacy_source: 'esignature', legacy_ref_id: Number(row.Id),
    });
  }
  const { inserted, skipped } = await insertBatch(docs);
  console.log(`[Esignature_Document_Master] DONE — inserted=${inserted} skipped=${skipped} unmapped=${unmapped}`);
  return { inserted, skipped, unmapped };
}

async function main() {
  console.log('=== Employee Document Migration: db_bill → mas_hrms ===');
  const startTime = Date.now();
  // Test connections
  await legacyPool.execute('SELECT 1');
  console.log('[OK] Legacy db_bill connected');
  await hrmsPool.execute('SELECT 1');
  console.log('[OK] mas_hrms connected');

  const [empMap, srnoMap] = await Promise.all([buildEmployeeMap(), buildSrnoMap()]);
  const r1 = await migrateDocumentMaster(empMap, srnoMap);
  const r2 = await migrateQualDocoments(empMap);
  const r3 = await migrateEsignature(empMap);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Migration Complete ===');
  console.log(`document_master:            inserted=${r1.inserted} skipped=${r1.skipped} unmapped=${r1.unmapped}`);
  console.log(`qual_docoments:             inserted=${r2.inserted} skipped=${r2.skipped} unmapped=${r2.unmapped}`);
  console.log(`Esignature_Document_Master: inserted=${r3.inserted} skipped=${r3.skipped} unmapped=${r3.unmapped}`);
  console.log(`Total inserted: ${r1.inserted + r2.inserted + r3.inserted}`);
  console.log(`Elapsed: ${elapsed}s`);
  await Promise.all([legacyPool.end(), hrmsPool.end()]);
}

main().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });

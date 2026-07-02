/**
 * Employee Document Migration: db_bill → mas_hrms.employee_documents
 *
 * Sources:
 *   1. db_bill.document_master      (~127,905 rows) — via EmpSrno → employee_master → EmpCode
 *   2. db_bill.qual_docoments       (~7,708 rows)   — EmpCode directly
 *   3. db_bill.Esignature_Document_Master (51 rows) — EmpCode directly
 *
 * READ-ONLY on legacyDb (db_bill). Write only to mas_hrms via db.
 */

import { db } from '../../db/mysql.js';
import { getLegacyPool } from '../../db/legacyDb.js';
import { randomUUID } from 'crypto';
import type { RowDataPacket, ResultSetHeader, Pool } from 'mysql2/promise';

const BATCH_SIZE = 500;

// ─── Doc-category mapping ─────────────────────────────────────────────────────

function mapDocCategory(docType: string): string {
  const t = (docType ?? '').toLowerCase();
  if (t.includes('pan'))                                                     return 'pan';
  if (t.includes('aadhar') || t.includes('aadhaar'))                        return 'aadhaar';
  if (t.includes('passport'))                                                return 'passport';
  if (t.includes('driving') || t.includes('dl ') || t === 'dl')             return 'driving_license';
  if (t.includes('visa'))                                                    return 'visa';
  if (t.includes('poi') || t.includes('id proof') || t.includes('identity')) return 'identity';
  if (t.includes('poa') || t.includes('address'))                           return 'address_proof';
  if (t.includes('poe') || t.includes('education') || t.includes('qual'))   return 'education';
  if (t.includes('resume') || t.includes('cv') || t.includes('experience')) return 'experience';
  if (t.includes('bank') || t.includes('cheque') || t.includes('passbook')) return 'bank';
  if (t.includes('tax') || t.includes('form16') || t.includes('form 16'))   return 'tax';
  if (t.includes('epf') || t.includes('pf') || t.includes('statutory'))     return 'statutory';
  if (t.includes('medical') || t.includes('health'))                        return 'medical';
  if (t.includes('offer') || t.includes('appointment') || t.includes('joining')) return 'offer_letter';
  if (t.includes('coc') || t.includes('code of conduct') || t.includes('contract') || t.includes('cf_')) return 'contract';
  return 'other';
}

// ─── Lookup maps ──────────────────────────────────────────────────────────────

/** Load employee_code → UUID map from mas_hrms */
async function buildEmployeeMap(): Promise<Map<string, string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT id, employee_code FROM employees WHERE employee_code IS NOT NULL'
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(String(row.employee_code).toUpperCase(), String(row.id));
  }
  console.log(`[Map] Loaded ${map.size} employees from mas_hrms`);
  return map;
}

/** Load SrNo → EmpCode map from db_bill.employee_master */
async function buildSrnoMap(legacy: Pool): Promise<Map<number, string>> {
  const [rows] = await legacy.query<RowDataPacket[]>(
    'SELECT SrNo, EmpCode FROM employee_master WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );
  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(Number(row.SrNo), String(row.EmpCode).toUpperCase());
  }
  console.log(`[Map] Loaded ${map.size} legacy employees from db_bill.employee_master`);
  return map;
}

/** Return set of legacy_ref_ids already migrated for a given source */
async function getAlreadyMigrated(source: string): Promise<Set<number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT legacy_ref_id FROM employee_documents WHERE legacy_source = ?',
    [source]
  );
  return new Set(rows.map((r) => Number(r.legacy_ref_id)));
}

// ─── Batch insert ─────────────────────────────────────────────────────────────

interface DocRow {
  id: string;
  employee_id: string;
  doc_type: string;
  doc_name: string;
  file_url: string | null;
  created_at: Date;
  doc_category: string;
  legacy_source: string;
  legacy_ref_id: number;
}

async function insertBatch(docs: DocRow[]): Promise<{ inserted: number; skipped: number }> {
  if (docs.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;
  for (const doc of docs) {
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO employee_documents
           (id, employee_id, doc_type, doc_name, file_url, verified, uploaded_by,
            created_at, doc_category, legacy_source, legacy_ref_id)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
        [
          doc.id,
          doc.employee_id,
          doc.doc_type,
          doc.doc_name,
          doc.file_url,
          doc.created_at,
          doc.doc_category,
          doc.legacy_source,
          doc.legacy_ref_id,
        ]
      );
      if (result.affectedRows > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException & { code?: string };
      if (err.code === 'ER_DUP_ENTRY') {
        skipped++;
      } else {
        throw e;
      }
    }
  }
  return { inserted, skipped };
}

// ─── Source 1: document_master ────────────────────────────────────────────────

async function migrateDocumentMaster(
  legacy: Pool,
  empMap: Map<string, string>,
  srnoMap: Map<number, string>
): Promise<{ inserted: number; skipped: number; unmapped: number }> {
  console.log('\n[document_master] Starting migration...');
  const alreadyMigrated = await getAlreadyMigrated('document_master');
  console.log(`[document_master] Already migrated: ${alreadyMigrated.size} records`);

  let offset = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalUnmapped = 0;

  while (true) {
    const [rows] = await legacy.query<RowDataPacket[]>(
      'SELECT Id, EmpSrno, DocumentType, DocumentUploaded, DocumentName, SaveDate FROM document_master ORDER BY Id LIMIT ? OFFSET ?',
      [BATCH_SIZE, offset]
    );
    if (rows.length === 0) break;

    const docs: DocRow[] = [];
    for (const row of rows) {
      if (alreadyMigrated.has(Number(row.Id))) {
        totalSkipped++;
        continue;
      }
      const empCode = srnoMap.get(Number(row.EmpSrno));
      if (!empCode) {
        totalUnmapped++;
        continue;
      }
      const employeeId = empMap.get(empCode);
      if (!employeeId) {
        totalUnmapped++;
        continue;
      }

      docs.push({
        id: randomUUID(),
        employee_id: employeeId,
        doc_type: String(row.DocumentType ?? '').trim(),
        doc_name: String(row.DocumentName ?? row.DocumentType ?? '').trim(),
        file_url: row.DocumentUploaded
          ? `legacy://document_master/${row.DocumentUploaded}`
          : null,
        created_at: row.SaveDate ? new Date(row.SaveDate) : new Date(),
        doc_category: mapDocCategory(String(row.DocumentType ?? '')),
        legacy_source: 'document_master',
        legacy_ref_id: Number(row.Id),
      });
    }

    const { inserted, skipped } = await insertBatch(docs);
    totalInserted += inserted;
    totalSkipped += skipped;
    offset += rows.length;

    if (offset % 5000 === 0) {
      console.log(
        `[document_master] Progress: ${offset} rows scanned, ${totalInserted} inserted, ${totalUnmapped} unmapped`
      );
    }

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `[document_master] DONE — inserted: ${totalInserted}, skipped: ${totalSkipped}, unmapped: ${totalUnmapped}`
  );
  return { inserted: totalInserted, skipped: totalSkipped, unmapped: totalUnmapped };
}

// ─── Source 2: qual_docoments ─────────────────────────────────────────────────

async function migrateQualDocoments(
  legacy: Pool,
  empMap: Map<string, string>
): Promise<{ inserted: number; skipped: number; unmapped: number }> {
  console.log('\n[qual_docoments] Starting migration...');
  const alreadyMigrated = await getAlreadyMigrated('qual_docoments');
  console.log(`[qual_docoments] Already migrated: ${alreadyMigrated.size} records`);

  const [rows] = await legacy.query<RowDataPacket[]>(
    'SELECT Id, EmpCode, DocType, DocName, filename, saveDate FROM qual_docoments WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );

  const docs: DocRow[] = [];
  let unmapped = 0;
  for (const row of rows) {
    if (alreadyMigrated.has(Number(row.Id))) continue;
    const employeeId = empMap.get(String(row.EmpCode).toUpperCase());
    if (!employeeId) {
      unmapped++;
      continue;
    }
    docs.push({
      id: randomUUID(),
      employee_id: employeeId,
      doc_type: String(row.DocType ?? '').trim(),
      doc_name: String(row.DocName ?? row.DocType ?? '').trim(),
      file_url: row.filename ? `legacy://qual_docoments/${row.filename}` : null,
      created_at: row.saveDate ? new Date(row.saveDate) : new Date(),
      doc_category: mapDocCategory(String(row.DocType ?? '')),
      legacy_source: 'qual_docoments',
      legacy_ref_id: Number(row.Id),
    });
  }

  const { inserted, skipped } = await insertBatch(docs);
  console.log(
    `[qual_docoments] DONE — inserted: ${inserted}, skipped: ${skipped}, unmapped: ${unmapped}`
  );
  return { inserted, skipped, unmapped };
}

// ─── Source 3: Esignature_Document_Master ─────────────────────────────────────

async function migrateEsignature(
  legacy: Pool,
  empMap: Map<string, string>
): Promise<{ inserted: number; skipped: number; unmapped: number }> {
  console.log('\n[Esignature_Document_Master] Starting migration...');
  const alreadyMigrated = await getAlreadyMigrated('esignature');
  console.log(`[Esignature_Document_Master] Already migrated: ${alreadyMigrated.size} records`);

  const [rows] = await legacy.query<RowDataPacket[]>(
    'SELECT Id, EmpCode, DocName, EsignaturePath, EsignatureStatus, CreateDate FROM Esignature_Document_Master WHERE EmpCode IS NOT NULL AND EmpCode != ""'
  );

  const docs: DocRow[] = [];
  let unmapped = 0;
  for (const row of rows) {
    if (alreadyMigrated.has(Number(row.Id))) continue;
    const employeeId = empMap.get(String(row.EmpCode).toUpperCase());
    if (!employeeId) {
      unmapped++;
      continue;
    }
    docs.push({
      id: randomUUID(),
      employee_id: employeeId,
      doc_type: String(row.DocName ?? '').trim(),
      doc_name: `${String(row.DocName ?? '').trim()} (E-Signed)`,
      file_url: row.EsignaturePath ? String(row.EsignaturePath).trim() : null,
      created_at: row.CreateDate ? new Date(row.CreateDate) : new Date(),
      doc_category: mapDocCategory(String(row.DocName ?? '')),
      legacy_source: 'esignature',
      legacy_ref_id: Number(row.Id),
    });
  }

  const { inserted, skipped } = await insertBatch(docs);
  console.log(
    `[Esignature_Document_Master] DONE — inserted: ${inserted}, skipped: ${skipped}, unmapped: ${unmapped}`
  );
  return { inserted, skipped, unmapped };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface DocumentMigrationResult {
  document_master: { inserted: number; skipped: number; unmapped: number };
  qual_docoments:  { inserted: number; skipped: number; unmapped: number };
  esignature:      { inserted: number; skipped: number; unmapped: number };
  total_inserted:  number;
  elapsed_seconds: number;
}

export async function migrateDocumentsFromLegacy(): Promise<DocumentMigrationResult> {
  console.log('=== Employee Document Migration: db_bill → mas_hrms ===');
  const startTime = Date.now();

  const legacy = await getLegacyPool();

  const [empMap, srnoMap] = await Promise.all([
    buildEmployeeMap(),
    buildSrnoMap(legacy),
  ]);

  const r1 = await migrateDocumentMaster(legacy, empMap, srnoMap);
  const r2 = await migrateQualDocoments(legacy, empMap);
  const r3 = await migrateEsignature(legacy, empMap);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Migration Complete ===');
  console.log(`document_master:           inserted=${r1.inserted} skipped=${r1.skipped} unmapped=${r1.unmapped}`);
  console.log(`qual_docoments:            inserted=${r2.inserted} skipped=${r2.skipped} unmapped=${r2.unmapped}`);
  console.log(`Esignature_Document_Master: inserted=${r3.inserted} skipped=${r3.skipped} unmapped=${r3.unmapped}`);
  console.log(`Total inserted: ${r1.inserted + r2.inserted + r3.inserted}`);
  console.log(`Elapsed: ${elapsed}s`);

  return {
    document_master: r1,
    qual_docoments:  r2,
    esignature:      r3,
    total_inserted:  r1.inserted + r2.inserted + r3.inserted,
    elapsed_seconds: parseFloat(elapsed),
  };
}

// ─── Direct script execution ──────────────────────────────────────────────────

const isMain =
  process.argv[1]?.endsWith('migrateDocumentsFromLegacy.js') ||
  process.argv[1]?.endsWith('migrateDocumentsFromLegacy.ts');

if (isMain) {
  migrateDocumentsFromLegacy()
    .then((result) => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

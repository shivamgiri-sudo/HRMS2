/**
 * export-question-bank.ts
 * Exports all question bank questions to CSV and JSON in the Downloads folder.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/export-question-bank.ts
 */
import { db } from '../src/db/mysql.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

function tryParse(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

async function main() {
  const [rows] = await db.execute<any[]>(
    `SELECT
       question_code, process_key, role_key, section_key, section_title,
       question_type, difficulty_level, prompt,
       options_json, correct_answer_json, keywords_json,
       explanation, marks, manual_review, set_number, active_status, usage_count
     FROM ats_question_bank
     ORDER BY process_key, role_key, set_number, section_key, question_code`
  );

  // ── JSON export ────────────────────────────────────────────────────────────
  const jsonData = rows.map(r => ({
    questionCode:    r.question_code,
    process:         r.process_key,
    role:            r.role_key,
    section:         r.section_title,
    type:            r.question_type,
    difficulty:      r.difficulty_level,
    set:             r.set_number,
    marks:           Number(r.marks),
    prompt:          r.prompt,
    options:         tryParse(r.options_json),
    correctAnswer:   tryParse(r.correct_answer_json),
    keywords:        tryParse(r.keywords_json),
    explanation:     r.explanation          || null,
    manualReview:    Boolean(r.manual_review),
  }));

  const jsonPath = path.join(DOWNLOADS, 'MAS_ATS_Question_Bank.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log(`JSON saved → ${jsonPath}`);

  // ── CSV export ─────────────────────────────────────────────────────────────
  function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join(' | ') : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  }

  const header = [
    'Question Code','Process','Role','Section','Type','Difficulty','Set','Marks',
    'Prompt','Options','Correct Answer','Keywords','Explanation','Manual Review',
  ];

  const csvLines = [header.join(',')];
  for (const q of jsonData) {
    csvLines.push([
      csvCell(q.questionCode),
      csvCell(q.process),
      csvCell(q.role),
      csvCell(q.section),
      csvCell(q.type),
      csvCell(q.difficulty),
      csvCell(q.set),
      csvCell(q.marks),
      csvCell(q.prompt),
      csvCell(q.options),
      csvCell(Array.isArray(q.correctAnswer) ? q.correctAnswer.join(' | ') : q.correctAnswer),
      csvCell(q.keywords),
      csvCell(q.explanation),
      csvCell(q.manualReview ? 'Yes' : ''),
    ].join(','));
  }

  const csvPath = path.join(DOWNLOADS, 'MAS_ATS_Question_Bank.csv');
  fs.writeFileSync(csvPath, '﻿' + csvLines.join('\r\n'), 'utf-8'); // BOM for Excel
  console.log(`CSV saved → ${csvPath}`);
  console.log(`\nTotal questions exported: ${rows.length}`);

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

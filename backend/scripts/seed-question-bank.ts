/**
 * seed-question-bank.ts
 * Imports all question bank seed data for backoffice, inbound, outbound,
 * team leader and quality auditor assessments.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/seed-question-bank.ts
 */
import { db } from '../src/db/mysql.js';
import { ensureAssessmentSchema } from '../src/modules/ats-assessment/assessment.schema.js';
import { seedQuestionBank } from '../src/modules/ats-assessment/question-bank-seed.js';

async function main() {
  try {
    console.log('Ensuring assessment schema tables exist...');
    await ensureAssessmentSchema();
    console.log('Schema ready.');
    const result = await seedQuestionBank(null);
    console.log('\nQuestion bank seed complete.');
    console.log(`  Imported : ${result.imported}`);
    console.log(`  Skipped  : ${result.skipped}`);
    if (result.errors.length) {
      console.error('\nErrors:');
      result.errors.forEach(e => console.error(' ', e));
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * seed-question-bank-fresher.ts
 * Usage: cd backend && npx tsx scripts/seed-question-bank-fresher.ts
 */
import { db } from '../src/db/mysql.js';
import { ensureAssessmentSchema } from '../src/modules/ats-assessment/assessment.schema.js';
import { seedFresherQuestionBank } from '../src/modules/ats-assessment/question-bank-seed-fresher.js';

async function main() {
  try {
    await ensureAssessmentSchema();
    const result = await seedFresherQuestionBank(null);
    console.log('\nFresher question bank seed complete.');
    console.log(`  Imported : ${result.imported}`);
    console.log(`  Skipped  : ${result.skipped}`);
    if (result.errors.length) result.errors.forEach(e => console.error(' ', e));
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

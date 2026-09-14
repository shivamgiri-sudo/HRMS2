import 'dotenv/config';
import mysql from 'mysql2/promise';
const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: '+05:30', dateStrings: true });

// The 3 confirmed cases: a real, approved package exists in salary_component_assignments,
// but ats_employment_offer was never synced and still shows the original ₹0.
const candidateIds = {
  'MAS63497 (AKASH)': '295241d6-dad5-41fe-a493-934a55363ce2',
  'MAS63496 (HARSH NILAY)': '6586659f-9e4a-46f3-a9cf-4c9c6924b96d',
  'MAS63423 (VANSH ARYAN)': '29710cb6-b4f8-4daa-8b6c-94cb2cf5c32d',
};

await c.beginTransaction();
try {
  for (const [label, candidateId] of Object.entries(candidateIds)) {
    const [[bridge]] = await c.query(
      `SELECT employee_id FROM ats_onboarding_bridge WHERE candidate_id = ?`, [candidateId]
    );
    const [[sca]] = await c.query(
      `SELECT basic, hra, conveyance, special_allowance, other_allowance, bonus, gross,
              pf_employee, employer_pf, esic_employee, employer_esi, ctc, net_estimate
       FROM salary_component_assignments
       WHERE employee_id = ? AND status = 'active'
       ORDER BY assigned_at DESC LIMIT 1`,
      [bridge.employee_id],
    );
    if (!sca) { console.log(label, '- no active package found, skipping'); continue; }

    const [[before]] = await c.query(
      `SELECT offered_ctc, basic, gross FROM ats_employment_offer
        WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
      [candidateId],
    );
    console.log(label, '- BEFORE offer:', JSON.stringify(before), '| approved package:', JSON.stringify(sca));

    const [r] = await c.execute(
      `UPDATE ats_employment_offer SET
          offered_ctc = ?, basic = ?, hra = ?, conveyance = ?, special_allowance = ?,
          other_allowance = ?, bonus = ?, gross = ?,
          pf_employee = ?, pf_employer = ?, esic_employee = ?, esic_employer = ?, net_in_hand = ?
        WHERE candidate_id = ? AND id = (
          SELECT id FROM (SELECT id FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1) sub
        )`,
      [
        sca.ctc, sca.basic, sca.hra, sca.conveyance, sca.special_allowance,
        sca.other_allowance, sca.bonus, sca.gross,
        sca.pf_employee, sca.employer_pf, sca.esic_employee, sca.employer_esi, sca.net_estimate,
        candidateId, candidateId,
      ],
    );
    console.log(label, '- rows updated:', r.affectedRows);
  }
  await c.commit();
  console.log('\nCommitted.');
} catch (e) {
  await c.rollback();
  console.error('ROLLED BACK:', e.message);
  process.exitCode = 1;
}

for (const [label, candidateId] of Object.entries(candidateIds)) {
  const [[after]] = await c.query(
    `SELECT offered_ctc, basic, gross, net_in_hand FROM ats_employment_offer
      WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );
  console.log(label, '- AFTER offer:', JSON.stringify(after));
}
await c.end();

/**
 * Dispatch a consolidated joining kit from the production server.
 *
 * This cannot be run from a developer machine. The Aadhaar eSign provider
 * accepts only the deployment's egress IP (${process.env.LMS_DB_HOST}); from anywhere else
 * the handshake fails with "IP address <yours> is not whitelisted", and because
 * the kit email is sent after that step, nothing goes out.
 *
 * Usage, on the server, from /var/www/HRMS2/backend:
 *
 *   node scripts/dispatch-joining-kit.mjs --employee-code MAS63086            # dry run
 *   node scripts/dispatch-joining-kit.mjs --employee-code MAS63086 --confirm  # sends
 *
 * Dry run is the default: it prints what would happen and sends nothing.
 *
 * The kit and per-document signing flows are mutually exclusive by design, so an
 * active per-document link is superseded. That is deliberate rather than
 * incidental: the kit contains EPF_DECLARATION and EPF_NOMINATION_FORM2 among
 * its documents, so it already covers what a standalone PF link would have.
 */
process.env.JOINING_KIT_ESIGN_ENABLED = "true"; // this process only; no config is written

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const CONFIRM = args.includes("--confirm");
const CODE = arg("--employee-code");
const ACTOR = arg("--actor-user-id") ?? null;

if (!CODE) {
  console.error("usage: node scripts/dispatch-joining-kit.mjs --employee-code <CODE> [--actor-user-id <ID>] [--confirm]");
  process.exit(2);
}

const { db } = await import("../dist/src/db/mysql.js");
const { queueJoiningKit, dispatchJoiningKit } = await import("../dist/src/modules/employees/joiningKitDispatch.service.js");

const [[emp]] = await db.execute(
  `SELECT id, employee_code, full_name, personal_email, official_email, candidate_id
     FROM employees WHERE employee_code = ? LIMIT 1`, [CODE]);
if (!emp) { console.error(`No employee with code ${CODE}`); process.exit(1); }

const to = [emp.personal_email, emp.official_email].filter((e) => e && String(e).includes("@"));
const [[blockers]] = await db.execute(
  `SELECT COUNT(*) n FROM employee_joining_document_field_value fv
     JOIN employee_joining_document_checklist cl ON cl.id = fv.checklist_id
     LEFT JOIN document_template_field_map m
            ON m.document_code = cl.document_code AND m.field_key = fv.field_key
    WHERE cl.employee_id = ? AND fv.fill_status = 'hr_fill_required'
      AND fv.field_key NOT REGEXP '(^|_)signature$' AND COALESCE(m.required, 1) = 1`, [emp.id]);
const [perDoc] = await db.execute(
  `SELECT document_code FROM employee_joining_document_public_token
    WHERE employee_id = ? AND kit_id IS NULL AND token_status = 'active' AND expires_at > NOW()`, [emp.id]);

console.log(`employee            : ${emp.full_name} (${emp.employee_code})`);
console.log(`will email          : ${to.join(", ") || "(no address on record — dispatch would not mail)"}`);
console.log(`remaining blockers  : ${blockers.n}`);
console.log(`links to supersede  : ${perDoc.map((r) => r.document_code).join(", ") || "(none)"}`);
console.log(`FRONTEND_URL        : ${process.env.FRONTEND_URL ?? "(unset — falls back to the public address)"}`);

if (!CONFIRM) {
  console.log("\nDRY RUN — nothing sent. Re-run with --confirm to dispatch.");
  process.exit(0);
}
if (Number(blockers.n) > 0) {
  console.error(`\nRefusing: ${blockers.n} required field(s) still unfilled. Resync the checklist first.`);
  process.exit(1);
}
if (to.length === 0) {
  console.error("\nRefusing: no email address on record, so the kit would be built but never delivered.");
  process.exit(1);
}

if (perDoc.length) {
  const [r] = await db.execute(
    `UPDATE employee_joining_document_public_token SET token_status = 'revoked'
      WHERE employee_id = ? AND kit_id IS NULL AND token_status = 'active'`, [emp.id]);
  console.log(`superseded ${r.affectedRows} per-document link(s)`);
}
await db.execute(`DELETE FROM employee_joining_esign_kit WHERE employee_id = ? AND status IN ('blocked','failed')`, [emp.id]);

const q = await queueJoiningKit({
  employeeId: emp.id, candidateId: emp.candidate_id ?? null,
  actorUserId: ACTOR, triggerSource: "manual_hr_script",
});
const out = await dispatchJoiningKit(q.kitId, ACTOR);
console.log("\noutcome:", JSON.stringify(out, null, 1).slice(0, 900));

// A failed dispatch leaves the member with nothing, since the per-document link
// was just superseded. Put it back rather than leaving them stranded.
if (out.status !== "sent" && perDoc.length) {
  const [back] = await db.execute(
    `UPDATE employee_joining_document_public_token SET token_status = 'active'
      WHERE employee_id = ? AND kit_id IS NULL AND token_status = 'revoked'`, [emp.id]);
  console.log(`dispatch did not send — restored ${back.affectedRows} per-document link(s)`);
}
process.exit(out.status === "sent" ? 0 : 1);

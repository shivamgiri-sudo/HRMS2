import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npx tsx scripts/generate-admin-hash.ts '<temporary-password>'");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 10);

console.log("=".repeat(60));
console.log("Password Hash Generated");
console.log("=".repeat(60));
console.log();
console.log(`Hash:     ${hash}`);
console.log();
console.log("Use this hash in the SQL script (061_admin_setup.sql)");
console.log();

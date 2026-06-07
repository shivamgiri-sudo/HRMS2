import bcrypt from "bcryptjs";

const password = process.argv[2] || "Admin@123";
const hash = bcrypt.hashSync(password, 10);

console.log("=".repeat(60));
console.log("Password Hash Generated");
console.log("=".repeat(60));
console.log();
console.log(`Password: ${password}`);
console.log(`Hash:     ${hash}`);
console.log();
console.log("Use this hash in the SQL script (061_admin_setup.sql)");
console.log();

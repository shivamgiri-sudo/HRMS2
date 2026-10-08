/**
 * A stand-in for TallyPrime's HTTP gateway, for trying the "Post to Tally" flow without Tally.
 * NOT Tally: it only checks what is cheap to check (the XML parses into vouchers, each balances,
 * ledgers exist if you list them) and answers in Tally's response shape. Real Tally is stricter about
 * ledger / voucher-type / cost-centre masters, so a pass here is not a pass in Tally.
 *
 *   node scripts/mock-tally-gateway.mjs [port=9000] [ledgers.txt]
 *   TALLY_GATEWAY_URL=http://127.0.0.1:9000 in the backend env, then Finance > Salary Voucher > Post to Tally.
 *   GET /vouchers lists what it accepted.
 *
 * ledgers.txt: one ledger name per line. When given, a voucher naming any other ledger is rejected
 * with "Ledger 'X' does not exist!", as Tally does for a missing ledger.
 */
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] ?? 9000);
const known = process.argv[3] ? new Set(fs.readFileSync(process.argv[3], "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) : null;
const accepted = [];

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/vouchers") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(accepted, null, 2)); return; }
  if (req.method === "GET") { res.end("<RESPONSE>TallyPrime Server is Running (stand-in)</RESPONSE>"); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const vouchers = body.split("<VOUCHER ").slice(1);
    let created = 0, errors = 0; const lineErrors = [];
    for (const v of vouchers) {
      const no = (v.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/) ?? [])[1] ?? "?";
      const ledgers = [...v.matchAll(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/g)].map((m) => m[1]);
      const sum = [...v.matchAll(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
      const missing = known ? ledgers.find((l) => !known.has(l.replace(/&amp;/g, "&"))) : null;
      if (missing) { errors++; lineErrors.push(`Ledger '${missing}' does not exist!`); continue; }
      if (Math.abs(sum) > 0.01) { errors++; lineErrors.push(`Voucher ${no} is not balanced (difference ${sum.toFixed(2)})`); continue; }
      created++; accepted.push({ voucher_no: no, ledgers: ledgers.length, at: new Date().toISOString() });
      console.log(`accepted ${no} (${ledgers.length} ledger lines)`);
    }
    res.end(`<RESPONSE><CREATED>${created}</CREATED><ALTERED>0</ALTERED><ERRORS>${errors}</ERRORS><EXCEPTIONS>0</EXCEPTIONS>${lineErrors.map((e) => `<LINEERROR>${e}</LINEERROR>`).join("")}</RESPONSE>`);
  });
});
server.listen(port, "0.0.0.0", () => console.log(`stand-in Tally gateway on :${port}${known ? ` (${known.size} known ledgers)` : ""}`));

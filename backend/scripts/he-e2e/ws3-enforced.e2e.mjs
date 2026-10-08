// Rig e2e (WS3 E1), second phase: the WS3 backend restarted with REQ_END_DATE_ENFORCEMENT=policy and policy.req_end_date_enforced = 1 on ws3_rig.
//   node backend/scripts/he-e2e/ws3-enforced.e2e.mjs   (restore: policy 0 and restart without the env key)
const API = process.env.WS3_API ?? "http://127.0.0.1:5398";
async function login(id) {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: id, email: id, password: "RigTest#2026" }) });
  const j = await r.json(); const token = j.accessToken ?? j.token ?? j.data?.accessToken ?? j.data?.token;
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) };
}
const h = await login("rig.superadmin@he-e2e2.test");
let pass = 0, fail = 0; const ok = (n, c, d) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : " -> " + JSON.stringify(d).slice(0, 400)}`); };
const m = (await (await fetch(`${API}/api/he/campaign-matrix`, { headers: h })).json()).data;
ok("enforced: the matrix says enforcement is on", m.enforcedEndDate === true, m.enforcedEndDate);
const r04 = m.rows.filter((r) => r.requisition.code === "RIG-R04");
ok("enforced: R04 (ended 2026-10-05) cells are idle requisition_ended 'no new first contacts'", r04.length > 0 && r04.every((r) => Object.values(r.cells).filter((c) => c.state !== "not_applicable").every((c) => c.state === "idle" && c.reason === "requisition_ended" && c.reasonText.includes("no new first contacts"))), r04.map((r) => r.cells));
const before = (await import("node:fs")).readFileSync("/home/shuvam/he-e2e2/rec/mail.jsonl", "utf8").split("\n").filter(Boolean).length;
const n = await (await fetch(`${API}/api/meta/leads/a98667ee-dc38-4064-afb7-766541a11e33/notify`, { method: "POST", headers: h, body: JSON.stringify({ force: true }) })).json();
ok("enforced: Notify (even forced) on an R04 lead is refused with the end-date reason", JSON.stringify(n).includes("requisition end date passed (2026-10-05)"), n);
const after = (await import("node:fs")).readFileSync("/home/shuvam/he-e2e2/rec/mail.jsonl", "utf8").split("\n").filter(Boolean).length;
ok("enforced: nothing reached the mail sink", after === before, { before, after });
console.log(`${pass} passed, ${fail} failed`);

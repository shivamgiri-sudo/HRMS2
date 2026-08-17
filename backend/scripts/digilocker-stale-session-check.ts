/**
 * Read-only diagnostic: find real candidates currently stuck in a non-terminal
 * DigiLocker state, to verify the new staleness flag / "Start Over" button
 * against a genuine record instead of synthetic data.
 *
 * No writes. Safe to run against the live DB.
 */
import { db } from "../src/db/mysql.js";

const TERMINAL = new Set(["completed", "documents_received", "passed", "failed", "expired", "not_started"]);
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

async function main() {
  const [providerRows] = await db.execute(
    `SELECT candidate_id, status, updated_at, created_at
       FROM ats_provider_transaction_log
      WHERE provider = 'luckpay' AND service_type = 'digilocker'
      ORDER BY updated_at DESC
      LIMIT 500`
  );
  const [sessionRows] = await db.execute(
    `SELECT candidate_id, session_status AS status, updated_at, created_at
       FROM candidate_digilocker_session
      ORDER BY created_at DESC
      LIMIT 500`
  );

  const latestByCandidate = new Map<string, any>();
  for (const row of sessionRows as any[]) {
    if (!latestByCandidate.has(row.candidate_id)) latestByCandidate.set(row.candidate_id, row);
  }
  for (const row of providerRows as any[]) {
    latestByCandidate.set(row.candidate_id, row);
  }

  const now = Date.now();
  const nonTerminal: any[] = [];
  for (const [candidateId, row] of latestByCandidate) {
    const status = String(row.status ?? "");
    if (TERMINAL.has(status)) continue;
    const updatedAt = row.updated_at ?? row.created_at;
    const ageMs = updatedAt ? now - new Date(updatedAt).getTime() : null;
    nonTerminal.push({
      candidateId,
      status,
      updatedAt,
      ageHours: ageMs != null ? Math.round((ageMs / 3600000) * 10) / 10 : null,
      stale: ageMs != null && ageMs > STALE_AFTER_MS,
    });
  }

  // Most recently updated stale one first — best shot at a still-valid onboarding token.
  nonTerminal.sort((a, b) => (a.ageHours ?? 0) - (b.ageHours ?? 0));

  console.log(`Non-terminal DigiLocker sessions found: ${nonTerminal.length}`);
  console.log(`Of those, stale (>2h idle): ${nonTerminal.filter((r) => r.stale).length}`);
  console.log("");

  const candidateIds = nonTerminal.filter((r) => r.stale).slice(0, 10).map((r) => r.candidateId);
  if (candidateIds.length === 0) {
    process.exit(0);
  }
  const placeholders = candidateIds.map(() => "?").join(",");
  const [candRows] = await db.execute(
    `SELECT c.id, c.candidate_code, c.full_name, b.onboarding_token_expires_at,
            (b.onboarding_token_expires_at > NOW()) AS token_still_valid
       FROM ats_candidate c
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = c.id
      WHERE c.id IN (${placeholders})`,
    candidateIds
  );
  const byId = new Map((candRows as any[]).map((r) => [r.id, r]));

  for (const row of nonTerminal.filter((r) => r.stale).slice(0, 10)) {
    const cand = byId.get(row.candidateId);
    console.log(
      `${row.candidateId}  code=${cand?.candidate_code ?? "?"}  name=${cand?.full_name ?? "?"}  ` +
      `status=${row.status}  age=${row.ageHours}h  token_valid=${cand?.token_still_valid ?? "?"}  ` +
      `token_expires=${cand?.onboarding_token_expires_at ?? "?"}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});

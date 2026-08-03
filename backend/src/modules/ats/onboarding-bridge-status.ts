/**
 * Keeping `ats_onboarding_bridge` in step with what actually happened.
 *
 * The bridge carries `digilocker_status` and `penny_drop_status`, and nothing
 * ever wrote either one. Across all 304 rows in production both sat at
 * `not_started` — while four candidates had a verified penny drop and two had
 * completed a full DigiLocker round trip. The results were being written to
 * `candidate_bgv_report` and `candidate_bgv_check` instead.
 *
 * That is not merely cosmetic. `onboarding-full.service.ts` gates on
 *
 *     digilockerDone = bridge.digilocker_status === "documents_received"
 *
 * so the gate could never open, no matter how many candidates finished
 * DigiLocker.
 *
 * The two tables also disagree on vocabulary, which is the trap that makes this
 * easy to get wrong twice:
 *
 *   candidate_bgv_report.digilocker_status  enum(not_run, passed, failed, partial)
 *   ats_onboarding_bridge.digilocker_status enum(not_started, initiated,
 *                                                documents_received, expired)
 *
 * Writing 'passed' to the bridge does not fail quietly — MySQL runs in STRICT
 * mode here, so an out-of-range ENUM throws and would take down the DigiLocker
 * sync that has only just started working. Every value this module can produce
 * is pinned by a test against the live column definition.
 */

/** ats_onboarding_bridge.digilocker_status */
export type BridgeDigilockerStatus =
  | "not_started" | "initiated" | "documents_received" | "expired";

/** ats_onboarding_bridge.penny_drop_status */
export type BridgePennyDropStatus =
  | "not_started" | "initiated" | "verified" | "failed" | "name_mismatch";

export const BRIDGE_DIGILOCKER_VALUES: BridgeDigilockerStatus[] = [
  "not_started", "initiated", "documents_received", "expired",
];

export const BRIDGE_PENNY_DROP_VALUES: BridgePennyDropStatus[] = [
  "not_started", "initiated", "verified", "failed", "name_mismatch",
];

/**
 * Never walk a candidate backwards.
 *
 * Statuses are refreshed from more than one place and not in a guaranteed
 * order — a late-arriving poll must not turn a finished DigiLocker back into
 * "initiated". Higher wins.
 */
const DIGILOCKER_RANK: Record<BridgeDigilockerStatus, number> = {
  not_started: 0, initiated: 1, expired: 2, documents_received: 3,
};

const PENNY_DROP_RANK: Record<BridgePennyDropStatus, number> = {
  not_started: 0, initiated: 1, failed: 2, name_mismatch: 3, verified: 4,
};

/** DigiLocker session state -> the bridge's vocabulary. */
export function bridgeDigilockerStatus(state: unknown): BridgeDigilockerStatus {
  switch (String(state ?? "").trim().toLowerCase()) {
    case "completed":
    case "documents_received":
      return "documents_received";
    case "expired":
      return "expired";
    case "created":
    case "initiated":
    case "pending":
    case "in_progress":
      return "initiated";
    default:
      return "not_started";
  }
}

/**
 * Bank check outcome -> the bridge's vocabulary.
 *
 * `manual_review` is deliberately split. A review raised because the account
 * holder's name diverged is a name mismatch and should read as one — that is
 * the case that caught a real account belonging to someone else. A review
 * raised because the provider was unreachable is not a mismatch; nothing is
 * known about the name yet, so it stays "initiated" rather than implying a
 * finding nobody made.
 */
export function bridgePennyDropStatus(
  checkStatus: unknown,
  riskFlags?: ReadonlyArray<unknown> | null,
): BridgePennyDropStatus {
  const flags = (riskFlags ?? []).map((f) => String(f ?? "").toUpperCase());
  const nameDiverged = flags.some((f) => f.includes("NAME_DIVERGENCE") || f.includes("NAME_MISMATCH"));

  switch (String(checkStatus ?? "").trim().toLowerCase()) {
    case "verified":
      return "verified";
    case "mismatch":
      return "name_mismatch";
    case "manual_review":
      return nameDiverged ? "name_mismatch" : "initiated";
    case "failed":
      return "failed";
    case "initiated":
    case "pending":
    case "in_progress":
      return "initiated";
    default:
      return "not_started";
  }
}

type Executor = { execute: (sql: string, params: unknown[]) => Promise<unknown> };

/**
 * Write a bridge status, but only ever forwards.
 *
 * Never throws. These calls sit after the verification work is already done and
 * persisted; losing a completed DigiLocker pull or a penny drop result because
 * a mirror write failed would be a far worse outcome than a stale bridge row.
 */
async function advance(
  db: Executor,
  candidateId: string,
  column: "digilocker_status" | "penny_drop_status",
  next: string,
  rank: Record<string, number>,
): Promise<void> {
  // FIELD() gives each enum value its position; comparing ranks in SQL keeps
  // this a single statement, so a concurrent update cannot land between a read
  // and a write.
  const order = Object.keys(rank).sort((a, b) => rank[a] - rank[b]);
  const list = order.map(() => "?").join(", ");
  try {
    await db.execute(
      `UPDATE ats_onboarding_bridge
          SET ${column} = ?, updated_at = NOW()
        WHERE candidate_id = ?
          AND FIELD(?, ${list}) > FIELD(COALESCE(${column}, 'not_started'), ${list})`,
      [next, candidateId, next, ...order, ...order],
    );
  } catch (error) {
    console.error(
      `[bridge] could not advance ${column} for ${candidateId}:`,
      (error as Error)?.message,
    );
  }
}

export async function syncBridgeDigilockerStatus(
  db: Executor, candidateId: string, state: unknown,
): Promise<void> {
  await advance(db, candidateId, "digilocker_status", bridgeDigilockerStatus(state), DIGILOCKER_RANK);
}

export async function syncBridgePennyDropStatus(
  db: Executor, candidateId: string, checkStatus: unknown,
  riskFlags?: ReadonlyArray<unknown> | null,
): Promise<void> {
  await advance(
    db, candidateId, "penny_drop_status",
    bridgePennyDropStatus(checkStatus, riskFlags), PENNY_DROP_RANK,
  );
}

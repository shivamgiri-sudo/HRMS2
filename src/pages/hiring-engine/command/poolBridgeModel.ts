/** Pure model of the pool bridge card (WS3 D2): import files grouped by source, the request body, the dry-run result per file in words. */
export type BridgeRecordType = "candidate" | "naukri_import" | "workindia_import";
export interface BridgeSource { recordType: string; sourceDetails: string; rows: number; inPool: number }
type Skip = "legacy_employee" | "test" | "no_mobile" | "employee" | "duplicate_mobile";
export interface BridgeBatch { recordType: string; sourceDetails: string; batchId: string | null; scanned: number; inserted: number; enriched: number; skipped: Record<Skip, number> }
export interface BridgeResult { dryRun: boolean; batches: BridgeBatch[]; totals: { scanned: number; inserted: number; enriched: number; skipped: Record<Skip, number> }; next: { recordType: BridgeRecordType; afterId: string } | null }

export const BRIDGE_PATH = "/api/he/pool/bridge-ats";
export const BRIDGE_SOURCES_PATH = "/api/he/pool/bridge-ats/sources";
export const BRIDGE_ROLES = ["super_admin", "admin"] as const;
export const SOURCE_LABEL: Record<string, string> = { naukri_import: "Naukri", workindia_import: "WorkIndia", candidate: "ATS candidates" };
const SKIP_TEXT: Record<Skip, [string, string]> = {
  legacy_employee: ["former employee (legacy record)", "former employees (legacy records)"], test: ["test record", "test records"],
  no_mobile: ["without a valid mobile", "without a valid mobile"], employee: ["current employee", "current employees"], duplicate_mobile: ["repeat of a number already in this run", "repeats of numbers already in this run"],
};

export function sourceGroups(list: BridgeSource[]): Array<{ recordType: string; label: string; files: number; rows: number; inPool: number }> {
  const out = new Map<string, { recordType: string; label: string; files: number; rows: number; inPool: number }>();
  for (const s of list) {
    const g = out.get(s.recordType) ?? { recordType: s.recordType, label: SOURCE_LABEL[s.recordType] ?? s.recordType, files: 0, rows: 0, inPool: 0 };
    g.files += 1; g.rows += s.rows; g.inPool += s.inPool;
    out.set(s.recordType, g);
  }
  return [...out.values()];
}

export function bridgeBody(types: string[], dryRun: boolean, after?: { recordType: string; afterId: string } | null) {
  return { recordTypes: types, dryRun, ...(after ? { after } : {}) };
}

export function skipText(s: Record<Skip, number>): string {
  return (Object.keys(SKIP_TEXT) as Skip[]).filter((k) => s[k] > 0).map((k) => `${s[k]} ${SKIP_TEXT[k][s[k] === 1 ? 0 : 1]}`).join(", ");
}

export function resultRows(r: BridgeResult) {
  return r.batches.map((b) => ({ file: b.sourceDetails, source: SOURCE_LABEL[b.recordType] ?? b.recordType, scanned: b.scanned, added: b.inserted, enriched: b.enriched, skipped: skipText(b.skipped) }));
}

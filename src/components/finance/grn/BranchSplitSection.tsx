import { useMemo } from "react";
import { GrnButton, GrnCard, GrnCardHeader, GrnInput, GrnSelect, GrnTable, GrnTd, GrnTh, GRN_TR } from "@/components/finance/grn/legacy-grn-ui";
import type { BranchSplitBranch, BranchSplitOptions } from "@/hooks/useBranchSplitOptions";

/**
 * "Split this Head Office bill across branches" (owner requirement 2026-10-07).
 *
 * Each row is one branch: its share lands on that branch's Back Office cost centre and is funded
 * from that branch's OWN budget, so Head Office carries only the vendor payable. The server picks
 * the funding line; this section only names the branch, its Back Office cost centre and the share.
 * Head Office keeps no share in this view (a bill Head Office keeps part of is raised the ordinary way).
 */
export interface BranchShareDraft {
  key: string;
  branchId: string;
  /** Only needed when the branch has several possible Back Office cost centres — an explicit pick. */
  costCentreId: string;
  percentage: number;
}

let shareSeq = 0;
export const newBranchShare = (branchId = ""): BranchShareDraft => ({ key: `bs${++shareSeq}`, branchId, costCentreId: "", percentage: 0 });

const money = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v || 0));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Same paise-exact split as the rest of the form: shares always add back to the total. */
export function splitAmountIntoShares(total: number, percentages: number[]): number[] {
  const t = round2(total);
  const shares = percentages.map((p) => round2((t * (Number(p) || 0)) / 100));
  if (!shares.length) return shares;
  const residual = round2(t - shares.reduce((s, x) => s + x, 0));
  if (residual !== 0) shares[shares.length - 1] = round2(shares[shares.length - 1] + residual);
  return shares;
}

/** The first thing wrong with these shares, or null when they can be saved. */
export function branchSharesError(shares: BranchShareDraft[], options: BranchSplitOptions | undefined): string | null {
  if (!shares.length) return "Add at least one branch.";
  const seen = new Set<string>();
  for (const [i, share] of shares.entries()) {
    const label = `Row ${i + 1}`;
    const branch = options?.branches.find((b) => b.branchId === share.branchId);
    if (!branch) return `${label}: choose a branch.`;
    if (seen.has(share.branchId)) return `${branch.branchName} appears twice — combine its shares into one row.`;
    seen.add(share.branchId);
    if (branch.status === "none") return `${branch.branchName} has no active Back Office cost centre, so it cannot receive a share.`;
    if (branch.status === "ambiguous" && !share.costCentreId) return `${branch.branchName}: pick which Back Office cost centre receives the share.`;
    if (!(Number(share.percentage) > 0)) return `${branch.branchName}: enter a share greater than 0%.`;
  }
  const total = Math.round(shares.reduce((s, x) => s + Number(x.percentage || 0), 0) * 1_000_000) / 1_000_000;
  if (Math.abs(total - 100) > 0.5) return `Shares must total 100% (currently ${total}%).`;
  return null;
}

/** What the server's `costCentreSplits` expects for a branch share. */
export const branchSharesPayload = (shares: BranchShareDraft[]) =>
  shares.map((s) => ({
    branchId: s.branchId,
    costCentreId: s.costCentreId || undefined,
    percentage: Number(s.percentage),
  }));

export function BranchSplitSection({
  amount, options, shares, onChange, error, head, subHead,
}: {
  amount: number;
  options: BranchSplitOptions;
  shares: BranchShareDraft[];
  onChange: (next: BranchShareDraft[]) => void;
  error?: string | null;
  head?: string;
  subHead?: string;
}) {
  const receivers = useMemo(() => options.branches.filter((b) => !b.isHeadOffice), [options.branches]);
  const amounts = splitAmountIntoShares(amount, shares.map((s) => s.percentage));
  const total = Math.round(shares.reduce((s, x) => s + Number(x.percentage || 0), 0) * 1_000_000) / 1_000_000;
  const reconciled = Math.abs(total - 100) <= 0.5;
  const update = (key: string, patch: Partial<BranchShareDraft>) =>
    onChange(shares.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const used = new Set(shares.map((s) => s.branchId));

  function splitEqually() {
    if (!shares.length) return;
    const each = Math.floor((100 / shares.length) * 1_000_000) / 1_000_000;
    onChange(shares.map((s, i) => ({ ...s, percentage: i === shares.length - 1 ? Math.round((100 - each * (shares.length - 1)) * 1_000_000) / 1_000_000 : each })));
  }

  const reason = (b: BranchSplitBranch) =>
    b.status === "none" ? " — no Back Office cost centre" : b.status === "ambiguous" ? " — pick a cost centre" : "";

  return (
    <GrnCard>
      <GrnCardHeader
        title="Split across branches"
        description={
          <>
            Each branch's share lands on its <strong>Back Office cost centre</strong> and is funded from <strong>that branch's own
            budget</strong>{head ? <> for {head}{subHead ? ` → ${subHead}` : ""}</> : null}. Head Office keeps only the vendor payable.
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GrnButton size="sm" variant="default" onClick={splitEqually} disabled={!shares.length}>Split equally</GrnButton>
            <GrnButton size="sm" variant="primary" onClick={() => onChange([...shares, newBranchShare()])} disabled={shares.length >= receivers.length}>
              + Add branch
            </GrnButton>
          </div>
        }
      />
      <GrnTable minWidth={720}>
        <thead>
          <tr>
            <GrnTh>Branch</GrnTh>
            <GrnTh>Back Office cost centre</GrnTh>
            <GrnTh align="right">Share %</GrnTh>
            <GrnTh align="right">Amount (incl. GST)</GrnTh>
            <GrnTh align="center"><span className="sr-only">Remove</span></GrnTh>
          </tr>
        </thead>
        <tbody>
          {shares.length === 0 ? (
            <tr><GrnTd colSpan={5}>No branches yet — use “Add branch”.</GrnTd></tr>
          ) : null}
          {shares.map((share, i) => {
            const branch = options.branches.find((b) => b.branchId === share.branchId);
            return (
              <tr key={share.key} className={GRN_TR}>
                <GrnTd>
                  <GrnSelect
                    aria-label={`Row ${i + 1} branch`}
                    value={share.branchId}
                    onChange={(e) => update(share.key, { branchId: e.target.value, costCentreId: "" })}
                    className="h-9 min-w-[200px] text-[12px]"
                  >
                    <option value="">Select branch</option>
                    {receivers.map((b) => (
                      <option key={b.branchId} value={b.branchId} disabled={(used.has(b.branchId) && b.branchId !== share.branchId) || b.status === "none"}>
                        {b.branchName}{reason(b)}
                      </option>
                    ))}
                  </GrnSelect>
                </GrnTd>
                <GrnTd>
                  {!branch ? <span className="text-slate-500">—</span>
                    : branch.status === "ok" ? <span className="font-medium">{branch.resolved?.code}</span>
                    : branch.status === "ambiguous" ? (
                      <GrnSelect
                        aria-label={`Row ${i + 1} Back Office cost centre`}
                        aria-invalid={!share.costCentreId}
                        value={share.costCentreId}
                        onChange={(e) => update(share.key, { costCentreId: e.target.value })}
                        className="h-9 min-w-[220px] text-[12px]"
                      >
                        <option value="">Pick one…</option>
                        {branch.candidates.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                      </GrnSelect>
                    ) : <span className="font-medium text-rose-700">None — cannot receive a share</span>}
                </GrnTd>
                <GrnTd align="right">
                  <GrnInput
                    aria-label={`Row ${i + 1} share percent`}
                    inputMode="decimal"
                    value={share.percentage || ""}
                    onChange={(e) => update(share.key, { percentage: Number(e.target.value) || 0 })}
                    className="h-9 w-24 text-right text-[12px]"
                  />
                </GrnTd>
                <GrnTd align="right"><span className="tabular-nums font-semibold">{money(amounts[i] ?? 0)}</span></GrnTd>
                <GrnTd align="center">
                  <GrnButton size="sm" variant="default" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(shares.filter((s) => s.key !== share.key))}>
                    Remove
                  </GrnButton>
                </GrnTd>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <GrnTd colSpan={2}><strong>Total</strong></GrnTd>
            <GrnTd align="right">
              <span className={`tabular-nums font-semibold ${reconciled ? "text-emerald-700" : "text-rose-700"}`}>
                {total}% {reconciled ? "✓" : "— must be 100%"}
              </span>
            </GrnTd>
            <GrnTd align="right"><span className="tabular-nums font-semibold">{money(amounts.reduce((s, x) => s + x, 0))}</span></GrnTd>
            <GrnTd />
          </tr>
        </tfoot>
      </GrnTable>
      {error ? <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-800">{error}</p> : null}
    </GrnCard>
  );
}

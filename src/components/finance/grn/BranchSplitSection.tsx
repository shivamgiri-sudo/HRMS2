import { useEffect, useMemo, useState } from "react";
import { Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GrnCard, GrnCardHeader, GrnInput, GrnSelect, GrnTable, GrnTd, GrnTh, GRN_TR } from "@/components/finance/grn/legacy-grn-ui";
import { BRANCH_SHARING_METHODS } from "@/hooks/useBranchBudget";
import type { BranchSplitBranch, BranchSplitOptions } from "@/hooks/useBranchSplitOptions";
import { weightFor } from "@/lib/sharingWeights";
import { cn } from "@/lib/utils";

/**
 * "Split this Head Office bill across branches" (owner requirement 2026-10-07).
 *
 * Works like the cost-centre split: every receiving branch is a row you tick, a split method
 * (equal, headcount, seats, revenue… or direct to one branch) fills the shares, and each row shows
 * the check that matters — does that branch's OWN budget for this head/sub-head cover its share.
 * A share lands on the branch's Back Office cost centre and is funded from that branch's budget, so
 * Head Office carries only the vendor payable. The server still decides the funding line and
 * re-checks everything; this section only names the branch, its cost centre and the share.
 */
export interface BranchShareDraft {
  key: string;
  branchId: string;
  /** Only needed when the branch has several possible Back Office cost centres — an explicit pick. */
  costCentreId: string;
  percentage: number;
  included: boolean;
}

export const newBranchShare = (branchId = ""): BranchShareDraft => ({
  key: `bs-${branchId || Math.random().toString(36).slice(2)}`, branchId, costCentreId: "", percentage: 0, included: false,
});

// Same method list as the cost-centre split (manual / meter / grade-weighted are not splits of a bill).
const SPLIT_METHODS = [
  { value: "direct", label: "Direct to branch" },
  ...BRANCH_SHARING_METHODS.filter((m) => !["manual", "meter_wise", "grade_weighted_headcount"].includes(m.value)),
];

const money = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v || 0));
const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

/** Same paise-exact split as the rest of the form: shares always add back to the total. */
export function splitAmountIntoShares(total: number, percentages: number[]): number[] {
  const t = round2(total);
  const shares = percentages.map((p) => round2((t * (Number(p) || 0)) / 100));
  if (!shares.length) return shares;
  const residual = round2(t - shares.reduce((s, x) => s + x, 0));
  if (residual !== 0) shares[shares.length - 1] = round2(shares[shares.length - 1] + residual);
  return shares;
}

export type BranchCheck = { ok: boolean; text: string; waiting?: boolean };

/** Can this branch take `percentage` of the bill from its own budget? Advisory — the server is the gate. */
export function branchCheck(branch: BranchSplitBranch | undefined, percentage: number, baseAmount: number): BranchCheck {
  if (!branch) return { ok: false, text: "Unknown branch" };
  if (branch.status === "none") return { ok: false, text: "No Back Office cost centre" };
  if (branch.coverage === undefined) return { ok: false, text: "Checking budget…", waiting: true };
  const cov = branch.coverage;
  if (!cov || !cov.headerActive) return { ok: false, text: "No active budget this month" };
  if (!cov.hasAnyLine) return { ok: false, text: "No budget line for this head" };
  const need = round2((baseAmount * (Number(percentage) || 0)) / 100);
  if (need > 0 && cov.aggregateAvailable + 0.005 < need) {
    return { ok: false, text: `Short by ${money(round2(need - cov.aggregateAvailable))} (has ${money(cov.aggregateAvailable)})` };
  }
  return { ok: true, text: `Budget OK · ${money(cov.aggregateAvailable)} available` };
}

/** The first thing wrong with these shares, or null when they can be saved. */
export function branchSharesError(shares: BranchShareDraft[], options: BranchSplitOptions | undefined, baseAmount = 0): string | null {
  const picked = shares.filter((s) => s.included);
  if (!picked.length) return "Tick at least one branch.";
  for (const share of picked) {
    const branch = options?.branches.find((b) => b.branchId === share.branchId);
    if (!branch) return "A ticked branch is no longer available — reload the page.";
    if (branch.status === "none") return `${branch.branchName} has no active Back Office cost centre, so it cannot receive a share.`;
    if (branch.status === "ambiguous" && !share.costCentreId) return `${branch.branchName}: pick which Back Office cost centre receives the share.`;
    if (!(Number(share.percentage) > 0)) return `${branch.branchName}: enter a share greater than 0%.`;
    const check = branchCheck(branch, share.percentage, baseAmount);
    if (!check.ok && !check.waiting) return `${branch.branchName}: ${check.text}.`;
  }
  const total = round6(picked.reduce((s, x) => s + Number(x.percentage || 0), 0));
  if (Math.abs(total - 100) > 0.5) return `Shares must total 100% (currently ${total}%).`;
  return null;
}

/** What the server's `costCentreSplits` expects for a branch share. */
export const branchSharesPayload = (shares: BranchShareDraft[]) =>
  shares
    .filter((s) => s.included && Number(s.percentage) > 0)
    .map((s) => ({ branchId: s.branchId, costCentreId: s.costCentreId || undefined, percentage: Number(s.percentage) }));

export function BranchSplitSection({
  amount, baseAmount, options, shares, onChange, error, head, subHead,
}: {
  /** What is split and shown against each branch (the invoice total). */
  amount: number;
  /** Ex-GST value the branch budgets are checked against. */
  baseAmount: number;
  options: BranchSplitOptions;
  shares: BranchShareDraft[];
  onChange: (next: BranchShareDraft[]) => void;
  error?: string | null;
  head?: string;
  subHead?: string;
}) {
  const [method, setMethod] = useState<string>("equal_split");
  const [directBranchId, setDirectBranchId] = useState("");
  const receivers = useMemo(() => options.branches.filter((b) => !b.isHeadOffice), [options.branches]);

  // One row per receiving branch, like the cost-centre split lists every cost centre.
  useEffect(() => {
    const have = new Set(shares.map((s) => s.branchId));
    const missing = receivers.filter((b) => !have.has(b.branchId));
    const stale = shares.filter((s) => !receivers.some((b) => b.branchId === s.branchId));
    if (!missing.length && !stale.length) return;
    onChange([...shares.filter((s) => !stale.includes(s)), ...missing.map((b) => newBranchShare(b.branchId))]);
  }, [receivers, shares, onChange]);

  const picked = shares.filter((s) => s.included);
  const amounts = splitAmountIntoShares(amount, shares.map((s) => (s.included ? s.percentage : 0)));
  const total = round6(picked.reduce((s, x) => s + Number(x.percentage || 0), 0));
  const reconciled = Math.abs(total - 100) <= 0.5;
  const byId = (id: string) => options.branches.find((b) => b.branchId === id);

  const equalFor = (rows: BranchShareDraft[]) => {
    const n = rows.filter((r) => r.included).length;
    const each = n ? round6(100 / n) : 0;
    return rows.map((r) => ({ ...r, percentage: r.included ? each : 0 }));
  };

  function update(key: string, patch: Partial<BranchShareDraft>) {
    const next = shares.map((s) => (s.key === key ? { ...s, ...patch } : s));
    if (patch.included === undefined) return onChange(next);
    // Ticking/unticking keeps an untouched (all-equal) split at equal shares; a hand-edited split is left alone.
    const before = shares.filter((s) => s.included);
    const untouched = before.every((s) => s.percentage === before[0].percentage);
    onChange(untouched ? equalFor(next) : next);
  }

  const readiness = useMemo((): { ready: boolean; reason: string } => {
    if (method === "direct") return directBranchId ? { ready: true, reason: "" } : { ready: false, reason: "Select which branch receives this bill." };
    if (picked.length < 2) return { ready: false, reason: "Tick at least 2 branches to split." };
    if (method === "equal_split") return { ready: true, reason: "" };
    const missing = picked.some((s) => weightFor(method, byId(s.branchId)?.drivers ?? undefined) <= 0);
    if (missing) {
      const label = SPLIT_METHODS.find((m) => m.value === method)?.label ?? method;
      return { ready: false, reason: `${label} data is not available for one or more ticked branches. Set drivers in Branch Budget → Plan Builder.` };
    }
    return { ready: true, reason: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, directBranchId, shares, options]);

  function apply() {
    if (!readiness.ready) return;
    if (method === "direct") {
      return onChange(shares.map((s) => ({ ...s, included: s.branchId === directBranchId, percentage: s.branchId === directBranchId ? 100 : 0 })));
    }
    if (method === "equal_split") return onChange(equalFor(shares));
    const weights = shares.map((s) => (s.included ? weightFor(method, byId(s.branchId)?.drivers ?? undefined) : 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    onChange(shares.map((s, i) => ({ ...s, percentage: s.included ? round6((weights[i] / sum) * 100) : 0 })));
  }

  return (
    <GrnCard>
      <GrnCardHeader
        title="Split across branches"
        description={
          <>
            Tick the branches that bear this bill. Each share lands on the branch's <strong>Back Office cost centre</strong> and is funded
            from <strong>that branch's own budget</strong>{head ? <> for {head}{subHead ? ` → ${subHead}` : ""}</> : null}. Head Office keeps only the vendor payable.
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GrnSelect
              aria-label="Split method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 w-[200px] text-[12px]"
              title={!readiness.ready ? readiness.reason : undefined}
            >
              {SPLIT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </GrnSelect>
            {method === "direct" && (
              <GrnSelect aria-label="Branch that receives the bill" value={directBranchId} onChange={(e) => setDirectBranchId(e.target.value)} className="h-9 min-w-[200px] text-[12px]">
                <option value="">Select branch</option>
                {receivers.filter((b) => b.status !== "none").map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
              </GrnSelect>
            )}
            <Button onClick={apply} disabled={!readiness.ready} title={!readiness.ready ? readiness.reason : undefined}>
              <Split className="h-3.5 w-3.5" /> Apply
            </Button>
          </div>
        }
      />
      <GrnTable minWidth={860}>
        <thead>
          <tr>
            <GrnTh><span className="sr-only">Include</span></GrnTh>
            <GrnTh>Branch</GrnTh>
            <GrnTh>Back Office cost centre</GrnTh>
            <GrnTh>Branch budget check</GrnTh>
            <GrnTh align="right">Share %</GrnTh>
            <GrnTh align="right">Amount (incl. GST)</GrnTh>
          </tr>
        </thead>
        <tbody>
          {receivers.length === 0 ? <tr><GrnTd colSpan={6}>No branches available.</GrnTd></tr> : null}
          {shares.map((share, i) => {
            const branch = byId(share.branchId);
            if (!branch) return null;
            const blocked = branch.status === "none";
            const check = branchCheck(branch, share.percentage, baseAmount);
            return (
              <tr key={share.key} className={cn(GRN_TR, !share.included && "opacity-60")}>
                <GrnTd>
                  <Checkbox
                    checked={share.included}
                    disabled={blocked}
                    onCheckedChange={(c) => update(share.key, { included: Boolean(c) })}
                    aria-label={`Include ${branch.branchName} in split`}
                  />
                </GrnTd>
                <GrnTd><span className="font-medium">{branch.branchName}</span></GrnTd>
                <GrnTd>
                  {branch.status === "ok" ? <span className="font-medium">{branch.resolved?.name || branch.resolved?.code}</span>
                    : branch.status === "ambiguous" ? (
                      <GrnSelect
                        aria-label={`${branch.branchName} Back Office cost centre`}
                        aria-invalid={share.included && !share.costCentreId}
                        value={share.costCentreId}
                        onChange={(e) => update(share.key, { costCentreId: e.target.value })}
                        className="h-9 min-w-[220px] text-[12px]"
                      >
                        <option value="">Pick one…</option>
                        {branch.candidates.map((c) => <option key={c.id} value={c.id}>{c.name || c.code}</option>)}
                      </GrnSelect>
                    ) : <span className="font-medium text-rose-700">None — cannot receive a share</span>}
                </GrnTd>
                <GrnTd>
                  {share.included || blocked ? (
                    <span className={cn("text-[12px] font-medium", check.ok ? "text-emerald-700" : check.waiting ? "text-slate-500" : "text-rose-700")}>
                      {check.ok ? "✓ " : check.waiting ? "" : "✕ "}{check.text}
                    </span>
                  ) : <span className="text-[12px] text-slate-500">{branch.coverage ? `${money(branch.coverage.aggregateAvailable)} available` : "—"}</span>}
                </GrnTd>
                <GrnTd align="right">
                  <GrnInput
                    aria-label={`${branch.branchName} share percent`}
                    inputMode="decimal"
                    disabled={!share.included}
                    value={share.included ? share.percentage || "" : ""}
                    onChange={(e) => update(share.key, { percentage: Number(e.target.value) || 0 })}
                    className="h-9 w-24 text-right text-[12px]"
                  />
                </GrnTd>
                <GrnTd align="right"><span className="tabular-nums font-semibold">{share.included ? money(amounts[i] ?? 0) : "—"}</span></GrnTd>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <GrnTd colSpan={4}><strong>Total</strong> <span className="text-[12px] text-slate-500">({picked.length} branch{picked.length === 1 ? "" : "es"})</span></GrnTd>
            <GrnTd align="right">
              <span className={cn("tabular-nums font-semibold", reconciled ? "text-emerald-700" : "text-rose-700")}>
                {total}% {reconciled ? "✓" : "— must be 100%"}
              </span>
            </GrnTd>
            <GrnTd align="right"><span className="tabular-nums font-semibold">{money(amounts.reduce((s, x) => s + x, 0))}</span></GrnTd>
          </tr>
        </tfoot>
      </GrnTable>
      {error ? <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-800">{error}</p> : null}
    </GrnCard>
  );
}

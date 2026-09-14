import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";

export type GrnStatusBucket = { count: number; value: number };

export type GrnSummary = {
  /** Keyed by GRN status — also what the Approval Queue's filter chips count from. */
  byStatus: Record<string, GrnStatusBucket>;
  /** `submitted` + `branch_head_approved`: everything awaiting somebody's decision. */
  inQueue: GrnStatusBucket;
};

const EMPTY_SUMMARY: GrnSummary = { byStatus: {}, inQueue: { count: 0, value: 0 } };

/**
 * Counts and rupee totals for the GRN page header and its filter chips.
 *
 * Deliberately a separate endpoint rather than a client-side sum over the list: /api/finance/grns
 * clamps limit to 100 server-side, so any branch past 100 GRNs would quietly under-report the
 * pending value — an understated money figure on a finance page being worse than none at all.
 */
export function useGrnSummary() {
  return useQuery({
    queryKey: ["grn-summary"],
    queryFn: async () => {
      const response = await hrmsApi.get<any>("/api/finance/grns/summary");
      return ((response?.data ?? response) as GrnSummary) ?? EMPTY_SUMMARY;
    },
  });
}

/**
 * How many GRNs still need a LOB against at least one allocation.
 *
 * Shares the LOB tab's query key on purpose, so opening the page fires one request that serves
 * both the header figure and the tab's own list.
 *
 * The role gate is not cosmetic. GRN_ATTRIBUTION_ROLES on the backend
 * (backend/src/modules/process-pnl/process-lob.routes.ts) omits `finance` and `payroll_head`,
 * yet both reach this page through grnRoles — so calling this unconditionally would hand those
 * two roles a 403 on every page load. Kept in step with that list by hand; the backend, not this,
 * is the actual gate.
 */
export const GRN_ATTRIBUTION_ROLES = [
  "super_admin",
  "admin",
  "finance_head",
  "accounts_head",
  "branch_head",
  "branch_admin",
] as const;

/** True when the caller may read the LOB attribution queue at all. Exported so the tab that
 *  renders the queue and the header count that summarises it cannot drift apart — hiding the
 *  count while still showing the tab left `finance` and `payroll_head` on a 403'd panel. */
export function useCanAttributeGrnLob() {
  return useHasRole(...GRN_ATTRIBUTION_ROLES);
}

export function useGrnNeedsLobCount() {
  const canAttribute = useCanAttributeGrnLob();

  const query = useQuery({
    queryKey: ["pending-grn-lob-attribution"],
    enabled: canAttribute,
    queryFn: async () => {
      const response = await hrmsApi.get<any>(
        "/api/finance/pnl/lobs/grn-attribution/pending?limit=200"
      );
      return (response?.data ?? response ?? []) as unknown[];
    },
  });

  return {
    /** null rather than 0 when the caller may not read it — the header hides the stat instead of
     *  claiming there is nothing to attribute. */
    count: canAttribute ? (query.data?.length ?? null) : null,
    isLoading: query.isLoading,
  };
}

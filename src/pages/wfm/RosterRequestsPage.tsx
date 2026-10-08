/**
 * Roster Requests — one inbox for everything raised against a published roster.
 *
 * Replaces the bare NativeRosterManagerQueue that /wfm/roster-requests pointed at, keeping the same
 * URL so the route does not move. Composition, not a rewrite: both tabs render existing pages
 * unchanged, and their original routes stay registered.
 *
 * The two halves are genuinely one job: an employee rejects a day (My Roster) and a manager settles
 * it here, or two employees want to swap and a manager approves that here. Splitting them across
 * two menu entries is why the second one was never wired up at all.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import { RequestList } from "./roster-requests/RequestList";
import { ImpactPanel } from "./roster-requests/ImpactPanel";
import { ActionBar } from "./roster-requests/ActionBar";
import { BulkBar } from "./roster-requests/BulkBar";
import { BULK_KINDS } from "./roster-requests/actions";
import { useDecide } from "./roster-requests/useDecide";
import { useKeyboardNav } from "./roster-requests/useKeyboardNav";
import { AutoRulesPanel } from "./roster-requests/AutoRulesPanel";
import { findDeepLinked, parseDeepLink } from "./roster-requests/deepLink";
import { useHasRole } from "@/hooks/useUserRole";
import { useApprovalFocus } from "@/hooks/useApprovalFocus";
import { useToast } from "@/hooks/use-toast";
import { useRosterRequests } from "./roster-requests/useRosterRequests";
import { KIND_LABEL, type RequestKind, type RosterRequest } from "./roster-requests/types";

const ManagerQueue  = lazy(() => import("@/pages/NativeRosterManagerQueue"));
const WFMExtensions = lazy(() => import("@/pages/NativeWFMExtensions"));

const TABS = [
  {
    value: "disputes",
    label: "Disputes & week-offs",
    blurb: "Roster disputes, and the week-offs employees have rejected and need a decision on.",
    Component: ManagerQueue,
  },
  {
    value: "swaps",
    label: "Swaps & conflicts",
    blurb: "Shift-swap requests between employees, and roster conflicts needing resolution.",
    Component: WFMExtensions,
  },
];

const DEFAULT_TAB = TABS[0].value;

export default function RosterRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = useMemo(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.value === requested) ? (requested as string) : DEFAULT_TAB;
  }, [searchParams]);
  const activeTab = TABS.find((t) => t.value === active) ?? TABS[0];

  const { requests, isLoading, errors } = useRosterRequests();
  const deepLink = useMemo(() => parseDeepLink(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [kindFilter, setKindFilter] = useState<RequestKind | "all">(deepLink.kind ?? "all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const canEditRules = useHasRole("admin", "hr", "wfm", "ho_wfm");
  const deepLinkDone = useRef(false);
  useApprovalFocus(!isLoading);
  useEffect(() => {
    if (deepLinkDone.current || isLoading || !deepLink.id) return;
    deepLinkDone.current = true;
    const hit = findDeepLinked(requests, deepLink);
    if (hit) { setKindFilter(hit.kind); setSelectedKey(hit.key); }
  }, [isLoading, requests, deepLink]);
  const kinds = Object.keys(KIND_LABEL) as RequestKind[];
  const visible = useMemo(
    () => (kindFilter === "all" ? requests : requests.filter((r) => r.kind === kindFilter)),
    [requests, kindFilter],
  );
  const selected = visible.find((r) => r.key === selectedKey) ?? null;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rejectSignal, setRejectSignal] = useState(0);
  const decide = useDecide();
  const { toast } = useToast();
  const checkedItems = visible.filter((r) => checked.has(r.key) && BULK_KINDS.includes(r.kind));
  const toggle = (r: RosterRequest) =>
    setChecked((prev) => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; });

  /** After a decision, move to the next request in the list (or the previous if it was last). */
  const advance = (done: RosterRequest) => {
    const i = visible.findIndex((r) => r.key === done.key);
    setSelectedKey((visible[i + 1] ?? visible[i - 1])?.key ?? null);
  };
  const quickApprove = (r: RosterRequest) =>
    decide.mutate({ kind: r.kind, id: r.id, action: "approve" }, {
      onSuccess: () => { toast({ title: "Approved", description: r.employeeName }); advance(r); },
      onError: (e) => toast({ title: "Could not approve", description: (e as Error).message, variant: "destructive" }),
    });
  const onKeyDown = useKeyboardNav({
    visible, selected, select: (r) => setSelectedKey(r.key), approve: quickApprove, focusReject: () => setRejectSignal((n) => n + 1),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">WFM · Roster</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Roster Requests</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Everything raised against a published roster, waiting on a decision.
          </p>
        </div>

        {errors.length > 0 ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Could not load: {errors.join(", ")}. The list below may be incomplete.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by request type"
            className="rounded border bg-white px-2 py-1 text-sm"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as RequestKind | "all")}
          >
            <option value="all">All types</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          {kinds.map((k) => (
            <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {KIND_LABEL[k]}: {requests.filter((r) => r.kind === k).length}
            </span>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {isLoading ? (
            <div className="flex items-center gap-3 rounded-lg border p-10 text-slate-500">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">Loading requests…</span>
            </div>
          ) : (
            <div className="space-y-2" tabIndex={0} onKeyDown={onKeyDown} aria-label="Roster requests list (keyboard enabled)">
              <BulkBar items={checkedItems} onDone={() => setChecked(new Set())} />
              <RequestList requests={visible} selectedKey={selectedKey} onSelect={(r) => setSelectedKey(r.key)}
                checkedKeys={checked} onToggle={toggle} canCheck={(r) => BULK_KINDS.includes(r.kind)} />
              <p className="text-xs text-slate-400">j/k move · a approve · r reject</p>
            </div>
          )}
          <div className="rounded-lg border bg-white">
            {selected ? (
              <>
                <ImpactPanel request={selected} />
                <ActionBar request={selected} onDecided={advance} rejectFocusSignal={rejectSignal} />
              </>
            ) : <div className="p-10 text-center text-sm text-slate-500">Select a request to see its roster impact.</div>}
          </div>
        </div>

        {canEditRules ? (
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Auto-approve rules</summary>
            <AutoRulesPanel />
          </details>
        ) : null}

        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Decide in classic view</summary>
        <div className="mt-4">
        <Tabs
          value={active}
          onValueChange={(next) =>
            setSearchParams(next === DEFAULT_TAB ? {} : { tab: next }, { replace: true })
          }
        >
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <p className="mt-3 text-sm text-slate-500">{activeTab.blurb}</p>

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span className="text-sm font-medium">Loading…</span>
                  </div>
                }
              >
                <t.Component />
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
        </div>
        </details>
      </div>
    </DashboardLayout>
  );
}

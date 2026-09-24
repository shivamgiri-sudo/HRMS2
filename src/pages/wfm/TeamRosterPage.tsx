import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, UsersRound } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MyTeamRosterTab from "@/components/wfm/team-roster/MyTeamRosterTab";
import SubmissionDrawer from "@/components/wfm/team-roster/SubmissionDrawer";
import SubmissionsTable from "@/components/wfm/team-roster/SubmissionsTable";
import TeamAttendanceTab from "@/components/wfm/team-roster/TeamAttendanceTab";
import { SUBMISSION_STATUS_FILTERS, STATUS_META, unpackError } from "@/components/wfm/team-roster/teamRosterFormat";
import { useApprovals, useMySubmissions, useTeamRosterMe, type TeamRosterMe } from "@/hooks/useTeamRoster";

type TabKey = "roster" | "attendance" | "submissions" | "approvals";

/** Which tabs this caller gets. Pure so the audience rules are testable without rendering. */
export function visibleTabs(me: Pick<TeamRosterMe, "isManager" | "canApproveManagerStep" | "canApproveWfmStep">): TabKey[] {
  const tabs: TabKey[] = [];
  if (me.isManager) tabs.push("roster", "attendance", "submissions");
  if (me.canApproveManagerStep || me.canApproveWfmStep) tabs.push("approvals");
  return tabs;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 md:p-6">
        <header className="flex items-center gap-3">
          <span className="rounded-xl bg-blue-50 p-2 text-blue-700"><UsersRound className="h-5 w-5" aria-hidden /></span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Team Roster</h1>
            <p className="text-sm text-slate-500">Fill and change your team's roster. Every change is approved before it is applied.</p>
          </div>
        </header>
        {children}
      </div>
    </DashboardLayout>
  );
}

function MySubmissionsTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const q = useMySubmissions(status, offset);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="tr-status" className="text-sm text-slate-500">Status</label>
        <select id="tr-status" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="all">All</option>
          {SUBMISSION_STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>
      <SubmissionsTable data={q.data} isLoading={q.isLoading} isError={q.isError} showSubmitter={false} onOpen={onOpen} onPage={setOffset}
        emptyText="You have not submitted anything yet." />
    </div>
  );
}

function ApprovalsTab({ me, onOpen }: { me: TeamRosterMe; onOpen: (id: number) => void }) {
  const both = me.canApproveManagerStep && me.canApproveWfmStep;
  const [step, setStep] = useState<"manager" | "wfm">(me.canApproveManagerStep ? "manager" : "wfm");
  const [offset, setOffset] = useState(0);
  const q = useApprovals(step, offset, true);
  return (
    <div className="space-y-3">
      {both && (
        <div className="flex gap-2" role="group" aria-label="Approval step">
          <Button size="sm" variant={step === "manager" ? "default" : "outline"} onClick={() => { setStep("manager"); setOffset(0); }}>Awaiting me as manager</Button>
          <Button size="sm" variant={step === "wfm" ? "default" : "outline"} onClick={() => { setStep("wfm"); setOffset(0); }}>Awaiting WFM approval</Button>
        </div>
      )}
      {q.isError && <p className="text-sm text-red-600">{unpackError(q.error).message}</p>}
      <SubmissionsTable data={q.data} isLoading={q.isLoading} isError={false} showSubmitter onOpen={onOpen} onPage={setOffset}
        emptyText="Nothing is waiting for your approval." />
    </div>
  );
}

export default function TeamRosterPage() {
  const me = useTeamRosterMe();
  const [params, setParams] = useSearchParams();
  const [drawerId, setDrawerId] = useState<number | null>(() => {
    const n = Number(params.get("submission"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [tabOverride, setTabOverride] = useState<TabKey | null>(null);

  if (me.isLoading) {
    return <Shell><div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" aria-label="Loading" /></div></Shell>;
  }
  if (me.isError || !me.data) {
    return <Shell><p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load your team roster access. {me.error ? unpackError(me.error).message : ""}</p></Shell>;
  }
  const data = me.data;
  const tabs = visibleTabs(data);
  if (tabs.length === 0) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">You have no team members</h2>
          <p className="mt-1 text-sm text-slate-500">
            This page is for people who have employees reporting to them. If you manage a team and are seeing this,
            your reporting line is not recorded against you; HR can correct it.
          </p>
        </div>
      </Shell>
    );
  }

  const wanted = (params.get("tab") as TabKey | null) ?? tabOverride;
  const active: TabKey = wanted && tabs.includes(wanted) ? wanted : tabs[0];
  const openTab = (t: string) => { setTabOverride(t as TabKey); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); n.delete("submission"); return n; }, { replace: true }); };

  return (
    <Shell>
      <Tabs value={active} onValueChange={openTab}>
        <TabsList className="h-auto flex-wrap">
          {tabs.includes("roster") && <TabsTrigger value="roster">My Team Roster</TabsTrigger>}
          {tabs.includes("attendance") && <TabsTrigger value="attendance">Team Attendance</TabsTrigger>}
          {tabs.includes("submissions") && <TabsTrigger value="submissions">My Submissions</TabsTrigger>}
          {tabs.includes("approvals") && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
        </TabsList>
        {tabs.includes("roster") && (
          <TabsContent value="roster" className="mt-4">
            <MyTeamRosterTab me={data} onSubmitted={(id) => { openTab("submissions"); setDrawerId(id); }} />
          </TabsContent>
        )}
        {tabs.includes("attendance") && <TabsContent value="attendance" className="mt-4"><TeamAttendanceTab me={data} /></TabsContent>}
        {tabs.includes("submissions") && <TabsContent value="submissions" className="mt-4"><MySubmissionsTab onOpen={setDrawerId} /></TabsContent>}
        {tabs.includes("approvals") && <TabsContent value="approvals" className="mt-4"><ApprovalsTab me={data} onOpen={setDrawerId} /></TabsContent>}
      </Tabs>
      <SubmissionDrawer id={drawerId} onClose={() => setDrawerId(null)} onCopiedToDraft={() => openTab("roster")} />
    </Shell>
  );
}

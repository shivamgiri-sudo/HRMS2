// src/pages/NativeAttendanceRulesMaster.tsx
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { SourceTab } from "@/components/attendance-rules/SourceTab";
import { ThresholdsTab } from "@/components/attendance-rules/ThresholdsTab";
import { EmployeeCheck } from "@/components/attendance-rules/EmployeeCheck";
import type {
  AttendanceLogic, AttendanceRule, Branch, DayThresholdsInForce, Designation, Process, ProcessLogicRow,
} from "@/components/attendance-rules/types";
import { LOGIC_META } from "@/components/attendance-rules/types";

type Envelope<T> = { success: boolean; data: T };

export default function NativeAttendanceRulesMaster() {
  const { toast } = useToast();
  // The write endpoints are admin-only on the server; HR and WFM can read everything here.
  const canEdit = useHasRole("admin", "super_admin");

  const [rules, setRules] = useState<AttendanceRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [logicRows, setLogicRows] = useState<ProcessLogicRow[]>([]);
  const [logicLoading, setLogicLoading] = useState(true);
  const [savingProcessId, setSavingProcessId] = useState<string | null>(null);
  const [inForce, setInForce] = useState<DayThresholdsInForce | null>(null);

  const reloadRules = useCallback(async () => {
    const res = await hrmsApi.get<Envelope<AttendanceRule[]>>("/api/wfm/attendance/rules");
    setRules(res.data ?? []);
  }, []);

  const loadLogic = useCallback(async () => {
    setLogicLoading(true);
    try {
      const res = await hrmsApi.get<Envelope<ProcessLogicRow[]>>("/api/wfm/attendance/attendance-logic");
      setLogicRows(res.data ?? []);
    } catch {
      toast({ title: "Failed to load attendance sources", variant: "destructive" });
    } finally {
      setLogicLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void loadLogic();
    (async () => {
      setRulesLoading(true);
      try {
        const [rulesRes, orgRes, procRes] = await Promise.all([
          hrmsApi.get<Envelope<AttendanceRule[]>>("/api/wfm/attendance/rules"),
          hrmsApi.get<Envelope<{ designations?: Designation[]; branches?: Branch[] }>>("/api/org"),
          hrmsApi.get<Envelope<Process[]>>("/api/processes"),
        ]);
        if (cancelled) return;
        setRules(rulesRes.data ?? []);
        setDesignations(orgRes.data?.designations ?? []);
        setBranches(orgRes.data?.branches ?? []);
        setProcesses(procRes.data ?? []);
      } catch {
        toast({ title: "Failed to load threshold rules", variant: "destructive" });
      } finally {
        if (!cancelled) setRulesLoading(false);
      }
      try {
        const res = await hrmsApi.get<Envelope<DayThresholdsInForce>>("/api/wfm/attendance/attendance-logic/thresholds-in-force");
        if (!cancelled) setInForce(res.data);
      } catch { /* the cards simply stay hidden */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeLogic = async (row: ProcessLogicRow, next: AttendanceLogic) => {
    setSavingProcessId(row.process_id);
    try {
      await hrmsApi.put(`/api/wfm/attendance/attendance-logic/${row.process_id}`, { attendance_logic: next });
      toast({
        title: `${row.process_name} is now ${LOGIC_META[next].short}`,
        description: "Applies from the next attendance run. Rebuild a past month to restate it.",
      });
      await loadLogic();
    } catch {
      toast({ title: "Could not change the source", variant: "destructive" });
    } finally {
      setSavingProcessId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div className="hrms-page-header">
          <div>
            <h1 className="hrms-page-title">Attendance Rules</h1>
            <p className="hrms-page-subtitle">
              Choose which feed builds attendance, and so salary, for each process: APR (dialler), COSEC (biometric) or both.
            </p>
          </div>
        </div>

        <Tabs defaultValue="source" className="space-y-5">
          <TabsList>
            <TabsTrigger value="source">Source of attendance</TabsTrigger>
            <TabsTrigger value="thresholds">Day thresholds</TabsTrigger>
            <TabsTrigger value="employee">Check an employee</TabsTrigger>
          </TabsList>

          <TabsContent value="source">
            <SourceTab rows={logicRows} loading={logicLoading} canEdit={canEdit}
              savingProcessId={savingProcessId} onChange={changeLogic} />
          </TabsContent>
          <TabsContent value="thresholds">
            <ThresholdsTab rules={rules} loading={rulesLoading} canEdit={canEdit} inForce={inForce}
              designations={designations} processes={processes} branches={branches} reload={reloadRules} />
          </TabsContent>
          <TabsContent value="employee">
            <EmployeeCheck canEdit={canEdit} onChanged={() => void loadLogic()} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Loader2, User, Users, ArrowUp, AlertTriangle, Building2, Network, Briefcase } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface NodeDetailData {
  employee: Record<string, any>;
  reporting_chain: Array<{
    id: string;
    name: string;
    designation: string | null;
    employee_code: string;
  }>;
  direct_reports: Array<{
    id: string;
    name: string;
    designation: string | null;
    employee_code: string;
  }>;
  data_quality_issues: string[];
}

interface OrgNodeDetailsDrawerProps {
  employeeId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onJumpToManager?: (managerId: string) => void;
  onJumpToEmployee?: (employeeId: string) => void;
}

export function OrgNodeDetailsDrawer({
  employeeId,
  isOpen,
  onClose,
  onJumpToManager,
  onJumpToEmployee,
}: OrgNodeDetailsDrawerProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["org-chart-node", employeeId],
    queryFn: () => hrmsApi.get<NodeDetailData>(`/api/org-chart/node/${employeeId}`),
    enabled: !!employeeId && isOpen,
    staleTime: 30_000,
  });

  if (!isOpen || !employeeId) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:w-[540px] sm:max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg font-bold text-[#1B3A5C]">Employee Details</SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-red-500">Failed to load employee details.</p>
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-6">
            {/* Employee card */}
            <div className="flex items-start gap-4 p-4 bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-xl">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-[#1B3A5C] to-[#2a5a7a] text-white font-bold text-lg flex-shrink-0">
                {data.employee.photo_url ? (
                  <img
                    src={data.employee.photo_url}
                    alt={data.employee.full_name || data.employee.first_name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span>
                    {(data.employee.first_name?.[0] || "").toUpperCase()}
                    {(data.employee.last_name?.[0] || "").toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-800 truncate">
                  {data.employee.full_name || `${data.employee.first_name} ${data.employee.last_name || ""}`.trim()}
                </h3>
                {data.employee.designation_name && (
                  <p className="text-sm text-slate-600 mt-0.5">{data.employee.designation_name}</p>
                )}
                {data.employee.employee_code && (
                  <p className="text-xs text-slate-400 mt-1">{data.employee.employee_code}</p>
                )}
                {data.employee.employment_status && (
                  <Badge
                    variant={data.employee.employment_status === "Active" ? "default" : "secondary"}
                    className="mt-2"
                  >
                    {data.employee.employment_status}
                  </Badge>
                )}
              </div>
            </div>

            {/* Org Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-slate-400" />
                Organization
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {data.employee.branch_name && (
                  <div className="flex items-start gap-2">
                    <Building2 className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500">Branch</p>
                      <p className="text-sm font-medium text-slate-700">{data.employee.branch_name}</p>
                    </div>
                  </div>
                )}
                {data.employee.process_name && (
                  <div className="flex items-start gap-2">
                    <Network className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500">Process</p>
                      <p className="text-sm font-medium text-slate-700">{data.employee.process_name}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Reporting Chain */}
            {data.reporting_chain.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <ArrowUp className="h-4 w-4 text-slate-400" />
                  Reporting Chain ({data.reporting_chain.length})
                </h4>
                <div className="space-y-2">
                  {data.reporting_chain.slice(0, 5).map((manager) => (
                    <button
                      key={manager.id}
                      onClick={() => {
                        onJumpToEmployee?.(manager.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors text-left"
                    >
                      <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{manager.name}</p>
                        {manager.designation && (
                          <p className="text-xs text-slate-500 truncate">{manager.designation}</p>
                        )}
                      </div>
                    </button>
                  ))}
                  {data.reporting_chain.length > 5 && (
                    <p className="text-xs text-slate-400 text-center">+{data.reporting_chain.length - 5} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Direct Reports */}
            {data.direct_reports.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-400" />
                    Direct Reports ({data.direct_reports.length})
                  </h4>
                  <div className="space-y-2">
                    {data.direct_reports.slice(0, 10).map((report) => (
                      <button
                        key={report.id}
                        onClick={() => {
                          onJumpToEmployee?.(report.id);
                          onClose();
                        }}
                        className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors text-left"
                      >
                        <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{report.name}</p>
                          {report.designation && (
                            <p className="text-xs text-slate-500 truncate">{report.designation}</p>
                          )}
                        </div>
                      </button>
                    ))}
                    {data.direct_reports.length > 10 && (
                      <p className="text-xs text-slate-400 text-center">+{data.direct_reports.length - 10} more</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Data Quality Issues */}
            {data.data_quality_issues.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    Data Quality Issues
                  </h4>
                  <div className="space-y-2">
                    {data.data_quality_issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 bg-orange-50 border border-orange-200 rounded-lg"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-orange-700">{issue}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Jump to Manager button */}
            {data.reporting_chain.length > 0 && onJumpToManager && (
              <Button
                onClick={() => {
                  onJumpToManager(data.reporting_chain[0].id);
                  onClose();
                }}
                variant="outline"
                className="w-full"
              >
                Jump to Manager
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

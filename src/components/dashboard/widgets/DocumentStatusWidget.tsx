import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

interface Props { employeeId: string; }

const DOC_TYPES = ["aadhaar_card", "pan_card", "bank_passbook", "address_proof"];
const DOC_LABELS: Record<string, string> = {
  aadhaar_card: "Aadhaar Card", pan_card: "PAN Card",
  bank_passbook: "Bank Passbook", address_proof: "Address Proof",
};

export function DocumentStatusWidget({ employeeId }: Props) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["employee-docs", employeeId],
    queryFn: () => hrmsApi.get(`/api/employee-docs/${employeeId}`),
    enabled: !!employeeId,
    staleTime: 1000 * 60 * 10,
  });
  const docs: any[] = Array.isArray(data?.data) ? data.data : [];
  const docMap: Record<string, boolean> = {};
  docs.forEach(d => { docMap[d.document_type] = !!d.verified; });

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-slate-600" />
          </div>
          <CardTitle className="text-sm font-bold text-slate-900">Documents Status</CardTitle>
        </div>
        <Link to="/profile" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
      </CardHeader>
      <CardContent className="p-5 space-y-3">
        {isLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : (
          DOC_TYPES.map(type => {
            const verified = docMap[type];
            const uploaded = docs.some(d => d.document_type === type);
            return (
              <div key={type} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{DOC_LABELS[type]}</span>
                {verified ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> Verified
                  </span>
                ) : uploaded ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    <Clock className="w-3 h-3" /> Pending
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Not Uploaded</span>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

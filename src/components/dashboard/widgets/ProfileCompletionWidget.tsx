import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const PROFILE_CHECKS = [
  { key: "personal_info",   label: "Personal Information",  fields: ["first_name","date_of_birth","gender"] },
  { key: "contact",         label: "Contact Information",   fields: ["personal_phone","personal_email"] },
  { key: "emergency",       label: "Emergency Contact",     fields: ["emergency_contact_name"] },
  { key: "bank",            label: "Bank Details",          fields: ["bank_account_number"] },
];

export function ProfileCompletionWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["employee-me"],
    queryFn: () => hrmsApi.get("/api/employees/me"),
    staleTime: 1000 * 60 * 10,
  });
  const profile = data?.data ?? {};

  const checks = PROFILE_CHECKS.map(c => ({
    ...c,
    done: c.fields.some(f => !!(profile as any)[f]),
  }));
  const done = checks.filter(c => c.done).length;
  const pct = Math.round((done / checks.length) * 100);

  const circumference = 2 * Math.PI * 28;
  const strokeDash = (pct / 100) * circumference;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">Profile Completion</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : (
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="28" fill="none" stroke="#e2e8f0" strokeWidth="6" />
                <circle cx="36" cy="36" r="28" fill="none" stroke="#3BAD49" strokeWidth="6"
                  strokeDasharray={`${strokeDash} ${circumference}`} strokeLinecap="round"
                  transform="rotate(-90 36 36)" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>{pct}%</span>
                <span className="text-[8px] text-slate-500 font-medium">Complete</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {done === checks.length && <p className="text-xs text-emerald-600 font-semibold">Great job! Almost there.</p>}
              {checks.map(c => (
                <div key={c.key} className="flex items-center gap-2">
                  {c.done
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    : <Circle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                  <span className={`text-xs ${c.done ? "text-slate-600" : "text-amber-600 font-medium"}`}>{c.label}</span>
                </div>
              ))}
              <Link to="/profile" className="text-xs font-semibold text-[#1B6AB5] hover:underline mt-2 block">Update Profile →</Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

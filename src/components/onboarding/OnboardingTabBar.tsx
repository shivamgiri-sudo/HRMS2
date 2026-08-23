import { useNavigate, useLocation } from "react-router-dom";
import { ClipboardList, Settings2, FileText, BadgeCheck } from "lucide-react";

const TABS = [
  {
    label: "Requests",
    path: "/ats/onboarding-requests",
    icon: ClipboardList,
    description: "Candidate profiles, BGV, offers",
  },
  {
    label: "Joining Ops",
    path: "/ats/joining-control-room",
    icon: Settings2,
    description: "JCLR, statutory, effective dates",
  },
  {
    label: "Documents",
    path: "/ats/joining-documents-tracker",
    icon: FileText,
    description: "Joining doc completion tracker",
  },
  {
    label: "Appointment Letters",
    path: "/provisioning/appointment-letter",
    icon: BadgeCheck,
    description: "Issue & track appointment letters",
  },
] as const;

export function OnboardingTabBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {TABS.map(({ label, path, icon: Icon }) => {
        const active = pathname === path || pathname.startsWith(path + "/");
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150 ${
              active
                ? "bg-blue-600 text-white shadow-sm"
                : "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

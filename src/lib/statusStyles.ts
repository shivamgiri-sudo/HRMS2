/** Shared Tailwind class maps for entity status badges — import these instead of redefining. */

export const employeeStatusStyles: Record<string, string> = {
  active:     "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive:   "bg-muted text-muted-foreground border-border",
  onboarding: "bg-primary/10 text-primary border-primary/20",
  offboarded: "bg-destructive/10 text-destructive border-destructive/20",
};

export const attendanceStatusColors: Record<string, string> = {
  present:    "bg-emerald-500 hover:bg-emerald-600 text-white",
  late:       "bg-amber-500 hover:bg-amber-600 text-white",
  absent:     "bg-red-500 hover:bg-red-600 text-white",
  "half-day": "bg-sky-500 hover:bg-sky-600 text-white",
  leave:      "bg-blue-500 hover:bg-blue-600 text-white",
  holiday:    "bg-purple-500 hover:bg-purple-600 text-white",
  weekend:    "bg-gray-300 hover:bg-gray-400 text-gray-700",
};

export const performanceStatusColors: Record<string, string> = {
  draft:        "bg-muted text-muted-foreground",
  submitted:    "bg-primary/10 text-primary border-primary/20",
  acknowledged: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export const goalStatusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary border-primary/20",
  completed:   "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled:   "bg-destructive/10 text-destructive border-destructive/20",
};

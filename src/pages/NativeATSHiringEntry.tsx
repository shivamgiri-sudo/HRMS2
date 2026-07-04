import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Clock3,
  PhoneCall,
  RefreshCw,
  Save,
  Target,
  UserRound,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type HiringActivityRow = Record<string, any>;

type BootstrapResponse = {
  actor: {
    userId: string;
    recruiterName: string;
    recruiterEmployeeId: string | null;
    recruiterCode: string | null;
    branchName: string;
    activityDate: string;
    activityMonth: string;
  };
  options: {
    processOptions: string[];
    sourceOptions: string[];
    positionOptions: string[];
    wpGroupOptions: string[];
    callingOutcomeOptions: string[];
    genderOptions: string[];
    educationOptions: string[];
    experienceOptions: string[];
  };
};

type HiringDashboard = {
  metrics: {
    total_records: number;
    total_contacted: number;
    contacted_pct: number;
    not_contacted: number;
    shortlisted: number;
    recruiter_rejected: number;
    final_selected: number;
    joined: number;
    walkins: number;
  };
};

type HiringListResponse = {
  success: boolean;
  data: HiringActivityRow[];
  total: number;
  page: number;
  limit: number;
};

type HiringDashboardResponse = {
  success: boolean;
  data: HiringDashboard;
};

type BootstrapApiResponse = {
  success: boolean;
  data: BootstrapResponse;
};

type FormState = {
  process_name: string;
  hiring_source: string;
  position_name: string;
  wp_group: string;
  candidate_name: string;
  mobile: string;
  candidate_email: string;
  gender: string;
  education_qualification: string;
  experience_level: string;
  candidate_location: string;
  recruiter_remarks: string;
  recruiter_rejection_reason: string;
};

const EMPTY_FORM: FormState = {
  process_name: "",
  hiring_source: "",
  position_name: "",
  wp_group: "",
  candidate_name: "",
  mobile: "",
  candidate_email: "",
  gender: "",
  education_qualification: "",
  experience_level: "",
  candidate_location: "",
  recruiter_remarks: "",
  recruiter_rejection_reason: "",
};

const FIELD_ORDER: Array<keyof FormState> = [
  "process_name",
  "hiring_source",
  "position_name",
  "wp_group",
  "candidate_name",
  "mobile",
  "candidate_email",
  "gender",
  "education_qualification",
  "experience_level",
  "candidate_location",
  "recruiter_remarks",
  "recruiter_rejection_reason",
];

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function normalizeText(value: string) {
  return value.trim();
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function isArrived(row: HiringActivityRow) {
  const status = String(row.current_status ?? "").toLowerCase();
  return Boolean(
    row.linked_candidate_id ||
    row.queue_token_id ||
    row.walkin_flag === 1 ||
    row.walkin_flag === "1" ||
    status.includes("arrived") ||
    status.includes("waiting")
  );
}

function isSelected(row: HiringActivityRow) {
  return Boolean(
    row.final_selection_flag === 1 ||
    row.final_selection_flag === "1" ||
    String(row.current_status ?? "").toLowerCase().includes("selected")
  );
}

function statusTone(row: HiringActivityRow) {
  if (isSelected(row)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (isArrived(row)) return "bg-sky-50 text-sky-700 border-sky-200";
  if (String(row.recruiter_remarks ?? "").toLowerCase() === "rejected") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
          <div className="mt-2 text-sm text-slate-600">{hint}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  help,
  required,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        <span>{label}</span>
        {required ? <span className="text-rose-500">*</span> : null}
      </div>
      {children}
      {help ? <div className="text-xs text-slate-500">{help}</div> : null}
    </label>
  );
}

export default function NativeATSHiringEntry() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [rows, setRows] = useState<HiringActivityRow[]>([]);
  const [dashboard, setDashboard] = useState<HiringDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const fieldRefs = useRef<Partial<Record<keyof FormState, HTMLElement | null>>>({});

  const isCalling = useMemo(() => window.location.pathname.includes("/calling-entry"), []);

  const assignFieldRef = (key: keyof FormState) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  };

  const focusField = (key: keyof FormState) => {
    fieldRefs.current[key]?.focus();
  };

  const moveToNextField = (key: keyof FormState) => {
    const currentIndex = FIELD_ORDER.indexOf(key);
    const nextKey = FIELD_ORDER[currentIndex + 1];
    if (nextKey) focusField(nextKey);
  };

  const handleKeyAdvance = (key: keyof FormState) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || key === "recruiter_rejection_reason") return;
    event.preventDefault();
    moveToNextField(key);
  };

  const updateForm = (key: keyof FormState, value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: key === "mobile" ? digitsOnly(value) : value,
    }));
  };

  const clearCandidateFields = () => {
    setForm((prev) => ({
      ...prev,
      candidate_name: "",
      mobile: "",
      candidate_email: "",
      gender: "",
      education_qualification: "",
      experience_level: "",
      candidate_location: "",
      recruiter_remarks: "",
      recruiter_rejection_reason: "",
    }));
    setValidationErrors([]);
    window.setTimeout(() => focusField("candidate_name"), 0);
  };

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setValidationErrors([]);
    setMessage("");
    window.setTimeout(() => focusField("process_name"), 0);
  };

  const loadPageData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [bootstrapRes, rowsRes, dashboardRes] = await Promise.all([
        hrmsApi.get<BootstrapApiResponse>("/api/ats/recruiter/hiring-activity/bootstrap"),
        hrmsApi.get<HiringListResponse>("/api/ats/recruiter/hiring-activity?limit=12&page=1"),
        hrmsApi.get<HiringDashboardResponse>("/api/ats/recruiter/hiring-dashboard"),
      ]);
      setBootstrap(bootstrapRes.data);
      setRows(rowsRes.data ?? []);
      setDashboard(dashboardRes.data ?? null);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load hiring entry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    if (bootstrap && !loading) {
      window.setTimeout(() => focusField("process_name"), 0);
    }
  }, [bootstrap, loading]);

  const sourceOptions = bootstrap?.options.sourceOptions ?? [];
  const processOptions = bootstrap?.options.processOptions ?? [];
  const positionOptions = bootstrap?.options.positionOptions ?? [];
  const wpGroupOptions = bootstrap?.options.wpGroupOptions ?? [];
  const outcomeOptions = bootstrap?.options.callingOutcomeOptions ?? [];
  const genderOptions = bootstrap?.options.genderOptions ?? [];
  const educationOptions = bootstrap?.options.educationOptions ?? [];
  const experienceOptions = bootstrap?.options.experienceOptions ?? [];

  const turnoutRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.walkins / dashboard.metrics.total_records) * 1000) / 10
    : 0;

  const selectedRate = dashboard?.metrics.total_records
    ? Math.round((dashboard.metrics.final_selected / dashboard.metrics.total_records) * 1000) / 10
    : 0;

  const validate = () => {
    const errors: string[] = [];
    if (!normalizeText(form.process_name)) errors.push("Process name is required.");
    if (!normalizeText(form.hiring_source)) errors.push("Hiring source is required.");
    if (!normalizeText(form.position_name)) errors.push("Position is required.");
    if (!normalizeText(form.wp_group)) errors.push("WP group is required.");
    if (!normalizeText(form.candidate_name)) errors.push("Candidate name is required.");
    if (digitsOnly(form.mobile).length !== 10) errors.push("Enter a valid 10-digit mobile number.");
    if (!normalizeText(form.recruiter_remarks)) errors.push("Calling outcome is required.");

    const normalizedOutcome = normalizeText(form.recruiter_remarks).toLowerCase();
    if ((normalizedOutcome === "rejected" || normalizedOutcome === "not contacted") && !normalizeText(form.recruiter_rejection_reason)) {
      errors.push("Reason is required when outcome is Rejected or Not Contacted.");
    }

    const email = normalizeText(form.candidate_email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Enter a valid email address or leave it blank.");
    }

    return errors;
  };

  const saveEntry = async () => {
    const errors = validate();
    setValidationErrors(errors);
    setMessage("");
    if (errors.length) return;

    setSaving(true);
    try {
      const payload = {
        ...form,
        process_name: normalizeText(form.process_name),
        hiring_source: normalizeText(form.hiring_source),
        position_name: normalizeText(form.position_name),
        wp_group: normalizeText(form.wp_group),
        candidate_name: normalizeText(form.candidate_name),
        mobile: digitsOnly(form.mobile),
        candidate_email: normalizeText(form.candidate_email),
        gender: normalizeText(form.gender),
        education_qualification: normalizeText(form.education_qualification),
        experience_level: normalizeText(form.experience_level),
        candidate_location: normalizeText(form.candidate_location),
        recruiter_remarks: normalizeText(form.recruiter_remarks),
        recruiter_rejection_reason: normalizeText(form.recruiter_rejection_reason),
        source_system: "HRMS",
        duplicateMode: "update_existing",
      };

      const res = await hrmsApi.post<{ success: boolean; data: { action?: string; row?: HiringActivityRow } }>(
        "/api/ats/recruiter/hiring-activity",
        payload
      );

      const action = res.data?.action ?? "saved";
      setMessage(action === "updated" ? "Existing entry updated for this candidate." : "Calling entry saved.");
      clearCandidateFields();
      await loadPageData();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">
              {isCalling ? "Recruiter Calling Entry" : "Recruiter Hiring Entry"}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Fast pre-walk-in calling form
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Recruiter, branch, date, and month are captured automatically from the logged-in profile. Use <span className="font-semibold text-slate-900">Tab</span> or <span className="font-semibold text-slate-900">Enter</span> to move quickly across fields.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadPageData()}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Clear all
            </button>
          </div>
        </div>

        {message ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
            {message}
          </div>
        ) : null}

        {validationErrors.length ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="font-bold">Please fix these before saving:</div>
            <ul className="mt-2 space-y-1">
              {validationErrors.map((error) => (
                <li key={error}>- {error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Calls Logged" value={formatMetric(dashboard?.metrics.total_records ?? 0)} hint="Total recruiter calling entries recorded." icon={<PhoneCall className="h-5 w-5" />} />
          <MetricCard label="Contacted" value={`${formatMetric(dashboard?.metrics.total_contacted ?? 0)} (${dashboard?.metrics.contacted_pct ?? 0}%)`} hint="Candidates the recruiter actually reached." icon={<BadgeCheck className="h-5 w-5" />} />
          <MetricCard label="Shortlisted" value={formatMetric(dashboard?.metrics.shortlisted ?? 0)} hint="Candidates kept warm for next action." icon={<Target className="h-5 w-5" />} />
          <MetricCard label="Turned Up" value={`${formatMetric(dashboard?.metrics.walkins ?? 0)} (${turnoutRate}%)`} hint="Auto-linked from candidate registration." icon={<Users className="h-5 w-5" />} />
          <MetricCard label="Selected" value={`${formatMetric(dashboard?.metrics.final_selected ?? 0)} (${selectedRate}%)`} hint="Final selections mapped from later ATS flow." icon={<UserRound className="h-5 w-5" />} />
          <MetricCard label="Joined" value={formatMetric(dashboard?.metrics.joined ?? 0)} hint="Joined candidates coming through this funnel." icon={<Clock3 className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Recruiter</div>
                  <div className="mt-2 text-lg font-black text-slate-950">{bootstrap?.actor.recruiterName ?? "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">{bootstrap?.actor.recruiterCode || "Auto from login"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Branch</div>
                  <div className="mt-2 text-lg font-black text-slate-950">{bootstrap?.actor.branchName ?? "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">Auto mapped from recruiter profile</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Date</div>
                  <div className="mt-2 inline-flex items-center gap-2 text-lg font-black text-slate-950">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {bootstrap?.actor.activityDate ?? "-"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Saved in backend automatically</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Month Bucket</div>
                  <div className="mt-2 text-lg font-black text-slate-950">{bootstrap?.actor.activityMonth ?? "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">Used for reporting and monthly funnel</div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">Quick entry form</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Save one calling row fast. Later ATS steps will map back automatically instead of being typed twice.
                  </div>
                </div>
                <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
                  Smart duplicate mode: update same candidate instead of adding noise
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Process Name" help="Configurable from ATS form config" required>
                  <>
                    <input
                      ref={assignFieldRef("process_name") as any}
                      list="hiring-process-options"
                      value={form.process_name}
                      onChange={(event) => updateForm("process_name", event.target.value)}
                      onKeyDown={handleKeyAdvance("process_name")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Type or select process"
                    />
                    <datalist id="hiring-process-options">
                      {processOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Hiring Source" required>
                  <>
                    <input
                      ref={assignFieldRef("hiring_source") as any}
                      list="hiring-source-options"
                      value={form.hiring_source}
                      onChange={(event) => updateForm("hiring_source", event.target.value)}
                      onKeyDown={handleKeyAdvance("hiring_source")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Walk-in, portal, reference"
                    />
                    <datalist id="hiring-source-options">
                      {sourceOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Position" required>
                  <>
                    <input
                      ref={assignFieldRef("position_name") as any}
                      list="hiring-position-options"
                      value={form.position_name}
                      onChange={(event) => updateForm("position_name", event.target.value)}
                      onKeyDown={handleKeyAdvance("position_name")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Candidate role"
                    />
                    <datalist id="hiring-position-options">
                      {positionOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="WP Group" required>
                  <>
                    <input
                      ref={assignFieldRef("wp_group") as any}
                      list="hiring-wp-group-options"
                      value={form.wp_group}
                      onChange={(event) => updateForm("wp_group", event.target.value)}
                      onKeyDown={handleKeyAdvance("wp_group")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Team or work pool"
                    />
                    <datalist id="hiring-wp-group-options">
                      {wpGroupOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Candidate Name" required>
                  <input
                    ref={assignFieldRef("candidate_name") as any}
                    value={form.candidate_name}
                    onChange={(event) => updateForm("candidate_name", event.target.value)}
                    onKeyDown={handleKeyAdvance("candidate_name")}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="Full name"
                    autoComplete="name"
                  />
                </Field>

                <Field label="Mobile Number" help="Digits only, duplicate-safe" required>
                  <input
                    ref={assignFieldRef("mobile") as any}
                    value={form.mobile}
                    onChange={(event) => updateForm("mobile", event.target.value)}
                    onKeyDown={handleKeyAdvance("mobile")}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="10-digit mobile"
                    inputMode="numeric"
                    autoComplete="tel"
                  />
                </Field>

                <Field label="Email">
                  <input
                    ref={assignFieldRef("candidate_email") as any}
                    value={form.candidate_email}
                    onChange={(event) => updateForm("candidate_email", event.target.value)}
                    onKeyDown={handleKeyAdvance("candidate_email")}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="Optional email"
                    autoComplete="email"
                  />
                </Field>

                <Field label="Gender">
                  <>
                    <input
                      ref={assignFieldRef("gender") as any}
                      list="hiring-gender-options"
                      value={form.gender}
                      onChange={(event) => updateForm("gender", event.target.value)}
                      onKeyDown={handleKeyAdvance("gender")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Optional"
                    />
                    <datalist id="hiring-gender-options">
                      {genderOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Education">
                  <>
                    <input
                      ref={assignFieldRef("education_qualification") as any}
                      list="hiring-education-options"
                      value={form.education_qualification}
                      onChange={(event) => updateForm("education_qualification", event.target.value)}
                      onKeyDown={handleKeyAdvance("education_qualification")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Optional"
                    />
                    <datalist id="hiring-education-options">
                      {educationOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Experience">
                  <>
                    <input
                      ref={assignFieldRef("experience_level") as any}
                      list="hiring-experience-options"
                      value={form.experience_level}
                      onChange={(event) => updateForm("experience_level", event.target.value)}
                      onKeyDown={handleKeyAdvance("experience_level")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Optional"
                    />
                    <datalist id="hiring-experience-options">
                      {experienceOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field label="Candidate Location">
                  <input
                    ref={assignFieldRef("candidate_location") as any}
                    value={form.candidate_location}
                    onChange={(event) => updateForm("candidate_location", event.target.value)}
                    onKeyDown={handleKeyAdvance("candidate_location")}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    placeholder="Area / town"
                  />
                </Field>

                <Field label="Calling Outcome" help="Press Enter to jump to reason box" required>
                  <>
                    <input
                      ref={assignFieldRef("recruiter_remarks") as any}
                      list="hiring-outcome-options"
                      value={form.recruiter_remarks}
                      onChange={(event) => updateForm("recruiter_remarks", event.target.value)}
                      onKeyDown={handleKeyAdvance("recruiter_remarks")}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Shortlisted, rejected, callback, not contacted"
                    />
                    <datalist id="hiring-outcome-options">
                      {outcomeOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                </Field>

                <Field
                  label="Reason / Callback Note"
                  help="Required when outcome is Rejected or Not Contacted"
                >
                  <textarea
                    ref={assignFieldRef("recruiter_rejection_reason") as any}
                    value={form.recruiter_rejection_reason}
                    onChange={(event) => updateForm("recruiter_rejection_reason", event.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    placeholder="Busy, switched off, wrong number, rejected, call again tomorrow..."
                  />
                </Field>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <div className="text-sm text-slate-600">
                  Turn-up, selection, and joining numbers will map back automatically once the candidate moves through registration and later ATS stages.
                </div>
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={saving || loading}
                  className={`inline-flex h-12 items-center gap-2 rounded-2xl px-5 text-sm font-black ${
                    saving || loading
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "bg-slate-950 text-white hover:bg-slate-800"
                  }`}
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Calling Entry
                </button>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-950">
                <Users className="h-4 w-4" />
                My entries and candidate progress
              </div>
              <div className="mb-4 text-sm text-slate-600">
                This list is recruiter-scoped, so each logged-in recruiter sees only their own calling entries and the latest downstream ATS status of those candidates.
              </div>

              {loading ? (
                <div className="py-10 text-center text-sm text-slate-500">Loading recent entries...</div>
              ) : rows.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">No recruiter calling entries yet.</div>
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => {
                    const arrived = isArrived(row);
                    const selected = isSelected(row);
                    return (
                      <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-black text-slate-950">
                              {row.candidate_name || "Candidate"}
                            </div>
                            <div className="mt-1 text-sm text-slate-600">
                              {row.mobile || "-"} • {row.process_name || "No process"} • {row.position_name || "No position"}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {row.hiring_source || "No source"} • {row.branch_name || bootstrap?.actor.branchName || "No branch"}
                            </div>
                          </div>
                          <div className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row)}`}>
                            {selected ? "Selected" : arrived ? "Turned Up" : row.recruiter_remarks || "Open"}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Outcome: {row.recruiter_remarks || "Pending"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Current: {row.current_status || "Open"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            Date: {row.activity_date || "-"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Turned Up</div>
                            <div className={`mt-1 text-sm font-black ${arrived ? "text-sky-700" : "text-slate-700"}`}>
                              {arrived ? "Yes" : "Not yet"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected</div>
                            <div className={`mt-1 text-sm font-black ${selected ? "text-emerald-700" : "text-slate-700"}`}>
                              {selected ? "Yes" : "Pending"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Joined</div>
                            <div
                              className={`mt-1 text-sm font-black ${
                                row.joined_flag === 1 || row.joined_flag === "1" ? "text-emerald-700" : "text-slate-700"
                              }`}
                            >
                              {row.joined_flag === 1 || row.joined_flag === "1" ? "Yes" : "Pending"}
                            </div>
                          </div>
                        </div>

                        {row.recruiter_rejection_reason ? (
                          <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            {row.recruiter_rejection_reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

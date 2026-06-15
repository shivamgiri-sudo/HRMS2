import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileCheck2,
  Info,
  Landmark,
  Loader,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

type Employee = {
  id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

type TaxDeclaration = {
  id?: string;
  employee_id: string;
  financial_year: string;
  regime: "old" | "new";
  total_investment: number;
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  declared_ltc: number;
  declared_home_loan_interest: number;
  declared_nps_80ccd1b: number;
  declared_80e: number;
  declared_80g: number;
  declared_other_chapter_via: number;
  other_income: number;
  employee_consent: boolean;
  submission_status?: "draft" | "submitted" | "verified" | "rejected";
  tds_projected: number;
  submitted_at?: string | null;
  updated_at?: string;
  created_at?: string;
};

type FormState = {
  regime: "old" | "new";
  declared_hra: string;
  declared_ltc: string;
  declared_home_loan_interest: string;
  declared_80c: string;
  declared_nps_80ccd1b: string;
  declared_80d: string;
  declared_80e: string;
  declared_80g: string;
  declared_other_chapter_via: string;
  other_income: string;
  employee_consent: boolean;
};

type AmountField = Exclude<keyof FormState, "regime" | "employee_consent">;

const INR = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

function currentFinancialYear(): string {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

function financialYearOptions(): string[] {
  const start = Number(currentFinancialYear().slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((year) => `${year}-${year + 1}`);
}

const EMPTY_FORM: FormState = {
  regime: "new",
  declared_hra: "",
  declared_ltc: "",
  declared_home_loan_interest: "",
  declared_80c: "",
  declared_nps_80ccd1b: "",
  declared_80d: "",
  declared_80e: "",
  declared_80g: "",
  declared_other_chapter_via: "",
  other_income: "",
  employee_consent: false,
};

function toNum(value: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function employeeName(employee: Employee): string {
  return employee.full_name?.trim() || `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim();
}

function formFromDeclaration(declaration: TaxDeclaration | null): FormState {
  if (!declaration) return { ...EMPTY_FORM };
  const value = (amount: number) => (Number(amount) > 0 ? String(amount) : "");
  return {
    regime: declaration.regime,
    declared_hra: value(declaration.declared_hra),
    declared_ltc: value(declaration.declared_ltc),
    declared_home_loan_interest: value(declaration.declared_home_loan_interest),
    declared_80c: value(declaration.declared_80c),
    declared_nps_80ccd1b: value(declaration.declared_nps_80ccd1b),
    declared_80d: value(declaration.declared_80d),
    declared_80e: value(declaration.declared_80e),
    declared_80g: value(declaration.declared_80g),
    declared_other_chapter_via: value(declaration.declared_other_chapter_via),
    other_income: value(declaration.other_income),
    employee_consent: Boolean(declaration.employee_consent),
  };
}

const FIELD_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<{ key: AmountField; label: string; help: string; cap?: number }>;
}> = [
  {
    title: "Salary Exemptions",
    description: "Claims normally supported through Form 12BB evidence.",
    fields: [
      { key: "declared_hra", label: "HRA exemption", help: "Rent receipts, rental details and landlord evidence where applicable." },
      { key: "declared_ltc", label: "Leave travel concession", help: "Eligible domestic travel fare supported by tickets or invoices." },
      {
        key: "declared_home_loan_interest",
        label: "Home-loan interest",
        help: "Interest certificate and lender particulars. Payroll will verify the eligible limit.",
        cap: 200000,
      },
    ],
  },
  {
    title: "Chapter VI-A Deductions",
    description: "Tax-saving investments and eligible payments under the old regime.",
    fields: [
      { key: "declared_80c", label: "Section 80C / 80CCC / 80CCD(1)", help: "EPF, PPF, ELSS, LIC, tuition fee and eligible principal repayment.", cap: 150000 },
      { key: "declared_nps_80ccd1b", label: "Section 80CCD(1B) - NPS", help: "Additional employee NPS contribution.", cap: 50000 },
      { key: "declared_80d", label: "Section 80D - health insurance", help: "Self, family and parent medical insurance or eligible expenditure." },
      { key: "declared_80e", label: "Section 80E - education-loan interest", help: "Interest paid on an eligible higher-education loan." },
      { key: "declared_80g", label: "Section 80G - eligible donations", help: "Donation receipt and institution eligibility will be verified." },
      { key: "declared_other_chapter_via", label: "Other Chapter VI-A deductions", help: "Other eligible deductions supported by section-wise evidence." },
    ],
  },
];

export default function NativeTaxDeclaration() {
  const { hasAnyRole } = useWorkforceAccess();
  const canManageEmployees = hasAnyRole("super_admin", "admin", "hr", "finance", "payroll");
  const [mode, setMode] = useState<"self" | "admin">("self");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedFY, setSelectedFY] = useState(currentFinancialYear());
  const [declaration, setDeclaration] = useState<TaxDeclaration | null>(null);
  const [history, setHistory] = useState<TaxDeclaration[]>([]);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingDeclaration, setLoadingDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  const investmentTotal = useMemo(
    () =>
      toNum(form.declared_80c) +
      toNum(form.declared_nps_80ccd1b) +
      toNum(form.declared_80d) +
      toNum(form.declared_80e) +
      toNum(form.declared_80g) +
      toNum(form.declared_other_chapter_via),
    [form]
  );

  const oldRegimeClaimTotal = useMemo(
    () =>
      investmentTotal +
      toNum(form.declared_hra) +
      toNum(form.declared_ltc) +
      toNum(form.declared_home_loan_interest),
    [form, investmentTotal]
  );

  const evidenceItems = useMemo(
    () =>
      FIELD_GROUPS.flatMap((group) => group.fields)
        .filter((field) => toNum(form[field.key]) > 0)
        .map((field) => field.label),
    [form]
  );

  function showMessage(text: string, type: "info" | "success" | "error") {
    setMessage(text);
    setMessageType(type);
  }

  const loadEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const response = await hrmsApi.get<{ success: boolean; data: Employee[] }>("/api/employees");
      setEmployees(response.data ?? []);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Failed to load employees.", "error");
    } finally {
      setLoadingEmployees(false);
    }
  };

  useEffect(() => {
    if (mode === "admin" && canManageEmployees) void loadEmployees();
  }, [mode, canManageEmployees]);

  const loadDeclaration = async () => {
    const employeeId = mode === "self" ? "me" : selectedEmployeeId;
    if (!employeeId) {
      setDeclaration(null);
      setForm({ ...EMPTY_FORM });
      return;
    }

    setLoadingDeclaration(true);
    setMessage("");
    try {
      const response = await hrmsApi.get<{
        success: boolean;
        data: TaxDeclaration | null;
        history?: TaxDeclaration[];
      }>(`/api/payroll/tax-declaration/${employeeId}/${selectedFY}`);
      setDeclaration(response.data);
      setHistory(response.history ?? []);
      setForm(formFromDeclaration(response.data));
    } catch (error) {
      setDeclaration(null);
      setHistory([]);
      setForm({ ...EMPTY_FORM });
      showMessage(error instanceof Error ? error.message : "Failed to load declaration.", "error");
    } finally {
      setLoadingDeclaration(false);
    }
  };

  useEffect(() => {
    void loadDeclaration();
  }, [mode, selectedEmployeeId, selectedFY]);

  const submitDeclaration = async () => {
    const employeeId = mode === "self" ? "me" : selectedEmployeeId;
    if (!employeeId) {
      showMessage("Select an employee before submitting the declaration.", "error");
      return;
    }
    if (!form.employee_consent) {
      showMessage("Confirm the employee declaration before submitting.", "error");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/payroll/tax-declaration/${employeeId}/${selectedFY}`, {
        regime: form.regime,
        totalInvestment: investmentTotal,
        declaredHra: toNum(form.declared_hra),
        declaredLtc: toNum(form.declared_ltc),
        declaredHomeLoanInterest: toNum(form.declared_home_loan_interest),
        declared80c: toNum(form.declared_80c),
        declaredNps80ccd1b: toNum(form.declared_nps_80ccd1b),
        declared80d: toNum(form.declared_80d),
        declared80e: toNum(form.declared_80e),
        declared80g: toNum(form.declared_80g),
        declaredOtherChapterVia: toNum(form.declared_other_chapter_via),
        otherIncome: toNum(form.other_income),
        employeeConsent: form.employee_consent,
      });
      showMessage("Tax declaration submitted for payroll verification.", "success");
      await loadDeclaration();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Submission failed.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredEmployees = employees.filter((employee) => {
    const query = employeeSearch.trim().toLowerCase();
    return (
      !query ||
      employeeName(employee).toLowerCase().includes(query) ||
      (employee.employee_code ?? "").toLowerCase().includes(query)
    );
  });

  const messageColors = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
  };
  const status = declaration?.submission_status ?? (declaration ? "submitted" : "not submitted");
  const statusColors =
    status === "verified"
      ? "bg-emerald-100 text-emerald-800"
      : status === "rejected"
        ? "bg-rose-100 text-rose-800"
        : status === "submitted"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";
  const MessageIcon = messageType === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-blue-200">
                <Landmark className="h-4 w-4" />
                Payroll and Tax
              </div>
              <h1 className="mt-3 text-3xl font-black sm:text-4xl">Tax Declaration</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
                Declare Form 12BB-related exemptions and deductions for payroll TDS estimation.
                Final eligibility remains subject to document verification and statutory rules.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-200">Financial year</p>
                <p className="mt-1 text-lg font-black">{selectedFY}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-200">Status</p>
                <p className="mt-1 text-lg font-black capitalize">{status}</p>
              </div>
              <button
                onClick={() => void loadDeclaration()}
                disabled={loadingDeclaration}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-blue-50 disabled:opacity-50"
              >
                <RefreshCcw className={`h-4 w-4 ${loadingDeclaration ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageColors[messageType]}`}>
            <MessageIcon className="h-5 w-5 shrink-0" />
            {message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
            <Calculator className="h-6 w-6 text-blue-700" />
            <p className="mt-4 text-xs font-black uppercase tracking-wider text-blue-700">Declared claims</p>
            <p className="mt-1 text-2xl font-black text-blue-950">{INR(oldRegimeClaimTotal)}</p>
            <p className="mt-1 text-xs text-blue-700">Before payroll eligibility checks and statutory caps.</p>
          </div>
          <div className="rounded-3xl border border-violet-100 bg-violet-50 p-5">
            <TrendingDown className="h-6 w-6 text-violet-700" />
            <p className="mt-4 text-xs font-black uppercase tracking-wider text-violet-700">Projected annual TDS</p>
            <p className="mt-1 text-2xl font-black text-violet-950">
              {declaration ? INR(declaration.tds_projected) : "Submit to calculate"}
            </p>
            <p className="mt-1 text-xs text-violet-700">Provisional estimate using available annual salary data.</p>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
            <FileCheck2 className="h-6 w-6 text-emerald-700" />
            <p className="mt-4 text-xs font-black uppercase tracking-wider text-emerald-700">Evidence checklist</p>
            <p className="mt-1 text-2xl font-black text-emerald-950">{evidenceItems.length} categories</p>
            <p className="mt-1 text-xs text-emerald-700">Supporting proofs are required before payroll verification.</p>
          </div>
        </div>

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              {canManageEmployees && (
                <div className="flex overflow-hidden rounded-2xl border text-sm font-bold">
                  {(["self", "admin"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => {
                        setMode(item);
                        setSelectedEmployeeId("");
                        setDeclaration(null);
                        setForm({ ...EMPTY_FORM });
                      }}
                      className={`px-5 py-2.5 transition ${
                        mode === item ? "bg-slate-950 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {item === "self" ? "My declaration" : "Payroll view"}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <label htmlFor="financial-year" className="text-sm font-black text-slate-700">Financial year</label>
                <div className="relative">
                  <select
                    id="financial-year"
                    value={selectedFY}
                    onChange={(event) => setSelectedFY(event.target.value)}
                    className="appearance-none rounded-2xl border bg-slate-50 px-4 py-2.5 pr-9 text-sm font-bold outline-none focus:border-blue-500"
                  >
                    {financialYearOptions().map((year) => <option key={year}>{year}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>

            {mode === "admin" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    aria-label="Search employees"
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder="Search name or employee code"
                    className="h-11 min-w-[260px] rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                {loadingEmployees ? (
                  <Loader className="m-3 h-5 w-5 animate-spin text-slate-400" />
                ) : (
                  <select
                    aria-label="Select employee"
                    value={selectedEmployeeId}
                    onChange={(event) => setSelectedEmployeeId(event.target.value)}
                    className="h-11 min-w-[250px] rounded-2xl border bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-blue-500"
                  >
                    <option value="">Select employee</option>
                    {filteredEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employeeName(employee)} {employee.employee_code ? `(${employee.employee_code})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>

        {loadingDeclaration ? (
          <div className="flex items-center justify-center rounded-3xl border bg-white py-24">
            <Loader className="h-8 w-8 animate-spin text-blue-700" />
          </div>
        ) : (
          <>
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950">Choose tax regime</h2>
                  <p className="mt-1 text-sm text-slate-500">The new regime is the statutory default; eligible employees may choose the old regime.</p>
                </div>
                <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-black capitalize ${statusColors}`}>
                  {status}
                </span>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {(["new", "old"] as const).map((regime) => (
                  <label
                    key={regime}
                    className={`cursor-pointer rounded-2xl border-2 p-5 transition ${
                      form.regime === regime
                        ? regime === "new"
                          ? "border-blue-700 bg-blue-50"
                          : "border-violet-700 bg-violet-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="regime"
                      value={regime}
                      checked={form.regime === regime}
                      onChange={() => setForm((current) => ({ ...current, regime }))}
                      className="sr-only"
                    />
                    <div className="flex items-start gap-3">
                      <ShieldCheck className={`mt-0.5 h-6 w-6 ${regime === "new" ? "text-blue-700" : "text-violet-700"}`} />
                      <div>
                        <p className="font-black capitalize text-slate-950">{regime} regime</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {regime === "new"
                            ? "Lower slab rates with limited exemptions and deductions."
                            : "Supports eligible HRA, LTC, home-loan interest and Chapter VI-A claims."}
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              {form.regime === "new" && oldRegimeClaimTotal > 0 && (
                <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <Info className="mt-0.5 h-5 w-5 shrink-0" />
                  Old-regime claims are retained for comparison and records, but the TDS projection will ignore deductions that are not allowed under the new regime.
                </div>
              )}
            </div>

            {FIELD_GROUPS.map((group) => (
              <section key={group.title} className="rounded-3xl border bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-950">{group.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{group.description}</p>
                <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {group.fields.map((field) => {
                    const numericValue = toNum(form[field.key]);
                    const overCap = field.cap !== undefined && numericValue > field.cap;
                    return (
                      <div key={field.key}>
                        <label htmlFor={field.key} className="text-sm font-bold text-slate-800">{field.label}</label>
                        <div className="relative mt-2">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</span>
                          <input
                            id={field.key}
                            type="number"
                            min="0"
                            step="1"
                            value={form[field.key]}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            placeholder="0"
                            className={`w-full rounded-2xl border py-3 pl-9 pr-4 font-mono text-sm outline-none transition focus:border-blue-500 ${
                              overCap ? "border-amber-400 bg-amber-50" : ""
                            }`}
                          />
                        </div>
                        <p className={`mt-1.5 text-xs leading-5 ${overCap ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                          {overCap ? `Declared above the usual ${INR(field.cap!)} cap; payroll will limit the eligible amount. ` : ""}
                          {field.help}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-3xl border bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-950">Other income for TDS</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Include taxable income you want the employer to consider, such as previous-employer salary or interest income.
                </p>
                <label htmlFor="other_income" className="mt-5 block text-sm font-bold text-slate-800">Estimated other taxable income</label>
                <div className="relative mt-2 max-w-md">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</span>
                  <input
                    id="other_income"
                    type="number"
                    min="0"
                    value={form.other_income}
                    onChange={(event) => setForm((current) => ({ ...current, other_income: event.target.value }))}
                    placeholder="0"
                    className="w-full rounded-2xl border py-3 pl-9 pr-4 font-mono text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 text-white shadow-sm">
                <h2 className="text-xl font-black">Declaration summary</h2>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-4 text-slate-300">
                    <span>Exemptions and housing</span>
                    <strong className="font-mono text-white">{INR(oldRegimeClaimTotal - investmentTotal)}</strong>
                  </div>
                  <div className="flex justify-between gap-4 text-slate-300">
                    <span>Chapter VI-A claims</span>
                    <strong className="font-mono text-white">{INR(investmentTotal)}</strong>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-white/15 pt-3 text-slate-300">
                    <span>Total declared claims</span>
                    <strong className="font-mono text-lg text-white">{INR(oldRegimeClaimTotal)}</strong>
                  </div>
                  <div className="flex justify-between gap-4 text-slate-300">
                    <span>Other taxable income</span>
                    <strong className="font-mono text-white">{INR(toNum(form.other_income))}</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <FileCheck2 className="mt-0.5 h-6 w-6 text-emerald-700" />
                <div>
                  <h2 className="text-xl font-black text-slate-950">Evidence and verification</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Amount submission does not itself approve a tax benefit. Payroll must verify applicable receipts,
                    certificates and particulars before using the claim.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {evidenceItems.length > 0 ? evidenceItems.map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    <Clock className="h-4 w-4 text-amber-600" />
                    {item}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed p-4 text-sm text-slate-500">
                    Add a claim amount to generate the evidence checklist.
                  </div>
                )}
              </div>
              <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                Secure proof upload and payroll verification are the next required workflow. Full landlord or lender PAN
                should not be stored in ordinary text fields; sensitive identifiers need masking, restricted access and audit logging.
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-slate-50 p-4">
                <input
                  type="checkbox"
                  checked={form.employee_consent}
                  onChange={(event) => setForm((current) => ({ ...current, employee_consent: event.target.checked }))}
                  className="mt-1 h-4 w-4 accent-blue-700"
                />
                <span className="text-sm leading-6 text-slate-700">
                  I confirm that the information declared for FY {selectedFY} is true and complete to the best of my
                  knowledge. I understand that unsupported or ineligible claims may be rejected during payroll verification.
                </span>
              </label>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => void submitDeclaration()}
                  disabled={submitting || (mode === "admin" && !selectedEmployeeId)}
                  className="inline-flex min-w-[230px] items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Submit for verification
                </button>
                <button
                  onClick={() => setForm(formFromDeclaration(declaration))}
                  className="rounded-2xl border px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Restore saved values
                </button>
              </div>
              {(declaration?.submitted_at || declaration?.updated_at) && (
                <p className="mt-3 text-xs text-slate-500">
                  Last updated {new Date(declaration.submitted_at ?? declaration.updated_at!).toLocaleString("en-IN")}
                </p>
              )}
            </section>
          </>
        )}

        {history.length > 0 && (
          <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="text-lg font-black text-slate-950">Declaration history</h2>
              <p className="mt-1 text-sm text-slate-500">Financial-year declarations available for this employee.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    {["Financial year", "Regime", "Status", "Claims", "Other income", "Projected TDS", "Updated"].map((heading) => (
                      <th key={heading} className="p-4 font-bold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id ?? item.financial_year} className="border-t">
                      <td className="p-4 font-black text-slate-950">{item.financial_year}</td>
                      <td className="p-4 font-semibold capitalize">{item.regime}</td>
                      <td className="p-4 capitalize">{item.submission_status ?? "submitted"}</td>
                      <td className="p-4 font-mono">{INR(Number(item.total_investment) + Number(item.declared_hra) + Number(item.declared_ltc) + Number(item.declared_home_loan_interest))}</td>
                      <td className="p-4 font-mono">{INR(item.other_income)}</td>
                      <td className="p-4 font-mono">{INR(item.tds_projected)}</td>
                      <td className="p-4 text-xs text-slate-500">
                        {item.updated_at ? new Date(item.updated_at).toLocaleDateString("en-IN") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}

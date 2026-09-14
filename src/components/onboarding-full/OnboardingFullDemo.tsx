import { useState } from "react";
import {
  AlertCircle, CheckCircle2, Loader2, Shield, Phone, Mail, FileText,
  User, CreditCard, Building2, BadgeCheck, Percent, Smartphone, Lock,
  Sparkles, ChevronRight, Send, FileCheck, MapPin, Camera, Upload,
  Briefcase, GraduationCap, Users, Languages, Heart, Home, Globe,
  Calendar, Clock, Eye, FileImage, CheckSquare, XCircle, ArrowRight,
  ArrowLeft, IndianRupee, Landmark, Key, Fingerprint, ShieldCheck,
  Info, BookOpen, Plus, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

/**
 * Complete Onboarding Flow Demo — MAS HRMS Design Patterns
 *
 * FRONTEND ONLY — No backend connections, all mock data.
 * Demonstrates the full 10-step onboarding with:
 * - Glassmorphism cards
 * - Gradient headers (section-specific)
 * - Colored sections
 * - Responsive layouts
 * - Step navigation
 */

// Step configuration
const STEPS = [
  { id: 1, title: "Welcome", subtitle: "Get started", icon: Home, color: "blue" },
  { id: 2, title: "Personal", subtitle: "Basic info", icon: User, color: "indigo" },
  { id: 3, title: "Address", subtitle: "KYC details", icon: MapPin, color: "purple" },
  { id: 4, title: "Documents", subtitle: "Upload files", icon: FileImage, color: "pink" },
  { id: 5, title: "BGV", subtitle: "Verification", icon: ShieldCheck, color: "violet" },
  { id: 6, title: "Bank", subtitle: "Account info", icon: Landmark, color: "blue" },
  { id: 7, title: "Education", subtitle: "Qualifications", icon: GraduationCap, color: "cyan" },
  { id: 8, title: "Experience", subtitle: "Work history", icon: Briefcase, color: "pink" },
  { id: 9, title: "Family", subtitle: "& Languages", icon: Users, color: "teal" },
  { id: 10, title: "Submit", subtitle: "Final step", icon: CheckCircle2, color: "emerald" },
] as const;

// Color mappings for steps
const STEP_COLORS: Record<string, { gradient: string; bg: string; border: string; text: string; light: string }> = {
  blue: { gradient: "from-blue-600 to-indigo-600", bg: "bg-blue-600", border: "border-blue-200", text: "text-blue-600", light: "bg-blue-50" },
  indigo: { gradient: "from-indigo-600 to-purple-600", bg: "bg-indigo-600", border: "border-indigo-200", text: "text-indigo-600", light: "bg-indigo-50" },
  purple: { gradient: "from-purple-600 to-violet-600", bg: "bg-purple-600", border: "border-purple-200", text: "text-purple-600", light: "bg-purple-50" },
  pink: { gradient: "from-pink-600 to-rose-600", bg: "bg-pink-600", border: "border-pink-200", text: "text-pink-600", light: "bg-pink-50" },
  violet: { gradient: "from-violet-600 to-purple-600", bg: "bg-violet-600", border: "border-violet-200", text: "text-violet-600", light: "bg-violet-50" },
  cyan: { gradient: "from-cyan-600 to-teal-600", bg: "bg-cyan-600", border: "border-cyan-200", text: "text-cyan-600", light: "bg-cyan-50" },
  teal: { gradient: "from-teal-600 to-emerald-600", bg: "bg-teal-600", border: "border-teal-200", text: "text-teal-600", light: "bg-teal-50" },
  emerald: { gradient: "from-emerald-600 to-green-600", bg: "bg-emerald-600", border: "border-emerald-200", text: "text-emerald-600", light: "bg-emerald-50" },
};

// Mock employee data
const MOCK_DATA = {
  name: "Rajesh Kumar Singh",
  mobile: "9876543210",
  email: "rajesh.kumar@mashrms.in",
  branch: "Hyderabad - Gachibowli",
  process: "Customer Support - Premium",
  candidateCode: "MAS-2026-08-1234",
};

// Reusable Components
const GlassCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-lg ${className}`}>
    {children}
  </div>
);

const GradientHeader = ({
  title, subtitle, icon: Icon, color
}: {
  title: string; subtitle: string; icon: React.ElementType; color: string;
}) => {
  const c = STEP_COLORS[color] || STEP_COLORS.blue;
  return (
    <div className={`bg-gradient-to-r ${c.gradient} p-5 sm:p-6`}>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white">{title}</h2>
          <p className="text-white/80 text-sm">{subtitle}</p>
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({
  title, subtitle, icon: Icon, color
}: {
  title: string; subtitle?: string; icon: React.ElementType; color: string;
}) => {
  const c = STEP_COLORS[color] || STEP_COLORS.blue;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-9 h-9 rounded-lg ${c.light} flex items-center justify-center`}>
        <Icon className={`h-4 w-4 ${c.text}`} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
};

const FormField = ({
  label, value, placeholder, required, disabled, type = "text"
}: {
  label: string; value?: string; placeholder?: string; required?: boolean; disabled?: boolean; type?: string;
}) => (
  <div className="space-y-1.5">
    <Label className="text-sm font-semibold text-slate-700">
      {label} {required && <span className="text-rose-500">*</span>}
    </Label>
    <Input
      type={type}
      value={value || ""}
      placeholder={placeholder}
      disabled={disabled}
      className="min-h-[44px] rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-white"
      readOnly
    />
  </div>
);

const ReadOnlyField = ({ label, value, icon: Icon, color = "slate" }: {
  label: string; value?: string; icon?: React.ElementType; color?: string;
}) => (
  <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-slate-50/80 hover:bg-slate-100/80 transition-colors">
    {Icon && (
      <div className={`w-8 h-8 rounded-lg bg-${color}-100 flex items-center justify-center`}>
        <Icon className={`h-4 w-4 text-${color}-600`} />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-slate-800 truncate">{value || "—"}</p>
    </div>
  </div>
);

const InfoBox = ({
  variant = "info", children
}: {
  variant?: "info" | "success" | "warning" | "error"; children: React.ReactNode;
}) => {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-rose-50 border-rose-200 text-rose-800",
  };
  const icons = {
    info: Info,
    success: CheckCircle2,
    warning: AlertCircle,
    error: XCircle,
  };
  const Icon = icons[variant];
  return (
    <div className={`rounded-xl border-2 p-4 ${styles[variant]}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
};

const YesNoChips = ({
  value, onChange, label, helpText
}: {
  value: boolean | null; onChange: (v: boolean) => void; label: string; helpText?: string;
}) => (
  <div className="space-y-2">
    <Label className="text-sm font-semibold text-slate-700">{label}</Label>
    {helpText && <p className="text-xs text-slate-500">{helpText}</p>}
    <div className="flex gap-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`flex-1 min-h-[44px] rounded-xl border-2 font-bold text-sm transition-all active:scale-95 ${
            value === v
              ? v ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-rose-500 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  </div>
);

const DocumentCard = ({
  type, status, uploaded
}: {
  type: string; status: "pending" | "uploaded" | "verified"; uploaded?: boolean;
}) => {
  const statusStyles = {
    pending: { bg: "bg-slate-50", border: "border-slate-200", icon: Upload, color: "text-slate-400" },
    uploaded: { bg: "bg-blue-50", border: "border-blue-200", icon: FileCheck, color: "text-blue-600" },
    verified: { bg: "bg-emerald-50", border: "border-emerald-200", icon: CheckCircle2, color: "text-emerald-600" },
  };
  const s = statusStyles[status];
  return (
    <div className={`rounded-xl border-2 ${s.border} ${s.bg} p-4 transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <s.icon className={`h-5 w-5 ${s.color}`} />
          <span className="font-semibold text-sm text-slate-800">{type}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          status === "verified" ? "bg-emerald-100 text-emerald-700" :
          status === "uploaded" ? "bg-blue-100 text-blue-700" :
          "bg-slate-100 text-slate-500"
        }`}>
          {status === "verified" ? "Verified" : status === "uploaded" ? "Uploaded" : "Required"}
        </span>
      </div>
    </div>
  );
};

const ChecklistCard = ({
  label, value, ok, icon: Icon, tone
}: {
  label: string; value: string; ok: boolean; icon: React.ElementType;
  tone: "blue" | "green" | "amber" | "purple" | "teal" | "pink";
}) => {
  const tones = {
    blue: { bg: "from-blue-50 to-indigo-50", border: "border-blue-200", icon: "#0b63e5", text: "text-blue-700" },
    green: { bg: "from-emerald-50 to-green-50", border: "border-emerald-200", icon: "#15803d", text: "text-emerald-700" },
    amber: { bg: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "#ea580c", text: "text-amber-700" },
    purple: { bg: "from-purple-50 to-violet-50", border: "border-purple-200", icon: "#6d28d9", text: "text-purple-700" },
    teal: { bg: "from-teal-50 to-cyan-50", border: "border-teal-200", icon: "#0891b2", text: "text-teal-700" },
    pink: { bg: "from-pink-50 to-rose-50", border: "border-pink-200", icon: "#db2777", text: "text-pink-700" },
  };
  const t = tones[tone];
  return (
    <div className={`rounded-xl border-2 ${t.border} bg-gradient-to-br ${t.bg} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${t.icon}15` }}>
            <Icon className="h-5 w-5" style={{ color: t.icon }} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-0.5 font-bold text-sm ${t.text}`}>{value}</p>
          </div>
        </div>
        {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertCircle className="h-5 w-5 text-amber-500" />}
      </div>
    </div>
  );
};

// Step Components
function Step1Content() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Your Details" subtitle="From your application" icon={User} color="blue" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReadOnlyField label="Full Name" value={MOCK_DATA.name} icon={User} color="blue" />
        <ReadOnlyField label="Mobile" value={MOCK_DATA.mobile} icon={Phone} color="emerald" />
        <ReadOnlyField label="Email" value={MOCK_DATA.email} icon={Mail} color="purple" />
        <ReadOnlyField label="Branch" value={MOCK_DATA.branch} icon={Building2} color="indigo" />
        <ReadOnlyField label="Process" value={MOCK_DATA.process} icon={Briefcase} color="pink" />
        <ReadOnlyField label="Candidate Code" value={MOCK_DATA.candidateCode} icon={Key} color="amber" />
      </div>

      <SectionHeader title="Before You Begin" subtitle="Important instructions" icon={Info} color="indigo" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { icon: "📝", text: "Fill all 10 steps — details used for payroll, PF, ESI" },
          { icon: "💾", text: "Progress autosaves — no data lost on refresh" },
          { icon: "📎", text: "Keep Aadhaar, PAN, Passbook scans ready" },
          { icon: "📱", text: "OTP verification required for final submission" },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="text-xl">{item.icon}</span>
            <span className="text-sm text-slate-700">{item.text}</span>
          </div>
        ))}
      </div>

      <InfoBox variant="info">
        <p className="font-bold">Data Privacy Notice (DPDP Act 2023)</p>
        <p className="text-xs mt-1">Your data is collected for employment, payroll, and statutory compliance only. You can request access or deletion anytime.</p>
      </InfoBox>
    </div>
  );
}

function Step2Content() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Basic Information" subtitle="Personal details" icon={User} color="indigo" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Title" value="Mr" required />
        <FormField label="First Name" value="Rajesh" required />
        <FormField label="Middle Name" value="Kumar" />
        <FormField label="Last Name" value="Singh" required />
        <FormField label="Date of Birth" value="1995-05-15" type="date" required />
        <FormField label="Gender" value="Male" required />
        <FormField label="Marital Status" value="Single" />
        <FormField label="Blood Group" value="O+" />
        <FormField label="Nationality" value="Indian" required />
      </div>

      <SectionHeader title="Contact Information" subtitle="Phone and email" icon={Phone} color="emerald" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Mobile Number" value="9876543210" required />
        <FormField label="Alternate Mobile" placeholder="Optional" />
        <FormField label="Personal Email" value="rajesh.singh@gmail.com" required />
      </div>

      <SectionHeader title="Parent/Guardian" subtitle="Required for statutory forms" icon={Users} color="purple" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Father's Name" value="Suresh Kumar Singh" required />
        <FormField label="Mother's Name" value="Kamla Devi" />
        <FormField label="Spouse Name" placeholder="If married" />
      </div>
    </div>
  );
}

function Step3Content() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Permanent Address" subtitle="As per ID proof" icon={Home} color="purple" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <FormField label="Address Line 1" value="Plot No. 45, Gachibowli" required />
        </div>
        <FormField label="Address Line 2" value="Near IT Park" />
        <FormField label="City" value="Hyderabad" required />
        <FormField label="State" value="Telangana" required />
        <FormField label="PIN Code" value="500032" required />
        <FormField label="Country" value="India" required />
      </div>

      <SectionHeader title="Current Address" subtitle="Where you currently stay" icon={MapPin} color="teal" />
      <InfoBox variant="info">
        <p className="font-semibold">Same as permanent address?</p>
        <p className="text-xs">If your current address is different, fill the details below.</p>
      </InfoBox>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <FormField label="Address Line 1" value="Same as above" />
        </div>
      </div>

      <SectionHeader title="Identity Documents" subtitle="Aadhaar and PAN" icon={Fingerprint} color="violet" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="font-bold text-orange-800">Aadhaar Card</p>
              <p className="text-xs text-orange-600">12-digit UID</p>
            </div>
          </div>
          <FormField label="Aadhaar Number" value="XXXX XXXX 4567" required />
        </div>
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-blue-800">PAN Card</p>
              <p className="text-xs text-blue-600">Income Tax ID</p>
            </div>
          </div>
          <FormField label="PAN Number" value="ABCDE1234F" required />
        </div>
      </div>
    </div>
  );
}

function Step4Content() {
  const docs = [
    { type: "Aadhaar Card", status: "verified" as const },
    { type: "PAN Card", status: "uploaded" as const },
    { type: "Passport Photo", status: "verified" as const },
    { type: "10th Marksheet", status: "uploaded" as const },
    { type: "12th Marksheet", status: "uploaded" as const },
    { type: "Address Proof", status: "pending" as const },
    { type: "Cancelled Cheque", status: "pending" as const },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader title="Mandatory Documents" subtitle="Upload all required documents" icon={FileImage} color="pink" />
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.filter(d => ["Aadhaar Card", "PAN Card", "Passport Photo", "10th Marksheet", "12th Marksheet"].includes(d.type))
          .map((doc) => <DocumentCard key={doc.type} {...doc} />)}
      </div>

      <SectionHeader title="Optional Documents" subtitle="If applicable to you" icon={FileText} color="violet" />
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.filter(d => ["Address Proof", "Cancelled Cheque"].includes(d.type))
          .map((doc) => <DocumentCard key={doc.type} {...doc} />)}
      </div>

      <SectionHeader title="Live Selfie" subtitle="For identity verification" icon={Camera} color="cyan" />
      <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center">
              <Camera className="h-8 w-8 text-cyan-600" />
            </div>
            <div>
              <p className="font-bold text-cyan-800">Capture Live Selfie</p>
              <p className="text-sm text-cyan-600">Required for BGV verification</p>
            </div>
          </div>
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
      </div>
    </div>
  );
}

function Step5Content() {
  const [consent, setConsent] = useState(true);
  return (
    <div className="space-y-5">
      <SectionHeader title="Background Verification" subtitle="Required for employment" icon={ShieldCheck} color="violet" />

      <InfoBox variant="info">
        <p className="font-bold">What is BGV?</p>
        <p className="text-xs mt-1">Background verification confirms your identity, education, and employment history. This is mandatory for all new employees.</p>
      </InfoBox>

      <div className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 border-2 border-violet-200 p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <p className="font-bold text-violet-800">BGV Consent Required</p>
            <p className="text-sm text-violet-600">Please review and accept to proceed</p>
          </div>
        </div>

        <label className={`flex items-start gap-4 cursor-pointer p-4 rounded-xl border-2 transition-all ${
          consent ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200"
        }`}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-emerald-600" />
          <span className="text-sm text-slate-700">
            I authorize MAS Callnet to conduct background verification including identity, address, education, and employment history checks.
          </span>
        </label>
      </div>

      <SectionHeader title="Verification Status" subtitle="Real-time BGV progress" icon={Eye} color="teal" />
      <div className="space-y-3">
        {[
          { check: "Identity Verification", status: "verified" },
          { check: "Address Verification", status: "verified" },
          { check: "Education Check", status: "pending" },
          { check: "Employment History", status: "pending" },
        ].map((item) => (
          <div key={item.check} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="font-semibold text-sm text-slate-700">{item.check}</span>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${
              item.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}>
              {item.status === "verified" ? "Verified" : "Pending"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Step6Content() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Bank Account Details" subtitle="For salary credit" icon={Landmark} color="blue" />

      <InfoBox variant="warning">
        <p className="font-bold">Important</p>
        <p className="text-xs mt-1">Bank account must be in your name. Joint accounts are not accepted for salary credit.</p>
      </InfoBox>

      <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Account Holder Name" value="Rajesh Kumar Singh" required />
          <FormField label="Account Number" value="XXXX XXXX 7890" required />
          <FormField label="Confirm Account Number" value="XXXX XXXX 7890" required />
          <FormField label="Bank Name" value="HDFC Bank" required />
          <FormField label="IFSC Code" value="HDFC0001234" required />
          <FormField label="Branch Name" value="Gachibowli, Hyderabad" />
          <FormField label="Account Type" value="Savings" required />
        </div>
      </div>

      <SectionHeader title="Penny Drop Verification" subtitle="Verify account details" icon={IndianRupee} color="emerald" />
      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-emerald-800">Account Verified</p>
              <p className="text-sm text-emerald-600">Name matched: RAJESH KUMAR SINGH</p>
            </div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-200 text-emerald-800">SUCCESS</span>
        </div>
      </div>
    </div>
  );
}

function Step7Content() {
  const quals = [
    { level: "10th / SSC", institution: "Kendriya Vidyalaya", year: "2010", percent: "78%" },
    { level: "12th / HSC", institution: "Kendriya Vidyalaya", year: "2012", percent: "72%" },
    { level: "Graduate (B.Com)", institution: "Osmania University", year: "2015", percent: "68%" },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader title="Add Qualification" subtitle="Enter your educational details" icon={GraduationCap} color="cyan" />
      <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Qualification Level" value="Select..." required />
          <FormField label="Specialization" placeholder="e.g. Computer Science" />
          <FormField label="Institution Name" placeholder="College/School name" />
          <FormField label="Board/University" placeholder="e.g. CBSE, Osmania" />
          <FormField label="Year of Passing" placeholder="2024" required />
          <FormField label="Percentage/CGPA" placeholder="e.g. 72.5" />
        </div>
        <Button className="mt-4 min-h-[48px] px-6 bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold rounded-xl">
          <Plus className="h-4 w-4 mr-2" /> Add Qualification
        </Button>
      </div>

      <SectionHeader title="Added Qualifications" subtitle={`${quals.length} qualifications added`} icon={BookOpen} color="teal" />
      <div className="space-y-3">
        {quals.map((q, i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border-2 border-slate-200">
            <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-black">
              {i + 1}
            </div>
            <div className="flex-1">
              <p className="font-bold text-slate-900">{q.level}</p>
              <div className="flex flex-wrap gap-2 mt-1">
                <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">{q.institution}</span>
                <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full">Year: {q.year}</span>
                <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full">{q.percent}</span>
              </div>
            </div>
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Step8Content() {
  const [isFresher, setIsFresher] = useState(false);
  return (
    <div className="space-y-5">
      <SectionHeader title="Experience Level" subtitle="Select your experience" icon={Briefcase} color="pink" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {["Fresher", "6 months – 1 year", "1–2 years", "2–3 years", "3–5 years", "5+ years"].map((exp) => (
          <button
            key={exp}
            onClick={() => setIsFresher(exp === "Fresher")}
            className={`min-h-[52px] rounded-xl border-2 font-semibold text-sm transition-all ${
              (exp === "Fresher" && isFresher) || (exp === "1–2 years" && !isFresher)
                ? "border-pink-500 bg-pink-50 text-pink-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-pink-300"
            }`}
          >
            {exp}
          </button>
        ))}
      </div>

      {!isFresher && (
        <>
          <SectionHeader title="Previous Employment" subtitle="Most recent employer" icon={Building2} color="violet" />
          <div className="rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border-2 border-pink-200 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <FormField label="Company Name" value="TechCorp Solutions" required />
              </div>
              <FormField label="Designation" value="Customer Support Executive" required />
              <FormField label="Experience (years)" value="1.5" />
              <FormField label="Last CTC (Annual)" value="₹3,00,000" />
              <FormField label="From Date" value="2023-01-01" type="date" required />
              <FormField label="To Date" value="2024-06-30" type="date" required />
              <FormField label="Reason for Leaving" value="Better opportunity" />
            </div>
          </div>
        </>
      )}

      {isFresher && (
        <InfoBox variant="success">
          <p className="font-bold">Fresher Profile Selected</p>
          <p className="text-xs mt-1">No work experience details required. Make sure to upload your latest marksheet/certificate.</p>
        </InfoBox>
      )}
    </div>
  );
}

function Step9Content() {
  const languages = [
    { name: "English", read: true, write: true, speak: true, level: "Fluent" },
    { name: "Hindi", read: true, write: true, speak: true, level: "Native" },
    { name: "Telugu", read: false, write: false, speak: true, level: "Intermediate" },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader title="Family Information" subtitle="For HR and statutory records" icon={Heart} color="teal" />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Annual Household Income (₹)" value="6,00,000" />
        <FormField label="Number of Dependents" value="3" />
      </div>

      <SectionHeader title="Family Members" subtitle="For EPF nomination (Form 2)" icon={Users} color="emerald" />
      <div className="space-y-3">
        {[
          { name: "Suresh Kumar Singh", relation: "Father", dob: "1965-03-12" },
          { name: "Kamla Devi", relation: "Mother", dob: "1970-08-25" },
        ].map((member, i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-200">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <User className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-emerald-800">{member.name}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{member.relation}</span>
                <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">DOB: {member.dob}</span>
              </div>
            </div>
            <button className="p-2 hover:bg-red-50 rounded-lg"><Trash2 className="h-4 w-4 text-red-400" /></button>
          </div>
        ))}
      </div>

      <SectionHeader title="Language Proficiency" subtitle="Languages you know" icon={Languages} color="cyan" />
      <div className="flex flex-wrap gap-2 mb-4">
        {["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali"].map((lang) => (
          <button
            key={lang}
            className={`px-4 py-2 rounded-full border-2 text-sm font-semibold transition-all ${
              languages.find(l => l.name === lang)
                ? "border-teal-500 bg-teal-50 text-teal-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
            }`}
          >
            {languages.find(l => l.name === lang) && "✓ "}{lang}
          </button>
        ))}
      </div>
      <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["Language", "Read", "Write", "Speak", "Level"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {languages.map((l) => (
              <tr key={l.name} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{l.name}</td>
                <td className="px-4 py-3 text-center">{l.read ? "✓" : "—"}</td>
                <td className="px-4 py-3 text-center">{l.write ? "✓" : "—"}</td>
                <td className="px-4 py-3 text-center">{l.speak ? "✓" : "—"}</td>
                <td className="px-4 py-3 text-teal-700 font-semibold">{l.level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Step10Content() {
  const [otpVerified, setOtpVerified] = useState(false);
  const [declared, setDeclared] = useState(false);
  return (
    <div className="space-y-5">
      <SectionHeader title="Statutory Information" subtitle="PF and compliance declarations" icon={Shield} color="purple" />
      <div className="grid gap-4 sm:grid-cols-3">
        <YesNoChips label="Previous PF Member?" value={false} onChange={() => {}} helpText="Were you a PF member before?" />
        <YesNoChips label="EPS Member?" value={false} onChange={() => {}} helpText="Employee Pension Scheme" />
        <YesNoChips label="International Worker?" value={false} onChange={() => {}} helpText="Foreign national?" />
      </div>

      <SectionHeader title="OTP Verification" subtitle="Verify your mobile" icon={Smartphone} color="teal" />
      {otpVerified ? (
        <InfoBox variant="success">
          <p className="font-bold">OTP Verified Successfully</p>
          <p className="text-xs mt-1">{MOCK_DATA.mobile} has been verified.</p>
        </InfoBox>
      ) : (
        <div className="rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border-2 border-teal-200 p-5">
          <div className="flex flex-wrap gap-3 items-end">
            <Button variant="outline" className="min-h-[48px] px-6 font-bold rounded-xl border-2">
              <Send className="h-4 w-4 mr-2" /> Send OTP
            </Button>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Enter OTP</Label>
              <Input placeholder="000000" className="w-36 min-h-[48px] text-center font-mono tracking-widest rounded-xl border-2" />
            </div>
            <Button onClick={() => setOtpVerified(true)} className="min-h-[48px] px-6 bg-gradient-to-r from-teal-600 to-cyan-600 font-bold rounded-xl">
              <CheckCircle2 className="h-4 w-4 mr-2" /> Verify
            </Button>
          </div>
        </div>
      )}

      <SectionHeader title="Declaration" subtitle="Read and accept" icon={FileText} color="amber" />
      <label className={`flex items-start gap-4 cursor-pointer p-5 rounded-xl border-2 transition-all ${
        declared ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-200"
      }`}>
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1 h-5 w-5 accent-emerald-600" />
        <span className="text-sm text-slate-700">
          I hereby declare that all information furnished above is <strong>true, correct and complete</strong> to the best of my knowledge.
          I understand that any misrepresentation may result in <strong>rejection of my candidature or termination</strong>.
        </span>
      </label>

      <SectionHeader title="Submission Checklist" subtitle="Quick check before submit" icon={BadgeCheck} color="indigo" />
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <ChecklistCard label="Name" value={MOCK_DATA.name} ok icon={User} tone="blue" />
        <ChecklistCard label="PAN" value="ABCXXXXX4F" ok icon={CreditCard} tone="purple" />
        <ChecklistCard label="Documents" value="7 uploaded" ok icon={FileText} tone="green" />
        <ChecklistCard label="BGV Status" value="Verified ✓" ok icon={Shield} tone="teal" />
        <ChecklistCard label="Bank" value="HDFC Bank" ok icon={Building2} tone="blue" />
        <ChecklistCard label="OTP" value={otpVerified ? "Verified ✓" : "Not verified"} ok={otpVerified} icon={Smartphone} tone="teal" />
        <ChecklistCard label="Declaration" value={declared ? "Signed ✓" : "Not signed"} ok={declared} icon={FileCheck} tone="amber" />
        <ChecklistCard label="Qualifications" value="3 added" ok icon={BadgeCheck} tone="purple" />
        <ChecklistCard label="Completion" value="95%" ok icon={Percent} tone="green" />
      </div>
    </div>
  );
}

// Main Component
export default function OnboardingFullDemo() {
  const [currentStep, setCurrentStep] = useState(1);
  const step = STEPS.find(s => s.id === currentStep)!;
  const c = STEP_COLORS[step.color];
  const progress = (currentStep / STEPS.length) * 100;

  const StepContent = [
    Step1Content, Step2Content, Step3Content, Step4Content, Step5Content,
    Step6Content, Step7Content, Step8Content, Step9Content, Step10Content,
  ][currentStep - 1];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Demo Banner */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white p-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span className="font-bold">Design Demo — Complete Onboarding Flow</span>
          <span className="text-white/70 text-sm">| MAS HRMS Design Patterns (Frontend Only)</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-slate-700">Step {currentStep} of {STEPS.length}</span>
            <span className="text-sm font-semibold text-slate-500">{Math.round(progress)}% Complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Indicators (Mobile: compact, Desktop: full) */}
        <div className="mb-6 overflow-x-auto pb-2">
          <div className="flex gap-2 min-w-max">
            {STEPS.map((s) => {
              const sc = STEP_COLORS[s.color];
              const isActive = s.id === currentStep;
              const isComplete = s.id < currentStep;
              return (
                <button
                  key={s.id}
                  onClick={() => setCurrentStep(s.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all ${
                    isActive
                      ? `${sc.border} ${sc.light} ${sc.text}`
                      : isComplete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                        : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${
                    isActive ? `${sc.bg} text-white` :
                    isComplete ? "bg-emerald-500 text-white" :
                    "bg-slate-200 text-slate-500"
                  }`}>
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : s.id}
                  </div>
                  <span className="font-semibold text-sm hidden sm:inline">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Card */}
        <GlassCard className="overflow-hidden">
          <GradientHeader title={step.title} subtitle={STEPS[currentStep - 1].subtitle} icon={step.icon} color={step.color} />
          <div className="p-5 sm:p-6">
            <StepContent />
          </div>

          {/* Navigation */}
          <div className="p-5 sm:p-6 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
                disabled={currentStep === 1}
                className="min-h-[48px] px-6 font-semibold rounded-xl border-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" /> Previous
              </Button>
              {currentStep === STEPS.length ? (
                <Button className={`min-h-[48px] px-8 font-black rounded-xl bg-gradient-to-r ${c.gradient} text-white shadow-lg`}>
                  <CheckCircle2 className="h-5 w-5 mr-2" /> Submit Onboarding
                </Button>
              ) : (
                <Button
                  onClick={() => setCurrentStep(Math.min(STEPS.length, currentStep + 1))}
                  className={`min-h-[48px] px-6 font-bold rounded-xl bg-gradient-to-r ${c.gradient} text-white shadow-lg`}
                >
                  Next Step <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Pattern Legend */}
        <div className="mt-6 p-4 rounded-xl border border-slate-200 bg-white/80">
          <p className="font-bold text-slate-700 mb-3">Applied Design Patterns</p>
          <div className="flex flex-wrap gap-3 text-xs">
            {["Gradient Headers", "Glassmorphism", "Colored Sections", "Icon Containers", "Status Badges", "Responsive Grid"].map((p) => (
              <span key={p} className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 font-semibold">{p}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

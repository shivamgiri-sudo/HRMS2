import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  User, Landmark, ShieldCheck, Phone, UserPlus, GraduationCap, Briefcase,
  Users, FileText, ShieldAlert, CheckCircle2, Plus, Trash2, ExternalLink,
  AlertCircle, Upload, Loader2, ArrowLeft,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────

const GENDERS = ["Male", "Female", "Other"];
const ACCOUNT_TYPES = ["Savings", "Current", "Salary"];
const EMERGENCY_RELATIONS = ["Father", "Mother", "Husband", "Wife", "Son", "Daughter", "Brother", "Sister", "Guardian", "Other"];
const NOMINEE_RELATIONS = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Guardian", "Other"];

// Same 14-type checklist and required/optional split as REQUIRED_DOCS in
// OnboardingSteps1to5.tsx (the candidate journey's source list) — the first 7
// entries are required there, not the first 5.
const REQUIRED_DOCS: Array<{ type: string; label: string; required: boolean }> = [
  { type: "Aadhaar", label: "Aadhaar Card", required: true },
  { type: "PAN Card", label: "PAN Card", required: true },
  { type: "Address Proof", label: "Address Proof", required: true },
  { type: "Cancelled Cheque", label: "Cancelled Cheque / Bank Passbook", required: true },
  { type: "Passport Photo", label: "Passport Size Photo", required: true },
  { type: "10th Marksheet", label: "10th Marksheet / Certificate", required: true },
  { type: "12th Marksheet", label: "12th Marksheet / Diploma Certificate", required: true },
  { type: "Degree Certificate", label: "Degree / Graduation Certificate", required: false },
  { type: "Experience Letter", label: "Experience Letter", required: false },
  { type: "Relieving Letter", label: "Relieving Letter", required: false },
  { type: "Salary Slip", label: "Last Salary Slip", required: false },
  { type: "Passport", label: "Passport", required: false },
  { type: "Driving License", label: "Driving License", required: false },
  { type: "Voter ID", label: "Voter ID", required: false },
];

const STEPS: Array<{ id: string; label: string }> = [
  { id: "personal", label: "1. Personal / KYC" },
  { id: "bank", label: "2. Bank" },
  { id: "statutory", label: "3. Statutory" },
  { id: "emergency", label: "4. Emergency" },
  { id: "nominee", label: "5. Nominee" },
  { id: "education", label: "6. Education" },
  { id: "experience", label: "7. Experience" },
  { id: "family", label: "8. Family" },
  { id: "documents", label: "9. Documents" },
  { id: "bgv", label: "10. BGV" },
];

// ── Shared step shell ─────────────────────────────────────────────────────

function StepCard({
  icon: Icon, title, description, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

// ── Step 1: Personal / KYC ────────────────────────────────────────────────

interface PersonalForm {
  gender: string;
  dateOfBirth: string;
  personalEmail: string;
  personalMobile: string;
  address1: string;
  city: string;
}

const emptyPersonalForm: PersonalForm = {
  gender: "", dateOfBirth: "", personalEmail: "", personalMobile: "", address1: "", city: "",
};

function StepPersonal({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PersonalForm>(emptyPersonalForm);
  const initialized = useRef(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["epc-personal", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>(`/api/employees/${employeeId}`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (employee && !initialized.current) {
      setForm({
        gender: employee.gender ?? "",
        dateOfBirth: employee.date_of_birth ? String(employee.date_of_birth).slice(0, 10) : "",
        personalEmail: employee.personal_email ?? "",
        personalMobile: employee.personal_phone ?? "",
        address1: employee.address1 ?? "",
        city: employee.city ?? "",
      });
      initialized.current = true;
    }
  }, [employee]);

  const upd = (k: keyof PersonalForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (form.gender) payload.gender = form.gender;
      if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth;
      if (form.personalEmail.trim()) payload.personalEmail = form.personalEmail.trim();
      if (form.personalMobile.trim()) payload.personalMobile = form.personalMobile.trim();
      if (form.address1.trim()) payload.address1 = form.address1.trim();
      if (form.city.trim()) payload.city = form.city.trim();
      return hrmsApi.patch(`/api/employees/${employeeId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epc-personal", employeeId] });
      toast({ title: "Saved", description: "Personal details updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save personal details.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={User} title="Personal / KYC" description="Gender, date of birth and personal contact details">
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pc-gender">Gender</Label>
              <Select value={form.gender} onValueChange={(v) => upd("gender", v)}>
                <SelectTrigger id="pc-gender"><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc-dob">Date of Birth</Label>
              <Input id="pc-dob" type="date" value={form.dateOfBirth} onChange={(e) => upd("dateOfBirth", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc-pemail">Personal Email</Label>
              <Input id="pc-pemail" type="email" placeholder="name@example.com" value={form.personalEmail} onChange={(e) => upd("personalEmail", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc-pmobile">Personal Mobile</Label>
              <Input id="pc-pmobile" placeholder="10-digit mobile number" value={form.personalMobile} onChange={(e) => upd("personalMobile", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc-city">City</Label>
              <Input id="pc-city" placeholder="City" value={form.city} onChange={(e) => upd("city", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-address">Address</Label>
            <Textarea id="pc-address" placeholder="House / Street / Area" rows={3} value={form.address1} onChange={(e) => upd("address1", e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Personal Details
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

// ── Step 2: Bank details ──────────────────────────────────────────────────

interface BankForm {
  bank_name: string;
  account_holder_name: string;
  bank_branch: string;
  ifsc_code: string;
  account_type: string;
  account_number: string;
}

const emptyBankForm: BankForm = {
  bank_name: "", account_holder_name: "", bank_branch: "", ifsc_code: "", account_type: "", account_number: "",
};

function StepBank({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<BankForm>(emptyBankForm);
  const upd = (k: keyof BankForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      // The backend route always reads all six keys without an `undefined` guard,
      // so every field must be sent explicitly (null, not omitted) or mysql2
      // throws "Bind parameters must not contain undefined".
      return hrmsApi.put(`/api/employees/${employeeId}/bank-details`, {
        bank_name: form.bank_name.trim() || null,
        account_holder_name: form.account_holder_name.trim() || null,
        bank_branch: form.bank_branch.trim() || null,
        ifsc_code: form.ifsc_code.trim() || null,
        account_type: form.account_type || null,
        account_number: form.account_number.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Bank details saved. Verification happens separately." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save bank details.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={Landmark} title="Bank Details" description="No penny-drop verification here — plain entry only, saved as pending verification">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This step does not preload previously saved values. Submitting again safely updates the existing bank record.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bk-name">Bank Name</Label>
          <Input id="bk-name" value={form.bank_name} onChange={(e) => upd("bank_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bk-holder">Account Holder Name</Label>
          <Input id="bk-holder" value={form.account_holder_name} onChange={(e) => upd("account_holder_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bk-branch">Branch</Label>
          <Input id="bk-branch" value={form.bank_branch} onChange={(e) => upd("bank_branch", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bk-ifsc">IFSC Code</Label>
          <Input id="bk-ifsc" placeholder="e.g. HDFC0001234" value={form.ifsc_code} onChange={(e) => upd("ifsc_code", e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bk-type">Account Type</Label>
          <Select value={form.account_type} onValueChange={(v) => upd("account_type", v)}>
            <SelectTrigger id="bk-type"><SelectValue placeholder="Select account type" /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bk-acct">Account Number</Label>
          <Input id="bk-acct" value={form.account_number} onChange={(e) => upd("account_number", e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Bank Details
        </Button>
      </div>
    </StepCard>
  );
}

// ── Step 3: Statutory details ─────────────────────────────────────────────

interface StatutoryForm {
  epf_number: string;
  esi_number: string;
  uan_number: string;
  pan_number: string;
  aadhaar_id: string;
  epf_date: string;
  pf_eligible: boolean;
  esi_eligible: boolean;
  previous_pf_member: boolean;
  eps_member: boolean;
  international_worker: boolean;
  declaration_accepted: boolean;
}

const emptyStatutoryForm: StatutoryForm = {
  epf_number: "", esi_number: "", uan_number: "", pan_number: "", aadhaar_id: "", epf_date: "",
  pf_eligible: false, esi_eligible: false,
  previous_pf_member: false, eps_member: false, international_worker: false, declaration_accepted: false,
};

function DeclarationCheckbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer rounded-lg border-2 p-3 transition-colors ${checked ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/30"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

function StepStatutory({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<StatutoryForm>(emptyStatutoryForm);
  const initialized = useRef(false);
  const upd = <K extends keyof StatutoryForm>(k: K, v: StatutoryForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  // No dedicated GET for statutory-details; the employees table carries a few of
  // the same values (pan_number, uan_number, epf_number, esic_number) that we can
  // use as a best-effort prefill, since the header query is fetched anyway.
  const { data: employee } = useQuery({
    queryKey: ["epc-statutory-employee", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>(`/api/employees/${employeeId}`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (employee && !initialized.current) {
      setForm((p) => ({
        ...p,
        pan_number: employee.pan_number ?? "",
        uan_number: employee.uan_number ?? "",
        epf_number: employee.epf_number ?? "",
        esi_number: employee.esic_number ?? "",
      }));
      initialized.current = true;
    }
  }, [employee]);

  const mutation = useMutation({
    mutationFn: async () => {
      return hrmsApi.put(`/api/employees/${employeeId}/statutory-details`, {
        epf_number: form.epf_number.trim() || undefined,
        esi_number: form.esi_number.trim() || undefined,
        uan_number: form.uan_number.trim() || undefined,
        pan_number: form.pan_number.trim() || undefined,
        aadhaar_id: form.aadhaar_id.trim() || undefined,
        epf_date: form.epf_date || undefined,
        pf_eligible: form.pf_eligible,
        esi_eligible: form.esi_eligible,
        previous_pf_member: form.previous_pf_member,
        eps_member: form.eps_member,
        international_worker: form.international_worker,
        declaration_accepted: form.declaration_accepted,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Statutory details saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save statutory details.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={ShieldCheck} title="Statutory Details" description="PF, ESI and identity numbers for statutory compliance">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="st-epf">EPF Number</Label>
          <Input id="st-epf" value={form.epf_number} onChange={(e) => upd("epf_number", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="st-esi">ESI Number</Label>
          <Input id="st-esi" value={form.esi_number} onChange={(e) => upd("esi_number", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="st-uan">UAN Number</Label>
          <Input id="st-uan" value={form.uan_number} onChange={(e) => upd("uan_number", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="st-pan">PAN Number</Label>
          <Input id="st-pan" value={form.pan_number} onChange={(e) => upd("pan_number", e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="st-aadhaar">Aadhaar ID</Label>
          <Input id="st-aadhaar" value={form.aadhaar_id} onChange={(e) => upd("aadhaar_id", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="st-epfdate">EPF Date</Label>
          <Input id="st-epfdate" type="date" value={form.epf_date} onChange={(e) => upd("epf_date", e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.pf_eligible} onChange={(e) => upd("pf_eligible", e.target.checked)} />
          PF Eligible
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.esi_eligible} onChange={(e) => upd("esi_eligible", e.target.checked)} />
          ESI Eligible
        </label>
      </div>

      <div className="space-y-2">
        <Label className="text-sm text-muted-foreground">Declarations</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <DeclarationCheckbox
            checked={form.previous_pf_member}
            onChange={(v) => upd("previous_pf_member", v)}
            label="Was a PF member in a previous job"
          />
          <DeclarationCheckbox
            checked={form.eps_member}
            onChange={(v) => upd("eps_member", v)}
            label="Employee Pension Scheme (EPS) member"
          />
          <DeclarationCheckbox
            checked={form.international_worker}
            onChange={(v) => upd("international_worker", v)}
            label="International worker (foreign national / foreign passport)"
          />
          <DeclarationCheckbox
            checked={form.declaration_accepted}
            onChange={(v) => upd("declaration_accepted", v)}
            label="I declare the above statutory information is true and correct"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Statutory Details
        </Button>
      </div>
    </StepCard>
  );
}

// ── Step 4: Emergency contact ─────────────────────────────────────────────

interface EmergencyForm {
  name: string;
  relationship: string;
  mobile: string;
  address: string;
}

const emptyEmergencyForm: EmergencyForm = { name: "", relationship: "", mobile: "", address: "" };

function StepEmergency({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<EmergencyForm>(emptyEmergencyForm);
  const upd = (k: keyof EmergencyForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.relationship.trim() || !form.mobile.trim()) {
        throw new Error("Name, relationship and mobile are required.");
      }
      return hrmsApi.put(`/api/employees/${employeeId}/emergency-contact`, {
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        mobile: form.mobile.trim(),
        address: form.address.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Emergency contact saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save emergency contact.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={Phone} title="Emergency Contact" description="Name, relationship and mobile are required by the API">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This step does not preload previously saved values. Submitting again safely updates the existing contact.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ec-name">Contact Name *</Label>
          <Input id="ec-name" value={form.name} onChange={(e) => upd("name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ec-rel">Relationship *</Label>
          <Select value={form.relationship} onValueChange={(v) => upd("relationship", v)}>
            <SelectTrigger id="ec-rel"><SelectValue placeholder="Select relationship" /></SelectTrigger>
            <SelectContent>
              {EMERGENCY_RELATIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ec-mobile">Mobile *</Label>
          <Input id="ec-mobile" value={form.mobile} onChange={(e) => upd("mobile", e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ec-address">Address</Label>
        <Textarea id="ec-address" rows={3} value={form.address} onChange={(e) => upd("address", e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Emergency Contact
        </Button>
      </div>
    </StepCard>
  );
}

// ── Step 5: Nominee ───────────────────────────────────────────────────────

interface NomineeForm {
  nominee_name: string;
  relationship: string;
  date_of_birth: string;
  mobile: string;
  address: string;
}

const emptyNomineeForm: NomineeForm = { nominee_name: "", relationship: "", date_of_birth: "", mobile: "", address: "" };

function StepNominee({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<NomineeForm>(emptyNomineeForm);
  const upd = (k: keyof NomineeForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.nominee_name.trim() || !form.relationship.trim()) {
        throw new Error("Nominee name and relationship are required.");
      }
      return hrmsApi.put(`/api/employees/${employeeId}/nominee`, {
        nominee_name: form.nominee_name.trim(),
        relationship: form.relationship.trim(),
        date_of_birth: form.date_of_birth || undefined,
        mobile: form.mobile.trim() || undefined,
        address: form.address.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Nominee saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save nominee.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={UserPlus} title="Nominee" description="Nominee name and relationship are required by the API">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This step does not preload previously saved values. Submitting again safely updates the existing nominee.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nm-name">Nominee Name *</Label>
          <Input id="nm-name" value={form.nominee_name} onChange={(e) => upd("nominee_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nm-rel">Relationship *</Label>
          <Select value={form.relationship} onValueChange={(v) => upd("relationship", v)}>
            <SelectTrigger id="nm-rel"><SelectValue placeholder="Select relationship" /></SelectTrigger>
            <SelectContent>
              {NOMINEE_RELATIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="nm-dob">Date of Birth</Label>
          <Input id="nm-dob" type="date" value={form.date_of_birth} onChange={(e) => upd("date_of_birth", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nm-mobile">Mobile</Label>
          <Input id="nm-mobile" value={form.mobile} onChange={(e) => upd("mobile", e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="nm-address">Address</Label>
        <Textarea id="nm-address" rows={3} value={form.address} onChange={(e) => upd("address", e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Nominee
        </Button>
      </div>
    </StepCard>
  );
}

// ── Step 6: Education (repeater) ──────────────────────────────────────────

interface EducationForm {
  qualification: string;
  specialization_course_name: string;
  institution_name: string;
  board_type: string;
  passed_out_state: string;
  passed_out_city: string;
  passed_out_year: string;
  passed_out_percentage: string;
}

const emptyEducationForm: EducationForm = {
  qualification: "", specialization_course_name: "", institution_name: "", board_type: "",
  passed_out_state: "", passed_out_city: "", passed_out_year: "", passed_out_percentage: "",
};

function StepEducation({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EducationForm>(emptyEducationForm);
  const upd = (k: keyof EducationForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["epc-education", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/employees/${employeeId}/education`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!form.qualification.trim()) throw new Error("Qualification is required.");
      return hrmsApi.post(`/api/employees/${employeeId}/education`, {
        qualification: form.qualification.trim(),
        specialization_course_name: form.specialization_course_name.trim() || undefined,
        institution_name: form.institution_name.trim() || undefined,
        board_type: form.board_type.trim() || undefined,
        passed_out_state: form.passed_out_state.trim() || undefined,
        passed_out_city: form.passed_out_city.trim() || undefined,
        passed_out_year: form.passed_out_year.trim() || undefined,
        passed_out_percentage: form.passed_out_percentage.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epc-education", employeeId] });
      setForm(emptyEducationForm);
      toast({ title: "Added", description: "Qualification added." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to add qualification.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (educationId: string) => hrmsApi.delete(`/api/employees/${employeeId}/education/${educationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epc-education", employeeId] });
      toast({ title: "Removed", description: "Qualification removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove qualification.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={GraduationCap} title="Education" description="Add each qualification separately; an employee can have several">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="ed-qual">Qualification *</Label>
          <Input id="ed-qual" placeholder="e.g. B.Com" value={form.qualification} onChange={(e) => upd("qualification", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-spec">Specialization / Course</Label>
          <Input id="ed-spec" value={form.specialization_course_name} onChange={(e) => upd("specialization_course_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-inst">Institution</Label>
          <Input id="ed-inst" value={form.institution_name} onChange={(e) => upd("institution_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-board">Board / University</Label>
          <Input id="ed-board" value={form.board_type} onChange={(e) => upd("board_type", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-state">State</Label>
          <Input id="ed-state" value={form.passed_out_state} onChange={(e) => upd("passed_out_state", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-city">City</Label>
          <Input id="ed-city" value={form.passed_out_city} onChange={(e) => upd("passed_out_city", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-year">Year of Passing</Label>
          <Input id="ed-year" inputMode="numeric" value={form.passed_out_year} onChange={(e) => upd("passed_out_year", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ed-pct">Percentage / CGPA</Label>
          <Input id="ed-pct" value={form.passed_out_percentage} onChange={(e) => upd("passed_out_percentage", e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
          {addMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add Qualification
        </Button>
      </div>

      <div className="space-y-2 pt-2 border-t border-border">
        <Label className="text-sm text-muted-foreground">Added Qualifications ({rows.length})</Label>
        {isLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No qualifications added yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((q: any) => (
              <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="font-medium text-foreground">{q.qualification}</p>
                  <p className="text-xs text-muted-foreground">
                    {[q.specialization_course_name, q.institution_name, q.board_type, q.passed_out_year && `Year: ${q.passed_out_year}`, q.passed_out_percentage && `${q.passed_out_percentage}%`]
                      .filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(q.id)} disabled={deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </StepCard>
  );
}

// ── Step 7: Experience (single latest employer) ──────────────────────────

interface ExperienceForm {
  is_fresher: boolean;
  employer_name: string;
  last_designation: string;
  last_ctc: string;
  experience_years: string;
  from_date: string;
  to_date: string;
  reason_for_leaving: string;
}

const emptyExperienceForm: ExperienceForm = {
  is_fresher: false, employer_name: "", last_designation: "", last_ctc: "",
  experience_years: "", from_date: "", to_date: "", reason_for_leaving: "",
};

function StepExperience({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ExperienceForm>(emptyExperienceForm);
  const initialized = useRef(false);
  const upd = <K extends keyof ExperienceForm>(k: K, v: ExperienceForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { data: existing, isLoading } = useQuery({
    queryKey: ["epc-experience", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any | null }>(`/api/employees/${employeeId}/experience`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (existing && !initialized.current) {
      setForm({
        is_fresher: !!existing.is_fresher,
        employer_name: existing.employer_name ?? "",
        last_designation: existing.last_designation ?? "",
        last_ctc: existing.last_ctc != null ? String(existing.last_ctc) : "",
        experience_years: existing.experience_years != null ? String(existing.experience_years) : "",
        from_date: existing.from_date ? String(existing.from_date).slice(0, 10) : "",
        to_date: existing.to_date ? String(existing.to_date).slice(0, 10) : "",
        reason_for_leaving: existing.reason_for_leaving ?? "",
      });
      initialized.current = true;
    }
  }, [existing]);

  const mutation = useMutation({
    mutationFn: async () => {
      return hrmsApi.put(`/api/employees/${employeeId}/experience`, {
        is_fresher: form.is_fresher,
        employer_name: form.is_fresher ? undefined : (form.employer_name.trim() || undefined),
        last_designation: form.is_fresher ? undefined : (form.last_designation.trim() || undefined),
        last_ctc: form.is_fresher ? undefined : (form.last_ctc.trim() || undefined),
        experience_years: form.is_fresher ? undefined : (form.experience_years.trim() || undefined),
        from_date: form.is_fresher ? undefined : (form.from_date || undefined),
        to_date: form.is_fresher ? undefined : (form.to_date || undefined),
        reason_for_leaving: form.is_fresher ? undefined : (form.reason_for_leaving.trim() || undefined),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epc-experience", employeeId] });
      toast({ title: "Saved", description: "Experience details saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save experience.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={Briefcase} title="Work Experience" description="Most recent employer only — a single latest-employer entry, not full history">
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="ex-fresher">I am a fresher</Label>
              <p className="text-xs text-muted-foreground">Toggle on if this employee has no prior work experience</p>
            </div>
            <input
              id="ex-fresher"
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={form.is_fresher}
              onChange={(e) => upd("is_fresher", e.target.checked)}
            />
          </div>

          {!form.is_fresher && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ex-employer">Employer Name</Label>
                <Input id="ex-employer" value={form.employer_name} onChange={(e) => upd("employer_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-desig">Last Designation</Label>
                <Input id="ex-desig" value={form.last_designation} onChange={(e) => upd("last_designation", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-ctc">Last CTC</Label>
                <Input id="ex-ctc" inputMode="numeric" value={form.last_ctc} onChange={(e) => upd("last_ctc", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-years">Experience (years)</Label>
                <Input id="ex-years" inputMode="decimal" value={form.experience_years} onChange={(e) => upd("experience_years", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-from">From Date</Label>
                <Input id="ex-from" type="date" value={form.from_date} onChange={(e) => upd("from_date", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-to">To Date</Label>
                <Input id="ex-to" type="date" value={form.to_date} onChange={(e) => upd("to_date", e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="ex-reason">Reason for Leaving</Label>
                <Input id="ex-reason" value={form.reason_for_leaving} onChange={(e) => upd("reason_for_leaving", e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Experience Details
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

// ── Step 8: Family ─────────────────────────────────────────────────────────

interface FamilyForm {
  annualIncome: string;
  countOfDependents: string;
}

function StepFamily({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FamilyForm>({ annualIncome: "", countOfDependents: "" });
  const initialized = useRef(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["epc-family", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>(`/api/employees/${employeeId}`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (employee && !initialized.current) {
      setForm({
        annualIncome: employee.annual_income != null ? String(employee.annual_income) : "",
        countOfDependents: employee.count_of_dependents != null ? String(employee.count_of_dependents) : "",
      });
      initialized.current = true;
    }
  }, [employee]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (form.annualIncome.trim()) payload.annualIncome = Number(form.annualIncome);
      if (form.countOfDependents.trim()) payload.countOfDependents = Number(form.countOfDependents);
      return hrmsApi.patch(`/api/employees/${employeeId}`, payload);
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Family details updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save family details.", variant: "destructive" });
    },
  });

  return (
    <StepCard icon={Users} title="Family" description="Household income and dependents, for HR records">
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fm-income">Annual Household Income (₹)</Label>
              <Input id="fm-income" inputMode="numeric" value={form.annualIncome} onChange={(e) => setForm((p) => ({ ...p, annualIncome: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fm-deps">Number of Dependents</Label>
              <Input id="fm-deps" inputMode="numeric" value={form.countOfDependents} onChange={(e) => setForm((p) => ({ ...p, countOfDependents: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Family Details
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

// ── Step 9: Documents ─────────────────────────────────────────────────────

function StepDocuments({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>({});
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["epc-documents", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>(`/api/employee-docs/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ type, label, file }: { type: string; label: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", type);
      formData.append("document_name", label);
      return hrmsApi.postForm(`/api/employee-docs/${employeeId}/upload`, formData);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["epc-documents", employeeId] });
      setPendingFiles((p) => ({ ...p, [variables.type]: null }));
      toast({ title: "Uploaded", description: `${variables.label} uploaded.` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to upload document.", variant: "destructive" });
    },
    onSettled: () => setUploadingType(null),
  });

  const statusFor = (docType: string): "not_uploaded" | "uploaded" | "verified" => {
    const match = docs.find((d: any) => d.document_type === docType);
    if (!match) return "not_uploaded";
    return match.verified ? "verified" : "uploaded";
  };

  return (
    <StepCard icon={FileText} title="Documents" description="Upload checklist — first 7 types required, the rest optional">
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-3">
          {REQUIRED_DOCS.map((def) => {
            const status = statusFor(def.type);
            const file = pendingFiles[def.type] ?? null;
            const isUploading = uploadingType === def.type && uploadMutation.isPending;
            return (
              <div key={def.type} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  {status === "verified" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : status === "uploaded" ? (
                    <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                  ) : (
                    <AlertCircle className={`h-4 w-4 flex-shrink-0 ${def.required ? "text-destructive" : "text-muted-foreground"}`} />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {def.label} {def.required && <span className="text-destructive">*</span>}
                    </p>
                    <Badge variant={status === "verified" ? "default" : status === "uploaded" ? "secondary" : "outline"} className="mt-0.5 text-[10px]">
                      {status === "verified" ? "Verified" : status === "uploaded" ? "Uploaded" : "Not uploaded"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                      className="sr-only"
                      onChange={(e) => setPendingFiles((p) => ({ ...p, [def.type]: e.target.files?.[0] ?? null }))}
                    />
                    <span className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      {file ? file.name : "Choose file"}
                    </span>
                  </label>
                  <Button
                    size="sm"
                    disabled={!file || isUploading}
                    onClick={() => {
                      if (!file) return;
                      setUploadingType(def.type);
                      uploadMutation.mutate({ type: def.type, label: def.label, file });
                    }}
                  >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </StepCard>
  );
}

// ── Step 10: BGV ───────────────────────────────────────────────────────────

function StepBgv({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [consentChecked, setConsentChecked] = useState(false);

  const { data: bgv, isLoading } = useQuery({
    queryKey: ["epc-bgv", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>(`/api/bgv/employee/${employeeId}`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!consentChecked) throw new Error("Consent must be confirmed before starting BGV.");
      return hrmsApi.post<{ data: { candidateId: string; alreadyLinked: boolean } }>(
        `/api/employees/${employeeId}/bgv/start`,
        { consentConfirmed: true }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epc-bgv", employeeId] });
      toast({ title: "Started", description: "Background verification has been started." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to start background verification.", variant: "destructive" });
    },
  });

  const alreadyStarted = bgv && bgv.status !== "no_bgv_record";
  const candidateId = bgv?.candidateId ?? startMutation.data?.data?.candidateId ?? null;

  return (
    <StepCard icon={ShieldAlert} title="Background Verification" description="Consent-and-start action — HR confirms consent, then launches BGV in the existing verification centre">
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : alreadyStarted ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <p className="text-sm">
              Current BGV status: <Badge variant="secondary">{bgv.status}</Badge>
            </p>
          </div>
          {candidateId && (
            <Button asChild variant="outline">
              <Link to={`/bgv-report-view/${candidateId}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open BGV Report
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
            I confirm this employee has been informed that a background verification check will be run using
            their personal, contact, and identity information, and has consented to it.
          </div>
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border-2 border-border p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            <span className="text-sm text-foreground">I confirm the employee's consent has been recorded.</span>
          </label>
          {startMutation.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{(startMutation.error as Error).message}</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (!consentChecked) return;
                startMutation.mutate();
              }}
              disabled={!consentChecked || startMutation.isPending}
            >
              {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Background Verification
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────

export default function EmployeeProfileCompletion() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [activeStep, setActiveStep] = useState("personal");

  const { data: employee, isLoading: headerLoading } = useQuery({
    queryKey: ["epc-header", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>(`/api/employees/${employeeId}`);
      return res.data;
    },
    enabled: !!employeeId,
  });

  if (!employeeId) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-foreground font-semibold">No employee specified</p>
          <p className="text-sm text-muted-foreground">This page requires an employee ID in the URL.</p>
        </div>
      </DashboardLayout>
    );
  }

  const employeeName = employee ? [employee.first_name, employee.last_name].filter(Boolean).join(" ") : "";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/employees"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {headerLoading ? "Loading…" : `Complete Profile — ${employeeName || "Employee"}${employee?.employee_code ? ` (${employee.employee_code})` : ""}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              Every step below is optional and saves independently — come back anytime to fill in more.
            </p>
          </div>
        </div>

        <Tabs value={activeStep} onValueChange={setActiveStep}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
            {STEPS.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="text-xs sm:text-sm">
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="personal" className="mt-6"><StepPersonal employeeId={employeeId} /></TabsContent>
          <TabsContent value="bank" className="mt-6"><StepBank employeeId={employeeId} /></TabsContent>
          <TabsContent value="statutory" className="mt-6"><StepStatutory employeeId={employeeId} /></TabsContent>
          <TabsContent value="emergency" className="mt-6"><StepEmergency employeeId={employeeId} /></TabsContent>
          <TabsContent value="nominee" className="mt-6"><StepNominee employeeId={employeeId} /></TabsContent>
          <TabsContent value="education" className="mt-6"><StepEducation employeeId={employeeId} /></TabsContent>
          <TabsContent value="experience" className="mt-6"><StepExperience employeeId={employeeId} /></TabsContent>
          <TabsContent value="family" className="mt-6"><StepFamily employeeId={employeeId} /></TabsContent>
          <TabsContent value="documents" className="mt-6"><StepDocuments employeeId={employeeId} /></TabsContent>
          <TabsContent value="bgv" className="mt-6"><StepBgv employeeId={employeeId} /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

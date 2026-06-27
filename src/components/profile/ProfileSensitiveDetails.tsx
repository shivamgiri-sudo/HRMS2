import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Banknote,
  CircleAlert,
  Clock,
  HeartHandshake,
  Landmark,
  Loader2,
  LockKeyhole,
  PhoneCall,
  Save,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type VerificationStatus = "verified" | "pending" | "rejected" | "not_provided";

interface BankDetails {
  bank_name?: string | null;
  account_holder_name?: string | null;
  bank_branch?: string | null;
  ifsc_code?: string | null;
  account_type?: string | null;
  masked_account_number?: string | null;
  verification_status?: VerificationStatus;
}

interface StatutoryDetails {
  masked_pan_number?: string | null;
  masked_aadhaar_number?: string | null;
  masked_pf_number?: string | null;
  masked_uan?: string | null;
  pan_verification_status?: VerificationStatus;
  aadhaar_verification_status?: VerificationStatus;
  pf_uan_verification_status?: VerificationStatus;
}

interface EmergencyContact {
  name?: string | null;
  relationship?: string | null;
  mobile?: string | null;
  address?: string | null;
}

interface NomineeDetails {
  nominee_name?: string | null;
  relationship?: string | null;
  date_of_birth?: string | null;
  mobile?: string | null;
  address?: string | null;
}

interface SensitiveProfile {
  bank_details?: BankDetails | null;
  statutory_details?: StatutoryDetails | null;
  emergency_contact?: EmergencyContact | null;
  nominee?: NomineeDetails | null;
}

function VerificationBadge({ status = "not_provided" }: { status?: VerificationStatus }) {
  const styles: Record<VerificationStatus, string> = {
    verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    rejected: "border-rose-200 bg-rose-50 text-rose-700",
    not_provided: "border-slate-200 bg-slate-50 text-slate-600",
  };
  const labels: Record<VerificationStatus, string> = {
    verified: "Verified",
    pending: "Pending verification",
    rejected: "Rejected",
    not_provided: "Not provided",
  };
  return (
    <Badge variant="outline" className={`rounded-full font-semibold ${styles[status]}`}>
      {status === "verified" ? <BadgeCheck className="mr-1 size-3.5" /> : null}
      {labels[status]}
    </Badge>
  );
}

function DetailValue({
  label,
  value,
  status,
}: {
  label: string;
  value?: string | null;
  status?: VerificationStatus;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        {status ? <VerificationBadge status={status} /> : null}
      </div>
      <p className="mt-3 truncate text-base font-bold tabular-nums text-slate-950">
        {value || "Not provided"}
      </p>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f2fc] text-[#073f78]">
          {icon}
        </div>
        <div>
          <h2 className="text-balance text-lg font-bold text-slate-950">{title}</h2>
          <p className="mt-1 text-pretty text-sm text-slate-700">{description}</p>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function invalidateProfile(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  void queryClient.invalidateQueries({ queryKey: ["employee-profile"] });
}

export function BankStatutoryDetails({ employee, allowStatutoryEdit = false }: { employee: SensitiveProfile; allowStatutoryEdit?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const bank = employee.bank_details;
  const statutory = employee.statutory_details;
  const [bankError, setBankError] = useState("");
  const [statutoryError, setStatutoryError] = useState("");
  const [bankForm, setBankForm] = useState({
    bank_name: bank?.bank_name ?? "",
    account_holder_name: bank?.account_holder_name ?? "",
    bank_branch: bank?.bank_branch ?? "",
    ifsc_code: bank?.ifsc_code ?? "",
    account_type: bank?.account_type || "Savings",
    account_number: "",
  });
  const [statutoryForm, setStatutoryForm] = useState({
    pan_number: "",
    aadhaar_id: "",
    uan_number: "",
    epf_number: "",
  });

  const { data: pendingBankRequest } = useQuery({
    queryKey: ["my-pending-bank-request"],
    queryFn: () => hrmsApi.get<{ pending: boolean; requested_at?: string }>("/api/employees/me/bank-change-status"),
    retry: false,
  });

  const bankMutation = useMutation({
    mutationFn: () => hrmsApi.post("/api/employees/me/bank-change-request", {
      ...bankForm,
      bank_branch: bankForm.bank_branch || null,
      account_number: bankForm.account_number || undefined,
    }),
    onSuccess: () => {
      setBankError("");
      setBankForm((current) => ({ ...current, account_number: "" }));
      invalidateProfile(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["my-pending-bank-request"] });
      toast({
        title: "Bank change request submitted",
        description: "Your request has been routed to Payroll HO for approval. The new account will be effective from the next payroll run after approval.",
      });
    },
    onError: (error: Error) => setBankError(error.message),
  });

  const statutoryMutation = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries(
        Object.entries(statutoryForm).filter(([key, value]) => {
          if (!value.trim()) return false;
          if (!allowStatutoryEdit && (key === "pan_number" || key === "aadhaar_id")) return false;
          return true;
        }),
      );
      return hrmsApi.put("/api/employees/me/statutory-details", payload);
    },
    onSuccess: () => {
      setStatutoryError("");
      setStatutoryForm({ pan_number: "", aadhaar_id: "", uan_number: "", epf_number: "" });
      invalidateProfile(queryClient);
      toast({
        title: "Statutory details submitted",
        description: "The replacement values are pending HR or payroll verification.",
      });
    },
    onError: (error: Error) => setStatutoryError(error.message),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SectionCard
        icon={<Banknote className="size-5" />}
        title="Bank Account"
        description="Only the final four account digits are displayed. New submissions require verification."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailValue
            label="Account Number"
            value={bank?.masked_account_number}
            status={bank?.verification_status ?? "not_provided"}
          />
          <DetailValue label="IFSC Code" value={bank?.ifsc_code} />
        </div>

        {pendingBankRequest?.pending ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Clock className="size-4 shrink-0" />
            <span>A bank account change request is pending Payroll HO approval{pendingBankRequest.requested_at ? ` (submitted ${formatISTDate(pendingBankRequest.requested_at)})` : ""}. New requests will replace the pending one.</span>
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-bank-name">Bank Name</Label>
            <Input
              id="profile-bank-name"
              value={bankForm.bank_name}
              onChange={(event) => setBankForm((current) => ({
                ...current,
                bank_name: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-account-holder">Account Holder Name</Label>
            <Input
              id="profile-account-holder"
              value={bankForm.account_holder_name}
              onChange={(event) => setBankForm((current) => ({
                ...current,
                account_holder_name: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-bank-branch">Bank Branch</Label>
            <Input
              id="profile-bank-branch"
              value={bankForm.bank_branch}
              onChange={(event) => setBankForm((current) => ({
                ...current,
                bank_branch: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-ifsc">IFSC Code</Label>
            <Input
              id="profile-ifsc"
              value={bankForm.ifsc_code}
              onChange={(event) => setBankForm((current) => ({
                ...current,
                ifsc_code: event.target.value.toUpperCase(),
              }))}
              maxLength={11}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-account-type">Account Type</Label>
            <Select
              value={bankForm.account_type}
              onValueChange={(value) => setBankForm((current) => ({
                ...current,
                account_type: value,
              }))}
            >
              <SelectTrigger id="profile-account-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Savings">Savings</SelectItem>
                <SelectItem value="Current">Current</SelectItem>
                <SelectItem value="Salary">Salary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-account-number">
              {bank ? "Replacement Account Number" : "Account Number"}
            </Label>
            <Input
              id="profile-account-number"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={bankForm.account_number}
              onChange={(event) => setBankForm((current) => ({
                ...current,
                account_number: event.target.value.replace(/\D/g, ""),
              }))}
              placeholder={bank ? "Leave blank to keep current" : "Enter account number"}
              maxLength={20}
            />
          </div>
        </div>

        {bankError ? (
          <p className="mt-4 text-sm font-medium text-rose-700" role="alert">{bankError}</p>
        ) : null}
        <Button
          className="mt-5 bg-[#073f78] hover:bg-[#0b4f91]"
          onClick={() => bankMutation.mutate()}
          disabled={bankMutation.isPending}
        >
          {bankMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          {bank ? "Request Bank Account Change" : "Submit Bank Details"}
        </Button>
      </SectionCard>

      <SectionCard
        icon={<Landmark className="size-5" />}
        title="PF, UAN & Identity"
        description="PAN, PF, UAN and Aadhaar are always masked in your profile."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailValue
            label="PAN"
            value={statutory?.masked_pan_number}
            status={statutory?.pan_verification_status ?? "not_provided"}
          />
          <DetailValue
            label="Aadhaar"
            value={statutory?.masked_aadhaar_number}
            status={statutory?.aadhaar_verification_status ?? "not_provided"}
          />
          <DetailValue
            label="PF Member Number"
            value={statutory?.masked_pf_number}
            status={statutory?.masked_pf_number
              ? statutory.pf_uan_verification_status
              : "not_provided"}
          />
          <DetailValue
            label="UAN"
            value={statutory?.masked_uan}
            status={statutory?.masked_uan
              ? statutory.pf_uan_verification_status
              : "not_provided"}
          />
        </div>

        <div className="mt-5 flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-[#073f78]">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">
            {allowStatutoryEdit
              ? "Enter only values you need to replace. Aadhaar accepts its last four digits only."
              : "PAN and Aadhaar can only be updated by HR or Super Admin. Contact HR to make corrections."}
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {allowStatutoryEdit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="profile-pan">New PAN</Label>
                <Input
                  id="profile-pan"
                  autoComplete="off"
                  value={statutoryForm.pan_number}
                  onChange={(event) => setStatutoryForm((current) => ({
                    ...current,
                    pan_number: event.target.value.toUpperCase(),
                  }))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-aadhaar-last4">Aadhaar Number</Label>
                <Input
                  id="profile-aadhaar-last4"
                  inputMode="numeric"
                  autoComplete="off"
                  value={statutoryForm.aadhaar_id}
                  onChange={(event) => setStatutoryForm((current) => ({
                    ...current,
                    aadhaar_id: event.target.value.replace(/\D/g, ""),
                  }))}
                  placeholder="12-digit Aadhaar number"
                  maxLength={12}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="profile-pf">New PF Member Number</Label>
            <Input
              id="profile-pf"
              autoComplete="off"
              value={statutoryForm.epf_number}
              onChange={(event) => setStatutoryForm((current) => ({
                ...current,
                epf_number: event.target.value.toUpperCase(),
              }))}
              placeholder="PF member number"
              maxLength={32}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-uan">New UAN</Label>
            <Input
              id="profile-uan"
              inputMode="numeric"
              autoComplete="off"
              value={statutoryForm.uan_number}
              onChange={(event) => setStatutoryForm((current) => ({
                ...current,
                uan_number: event.target.value.replace(/\D/g, ""),
              }))}
              placeholder="12-digit UAN"
              maxLength={12}
            />
          </div>
        </div>

        {statutoryError ? (
          <p className="mt-4 text-sm font-medium text-rose-700" role="alert">{statutoryError}</p>
        ) : null}
        <Button
          className="mt-5 bg-[#073f78] hover:bg-[#0b4f91]"
          onClick={() => statutoryMutation.mutate()}
          disabled={statutoryMutation.isPending}
        >
          {statutoryMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
          Submit Statutory Details
        </Button>
      </SectionCard>
    </div>
  );
}

export function EmergencyNomineeDetails({ employee }: { employee: SensitiveProfile }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const emergency = employee.emergency_contact;
  const nominee = employee.nominee;
  const [emergencyError, setEmergencyError] = useState("");
  const [nomineeError, setNomineeError] = useState("");
  const [emergencyForm, setEmergencyForm] = useState({
    name: emergency?.name ?? "",
    relationship: emergency?.relationship ?? "",
    mobile: emergency?.mobile ?? "",
    address: emergency?.address ?? "",
  });
  const [nomineeForm, setNomineeForm] = useState({
    nominee_name: nominee?.nominee_name ?? "",
    relationship: nominee?.relationship ?? "",
    date_of_birth: nominee?.date_of_birth?.slice(0, 10) ?? "",
    mobile: nominee?.mobile ?? "",
    address: nominee?.address ?? "",
  });

  const emergencyMutation = useMutation({
    mutationFn: () => hrmsApi.put("/api/employees/me/emergency-contact", {
      ...emergencyForm,
      address: emergencyForm.address || null,
    }),
    onSuccess: () => {
      setEmergencyError("");
      invalidateProfile(queryClient);
      toast({ title: "Emergency contact saved" });
    },
    onError: (error: Error) => setEmergencyError(error.message),
  });

  const nomineeMutation = useMutation({
    mutationFn: () => hrmsApi.put("/api/employees/me/nominee", {
      ...nomineeForm,
      date_of_birth: nomineeForm.date_of_birth || null,
      mobile: nomineeForm.mobile || null,
      address: nomineeForm.address || null,
    }),
    onSuccess: () => {
      setNomineeError("");
      invalidateProfile(queryClient);
      toast({ title: "Nominee details saved" });
    },
    onError: (error: Error) => setNomineeError(error.message),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SectionCard
        icon={<PhoneCall className="size-5" />}
        title="Emergency Contact"
        description="The person HR should contact in an urgent situation."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="emergency-name">Contact Name</Label>
            <Input
              id="emergency-name"
              value={emergencyForm.name}
              onChange={(event) => setEmergencyForm((current) => ({
                ...current,
                name: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergency-relation">Relationship</Label>
            <Input
              id="emergency-relation"
              value={emergencyForm.relationship}
              onChange={(event) => setEmergencyForm((current) => ({
                ...current,
                relationship: event.target.value,
              }))}
              placeholder="Parent, spouse, sibling"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="emergency-mobile">Emergency Contact Number</Label>
            <Input
              id="emergency-mobile"
              type="tel"
              value={emergencyForm.mobile}
              onChange={(event) => setEmergencyForm((current) => ({
                ...current,
                mobile: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="emergency-address">Address</Label>
            <Textarea
              id="emergency-address"
              value={emergencyForm.address}
              onChange={(event) => setEmergencyForm((current) => ({
                ...current,
                address: event.target.value,
              }))}
            />
          </div>
        </div>
        {emergencyError ? (
          <p className="mt-4 text-sm font-medium text-rose-700" role="alert">{emergencyError}</p>
        ) : null}
        <Button
          className="mt-5 bg-[#073f78] hover:bg-[#0b4f91]"
          onClick={() => emergencyMutation.mutate()}
          disabled={emergencyMutation.isPending}
        >
          {emergencyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          Save Emergency Contact
        </Button>
      </SectionCard>

      <SectionCard
        icon={<HeartHandshake className="size-5" />}
        title="Nominee Details"
        description="Primary nominee for general employee benefits and records."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nominee-name">Nominee Name</Label>
            <Input
              id="nominee-name"
              value={nomineeForm.nominee_name}
              onChange={(event) => setNomineeForm((current) => ({
                ...current,
                nominee_name: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nominee-relation">Relationship</Label>
            <Input
              id="nominee-relation"
              value={nomineeForm.relationship}
              onChange={(event) => setNomineeForm((current) => ({
                ...current,
                relationship: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nominee-dob">Date of Birth</Label>
            <Input
              id="nominee-dob"
              type="date"
              value={nomineeForm.date_of_birth}
              onChange={(event) => setNomineeForm((current) => ({
                ...current,
                date_of_birth: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nominee-mobile">Nominee Contact Number</Label>
            <Input
              id="nominee-mobile"
              type="tel"
              value={nomineeForm.mobile}
              onChange={(event) => setNomineeForm((current) => ({
                ...current,
                mobile: event.target.value,
              }))}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="nominee-address">Nominee Address</Label>
            <Textarea
              id="nominee-address"
              value={nomineeForm.address}
              onChange={(event) => setNomineeForm((current) => ({
                ...current,
                address: event.target.value,
              }))}
            />
          </div>
        </div>
        {nomineeError ? (
          <p className="mt-4 text-sm font-medium text-rose-700" role="alert">{nomineeError}</p>
        ) : null}
        <Button
          className="mt-5 bg-[#073f78] hover:bg-[#0b4f91]"
          onClick={() => nomineeMutation.mutate()}
          disabled={nomineeMutation.isPending}
        >
          {nomineeMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserRoundCheck className="mr-2 size-4" />}
          Save Nominee
        </Button>
      </SectionCard>

      <div className="xl:col-span-2 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <p className="text-pretty">
          Keep these details current. HR should verify nominee eligibility for PF, gratuity,
          insurance or other scheme-specific nominations separately.
        </p>
      </div>
    </div>
  );
}

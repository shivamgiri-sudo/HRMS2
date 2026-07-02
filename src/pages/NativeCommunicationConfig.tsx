import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, MessageSquare, MessagesSquare, CheckCircle2, XCircle,
  Loader2, Eye, EyeOff, Settings2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Channel = "email" | "sms" | "whatsapp";
type EmailProviderType = "nodemailer" | "sendgrid" | "mailgun" | "local-email-tool";
type SMSProviderType = "twilio" | "msg91" | "local-sms-tool";
type WAProviderType = "twilio" | "meta" | "local-whatsapp-tool";

interface ChannelConfig {
  id: string;
  channel: Channel;
  provider_type: string;
  config_json: Record<string, any>;
  is_enabled: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  test_at: string | null;
  secrets?: Record<string, string>;
}

// ── Reusable password input with show/hide toggle ─────────────────────────
function SecretInput({
  label, value, onChange, placeholder, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? "Enter value…"}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function StatusBadge({ config }: { config: ChannelConfig }) {
  if (!config.is_enabled) return <Badge variant="secondary">Disabled</Badge>;
  if (config.test_ok === null) return <Badge variant="outline" className="border-slate-300">Not Tested</Badge>;
  if (config.test_ok) return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Connected ✓</Badge>;
  return <Badge variant="destructive">Connection Failed</Badge>;
}

// ── EMAIL FORM ─────────────────────────────────────────────────────────────
function EmailForm({
  initial, onSave, isSaving,
}: {
  initial: ChannelConfig;
  onSave: (data: { provider_type: string; config: Record<string, any>; secrets: Record<string, string>; test_recipient?: string }) => void;
  isSaving: boolean;
}) {
  const [provider, setProvider] = useState<EmailProviderType>(
    (initial.provider_type as EmailProviderType) ?? "nodemailer"
  );
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string | boolean | number) =>
    setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) =>
    setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Email Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as EmailProviderType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nodemailer">SMTP — Gmail / Company Server / Any SMTP</SelectItem>
            <SelectItem value="sendgrid">SendGrid API</SelectItem>
            <SelectItem value="mailgun">Mailgun API</SelectItem>
            <SelectItem value="local-email-tool">Custom HTTP Endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "nodemailer" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>SMTP Host</Label>
              <Input
                value={cfg.smtp_host ?? ""}
                onChange={e => f("smtp_host")(e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Port</Label>
              <Input
                type="number"
                value={cfg.smtp_port ?? 587}
                onChange={e => f("smtp_port")(parseInt(e.target.value) || 587)}
                placeholder="587"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Username / Email</Label>
              <Input
                value={secrets.smtp_user ?? ""}
                onChange={e => s("smtp_user")(e.target.value)}
                placeholder="hr@mascallnet.com"
              />
            </div>
            <SecretInput
              label="Password / App Password"
              value={secrets.smtp_pass ?? ""}
              onChange={s("smtp_pass")}
              placeholder="Gmail App Password"
              hint="For Gmail: generate an App Password, not your regular password"
            />
            <div className="space-y-1.5">
              <Label>From Address</Label>
              <Input
                value={cfg.smtp_from ?? ""}
                onChange={e => f("smtp_from")(e.target.value)}
                placeholder="hr@mascallnet.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>From Name (display name)</Label>
              <Input
                value={cfg.smtp_from_name ?? ""}
                onChange={e => f("smtp_from_name")(e.target.value)}
                placeholder="MAS Callnet HRMS"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={!!cfg.smtp_secure}
              onCheckedChange={v => f("smtp_secure")(v)}
            />
            <div>
              <Label>Use SSL/TLS</Label>
              <p className="text-xs text-slate-500">Enable for port 465. Keep off for port 587 (STARTTLS).</p>
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            <strong>Gmail setup:</strong> Use <code className="bg-blue-100 px-1 rounded">smtp.gmail.com</code> port <code className="bg-blue-100 px-1 rounded">587</code>, your Gmail as username, and a{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="underline font-medium">Google App Password</a>{" "}
            (requires 2FA enabled on the Google account).
          </div>
        </div>
      )}

      {provider === "sendgrid" && (
        <div className="space-y-4">
          <SecretInput
            label="SendGrid API Key"
            value={secrets.sendgrid_api_key ?? ""}
            onChange={s("sendgrid_api_key")}
            placeholder="SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From Address <span className="text-slate-400">(must be verified in SendGrid)</span></Label>
              <Input
                value={cfg.sendgrid_from ?? ""}
                onChange={e => f("sendgrid_from")(e.target.value)}
                placeholder="hr@mascallnet.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>From Name</Label>
              <Input
                value={cfg.sendgrid_from_name ?? ""}
                onChange={e => f("sendgrid_from_name")(e.target.value)}
                placeholder="MAS Callnet HRMS"
              />
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            Get your API key at{" "}
            <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noopener noreferrer" className="underline font-medium">SendGrid → Settings → API Keys</a>.
            Verify your sender domain first under <em>Sender Authentication</em>.
          </div>
        </div>
      )}

      {provider === "mailgun" && (
        <div className="space-y-4">
          <SecretInput
            label="Mailgun API Key"
            value={secrets.mailgun_api_key ?? ""}
            onChange={s("mailgun_api_key")}
            placeholder="key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Mailgun Domain</Label>
              <Input
                value={cfg.mailgun_domain ?? ""}
                onChange={e => f("mailgun_domain")(e.target.value)}
                placeholder="mg.mascallnet.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select
                value={cfg.mailgun_region ?? "us"}
                onValueChange={v => f("mailgun_region")(v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">US — api.mailgun.net</SelectItem>
                  <SelectItem value="eu">EU — api.eu.mailgun.net</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>From Address</Label>
              <Input
                value={cfg.mailgun_from ?? ""}
                onChange={e => f("mailgun_from")(e.target.value)}
                placeholder="hr@mg.mascallnet.com"
              />
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>Note:</strong> Mailgun does not support file attachments via this integration. Use SendGrid if you need to send payslips or documents.
          </div>
        </div>
      )}

      {provider === "local-email-tool" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>API URL</Label>
            <Input
              value={cfg.local_api_url ?? ""}
              onChange={e => f("local_api_url")(e.target.value)}
              placeholder="https://your-email-api.com"
            />
          </div>
          <SecretInput
            label="API Key (Bearer token)"
            value={secrets.local_api_key ?? ""}
            onChange={s("local_api_key")}
          />
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1.5">
          <Label>Test Email Address</Label>
          <Input
            type="email"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="admin@mascallnet.com"
          />
          <p className="text-xs text-slate-500">
            Clicking Save will save the config. If you add a test email here, a test message will be sent immediately after saving.
          </p>
        </div>
        <Button
          onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })}
          disabled={isSaving}
          className="w-full"
        >
          {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving&hellip;</> : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}

// ── SMS FORM ───────────────────────────────────────────────────────────────
function SMSForm({
  initial, onSave, isSaving,
}: {
  initial: ChannelConfig;
  onSave: (data: { provider_type: string; config: Record<string, any>; secrets: Record<string, string>; test_recipient?: string }) => void;
  isSaving: boolean;
}) {
  const [provider, setProvider] = useState<SMSProviderType>(
    (initial.provider_type as SMSProviderType) ?? "twilio"
  );
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string) => setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) => setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>SMS Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as SMSProviderType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="twilio">Twilio (Global)</SelectItem>
            <SelectItem value="msg91">MSG91 — India (DLT registered)</SelectItem>
            <SelectItem value="local-sms-tool">Custom HTTP Endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "twilio" && (
        <div className="space-y-4">
          <SecretInput
            label="Account SID"
            value={secrets.twilio_account_sid ?? ""}
            onChange={s("twilio_account_sid")}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <SecretInput
            label="Auth Token"
            value={secrets.twilio_auth_token ?? ""}
            onChange={s("twilio_auth_token")}
            placeholder="Your Twilio Auth Token"
          />
          <div className="space-y-1.5">
            <Label>Messaging Service SID</Label>
            <Input
              value={cfg.twilio_messaging_service_sid ?? ""}
              onChange={e => f("twilio_messaging_service_sid")(e.target.value)}
              placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            Find Account SID and Auth Token on your{" "}
            <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">Twilio Console</a>.
            Create a Messaging Service under <em>Messaging → Services</em>.
          </div>
        </div>
      )}

      {provider === "msg91" && (
        <div className="space-y-4">
          <SecretInput
            label="Auth Key"
            value={secrets.msg91_auth_key ?? ""}
            onChange={s("msg91_auth_key")}
            placeholder="Your MSG91 Auth Key"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Sender ID <span className="text-slate-400">(DLT registered, max 6 chars)</span></Label>
              <Input
                value={cfg.msg91_sender_id ?? ""}
                onChange={e => f("msg91_sender_id")(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="MASCAL"
                maxLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <Label>DLT Template ID</Label>
              <Input
                value={cfg.msg91_template_id ?? ""}
                onChange={e => f("msg91_template_id")(e.target.value)}
                placeholder="Your TRAI-approved template ID"
              />
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>India DLT requirement:</strong> Your Sender ID must be registered with TRAI. The DLT Template ID is required for every message.
            Registration takes 1–3 business days.{" "}
            <a href="https://msg91.com/in" target="_blank" rel="noopener noreferrer" className="underline font-medium">Get Auth Key from MSG91 dashboard.</a>
          </div>
        </div>
      )}

      {provider === "local-sms-tool" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>API URL</Label>
            <Input
              value={cfg.local_api_url ?? ""}
              onChange={e => f("local_api_url")(e.target.value)}
              placeholder="https://your-sms-api.com"
            />
          </div>
          <SecretInput
            label="API Key"
            value={secrets.local_api_key ?? ""}
            onChange={s("local_api_key")}
          />
          <div className="space-y-1.5">
            <Label>Sender ID</Label>
            <Input
              value={cfg.local_sender_id ?? ""}
              onChange={e => f("local_sender_id")(e.target.value)}
              placeholder="MASCAL"
            />
          </div>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1.5">
          <Label>Test Mobile Number</Label>
          <Input
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="+919876543210"
          />
          <p className="text-xs text-slate-500">Include country code (e.g. +91 for India, +1 for US)</p>
        </div>
        <Button
          onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })}
          disabled={isSaving}
          className="w-full"
        >
          {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving&hellip;</> : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}

// ── WHATSAPP FORM ──────────────────────────────────────────────────────────
function WAForm({
  initial, onSave, isSaving,
}: {
  initial: ChannelConfig;
  onSave: (data: { provider_type: string; config: Record<string, any>; secrets: Record<string, string>; test_recipient?: string }) => void;
  isSaving: boolean;
}) {
  const [provider, setProvider] = useState<WAProviderType>(
    (initial.provider_type as WAProviderType) ?? "twilio"
  );
  const [cfg, setCfg] = useState<Record<string, any>>(initial.config_json ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("");

  const f = (k: string) => (v: string) => setCfg(c => ({ ...c, [k]: v }));
  const s = (k: string) => (v: string) => setSecrets(c => ({ ...c, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>WhatsApp Provider</Label>
        <Select value={provider} onValueChange={v => setProvider(v as WAProviderType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="twilio">Twilio WhatsApp Business</SelectItem>
            <SelectItem value="meta">Meta Cloud API (Official WhatsApp Business API)</SelectItem>
            <SelectItem value="local-whatsapp-tool">Custom HTTP Endpoint</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "twilio" && (
        <div className="space-y-4">
          <SecretInput
            label="Account SID"
            value={secrets.twilio_account_sid ?? ""}
            onChange={s("twilio_account_sid")}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <SecretInput
            label="Auth Token"
            value={secrets.twilio_auth_token ?? ""}
            onChange={s("twilio_auth_token")}
          />
          <div className="space-y-1.5">
            <Label>WhatsApp-enabled Twilio Number</Label>
            <Input
              value={cfg.twilio_whatsapp_number ?? ""}
              onChange={e => f("twilio_whatsapp_number")(e.target.value)}
              placeholder="+14155238886"
            />
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            Enable WhatsApp on your Twilio number at{" "}
            <a href="https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders" target="_blank" rel="noopener noreferrer" className="underline font-medium">Twilio Console → WhatsApp Senders</a>.
            Use sandbox number <code className="bg-blue-100 px-1 rounded">+14155238886</code> for testing.
          </div>
        </div>
      )}

      {provider === "meta" && (
        <div className="space-y-4">
          <SecretInput
            label="Permanent Access Token"
            value={secrets.meta_access_token ?? ""}
            onChange={s("meta_access_token")}
            placeholder="EAAxxxxxx… (System User token, not page token)"
            hint="Use a System User token from Meta Business Manager — not a temporary page access token"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone Number ID</Label>
              <Input
                value={cfg.meta_phone_number_id ?? ""}
                onChange={e => f("meta_phone_number_id")(e.target.value)}
                placeholder="123456789012345"
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp Business Account ID (WABA)</Label>
              <Input
                value={cfg.meta_waba_id ?? ""}
                onChange={e => f("meta_waba_id")(e.target.value)}
                placeholder="123456789012345"
              />
            </div>
          </div>
          <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
            <strong>Setup:</strong> (1) Meta Business account → (2) WhatsApp Business app in Developer Console → (3) System User token from Business Manager → (4) Verify phone number, note Phone Number ID.{" "}
            <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="underline font-medium">Meta Cloud API docs →</a>
          </div>
        </div>
      )}

      {provider === "local-whatsapp-tool" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>API URL</Label>
            <Input
              value={cfg.local_api_url ?? ""}
              onChange={e => f("local_api_url")(e.target.value)}
              placeholder="https://your-wa-api.com"
            />
          </div>
          <SecretInput
            label="API Key"
            value={secrets.local_api_key ?? ""}
            onChange={s("local_api_key")}
          />
          <div className="space-y-1.5">
            <Label>Business WhatsApp Number</Label>
            <Input
              value={cfg.local_business_number ?? ""}
              onChange={e => f("local_business_number")(e.target.value)}
              placeholder="+919876543210"
            />
          </div>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1.5">
          <Label>Test WhatsApp Number</Label>
          <Input
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            placeholder="+919876543210"
          />
          <p className="text-xs text-slate-500">Must be a WhatsApp-enabled number. Include country code.</p>
        </div>
        <Button
          onClick={() => onSave({ provider_type: provider, config: cfg, secrets, test_recipient: testTo || undefined })}
          disabled={isSaving}
          className="w-full"
        >
          {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving&hellip;</> : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────
export default function NativeCommunicationConfig() {
  const qc = useQueryClient();

  const { data: configs = [], isLoading } = useQuery<ChannelConfig[]>({
    queryKey: ["communication-config"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ChannelConfig[] }>(
        "/api/communication/config"
      );
      return (res as any).data ?? [];
    },
  });

  const configMap = Object.fromEntries(
    configs.map(c => [c.channel, c])
  ) as Partial<Record<Channel, ChannelConfig>>;

  const saveMutation = useMutation({
    mutationFn: async ({
      channel, payload,
    }: {
      channel: Channel;
      payload: { provider_type: string; config: Record<string, any>; secrets: Record<string, string>; test_recipient?: string };
    }) => {
      const { test_recipient, ...saveData } = payload;
      await hrmsApi.put(`/api/communication/config/${channel}`, saveData);
      return { channel, test_recipient };
    },
    onSuccess: ({ channel, test_recipient }) => {
      toast.success(`${channel} configuration saved`);
      qc.invalidateQueries({ queryKey: ["communication-config"] });
      if (test_recipient) {
        testMutation.mutate({ channel, test_recipient });
      }
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const testMutation = useMutation({
    mutationFn: async ({
      channel, test_recipient,
    }: {
      channel: Channel; test_recipient: string;
    }) => {
      return hrmsApi.post<{ success: boolean; error?: string; provider: string }>(
        `/api/communication/config/${channel}/test`,
        { test_recipient }
      );
    },
    onSuccess: (res, { channel }) => {
      if ((res as any).success) {
        toast.success(`Test ${channel} sent! Check ${channel === "email" ? "inbox" : "your phone"}.`);
      } else {
        toast.error(`Test failed: ${(res as any).error ?? "Unknown error"}`);
      }
      qc.invalidateQueries({ queryKey: ["communication-config"] });
    },
    onError: (e: any) => toast.error(`Test failed: ${e.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ channel, enable }: { channel: Channel; enable: boolean }) => {
      return hrmsApi.post(
        `/api/communication/config/${channel}/${enable ? "enable" : "disable"}`,
        {}
      );
    },
    onSuccess: (_r, { channel, enable }) => {
      toast.success(`${channel} channel ${enable ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["communication-config"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const channels: Array<{
    key: Channel; label: string; icon: React.ReactNode; description: string;
  }> = [
    { key: "email", label: "Email", icon: <Mail className="h-4 w-4" />, description: "SMTP, SendGrid, or Mailgun" },
    { key: "sms", label: "SMS", icon: <MessageSquare className="h-4 w-4" />, description: "Twilio or MSG91 (India)" },
    { key: "whatsapp", label: "WhatsApp", icon: <MessagesSquare className="h-4 w-4" />, description: "Twilio or Meta Cloud API" },
  ];

  const emptyConfig = (ch: Channel): ChannelConfig => ({
    id: "", channel: ch, provider_type: ch === "sms" ? "twilio" : ch === "whatsapp" ? "twilio" : "nodemailer",
    config_json: {}, is_enabled: false, test_ok: null, test_error: null, test_at: null,
  });

  const isSaving = saveMutation.isPending || testMutation.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 flex items-center gap-2">
            <Settings2 className="h-6 w-6" />
            Communication Configuration
          </h1>
          <p className="mt-1 text-slate-500">
            Configure email, SMS, and WhatsApp providers. Changes take effect immediately — no server restart needed.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading configuration&hellip;
          </div>
        ) : (
          <Tabs defaultValue="email">
            <TabsList className="grid grid-cols-3 w-full max-w-sm">
              {channels.map(ch => (
                <TabsTrigger key={ch.key} value={ch.key} className="flex items-center gap-1.5">
                  {ch.icon}
                  <span>{ch.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {channels.map(ch => {
              const cfg = configMap[ch.key] ?? emptyConfig(ch.key);
              return (
                <TabsContent key={ch.key} value={ch.key} className="mt-4">
                  <Card className="max-w-2xl">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            {ch.icon}
                            {ch.label}
                          </CardTitle>
                          <CardDescription className="mt-0.5">{ch.description}</CardDescription>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge config={cfg} />
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={cfg.is_enabled}
                              onCheckedChange={v =>
                                toggleMutation.mutate({ channel: ch.key, enable: v })
                              }
                              disabled={toggleMutation.isPending}
                            />
                            <span className="text-sm text-slate-600 w-14">
                              {cfg.is_enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {cfg.test_at && (
                        <div
                          className={`mt-3 flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                            cfg.test_ok
                              ? "bg-green-50 border border-green-200 text-green-800"
                              : "bg-red-50 border border-red-200 text-red-800"
                          }`}
                        >
                          {cfg.test_ok ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0" />
                          )}
                          <span>
                            {cfg.test_ok
                              ? "Last test passed"
                              : `Last test failed: ${cfg.test_error ?? "Unknown error"}`}
                          </span>
                          <span className="ml-auto text-xs opacity-60 whitespace-nowrap">
                            {formatIST(cfg.test_at)}
                          </span>
                        </div>
                      )}
                    </CardHeader>

                    <CardContent>
                      {ch.key === "email" && (
                        <EmailForm
                          initial={cfg}
                          onSave={data => saveMutation.mutate({ channel: "email", payload: data })}
                          isSaving={isSaving}
                        />
                      )}
                      {ch.key === "sms" && (
                        <SMSForm
                          initial={cfg}
                          onSave={data => saveMutation.mutate({ channel: "sms", payload: data })}
                          isSaving={isSaving}
                        />
                      )}
                      {ch.key === "whatsapp" && (
                        <WAForm
                          initial={cfg}
                          onSave={data => saveMutation.mutate({ channel: "whatsapp", payload: data })}
                          isSaving={isSaving}
                        />
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}

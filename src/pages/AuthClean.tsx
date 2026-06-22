import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, Users, Clock, BarChart3, CheckCircle2, Phone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoginSmartGreeting } from "@/components/integrations/LoginSmartGreeting";
import { hrmsApi } from "@/lib/hrmsApi";

const companyLogo = "/mcn-logo.png?v=999";
const currentYear = new Date().getFullYear();

const FEATURES = [
  { icon: Users, label: "Employee Management", desc: "Manage your entire workforce in one place" },
  { icon: Clock, label: "Attendance Tracking", desc: "Real-time presence and work-hour monitoring" },
  { icon: BarChart3, label: "Advanced Analytics", desc: "Actionable insights for smarter HR decisions" },
  { icon: CheckCircle2, label: "Leave & Payroll", desc: "Streamlined approvals and payroll processing" },
];

type ForgotPasswordChannel = 'email' | 'sms';
type ForgotPasswordStep = 'send' | 'verify';

export default function AuthClean() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetPhone, setResetPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotChannel, setForgotChannel] = useState<ForgotPasswordChannel>('email');
  const [forgotStep, setForgotStep] = useState<ForgotPasswordStep>('send');
  const [loading, setLoading] = useState(false);
  const { signIn, forgotPassword, user, mustChangePassword } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate(mustChangePassword ? "/change-password" : "/dashboard", { replace: true });
  }, [user, mustChangePassword, navigate]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      toast({ title: "Login Alert", description: "Enter email/employee code and password." });
      return;
    }
    setLoading(true);
    const { error } = await signIn(identifier.trim(), password);
    setLoading(false);
    if (error) toast({ title: "Login Alert", description: error.message });
  };

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault();

    if (forgotChannel === 'email') {
      if (!resetEmail.trim()) {
        toast({ title: "Reset Password", description: "Enter your registered official email." });
        return;
      }
      setLoading(true);
      const { error, smtpNotConfigured } = await forgotPassword(resetEmail.trim());
      setLoading(false);
      if (smtpNotConfigured) {
        toast({ title: "Email Not Available", description: "Email reset is not set up. Switching to mobile OTP reset." });
        setForgotChannel('sms');
        return;
      }
      if (error) {
        toast({ title: "Reset Password", description: error.message });
        return;
      }
      toast({ title: "Reset Link Sent", description: "If this email is registered, a reset link has been sent." });
      setShowForgot(false);
    } else {
      // SMS OTP flow
      if (!resetPhone.trim()) {
        toast({ title: "Reset Password", description: "Enter your registered mobile number." });
        return;
      }
      setLoading(true);
      try {
        const res = await hrmsApi.post('/api/auth/forgot-password-otp', { phone: resetPhone.trim() });
        setLoading(false);
        if (res.data.success) {
          toast({ title: "OTP Sent", description: res.data.message });
          setForgotStep('verify');
        } else {
          toast({ title: "Error", description: res.data.message || "Failed to send OTP" });
        }
      } catch (error: any) {
        setLoading(false);
        toast({ title: "Error", description: error.response?.data?.error || "Failed to send OTP" });
      }
    }
  };

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!otp.trim() || !newPassword.trim()) {
      toast({ title: "Reset Password", description: "Enter OTP and new password." });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Reset Password", description: "Password must be at least 8 characters." });
      return;
    }
    setLoading(true);
    try {
      const res = await hrmsApi.post('/api/auth/verify-otp-reset', {
        phone: resetPhone.trim(),
        otp: otp.trim(),
        newPassword: newPassword
      });
      setLoading(false);
      if (res.data.success) {
        toast({ title: "Success", description: "Password reset successful. Please login." });
        setShowForgot(false);
        setForgotStep('send');
        setOtp('');
        setNewPassword('');
        setResetPhone('');
      } else {
        toast({ title: "Error", description: res.data.error || "Invalid or expired OTP" });
      }
    } catch (error: any) {
      setLoading(false);
      toast({ title: "Error", description: error.response?.data?.error || "Failed to reset password" });
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* ── Left Panel — MAS Branding ──────────────────────────────── */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:w-[52%] xl:w-[58%]"
        style={{
          background: "linear-gradient(135deg, #071428 0%, #0c1d3a 40%, #0f2a4d 70%, #071428 100%)",
        }}
      >
        {/* Colorful blobs */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(27,106,181,0.35)" }} />
        <div className="pointer-events-none absolute right-0 top-1/3 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(59,173,73,0.20)" }} />
        <div className="pointer-events-none absolute bottom-0 left-1/4 h-72 w-72 rounded-full blur-3xl" style={{ background: "rgba(232,35,26,0.15)" }} />
        <div className="pointer-events-none absolute -bottom-10 right-1/4 h-64 w-64 rounded-full blur-3xl" style={{ background: "rgba(27,106,181,0.25)" }} />

        {/* Grid dot overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-5">
            <div className="flex h-24 w-52 items-center justify-center rounded-2xl bg-white/95 px-3 shadow-xl">
              <img src={companyLogo} alt="Mas Callnet India Pvt Ltd" className="h-auto w-48 object-contain" />
            </div>
            <div>
              <p className="text-xl font-black text-white">Mas Callnet India Pvt Ltd</p>
              <p className="text-xs font-bold" style={{ color: "#5aa0dd" }}>HRMS Platform</p>
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="relative z-10 my-auto">
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold"
            style={{ borderColor: "rgba(27,106,181,0.4)", background: "rgba(27,106,181,0.15)", color: "#5aa0dd" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#3BAD49] animate-pulse" />
            Enterprise HR Suite
          </div>

          <h1 className="text-4xl font-black leading-tight tracking-tight text-white xl:text-5xl">
            Your Complete
            <span className="block mt-1" style={{ color: "#5aa0dd" }}>
              Workforce Hub
            </span>
          </h1>

          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">
            Manage employees, attendance, payroll, leaves and performance — all from one powerful, beautiful platform.
          </p>

          {/* Feature list */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-2xl border p-4"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(27,106,181,0.25)" }}
                >
                  <Icon className="h-4 w-4" style={{ color: "#5aa0dd" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10">
          <p className="text-xs text-slate-500">
            © {currentYear} Mas Callnet India Pvt Ltd · Secure · Reliable · Enterprise-Grade
          </p>
        </div>
      </div>

      {/* ── Right Panel — Login Form ────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#f3f6fb] px-6 py-10">
        {/* Mobile logo */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
          <div className="flex h-24 w-52 items-center justify-center rounded-2xl bg-white px-3 shadow-md">
            <img src={companyLogo} alt="Mas Callnet India Pvt Ltd" className="h-auto w-48 object-contain" />
          </div>
          <div>
            <p className="font-black text-slate-950">Mas Callnet India Pvt Ltd</p>
            <p className="text-xs font-semibold text-slate-400">Employee Portal</p>
          </div>
        </div>

        <div className="w-full max-w-[400px]">
          {/* Card */}
          <div className="overflow-hidden rounded-3xl border border-white bg-white shadow-2xl shadow-slate-200/80">
            {/* Top accent strip — 3 MAS colors */}
            <div className="flex h-3">
              <div className="flex-1" style={{ background: "#1B6AB5" }} />
              <div className="flex-1" style={{ background: "#3BAD49" }} />
              <div className="flex-1" style={{ background: "#E8231A" }} />
            </div>

            <div className="px-7 pb-8 pt-7">
              {!showForgot ? (
                <>
                  <div className="mb-5">
                    <h2 className="text-2xl font-black tracking-tight text-slate-950">Welcome Back</h2>
                    <p className="mt-1.5 text-sm text-slate-500">Sign in with your official email or employee code</p>
                  </div>

                  <LoginSmartGreeting employeeName={identifier} />

                  <form onSubmit={handleLogin} className="space-y-5">
                    {/* Email / Employee code */}
                    <div className="space-y-1.5">
                      <Label htmlFor="identifier" className="text-sm font-bold text-slate-700">
                        Email or Employee Code
                      </Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="identifier"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="name@company.com or EMP001"
                          className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                          disabled={loading}
                        />
                      </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-sm font-bold text-slate-700">
                        Password
                      </Label>
                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 pr-11 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                          disabled={loading}
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          onClick={() => setShowPassword((v) => !v)}
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Secure row */}
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <ShieldCheck className="h-4 w-4 text-[#3BAD49]" />
                        256-bit encrypted
                      </div>
                      <button
                        type="button"
                        className="text-xs font-bold hover:underline"
                        style={{ color: "#1B6AB5" }}
                        onClick={() => {
                          setShowForgot(true);
                          setResetEmail(identifier.includes("@") ? identifier : "");
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-black text-white transition-all hover:opacity-90 disabled:opacity-60"
                      style={{
                        background: "linear-gradient(135deg, #1B6AB5 0%, #155e9f 100%)",
                        boxShadow: "0 4px 16px rgba(27,106,181,0.35)",
                      }}
                    >
                      {loading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Please wait...</>
                      ) : (
                        <>Sign In <ArrowRight className="h-4 w-4" /></>
                      )}
                    </button>

                    {/* Demo Quick-Start (dev/local only) */}
                    {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true') && (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <p className="mb-2 text-center text-xs font-semibold text-slate-500">🔧 Demo Quick-Start</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIdentifier('admin@mascallnet.com');
                              setPassword('Admin@123');
                            }}
                            className="text-xs"
                          >
                            Admin
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIdentifier('hr@mascallnet.com');
                              setPassword('Hr@123456');
                            }}
                            className="text-xs"
                          >
                            HR
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIdentifier('recruiter@mascallnet.com');
                              setPassword('Recruiter@1');
                            }}
                            className="text-xs"
                          >
                            Recruiter
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIdentifier('manager@mascallnet.com');
                              setPassword('Manager@1');
                            }}
                            className="text-xs"
                          >
                            Manager
                          </Button>
                        </div>
                      </div>
                    )}
                  </form>
                </>
              ) : (
                <>
                  <div className="mb-5">
                    <h2 className="text-xl font-black text-slate-950">Reset Password</h2>
                    <p className="mt-1.5 text-sm text-slate-500">
                      {forgotStep === 'send' ? 'Choose how to reset your password' : 'Enter OTP and set new password'}
                    </p>
                  </div>

                  {forgotStep === 'send' && (
                    <>
                      {/* Channel tabs */}
                      <div className="mb-4 flex gap-2 rounded-xl bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() => setForgotChannel('email')}
                          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-all ${
                            forgotChannel === 'email'
                              ? 'bg-white text-[#1B6AB5] shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Mail className="inline h-4 w-4 mr-1.5" />
                          Email
                        </button>
                        <button
                          type="button"
                          onClick={() => setForgotChannel('sms')}
                          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-all ${
                            forgotChannel === 'sms'
                              ? 'bg-white text-[#1B6AB5] shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Phone className="inline h-4 w-4 mr-1.5" />
                          SMS/OTP
                        </button>
                      </div>

                      <form onSubmit={handleForgot} className="space-y-4">
                        {forgotChannel === 'email' ? (
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              type="email"
                              value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              placeholder="official.email@company.com"
                              className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                              disabled={loading}
                            />
                          </div>
                        ) : (
                          <div className="relative">
                            <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              type="tel"
                              value={resetPhone}
                              onChange={(e) => setResetPhone(e.target.value)}
                              placeholder="9876543210"
                              className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                              disabled={loading}
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="submit"
                            disabled={loading}
                            className="flex h-11 items-center justify-center gap-2 rounded-xl font-bold text-white"
                            style={{ background: "#1B6AB5" }}
                          >
                            {loading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : forgotChannel === 'email' ? (
                              "Send Link"
                            ) : (
                              "Send OTP"
                            )}
                          </button>
                          <button
                            type="button"
                            className="h-11 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              setShowForgot(false);
                              setForgotStep('send');
                              setResetPhone('');
                              setResetEmail('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </>
                  )}

                  {forgotStep === 'verify' && forgotChannel === 'sms' && (
                    <form onSubmit={handleVerifyOtp} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="otp" className="text-sm font-bold text-slate-700">
                          6-Digit OTP
                        </Label>
                        <Input
                          id="otp"
                          type="text"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="123456"
                          maxLength={6}
                          className="h-11 rounded-xl border-slate-200 bg-slate-50 text-center text-lg tracking-widest focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                          disabled={loading}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="newPassword" className="text-sm font-bold text-slate-700">
                          New Password
                        </Label>
                        <div className="relative">
                          <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            id="newPassword"
                            type={showNewPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Min. 8 characters"
                            className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 pr-11 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                            disabled={loading}
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            onClick={() => setShowNewPassword((v) => !v)}
                            tabIndex={-1}
                          >
                            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="submit"
                          disabled={loading}
                          className="flex h-11 items-center justify-center gap-2 rounded-xl font-bold text-white"
                          style={{ background: "#1B6AB5" }}
                        >
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset Password"}
                        </button>
                        <button
                          type="button"
                          className="h-11 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setForgotStep('send');
                            setOtp('');
                            setNewPassword('');
                          }}
                        >
                          Back
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            © {currentYear} Mas Callnet India Pvt Ltd · All rights reserved
          </p>
        </div>
      </div>
    </div>
  );
}

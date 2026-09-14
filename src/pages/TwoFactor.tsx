import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TwoFactor() {
  const [otp, setOtp] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [loading, setLoading] = useState(false);
  const { sendTwoFactorCode, verifyTwoFactorCode, twoFactorVerified } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (twoFactorVerified) navigate("/dashboard", { replace: true });
  }, [navigate, twoFactorVerified]);

  const sendCode = async () => {
    setLoading(true);
    try {
      const { error } = await sendTwoFactorCode(channel);
      if (error) throw error;
      toast({ title: "Code sent", description: `Check your ${channel}.` });
    } catch (error) {
      toast({ title: "Code not sent", description: error instanceof Error ? error.message : "Unable to send code.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { error } = await verifyTwoFactorCode(otp);
      if (error) throw error;
      toast({ title: "Login verified", description: "Your secure session is ready." });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      toast({ title: "Verification failed", description: error instanceof Error ? error.message : "Invalid code.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <Card className="w-full max-w-md rounded-3xl shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <CardTitle>Verify login</CardTitle>
          <CardDescription>Enter the one-time code sent to your registered contact.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button type="button" variant={channel === "email" ? "default" : "outline"} onClick={() => setChannel("email")}>Email</Button>
            <Button type="button" variant={channel === "sms" ? "default" : "outline"} onClick={() => setChannel("sms")}>SMS</Button>
          </div>
          <Button type="button" variant="secondary" className="mb-4 w-full" disabled={loading} onClick={sendCode}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send code
          </Button>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </div>
            <Button className="w-full" disabled={loading || otp.length !== 6}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

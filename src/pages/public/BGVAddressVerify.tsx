import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Camera, CheckCircle, XCircle, AlertTriangle, Loader2 } from "lucide-react";

type Info = {
  id: string;
  declaredAddress: string;
  candidateName: string | null;
  candidateCode: string | null;
  expiresAt: string;
  attemptNumber: number;
  maxAttempts: number;
};

type Phase = "loading" | "error" | "capture" | "submitting" | "success" | "failed";

const API = "/api/bgv/address-verification";

export default function BGVAddressVerify() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [resultMsg, setResultMsg] = useState("");
  const [autoVerified, setAutoVerified] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { setPhase("error"); setErrorMsg("Invalid link."); return; }
    fetch(`${API}/public/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) { setPhase("error"); setErrorMsg(d.message); return; }
        setInfo(d.data);
        setPhase("capture");
        requestGps();
      })
      .catch(() => { setPhase("error"); setErrorMsg("Could not load verification details. Check your connection."); });
  }, [token]);

  function requestGps() {
    if (!navigator.geolocation) { setGpsError("Your browser does not support GPS. Use Chrome or Safari on a recent phone."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsError(null);
        setLocating(false);
      },
      (err) => {
        setGpsError(`Location access denied (${err.message}). Please enable GPS and try again.`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelfieFile(file);
    setSelfiePreview(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!selfieFile) { alert("Please take a selfie first."); return; }
    if (!gps) {
      const proceed = confirm("No GPS location detected. Submit without location? HR will review manually.");
      if (!proceed) return;
    }
    setPhase("submitting");

    const form = new FormData();
    form.append("selfie", selfieFile);
    if (gps) {
      form.append("latitude", String(gps.lat));
      form.append("longitude", String(gps.lng));
      form.append("accuracy", String(gps.accuracy));
    }

    try {
      const r = await fetch(`${API}/public/${token}/submit`, { method: "POST", body: form });
      const d = await r.json() as { success: boolean; message: string; autoVerified?: boolean };
      if (d.success) {
        setResultMsg(d.message);
        setAutoVerified(d.autoVerified ?? false);
        setPhase("success");
      } else {
        setResultMsg(d.message);
        setPhase("failed");
      }
    } catch {
      setResultMsg("Submission failed due to a network error. Please try again.");
      setPhase("failed");
    }
  }

  const gradBg = "min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4";
  const card = "bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6 w-full max-w-md text-white shadow-2xl";

  if (phase === "loading") {
    return (
      <div className={gradBg}>
        <div className={card + " flex flex-col items-center gap-4"}>
          <Loader2 className="animate-spin w-10 h-10 text-blue-300" />
          <p className="text-blue-200">Loading verification details…</p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={gradBg}>
        <div className={card + " flex flex-col items-center gap-4 text-center"}>
          <XCircle className="w-14 h-14 text-red-400" />
          <h2 className="text-xl font-bold">Link Not Valid</h2>
          <p className="text-white/70 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className={gradBg}>
        <div className={card + " flex flex-col items-center gap-4 text-center"}>
          <CheckCircle className="w-16 h-16 text-emerald-400" />
          <h2 className="text-2xl font-bold">{autoVerified ? "Address Verified!" : "Submitted!"}</h2>
          <p className="text-white/80 text-sm">{resultMsg}</p>
          {selfiePreview && <img src={selfiePreview} alt="Your selfie" className="w-32 h-32 object-cover rounded-2xl border-2 border-emerald-400 mt-2" />}
          <p className="text-xs text-white/50 mt-2">You may close this page.</p>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className={gradBg}>
        <div className={card + " flex flex-col items-center gap-4 text-center"}>
          <XCircle className="w-14 h-14 text-red-400" />
          <h2 className="text-xl font-bold">Submission Failed</h2>
          <p className="text-white/70 text-sm">{resultMsg}</p>
          <button
            onClick={() => { setPhase("capture"); setResultMsg(""); }}
            className="mt-3 px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // capture phase
  return (
    <div className={gradBg}>
      <div className={card + " flex flex-col gap-5"}>
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-blue-600/30 border border-blue-400/40 rounded-full px-4 py-1.5 text-xs font-semibold text-blue-200 mb-3">
            <MapPin className="w-3.5 h-3.5" /> Address Verification
          </div>
          <h1 className="text-xl font-bold">Verify Your Address</h1>
          {info?.candidateName && <p className="text-white/60 text-sm mt-1">{info.candidateName} · {info?.candidateCode}</p>}
          <p className="text-xs text-white/40 mt-1">Attempt {info?.attemptNumber} of {info?.maxAttempts}</p>
        </div>

        {/* Declared address */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Your Declared Address</p>
          <p className="text-sm text-white/90 leading-relaxed">{info?.declaredAddress}</p>
        </div>

        {/* Consent notice */}
        <div className="bg-blue-500/10 border border-blue-400/30 rounded-2xl p-4 text-xs text-blue-100 leading-relaxed">
          <strong className="block mb-1 text-blue-200">📋 Consent &amp; Important Notice</strong>
          By submitting this verification you confirm that:
          <ul className="list-disc ml-4 mt-1 space-y-1 text-blue-100/90">
            <li>You <strong>consent</strong> to your GPS location being captured and stored for address verification purposes.</li>
            <li>You are <strong>physically present at the address shown above</strong> at the time of capture.</li>
            <li>The selfie is taken <strong>live</strong> — screenshots or previously captured photos are not accepted.</li>
            <li>Submitting from a different location will result in a <strong>failed verification</strong>.</li>
          </ul>
        </div>

        {/* Instructions */}
        <div className="bg-amber-500/10 border border-amber-400/20 rounded-2xl p-4 text-xs text-amber-200 leading-relaxed">
          <strong className="block mb-1">How to complete</strong>
          <ol className="list-decimal ml-4 mt-1 space-y-1">
            <li>Go to your <strong>current address</strong> shown above</li>
            <li>Allow location access when the browser asks</li>
            <li>Take a live selfie with your surroundings clearly visible</li>
            <li>Submit — your GPS coordinates are recorded automatically</li>
          </ol>
        </div>

        {/* GPS status */}
        <div className={`rounded-2xl p-3 flex items-start gap-3 text-sm ${gps ? "bg-emerald-500/10 border border-emerald-400/20" : "bg-white/5 border border-white/10"}`}>
          {locating ? (
            <><Loader2 className="w-4 h-4 animate-spin text-blue-300 mt-0.5 shrink-0" /><span className="text-white/60">Getting your location…</span></>
          ) : gps ? (
            <><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /><span className="text-emerald-200">GPS captured (±{Math.round(gps.accuracy)} m) · <a href={`https://maps.google.com/?q=${gps.lat},${gps.lng}`} target="_blank" rel="noopener noreferrer" className="underline">View</a></span></>
          ) : (
            <><AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-200">{gpsError ?? "Location not detected"}</p>
                <button onClick={requestGps} className="mt-1 text-xs text-blue-300 underline">Retry GPS</button>
              </div>
            </>
          )}
        </div>

        {/* Selfie capture */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={handleFileChange}
            className="hidden"
          />
          {selfiePreview ? (
            <div className="flex flex-col items-center gap-3">
              <img src={selfiePreview} alt="Preview" className="w-40 h-40 object-cover rounded-2xl border-2 border-blue-400" />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs text-blue-300 underline"
              >
                Retake selfie
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center gap-3 py-8 border-2 border-dashed border-white/20 rounded-2xl hover:border-blue-400/50 hover:bg-white/5 transition-all"
            >
              <Camera className="w-10 h-10 text-white/40" />
              <span className="text-sm text-white/60">Tap to take a selfie</span>
            </button>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!selfieFile}
          className="w-full py-4 rounded-2xl font-bold text-base bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-900/50"
        >
          Submit Verification
        </button>

        <p className="text-center text-xs text-white/30">
          Link expires {info?.expiresAt ? new Date(info.expiresAt).toLocaleString("en-IN") : "soon"} · Powered by MAS PeopleOS
        </p>
      </div>
    </div>
  );
}

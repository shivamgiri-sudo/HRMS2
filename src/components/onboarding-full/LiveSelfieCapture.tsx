import { useState, useRef, useCallback } from "react";
import { Camera, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LiveSelfieCaptureProps {
  onCapture: (file: File) => void;
  captured: boolean;
  disabled?: boolean;
}

export function LiveSelfieCapture({ onCapture, captured, disabled }: LiveSelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    // Camera API requires a secure context (HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(
        "Camera is not available. This may be because the page is loaded over HTTP instead of HTTPS. " +
        "Please ask HR to share the secure (https://) link, or upload a photo from your gallery using the document upload below."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setError("Camera permission denied. Please allow camera access in your browser settings and try again.");
      } else if (e.name === "NotFoundError") {
        setError("No camera found on this device. Please upload a clear photo using the document upload section below.");
      } else if (e.name === "NotReadableError" || e.name === "AbortError") {
        setError("Camera is in use by another app. Please close other apps using the camera and try again.");
      } else {
        setError("Could not access camera: " + e.message);
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `live-selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
      setPreview(canvas.toDataURL("image/jpeg", 0.85));
      stopCamera();
      onCapture(file);
    }, "image/jpeg", 0.85);
  }, [onCapture, stopCamera]);

  const retake = useCallback(() => {
    setPreview(null);
    startCamera();
  }, [startCamera]);

  if (captured && !preview && !streaming) {
    return (
      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-emerald-800">Live Selfie Captured</p>
          <p className="text-xs text-emerald-600">Your identity will be verified against uploaded documents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-blue-800">Live Selfie Verification</p>
          <p className="text-xs text-blue-600">
            Take a live selfie to verify you are the same person as in your ID documents.
            This cannot be uploaded from gallery — camera only.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2">
          <p className="text-xs font-semibold text-red-700">{error}</p>
        </div>
      )}

      {!streaming && !preview && (
        <Button
          type="button"
          onClick={startCamera}
          disabled={disabled}
          className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 rounded-xl font-bold gap-2"
        >
          <Camera className="h-5 w-5" />
          Open Camera for Live Selfie
        </Button>
      )}

      {streaming && (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden border-2 border-blue-300 bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-h-[300px] object-cover mirror"
              style={{ transform: "scaleX(-1)" }}
            />
            <div className="absolute inset-0 pointer-events-none border-4 border-dashed border-white/30 rounded-xl" />
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
              Position your face in the frame
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={capture}
              className="flex-1 min-h-[48px] bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold gap-2"
            >
              <Camera className="h-5 w-5" /> Capture Selfie
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={stopCamera}
              className="min-h-[48px] rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border-2 border-emerald-300">
            <img src={preview} alt="Selfie preview" className="w-full max-h-[300px] object-cover" style={{ transform: "scaleX(-1)" }} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">Selfie captured successfully</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retake}
              className="rounded-xl gap-1"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retake
            </Button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

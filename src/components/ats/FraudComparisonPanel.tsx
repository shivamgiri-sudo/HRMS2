/**
 * FraudComparisonPanel
 *
 * Reusable panel used in two places:
 *   1. HR Profile Approval drawer — auto-opens when critical/high alerts exist
 *   2. /settings/fraud-alerts — Payroll HR queue, per-candidate expand
 *
 * Shows:
 *   • Alert summary banner with blocking/non-blocking counts
 *   • Face comparison grid — selfie vs DigiLocker doc vs manual upload,
 *     each face auto-detected and cropped to align vertically
 *   • Name comparison table — 6 sources (form, DigiLocker Aadhaar, DigiLocker PAN,
 *     Bank penny drop, BGV Aadhaar, BGV PAN) with Indian name match status
 *   • Document number comparison — Aadhaar and PAN across entered/DigiLocker/OCR
 *   • Resolution action panel — acknowledgement checkbox gates the approve button
 *     when embedded in the HR profile review flow
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
  X,
  ZoomIn,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FraudAlert {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  details?: string | Record<string, unknown> | null;
  matched_candidate_id?: string | null;
  matched_candidate_name?: string | null;
  created_at?: string | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
}

/**
 * `details` is a JSON column — mysql2 normally hands it back already parsed,
 * but it is typed defensively as string | object | null, so parse only when
 * it actually arrives as a string. The backend writers (ocr.service.ts,
 * face-match.service.ts) use "message" as the human-readable key; a couple
 * of call sites have no message at all (e.g. FACE_MISMATCH), so this can
 * legitimately return null.
 */
function getAlertMessage(details: FraudAlert["details"]): string | null {
  if (!details) return null;
  let parsed: Record<string, unknown>;
  if (typeof details === "string") {
    try {
      parsed = JSON.parse(details);
    } catch {
      return null;
    }
  } else {
    parsed = details;
  }
  const msg = parsed.message ?? parsed.reason;
  return typeof msg === "string" && msg.trim() ? msg : null;
}

interface FaceMatch {
  id: string;
  photo_document_id?: string | null;
  id_document_id?: string | null;
  photo_doc_type?: string | null;
  id_doc_type?: string | null;
  match_score?: number | null;
  match_status: string;
}

interface DocRow {
  id: string;
  doc_type: string;
  document_status?: string | null;
  uploaded_at?: string | null;
}

interface NameDetail {
  source_type: string;
  source_name?: string | null;
  match_score?: number | null;
  is_match?: number | null;  // TINYINT(1): 1=matched, 0=mismatch, null=not_checked
}

interface ComparisonData {
  alerts: FraudAlert[];
  faceMatches: FaceMatch[];
  docs: DocRow[];
  profile: { employee_name?: string; aadhaar_number_masked?: string; pan_number_masked?: string } | null;
  bgvNames: { check_type: string; matched_name?: string | null; status?: string | null }[];
  nameSummary: { overall_status?: string; mismatch_sources?: string | unknown; blocks_employee_code?: number } | null;
  nameDetails: NameDetail[];
  bankPennyDrop: { entered_name?: string | null; bank_name?: string | null; name_match_score?: number | null; status?: string | null } | null;
  /** The single downloaded DigiLocker KYC file, if the candidate completed DigiLocker. Null when they never did. */
  digilocker: {
    fileName: string;
    contentType: string;
    updatedAt?: string | null;
    /** candidate_digilocker_session.id — doubles as a stable id_document_id for candidate_face_match rows scored against this file. */
    sessionId: string;
    /** Whether this specific download is confirmed (via autoCreateDigilockerVerifiedChecks' own evidence rule) to include PAN, not just Aadhaar. */
    panConfirmed: boolean;
  } | null;
}

interface FaceBbox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

// ── Resolution options (same as NativeFraudAlertReview) ──────────────────────

const RESOLUTIONS = [
  { value: "resolved_false_positive", code: "name_variance",  label: "Same person — name written differently",  hint: "Initials, added/dropped middle name, regional ordering" },
  { value: "resolved_false_positive", code: "married_name",   label: "Name changed after marriage",             hint: "Supporting document seen" },
  { value: "resolved_false_positive", code: "data_entry",     label: "Our data was wrong",                     hint: "OCR misread or a typo in the record" },
  { value: "resolved_fraud",          code: "confirmed_fraud", label: "Confirmed — different person",           hint: "Candidate rejected" },
  { value: "dismissed",               code: "not_applicable",  label: "Not applicable",                         hint: "Raised in error or duplicate alert" },
] as const;

// ── Severity styles ───────────────────────────────────────────────────────────

const SEVERITY_BG: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high:     "bg-orange-100 text-orange-800 border-orange-300",
  medium:   "bg-amber-100 text-amber-800 border-amber-300",
  low:      "bg-slate-100 text-slate-700 border-slate-300",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-300 bg-red-50",
  high:     "border-orange-300 bg-orange-50",
  medium:   "border-amber-200 bg-amber-50",
  low:      "border-slate-200 bg-slate-50",
};

// ── Face Photo Cell with canvas-based face alignment ─────────────────────────

/**
 * Full-size click-to-zoom viewer. Reuses the already-fetched blob URL from
 * the cell that opened it — no re-fetch. `kind: "pdf"` renders an iframe
 * (browsers paginate/zoom PDFs natively there) instead of an <img>, since a
 * DigiLocker download is a PDF far more often than not and cannot be drawn
 * onto a face-crop canvas the way an image can.
 */
function Lightbox({ src, kind, label, onClose }: { src: string; kind: "image" | "pdf"; label: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-3">
        {kind === "pdf" && (
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-white/90 hover:text-white text-xs font-semibold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full"
          >
            Open in new tab
          </a>
        )}
        <button
          onClick={onClose}
          className="text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-1.5"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="text-center max-w-5xl w-full max-h-full flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {kind === "pdf" ? (
          <iframe src={src} title={label} className="w-full h-[80vh] bg-white rounded-lg shadow-2xl" />
        ) : (
          <img src={src} alt={label} className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain" />
        )}
        <p className="text-white/80 text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

interface FacePhotoCellProps {
  documentId: string | null | undefined;
  label: string;
  subLabel?: string;
  isTrusted?: boolean;
  noFaceText?: string;
  /** Overrides the default onboarding-document preview/face-detect URLs — used for the DigiLocker file, which has no candidate_onboarding_document row. */
  previewUrl?: string;
  faceDetectUrl?: string;
  /** The source is a PDF: skip face-cropping entirely and show a document tile instead. */
  isPdf?: boolean;
  /**
   * Recovered DigiLocker Aadhaar eKYC face photo (already a face crop, not a
   * full document scan). When present this takes priority over previewUrl /
   * documentId / isPdf entirely and is rendered directly — no PDF-icon
   * branch, no bbox face-detect call, since the photo is already just a
   * face. Not every candidate has completed a DigiLocker session yet, so a
   * failed fetch (404) silently falls back to the previewUrl/documentId/isPdf
   * resolution below rather than showing an error.
   */
  photoUrl?: string;
}

function FacePhotoCell({ documentId, label, subLabel, isTrusted, noFaceText, previewUrl, faceDetectUrl, isPdf, photoUrl }: FacePhotoCellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  // Tracks whether the priority photoUrl fetch has failed (404/error), so the
  // effect below can fall back to the legacy previewUrl/documentId resolution.
  const [photoUrlFailed, setPhotoUrlFailed] = useState(false);

  useEffect(() => { setPhotoUrlFailed(false); }, [photoUrl]);

  const usePhotoUrl = !!photoUrl && !photoUrlFailed;
  const src = previewUrl ?? (documentId ? `/api/ats/onboarding-full/documents/preview/${documentId}` : null);

  useEffect(() => {
    if (usePhotoUrl) {
      let blobUrl: string | null = null;
      let cancelled = false;
      setLoading(true);
      setError(null);
      setHasImage(false);

      hrmsApi.getBlob(photoUrl!).then((blob) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setFullBlobUrl(blobUrl);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          canvas.width = 160;
          canvas.height = 200;
          // The recovered photo is already a face crop (not a full document
          // scan needing bbox detection) — just cover-fit it into the frame.
          const scale = Math.max(160 / img.width, 200 / img.height);
          const sw = 160 / scale;
          const sh = 200 / scale;
          const sx = (img.width - sw) / 2;
          const sy = (img.height - sh) / 2;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 160, 200);
          setHasImage(true);
          setLoading(false);
        };
        img.onerror = () => { if (!cancelled) setPhotoUrlFailed(true); };
        img.src = blobUrl!;
      }).catch(() => {
        if (!cancelled) setPhotoUrlFailed(true);
      });

      return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }

    if (!src) { setError(noFaceText ?? "No document"); return; }

    let blobUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHasImage(false);

    if (isPdf) {
      hrmsApi.getBlob(src).then((blob) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setFullBlobUrl(blobUrl);
        setHasImage(true);
        setLoading(false);
      }).catch(() => {
        if (!cancelled) { setError("Failed to load"); setLoading(false); }
      });
      return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }

    const detectUrl = faceDetectUrl ?? (documentId ? `/api/ats/fraud-alerts/documents/face-detect/${documentId}` : null);

    // Load blob + bbox in parallel
    Promise.all([
      hrmsApi.getBlob(src),
      detectUrl
        ? hrmsApi.get<{ bbox: FaceBbox | null }>(detectUrl).catch(() => ({ bbox: null as FaceBbox | null }))
        : Promise.resolve({ bbox: null as FaceBbox | null }),
    ]).then(([blob, { bbox }]) => {
      if (cancelled) return;
      blobUrl = URL.createObjectURL(blob);
      setFullBlobUrl(blobUrl);
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Canvas output: 160 × 200 px (portrait face crop)
        canvas.width  = 160;
        canvas.height = 200;

        if (bbox) {
          // Expand the detected face region by margins for natural crop
          const mx = bbox.width  * 0.6;   // horizontal margin
          const my = bbox.height * 0.9;   // vertical margin (more above/below)
          const sx = Math.max(0, bbox.x - mx);
          const sy = Math.max(0, bbox.y - my * 1.2);
          const sw = Math.min(bbox.imageWidth  - sx, bbox.width  + mx * 2);
          const sh = Math.min(bbox.imageHeight - sy, bbox.height + my * 2.2);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 160, 200);
        } else {
          // Fallback: show the upper 62.5% of the document (face is typically here)
          const naturalH = img.width * 1.25;
          ctx.drawImage(img, 0, 0, img.width, Math.min(naturalH, img.height), 0, 0, 160, 200);
        }
        setHasImage(true);
        setLoading(false);
      };
      img.onerror = () => { if (!cancelled) { setError("Cannot render image"); setLoading(false); } };
      img.src = blobUrl!;
    }).catch(() => {
      if (!cancelled) { setError("Failed to load"); setLoading(false); }
    });

    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [usePhotoUrl, photoUrl, src, faceDetectUrl, documentId, noFaceText, isPdf]);

  const canZoom = hasImage && !loading && !!fullBlobUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Photo frame */}
      <div
        className={`relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-100 w-[160px] h-[200px] flex items-center justify-center shadow-sm group ${canZoom ? "cursor-zoom-in" : ""}`}
        onClick={() => canZoom && setZoomOpen(true)}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center gap-1 text-slate-400 px-3 text-center">
            <User className="h-10 w-10" />
            <span className="text-[11px]">{error}</span>
          </div>
        )}
        {isPdf && !usePhotoUrl ? (
          hasImage && (
            <div className="flex flex-col items-center gap-1.5 text-slate-500">
              <FileText className="h-12 w-12" />
              <span className="text-[11px] font-semibold">PDF document</span>
            </div>
          )
        ) : (
          <canvas ref={canvasRef} className={`w-full h-full object-cover ${hasImage ? "block" : "hidden"}`} />
        )}
        {canZoom && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <ZoomIn className="h-6 w-6 text-white drop-shadow" />
          </div>
        )}
        {isTrusted && (
          <div className="absolute top-2 left-2 bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow">
            <ShieldCheck className="h-2.5 w-2.5" /> GOVT VERIFIED
          </div>
        )}
      </div>
      {/* Labels */}
      <div className="text-center">
        <p className="text-xs font-bold text-slate-800">{label}</p>
        {subLabel && <p className="text-[11px] text-slate-500 mt-0.5">{subLabel}</p>}
      </div>
      {zoomOpen && fullBlobUrl && (
        <Lightbox src={fullBlobUrl} kind={isPdf ? "pdf" : "image"} label={label} onClose={() => setZoomOpen(false)} />
      )}
    </div>
  );
}

// ── Match Score Badge ─────────────────────────────────────────────────────────

function MatchScoreBadge({ score, status }: { score?: number | null; status: string }) {
  if (status === "no_face_detected") return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">
      <X className="h-3 w-3" /> No face
    </span>
  );
  if (score == null) return null;
  const matched = status === "matched";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${matched ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
      {matched ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {score}% {matched ? "Match" : "Mismatch"}
    </span>
  );
}

// ── Name status chip ──────────────────────────────────────────────────────────

function NameStatusChip({ status }: { status?: string | null }) {
  if (!status || status === "not_checked" || status === "pending") return (
    <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Not checked</span>
  );
  if (status === "matched") return (
    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3" /> Match
    </span>
  );
  if (status === "partial" || status === "acceptable") return (
    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
      <AlertTriangle className="h-3 w-3" /> Acceptable
    </span>
  );
  return (
    <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1">
      <ShieldX className="h-3 w-3" /> Mismatch
    </span>
  );
}

// ── Doc Number Status Chip ────────────────────────────────────────────────────

function NumStatusChip({ status }: { status?: string | null }) {
  if (!status || status === "not_checked") return <span className="text-[11px] text-slate-400">—</span>;
  if (status === "matched") return <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Match</span>;
  if (status === "mismatch") return <span className="text-[11px] font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Mismatch</span>;
  return <span className="text-[11px] text-slate-500">{status}</span>;
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{children}</p>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface FraudComparisonPanelProps {
  candidateId: string;
  candidateName?: string;
  /** When true, shows the resolution action panel and acknowledgement gate */
  showActions?: boolean;
  /** Called when HR acknowledges fraud review — unblocks the Approve button */
  onAcknowledged?: (acknowledged: boolean) => void;
  /** Called when any alert is resolved (triggers reload in parent) */
  onAlertResolved?: () => void;
}

export function FraudComparisonPanel({
  candidateId,
  candidateName,
  showActions = true,
  onAcknowledged,
  onAlertResolved,
}: FraudComparisonPanelProps) {
  const [data, setData]       = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Resolution state per alert
  const [choice, setChoice]   = useState<Record<string, number>>({});
  const [notes, setNotes]     = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Acknowledgement gate
  const [acknowledged, setAcknowledged] = useState(false);

  // Face comparison section collapse
  const [showFaces, setShowFaces] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await hrmsApi.get<ComparisonData>(`/api/ats/fraud-alerts/candidate/${candidateId}/comparison`);
      setData(r);
    } catch {
      setError("Could not load fraud comparison data.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { void load(); }, [load]);

  // Reset acknowledgement when alerts change
  useEffect(() => {
    setAcknowledged(false);
    onAcknowledged?.(false);
  }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAcknowledge = (checked: boolean) => {
    setAcknowledged(checked);
    onAcknowledged?.(checked);
  };

  const resolveAlert = async (alert: FraudAlert) => {
    const picked = RESOLUTIONS[choice[alert.id] ?? -1];
    const reason = (notes[alert.id] ?? "").trim();
    if (!picked) { setSaveError("Choose what you found before clearing this alert."); return; }
    if (picked.value !== "under_review" && !reason) { setSaveError("Add a note — it becomes the audit record."); return; }
    setSavingId(alert.id);
    setSaveError(null);
    try {
      await hrmsApi.patch(`/api/ats/fraud-alerts/${alert.id}/review`, {
        status: picked.value,
        notes: `[${picked.code}] ${reason}`,
      });
      onAlertResolved?.();
      await load();
    } catch {
      setSaveError("Could not save decision. Nothing was changed.");
    } finally {
      setSavingId(null);
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center gap-2 py-10 justify-center text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Loading fraud comparison…
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2 text-sm text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
    </div>
  );

  if (!data) return null;

  const { alerts, faceMatches, docs, profile, bgvNames, nameSummary, nameDetails, bankPennyDrop } = data;

  const openAlerts    = alerts.filter(a => a.status === "open" || a.status === "under_review");
  const blockingAlerts = openAlerts.filter(a => a.severity === "critical" || a.severity === "high");

  // Face data: find selfie, DigiLocker doc, and manual upload
  const selfieDoc     = docs.find(d => /selfie|live_photo|live/i.test(d.doc_type ?? ""));
  const aadhaarDigi   = docs.find(d => /digilocker.*aadhaar|aadhaar.*digilocker/i.test(d.doc_type ?? ""));
  const aadhaarManual = docs.find(d => /aadhaar/i.test(d.doc_type ?? "") && d !== aadhaarDigi);
  const panDigi       = docs.find(d => /digilocker.*pan|pan.*digilocker/i.test(d.doc_type ?? ""));
  const panManual     = docs.find(d => /^pan/i.test(d.doc_type ?? "") && d !== panDigi);

  // DigiLocker's completion download is ONE file total (Luckpay hands back a
  // single document, not a set — see digilocker-evidence.ts), stored outside
  // candidate_onboarding_document entirely, so it can never be matched by the
  // doc_type lookups above. Aadhaar is always evidenced by a completed
  // session; PAN only when the backend's own evidence rule (autoCreateDigilockerVerifiedChecks,
  // mirrored here via digilocker.panConfirmed) positively confirmed it — so
  // the file is only shown under the PAN row when that's true, rather than
  // guessing.
  const digilockerFile = data.digilocker;
  const digilockerUrls = digilockerFile
    ? {
        previewUrl: `/api/ats/fraud-alerts/documents/digilocker-preview/${candidateId}`,
        faceDetectUrl: `/api/ats/fraud-alerts/documents/digilocker-face-detect/${candidateId}`,
        isPdf: digilockerFile.contentType === "application/pdf",
      }
    : null;
  const showDigilockerForPan = digilockerFile?.panConfirmed ?? false;

  // Primary face match (selfie vs DigiLocker preferred, else vs any ID doc).
  // aadhaarDigi is dead (nothing ever writes that doc_type — see comment
  // above), so this falls back to the live-computed DigiLocker match keyed
  // by the session id before falling back to "whatever came back first".
  const primaryMatch = faceMatches.find(m =>
    m.photo_document_id === selfieDoc?.id && m.id_document_id === (aadhaarDigi?.id ?? digilockerFile?.sessionId)
  ) ?? faceMatches[0];

  // Convert is_match TINYINT(1) → status string for NameStatusChip
  const toMatchStatus = (d?: NameDetail) =>
    d ? (d.is_match === 1 ? "matched" : d.is_match === 0 ? "mismatch" : null) : null;

  // Lookup helper — source_type values can vary by integration (short codes or prefixed)
  const findDetail = (...types: string[]) => nameDetails.find(d => types.includes(d.source_type));

  // "bgv_aadhaar" / "bgv_pan" are not real candidate_name_match_detail.source_type
  // values — the backend only ever writes "form","aadhaar","pan","bank",
  // "employee_master","appointment_letter" (name-consistency.routes.ts), so those
  // findDetail() lookups always returned undefined and these two rows never showed
  // a status. Derive the BGV row's status directly from the check's own record
  // instead: candidate_bgv_check.status is 'verified'/'mismatch'/'failed'/etc, not
  // the NameStatusChip vocabulary, so map it the same way the Document Number
  // Comparison table below already does for the same column.
  const bgvCheckStatusToNameStatus = (status?: string | null): string | null => {
    if (!status) return null;
    if (status === "verified" || status === "matched") return "matched";
    if (status === "mismatch" || status === "failed") return "mismatch";
    return null; // pending / in_progress / manual_review / waived / queued — not yet decided
  };

  // Name rows for comparison table
  const nameRows: { label: string; name: string | null | undefined; status: string | null | undefined; isTrusted?: boolean; isReference?: boolean }[] = [
    { label: "Form entry (candidate)",   name: profile?.employee_name, status: null, isReference: true },
    {
      label: "DigiLocker — Aadhaar",
      name: findDetail("aadhaar", "digilocker_aadhaar", "aadhaar_offline")?.source_name
         ?? bgvNames.find(b => b.check_type === "aadhaar" || b.check_type === "aadhaar_offline")?.matched_name,
      status: toMatchStatus(findDetail("aadhaar", "digilocker_aadhaar", "aadhaar_offline")),
      isTrusted: true,
    },
    {
      label: "DigiLocker — PAN",
      name: findDetail("pan", "digilocker_pan")?.source_name
         ?? bgvNames.find(b => b.check_type === "pan")?.matched_name,
      status: toMatchStatus(findDetail("pan", "digilocker_pan")),
      isTrusted: true,
    },
    {
      label: "Bank — Penny Drop",
      name: bankPennyDrop?.bank_name,
      status: bankPennyDrop
        ? (bankPennyDrop.name_match_score != null
            ? (bankPennyDrop.name_match_score >= 80 ? "matched" : bankPennyDrop.name_match_score >= 60 ? "partial" : "mismatch")
            : null)
        : null,
    },
    {
      label: "BGV — Aadhaar check",
      name: bgvNames.find(b => b.check_type === "aadhaar" || b.check_type === "aadhaar_offline")?.matched_name,
      status: bgvCheckStatusToNameStatus(bgvNames.find(b => b.check_type === "aadhaar" || b.check_type === "aadhaar_offline")?.status),
    },
    {
      label: "BGV — PAN check",
      name: bgvNames.find(b => b.check_type === "pan")?.matched_name,
      status: bgvCheckStatusToNameStatus(bgvNames.find(b => b.check_type === "pan")?.status),
    },
  ];

  // Document number rows
  const aadhaarEntered  = profile?.aadhaar_number_masked;
  // DigiLocker docs are fetched as PDFs — no OCR extraction. The verification status comes from BGV.
  const aadhaarBgvCheck = bgvNames.find(b => b.check_type === "aadhaar" || b.check_type === "aadhaar_offline");

  const panEntered  = profile?.pan_number_masked;
  const panBgvCheck = bgvNames.find(b => b.check_type === "pan");

  return (
    <div className="space-y-5">

      {/* ── Alert Summary Banner ──────────────────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${blockingAlerts.length > 0 ? "border-red-300 bg-red-50" : openAlerts.length > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex flex-wrap items-center gap-3">
          {blockingAlerts.length > 0
            ? <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
            : openAlerts.length > 0
              ? <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              : <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            {openAlerts.length === 0
              ? <p className="text-sm font-bold text-emerald-800">No open fraud alerts — candidate cleared</p>
              : <>
                  <p className="text-sm font-bold text-slate-900">
                    {openAlerts.length} open fraud {openAlerts.length === 1 ? "alert" : "alerts"}
                    {blockingAlerts.length > 0 && <span className="ml-1 text-red-700">· {blockingAlerts.length} blocking employee creation</span>}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Indian name rules applied: shuffle, initials and dropped middle words are acceptable. Review each flag below.
                  </p>
                </>
            }
          </div>
          <div className="flex flex-wrap gap-1.5">
            {openAlerts.map(a => (
              <Badge key={a.id} className={`border text-[10px] font-bold ${SEVERITY_BG[a.severity]}`}>
                {a.alert_type.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* ── Face Comparison Grid ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFaces(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-800">Face Comparison</span>
            {primaryMatch && (
              <MatchScoreBadge score={primaryMatch.match_score} status={primaryMatch.match_status} />
            )}
          </div>
          {showFaces ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {showFaces && (
          <div className="border-t border-slate-100 p-4 space-y-4">
            <p className="text-[11px] text-slate-500">
              All faces are auto-detected and vertically aligned for comparison. The DigiLocker source is government-verified (ground truth). Face match score is selfie vs DigiLocker.
            </p>

            {/*
              Primary comparison: Selfie vs DigiLocker Aadhaar vs Manual Aadhaar.
              The DigiLocker Aadhaar cell renders the recovered eKYC face photo
              (photoUrl) when available, falling back to the previewUrl/isPdf
              document-scan resolution otherwise. Note: the match-score badge
              above (primaryMatch) is NOT recomputed against this new photo
              source yet — compareFaces/detectFaceBbox operate on a file path
              on disk, not this fetched Buffer response, so live scoring
              against the recovered photo is a separate follow-up.
            */}
            <div>
              <SectionHeader>Aadhaar face comparison</SectionHeader>
              <div className="flex flex-wrap gap-6 justify-start">
                <FacePhotoCell
                  documentId={selfieDoc?.id}
                  label="Live Selfie"
                  subLabel="Captured during onboarding"
                  noFaceText="No selfie uploaded"
                />
                <div className="flex items-center self-center">
                  <div className="text-center">
                    {primaryMatch ? (
                      <MatchScoreBadge score={primaryMatch.match_score} status={primaryMatch.match_status} />
                    ) : (
                      <span className="text-[11px] text-slate-400">vs</span>
                    )}
                  </div>
                </div>
                <FacePhotoCell
                  documentId={aadhaarDigi?.id}
                  previewUrl={digilockerUrls?.previewUrl}
                  faceDetectUrl={digilockerUrls?.faceDetectUrl}
                  isPdf={digilockerUrls?.isPdf}
                  photoUrl={`/api/ats/fraud-alerts/documents/digilocker-face-photo/${candidateId}`}
                  label="DigiLocker Aadhaar"
                  subLabel="Govt-verified · ground truth"
                  isTrusted={!!digilockerFile}
                  noFaceText="DigiLocker not completed"
                />
                <div className="flex items-center self-center">
                  <span className="text-[11px] text-slate-400">vs</span>
                </div>
                <FacePhotoCell
                  documentId={aadhaarManual?.id}
                  label="Manually Uploaded Aadhaar"
                  subLabel="Candidate-submitted"
                  noFaceText="No manual upload"
                />
              </div>
            </div>

            {/* PAN comparison if PAN docs exist */}
            {(panDigi?.id || panManual?.id || showDigilockerForPan) && (
              <div className="border-t border-slate-100 pt-4">
                <SectionHeader>PAN face comparison</SectionHeader>
                {digilockerFile && !showDigilockerForPan && (
                  <p className="text-[11px] text-amber-600 mb-2">
                    DigiLocker completed for this candidate, but only confirmed Aadhaar — its file isn't shown here because we don't have evidence it's the PAN document.
                  </p>
                )}
                <div className="flex flex-wrap gap-6 justify-start">
                  <FacePhotoCell
                    documentId={selfieDoc?.id}
                    label="Live Selfie"
                    subLabel="Reference"
                  />
                  <div className="flex items-center self-center">
                    {faceMatches.find(m => m.id_document_id === (panDigi?.id ?? (showDigilockerForPan ? digilockerFile?.sessionId : undefined))) ? (
                      <MatchScoreBadge
                        score={faceMatches.find(m => m.id_document_id === (panDigi?.id ?? (showDigilockerForPan ? digilockerFile?.sessionId : undefined)))?.match_score}
                        status={faceMatches.find(m => m.id_document_id === (panDigi?.id ?? (showDigilockerForPan ? digilockerFile?.sessionId : undefined)))?.match_status ?? ""}
                      />
                    ) : (
                      <span className="text-[11px] text-slate-400">vs</span>
                    )}
                  </div>
                  <FacePhotoCell
                    documentId={panDigi?.id}
                    previewUrl={showDigilockerForPan ? digilockerUrls?.previewUrl : undefined}
                    faceDetectUrl={showDigilockerForPan ? digilockerUrls?.faceDetectUrl : undefined}
                    isPdf={showDigilockerForPan ? digilockerUrls?.isPdf : undefined}
                    label="DigiLocker PAN"
                    subLabel="Govt-verified"
                    isTrusted={showDigilockerForPan}
                    noFaceText="PAN not in DigiLocker"
                  />
                  <div className="flex items-center self-center">
                    <span className="text-[11px] text-slate-400">vs</span>
                  </div>
                  <FacePhotoCell
                    documentId={panManual?.id}
                    label="Manually Uploaded PAN"
                    subLabel="Candidate-submitted"
                    noFaceText="No PAN uploaded"
                  />
                </div>
              </div>
            )}

            {/* All face matches summary table */}
            {faceMatches.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <SectionHeader>All face match records</SectionHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left pb-2 text-slate-400 font-semibold">Photo source</th>
                        <th className="text-left pb-2 text-slate-400 font-semibold">ID document</th>
                        <th className="text-left pb-2 text-slate-400 font-semibold">Score</th>
                        <th className="text-left pb-2 text-slate-400 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faceMatches.map(m => (
                        <tr key={m.id} className="border-b border-slate-50">
                          <td className="py-1.5 pr-4 text-slate-700 font-medium">{m.photo_doc_type ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-slate-700">{m.id_doc_type ?? "—"}</td>
                          <td className="py-1.5 pr-4 font-bold text-slate-800">{m.match_score != null ? `${m.match_score}%` : "—"}</td>
                          <td className="py-1.5">
                            <MatchScoreBadge score={m.match_score} status={m.match_status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Name Comparison Table ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <ShieldCheck className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-bold text-slate-800">Name Comparison</span>
          {nameSummary?.overall_status && (
            <NameStatusChip status={nameSummary.overall_status} />
          )}
        </div>
        <div className="p-4">
          <p className="text-[11px] text-slate-500 mb-3">
            Name shuffle, initials and dropped middle words are acceptable per Indian name matching rules.
            All sources are compared against the form-entry name.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left pb-2 text-slate-400 font-semibold w-48">Source</th>
                  <th className="text-left pb-2 text-slate-400 font-semibold">Name fetched</th>
                  <th className="text-left pb-2 text-slate-400 font-semibold w-32">Status</th>
                </tr>
              </thead>
              <tbody>
                {nameRows.map((row, i) => (
                  <tr key={i} className={`border-b border-slate-50 ${row.isReference ? "bg-blue-50/40" : ""}`}>
                    <td className="py-2 pr-4 text-slate-700 font-medium">
                      <div className="flex items-center gap-1.5">
                        {row.isTrusted && <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" />}
                        {row.label}
                        {row.isReference && <span className="text-[10px] text-blue-600 font-bold">(reference)</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-4 font-bold text-slate-900">
                      {row.name ? (
                        <span className={!row.isReference && row.status === "mismatch" ? "text-red-700" : ""}>{row.name}</span>
                      ) : (
                        <span className="text-slate-400 font-normal">Not available</span>
                      )}
                    </td>
                    <td className="py-2">
                      {row.isReference ? (
                        <span className="text-[11px] text-blue-600 font-semibold">— Reference</span>
                      ) : (
                        <NameStatusChip status={row.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bank penny drop detail */}
          {bankPennyDrop && (
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
              <p className="font-bold text-slate-600 uppercase tracking-wide text-[10px] mb-1.5">Bank Penny Drop Detail</p>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-400">Submitted by candidate:</span> <span className="font-bold text-slate-800">{bankPennyDrop.entered_name ?? "—"}</span></div>
                <div><span className="text-slate-400">Returned by bank:</span> <span className={`font-bold ${bankPennyDrop.status === "name_mismatch" ? "text-red-700" : "text-emerald-700"}`}>{bankPennyDrop.bank_name ?? "—"}</span></div>
                {bankPennyDrop.name_match_score != null && (
                  <div><span className="text-slate-400">Match score:</span> <span className="font-bold text-slate-800">{bankPennyDrop.name_match_score}%</span></div>
                )}
                {bankPennyDrop.status && (
                  <div><span className="text-slate-400">Status:</span> <span className="font-bold">{bankPennyDrop.status}</span></div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Document Number Comparison ────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <EyeOff className="h-4 w-4 text-orange-600" />
          <span className="text-sm font-bold text-slate-800">Document Number Comparison</span>
        </div>
        <div className="p-4 space-y-4">
          {/* Aadhaar numbers */}
          <div>
            <SectionHeader>Aadhaar number</SectionHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left pb-2 text-slate-400 font-semibold w-44">Source</th>
                    <th className="text-left pb-2 text-slate-400 font-semibold">Number (masked)</th>
                    <th className="text-left pb-2 text-slate-400 font-semibold w-28">Match vs entered</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-50 bg-blue-50/40">
                    <td className="py-2 pr-4 font-medium text-slate-700">Manually entered (form)</td>
                    <td className="py-2 pr-4 font-mono font-bold text-slate-900">{aadhaarEntered ?? "—"}</td>
                    <td className="py-2 text-[11px] text-blue-600 font-semibold">— Reference</td>
                  </tr>
                  <tr className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-medium text-slate-700 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" /> DigiLocker — BGV verified
                    </td>
                    <td className="py-2 pr-4 font-mono font-bold text-slate-900">
                      {aadhaarBgvCheck
                        ? <span className="font-sans text-slate-600 font-normal">Verified via BGV ({aadhaarBgvCheck.status ?? "checked"})</span>
                        : <span className="text-slate-400 font-normal font-sans">DigiLocker not completed</span>}
                    </td>
                    <td className="py-2">
                      {aadhaarBgvCheck?.status === "verified" || aadhaarBgvCheck?.status === "matched"
                        ? <NumStatusChip status="matched" />
                        : aadhaarBgvCheck
                          ? <NumStatusChip status={aadhaarBgvCheck.status ?? undefined} />
                          : <span className="text-[11px] text-slate-400">—</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* PAN numbers */}
          <div className="border-t border-slate-100 pt-4">
            <SectionHeader>PAN number</SectionHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left pb-2 text-slate-400 font-semibold w-44">Source</th>
                    <th className="text-left pb-2 text-slate-400 font-semibold">Number</th>
                    <th className="text-left pb-2 text-slate-400 font-semibold w-28">Match vs entered</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-50 bg-blue-50/40">
                    <td className="py-2 pr-4 font-medium text-slate-700">Manually entered (form)</td>
                    <td className="py-2 pr-4 font-mono font-bold text-slate-900">{panEntered ?? "—"}</td>
                    <td className="py-2 text-[11px] text-blue-600 font-semibold">— Reference</td>
                  </tr>
                  <tr className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-medium text-slate-700 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" /> DigiLocker — BGV verified
                    </td>
                    <td className="py-2 pr-4 font-mono font-bold text-slate-900">
                      {panBgvCheck
                        ? <span className="font-sans text-slate-600 font-normal">BGV verification status: {panBgvCheck.status ?? "checked"}</span>
                        : <span className="text-slate-400 font-normal font-sans">DigiLocker not completed</span>}
                    </td>
                    <td className="py-2">
                      {panBgvCheck?.status === "verified" || panBgvCheck?.status === "matched"
                        ? <NumStatusChip status="matched" />
                        : panBgvCheck
                          ? <NumStatusChip status={panBgvCheck.status ?? undefined} />
                          : <span className="text-[11px] text-slate-400">—</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Alert Resolution + Acknowledgement Gate ───────────────────────── */}
      {showActions && openAlerts.length > 0 && (
        <div className="space-y-3">
          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {saveError}
            </div>
          )}

          {openAlerts.map(alert => (
            <div key={alert.id} className={`rounded-xl border p-4 space-y-3 ${SEVERITY_BORDER[alert.severity]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`border text-[10px] font-bold ${SEVERITY_BG[alert.severity]}`}>{alert.severity}</Badge>
                <span className="font-mono text-xs font-bold text-slate-700">{alert.alert_type.replace(/_/g, " ")}</span>
                {alert.matched_candidate_id && (
                  <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700">
                    Matched: {alert.matched_candidate_name ?? alert.matched_candidate_id}
                  </span>
                )}
                {alert.created_at && (
                  <span className="text-xs text-slate-400 ml-auto">{String(alert.created_at).slice(0, 10)}</span>
                )}
              </div>

              {getAlertMessage(alert.details) && (
                <p className="text-xs text-slate-600 bg-white/60 border border-slate-200 rounded-lg px-3 py-2">
                  {getAlertMessage(alert.details)}
                </p>
              )}

              {/* Resolution choices */}
              <div className="grid gap-1.5">
                {RESOLUTIONS.map((opt, idx) => (
                  <label
                    key={`${alert.id}-${opt.code}`}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer text-xs transition-colors ${
                      choice[alert.id] === idx ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`resolution-${alert.id}`}
                      checked={choice[alert.id] === idx}
                      onChange={() => setChoice(prev => ({ ...prev, [alert.id]: idx }))}
                      className="mt-0.5 accent-blue-600"
                    />
                    <span>
                      <span className="font-semibold text-slate-900">{opt.label}</span>
                      <span className="block text-slate-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              <textarea
                value={notes[alert.id] ?? ""}
                onChange={e => setNotes(prev => ({ ...prev, [alert.id]: e.target.value }))}
                placeholder="What did you check and what did it show? This is the audit record."
                rows={2}
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:border-blue-400 focus:outline-none resize-none"
              />

              <Button
                onClick={() => void resolveAlert(alert)}
                disabled={savingId === alert.id}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 min-h-[36px]"
              >
                {savingId === alert.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving…</> : "Record decision"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── Acknowledgement Gate (unblocks Approve button in parent) ─────── */}
      {showActions && (
        <label className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${acknowledged ? "border-emerald-300 bg-emerald-50" : "border-blue-200 bg-blue-50/60 hover:border-blue-300"}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => handleAcknowledge(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-blue-600 shrink-0"
          />
          <div>
            <p className="text-sm font-bold text-slate-900">I have reviewed all fraud flags for {candidateName ?? "this candidate"}</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Checking this box records your review and enables the Approve Profile button.
              {blockingAlerts.length > 0 && openAlerts.some(a => a.status === "open") && (
                <span className="text-red-700 font-semibold"> Blocking alerts must be resolved first.</span>
              )}
            </p>
          </div>
        </label>
      )}
    </div>
  );
}

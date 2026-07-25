import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  Send,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getStatusMeta,
  useCreateCompanyPost,
  useMyCompanyPosts,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiBase";
import { formatRelativeTime } from "@/lib/companyFeedUtils";
import { getAuthToken } from "@/lib/hrmsApi";

type DraftImage = {
  id: string;
  file: File;
  previewUrl: string;
  uploadState: "ready" | "uploading" | "uploaded" | "failed";
  uploadedFileId?: string;
  error?: string;
};

const MAX_ATTACHMENTS = 4;
const MAX_CHARS = 2000;

function isCreatorAccessError(message: string | undefined): boolean {
  return /creator access|required|no active company post creator access/i.test(message ?? "");
}

async function uploadImage(file: File): Promise<string> {
  const token = getAuthToken();
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(apiUrl("/api/engagement/company-posts/upload"), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean; message?: string; error?: string; data?: { file_id?: string };
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? "Image upload failed.");
  const fileId = payload?.data?.file_id;
  if (!fileId) throw new Error("Upload completed without a file reference.");
  return fileId;
}

// Circular progress ring for character counter
function CharRing({ value, max }: { value: number; max: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const danger = value > max * 0.9;
  const warn = value > max * 0.7;
  const color = danger ? "#E8231A" : warn ? "#f59e0b" : "#1B6AB5";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={r} fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
      <circle
        cx="14" cy="14" r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={`${circ} ${circ}`}
        strokeDashoffset={circ - pct * circ}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
        style={{ transition: "stroke-dashoffset 0.15s ease, stroke 0.15s ease" }}
      />
      {value > max * 0.7 && (
        <text x="14" y="18" textAnchor="middle" fontSize="7" fill={color} fontWeight="600">
          {max - value}
        </text>
      )}
    </svg>
  );
}

export default function NativeCompanyPostCreate() {
  const { toast } = useToast();
  const createPost = useCreateCompanyPost();
  const myPostsQuery = useMyCompanyPosts({ limit: 8 });

  const [content, setContent] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [submitError, setSubmitError] = useState<string>("");
  const [formKey, setFormKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draftImagesRef = useRef<DraftImage[]>([]);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => { draftImagesRef.current = draftImages; }, [draftImages]);
  useEffect(() => {
    return () => { for (const img of draftImagesRef.current) URL.revokeObjectURL(img.previewUrl); };
  }, []);

  const creatorDenied = myPostsQuery.isError && isCreatorAccessError(myPostsQuery.error?.message);
  const creatorError = myPostsQuery.isError && !creatorDenied ? myPostsQuery.error?.message || "Creator workspace could not be loaded." : "";
  const myPosts = myPostsQuery.data?.posts ?? [];

  const awaitingCount = useMemo(() => myPosts.filter((p) => p.status === "pending_approval" || p.status === "borderline_flagged").length, [myPosts]);
  const publishedCount = useMemo(() => myPosts.filter((p) => p.status === "approved").length, [myPosts]);

  const canSubmit = content.trim().length > 0 || draftImages.length > 0;
  const isSubmitting = createPost.isPending;

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const all = Array.from(fileList);
    const incoming = all.filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) { toast({ title: "Images only", variant: "destructive" }); return; }
    const oversized = incoming.filter((f) => f.size > 10 * 1024 * 1024);
    if (oversized.length > 0) { toast({ title: "File too large", description: `Max 10 MB per image.`, variant: "destructive" }); return; }
    const slotsLeft = Math.max(0, MAX_ATTACHMENTS - draftImages.length);
    if (slotsLeft === 0) { toast({ title: "Max 4 images", variant: "destructive" }); return; }
    const selected = incoming.slice(0, slotsLeft).map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`, file, previewUrl: URL.createObjectURL(file), uploadState: "ready" as const,
    }));
    if (incoming.length > slotsLeft) toast({ title: `Only first ${slotsLeft} image${slotsLeft !== 1 ? "s" : ""} kept` });
    setDraftImages((cur) => [...cur, ...selected]);
  }

  function removeImage(imageId: string) {
    setDraftImages((cur) => { const m = cur.find((i) => i.id === imageId); if (m) URL.revokeObjectURL(m.previewUrl); return cur.filter((i) => i.id !== imageId); });
  }

  async function ensureUploads(): Promise<Array<{ file_id: string; media_type: "image"; sort_order: number }>> {
    const uploaded: Array<{ file_id: string; media_type: "image"; sort_order: number }> = [];
    for (let index = 0; index < draftImages.length; index += 1) {
      const image = draftImages[index];
      if (!image.uploadedFileId) {
        setDraftImages((cur) => cur.map((item) => item.id === image.id ? { ...item, uploadState: "uploading", error: undefined } : item));
        try {
          const fileId = await uploadImage(image.file);
          uploaded.push({ file_id: fileId, media_type: "image", sort_order: index + 1 });
          setDraftImages((cur) => cur.map((item) => item.id === image.id ? { ...item, uploadState: "uploaded", uploadedFileId: fileId, error: undefined } : item));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Image upload failed.";
          setDraftImages((cur) => cur.map((item) => item.id === image.id ? { ...item, uploadState: "failed", error: message } : item));
          throw new Error(message);
        }
      } else {
        uploaded.push({ file_id: image.uploadedFileId, media_type: "image", sort_order: index + 1 });
      }
    }
    return uploaded;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    if (!canSubmit) { setSubmitError("Write some copy or attach at least one image before submitting."); return; }
    try {
      const media = await ensureUploads();
      const result = await createPost.mutateAsync({ content_text: content.trim() || undefined, media });
      const outcome = result.status === "auto_rejected" ? "The post was auto-rejected by content policy."
        : result.status === "borderline_flagged" ? "The post was sent to moderation review."
        : "The post was submitted for approval.";
      toast({ title: "Creator studio updated", description: outcome });
      for (const img of draftImages) URL.revokeObjectURL(img.previewUrl);
      setContent(""); setDraftImages([]); setSubmitError(""); setFormKey((k) => k + 1);
      void myPostsQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit company post.";
      setSubmitError(message);
      toast({ title: "Submission failed", description: message, variant: "destructive" });
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave() { setIsDragging(false); }
  function handleDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }

  if (myPostsQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-4">
          <div className="h-8 w-48 skeleton" />
          <div className="h-64 w-full rounded-2xl skeleton" />
        </div>
      </DashboardLayout>
    );
  }

  if (creatorDenied) {
    return (
      <DashboardLayout>
        <div className="flex items-start justify-between border-b px-4 h-12 shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/engagement/company-feed"><Button variant="ghost" size="sm" className="h-6 px-2 text-xs">← Feed</Button></Link>
            <h1 className="text-sm font-semibold">New Post</h1>
          </div>
        </div>
        <main className="p-6">
          <Card className="rounded-2xl border-[color:var(--brand-100)] bg-white shadow-[var(--shadow-md)]">
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
                  <ShieldCheck className="h-3.5 w-3.5" /> Creator access required
                </div>
                <h2 className="text-2xl font-bold text-slate-950">This studio is for assigned creators only.</h2>
                <p className="text-sm leading-7 text-slate-600">Super Admin assigns posting rights separately. Once access is granted, this page turns into the live submission workspace.</p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild><Link to="/engagement/company-feed">Open company feed</Link></Button>
                  <Button asChild variant="outline"><Link to="/engagement">Back to engagement hub</Link></Button>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3 text-sm leading-6 text-slate-600">
                <p className="font-semibold text-slate-800">How it works:</p>
                <p>Assigned creators submit text or image-backed updates for moderation.</p>
                <p>HR Head, Admin, and Super Admin publish and delete posts.</p>
                <p>Policy-violating content is auto-rejected before reaching the feed.</p>
              </div>
            </CardContent>
          </Card>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
        <div className="flex items-center gap-2">
          <Link to="/engagement/company-feed"><Button variant="ghost" size="sm" className="h-6 px-2 text-xs">← Feed</Button></Link>
          <h1 className="text-sm font-semibold">New Post</h1>
        </div>
      </div>

      <main className="p-4 sm:p-6 lg:p-8">
        {creatorError && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <p className="flex-1 text-sm text-rose-700">{creatorError}</p>
            <Button variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-100" onClick={() => void myPostsQuery.refetch()}>
              <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}

        <div key={formKey} className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_22rem]">
          {/* Composer */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-md)]">
            {/* Gradient top strip */}
            <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)" }} />

            <form className="space-y-5 p-5 sm:p-6" onSubmit={handleSubmit}>
              {/* Copy section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="post-copy" className="text-sm font-semibold">Post copy</Label>
                  <CharRing value={content.length} max={MAX_CHARS} />
                </div>
                <Textarea
                  id="post-copy"
                  value={content}
                  maxLength={MAX_CHARS}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Share a townhall highlight, operations update, employee moment, or compliance-safe internal announcement…"
                  className="min-h-[180px] rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 text-[15px] leading-7 text-slate-700 focus:bg-white resize-none"
                  data-gramm="false"
                />
              </div>

              {/* Drag-drop image zone */}
              <div>
                <Label className="text-sm font-semibold mb-2 block">Images ({draftImages.length} / {MAX_ATTACHMENTS})</Label>
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex min-h-[80px] items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                    isDragging ? "border-[color:var(--brand-400)] bg-[color:var(--brand-50)]" : "border-slate-200 bg-slate-50/60"
                  } ${draftImages.length >= MAX_ATTACHMENTS ? "opacity-50 pointer-events-none" : "cursor-pointer hover:border-[color:var(--brand-300)] hover:bg-[color:var(--brand-50)/40]"}`}
                  onClick={() => { if (draftImages.length < MAX_ATTACHMENTS) document.getElementById("post-images-input")?.click(); }}
                >
                  <input
                    id="post-images-input"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
                  />
                  <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                    <Upload className="h-6 w-6 text-slate-400" />
                    <p className="text-sm text-slate-500">
                      {isDragging ? "Drop images here" : "Drag & drop or click to add images"}
                    </p>
                    <p className="text-[11px] text-slate-400">JPG, PNG, WebP — max 10 MB each</p>
                  </div>
                </div>

                {/* Image strip */}
                {draftImages.length > 0 && (
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {draftImages.map((img) => (
                      <div key={img.id} className="relative w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        <img src={img.previewUrl} alt={img.file.name} className="aspect-square w-full object-cover" />
                        {/* State overlay */}
                        {img.uploadState === "uploading" && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-xl">
                            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--brand-600)]" />
                          </div>
                        )}
                        {img.uploadState === "uploaded" && (
                          <div className="absolute bottom-1.5 right-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 drop-shadow-sm" />
                          </div>
                        )}
                        {img.uploadState === "failed" && (
                          <div className="absolute inset-0 flex items-center justify-center bg-rose-50/80 rounded-xl">
                            <AlertCircle className="h-4 w-4 text-rose-600" />
                          </div>
                        )}
                        {/* Remove */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                          aria-label={`Remove ${img.file.name}`}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/70 text-white hover:bg-slate-950 transition"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {/* Filename */}
                        <div className="border-t border-slate-200 bg-white px-1.5 py-1">
                          <p className="truncate text-[10px] text-slate-600">{img.file.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {submitError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {submitError}
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="w-full rounded-xl py-3 text-sm font-semibold bg-[color:var(--brand-600)] hover:bg-[color:var(--brand-700)]"
              >
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" /> Submit for review</>
                )}
              </Button>
            </form>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-[var(--shadow-sm)]">
                <p className="text-xl font-bold tabular-nums text-slate-950">{awaitingCount}</p>
                <p className="text-[11px] text-slate-500">Awaiting review</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-[var(--shadow-sm)]">
                <p className="text-xl font-bold tabular-nums text-slate-950">{publishedCount}</p>
                <p className="text-[11px] text-slate-500">Published</p>
              </div>
            </div>

            {/* Policy reminder */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600 space-y-2">
              <p className="font-semibold text-slate-800">Submission policy</p>
              <p>All posts go through moderation before publishing. Policy-violating content is auto-rejected.</p>
              <p>Max 2000 characters. Up to 4 images (JPG/PNG/WebP, max 10 MB each).</p>
            </div>

            {/* My latest submissions */}
            {myPosts.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-sm)]">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">My latest submissions</p>
                </div>
                <div className="p-3 space-y-2">
                  {myPosts.slice(0, 4).map((post) => {
                    const meta = getStatusMeta(post.status);
                    return (
                      <div key={post.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                          <span className="text-[10px] text-slate-400">{formatRelativeTime(post.submitted_at ?? post.created_at)}</span>
                        </div>
                        <p className="line-clamp-2 text-[12px] leading-5 text-slate-600">{post.content_text?.trim() || "Image-led post"}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </DashboardLayout>
  );
}

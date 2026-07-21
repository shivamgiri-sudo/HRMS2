import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ImagePlus,
  Loader2,
  PenSquare,
  RefreshCcw,
  Send,
  ShieldCheck,
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

function isCreatorAccessError(message: string | undefined): boolean {
  return /creator access|required|no active company post creator access/i.test(message ?? "");
}

const STATUS_BORDER_MAP: Record<string, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  borderline_flagged: "border-orange-200 bg-orange-50 text-orange-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  auto_rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

function statusBadgeClass(status: string): string {
  return STATUS_BORDER_MAP[status] ?? "border-slate-200 bg-slate-100 text-slate-600";
}

function formatDateTime(value: string | null): string {
  if (!value) return "Just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

  const payload = (await response.json().catch(() => null)) as
    | {
        success?: boolean;
        message?: string;
        error?: string;
        data?: { file_id?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.message ?? "Image upload failed.");
  }

  const fileId = payload?.data?.file_id;
  if (!fileId) {
    throw new Error("Upload completed without a file reference.");
  }

  return fileId;
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[color:var(--brand-600)] shadow-[var(--shadow-xs)]">
        <PenSquare className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-['Fira_Sans'] text-xl font-semibold tracking-[-0.03em] text-slate-950">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export default function NativeCompanyPostCreate() {
  const { toast } = useToast();
  const createPost = useCreateCompanyPost();
  const myPostsQuery = useMyCompanyPosts({ limit: 8 });

  const [content, setContent] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [submitError, setSubmitError] = useState<string>("");
  const draftImagesRef = useRef<DraftImage[]>([]);

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    return () => {
      for (const image of draftImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  const creatorDenied = myPostsQuery.isError && isCreatorAccessError(myPostsQuery.error?.message);
  const creatorError =
    myPostsQuery.isError && !creatorDenied
      ? myPostsQuery.error?.message || "Creator workspace could not be loaded."
      : "";

  const myPosts = myPostsQuery.data?.posts ?? [];

  const awaitingCount = useMemo(
    () =>
      myPosts.filter(
        (post) => post.status === "pending_approval" || post.status === "borderline_flagged",
      ).length,
    [myPosts],
  );

  const publishedCount = useMemo(
    () => myPosts.filter((post) => post.status === "approved").length,
    [myPosts],
  );

  const canSubmit = content.trim().length > 0 || draftImages.length > 0;
  const isSubmitting = createPost.isPending;

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;

    const all = Array.from(fileList);
    const incoming = all.filter((file) => file.type.startsWith("image/"));
    if (incoming.length === 0) {
      toast({
        title: "Images only",
        description: "Please select image files for company feed attachments.",
        variant: "destructive",
      });
      return;
    }

    const oversized = incoming.filter((file) => file.size > 10 * 1024 * 1024);
    if (oversized.length > 0) {
      toast({
        title: "File too large",
        description: `${oversized.map((f) => f.name).join(", ")} exceed${oversized.length === 1 ? "s" : ""} the 10 MB limit.`,
        variant: "destructive",
      });
      return;
    }

    const slotsLeft = Math.max(0, MAX_ATTACHMENTS - draftImages.length);
    if (slotsLeft === 0) {
      toast({
        title: "Attachment limit reached",
        description: "A post can carry up to four images.",
        variant: "destructive",
      });
      return;
    }

    const selected = incoming.slice(0, slotsLeft).map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
      uploadState: "ready" as const,
    }));

    if (incoming.length > slotsLeft) {
      toast({
        title: "Only the first four images were kept",
        description: "Remove an attachment if you want to replace it.",
      });
    }

    setDraftImages((current) => [...current, ...selected]);
  }

  function removeImage(imageId: string) {
    setDraftImages((current) => {
      const match = current.find((image) => image.id === imageId);
      if (match) URL.revokeObjectURL(match.previewUrl);
      return current.filter((image) => image.id !== imageId);
    });
  }

  async function ensureUploads(): Promise<Array<{ file_id: string; media_type: "image"; sort_order: number }>> {
    const uploaded: Array<{ file_id: string; media_type: "image"; sort_order: number }> = [];

    for (let index = 0; index < draftImages.length; index += 1) {
      const image = draftImages[index];

      if (!image.uploadedFileId) {
        setDraftImages((current) =>
          current.map((item) =>
            item.id === image.id ? { ...item, uploadState: "uploading", error: undefined } : item,
          ),
        );

        try {
          const fileId = await uploadImage(image.file);
          uploaded.push({ file_id: fileId, media_type: "image", sort_order: index + 1 });
          setDraftImages((current) =>
            current.map((item) =>
              item.id === image.id
                ? { ...item, uploadState: "uploaded", uploadedFileId: fileId, error: undefined }
                : item,
            ),
          );
          continue;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Image upload failed.";
          setDraftImages((current) =>
            current.map((item) =>
              item.id === image.id ? { ...item, uploadState: "failed", error: message } : item,
            ),
          );
          throw new Error(message);
        }
      }

      uploaded.push({
        file_id: image.uploadedFileId,
        media_type: "image",
        sort_order: index + 1,
      });
    }

    return uploaded;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");

    if (!canSubmit) {
      setSubmitError("Write some copy or attach at least one image before submitting.");
      return;
    }

    try {
      const media = await ensureUploads();
      const result = await createPost.mutateAsync({
        content_text: content.trim() || undefined,
        media,
      });

      const outcome =
        result.status === "auto_rejected"
          ? "The post was auto-rejected by content policy."
          : result.status === "borderline_flagged"
            ? "The post was sent to moderation review."
            : "The post was submitted for approval.";

      toast({
        title: "Creator studio updated",
        description: outcome,
      });

      for (const image of draftImages) {
        URL.revokeObjectURL(image.previewUrl);
      }

      setContent("");
      setDraftImages([]);
      setSubmitError("");
      void myPostsQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit company post.";
      setSubmitError(message);
      toast({
        title: "Submission failed",
        description: message,
        variant: "destructive",
      });
    }
  }

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
        <div className="flex items-center gap-2">
          <Link to="/engagement/company-feed">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">← Feed</Button>
          </Link>
          <h1 className="text-sm font-semibold">New Post</h1>
        </div>
      </div>
      <main className="space-y-8 p-4 sm:p-6 lg:p-8">
        {myPostsQuery.isLoading ? (
          <div key="loading" className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_24rem]">
            <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[var(--shadow-sm)]">
              <div className="h-8 w-48 skeleton" />
              <div className="h-48 w-full rounded-[1.25rem] skeleton" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-24 rounded-[1.25rem] skeleton" />
                <div className="h-24 rounded-[1.25rem] skeleton" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-48 rounded-[1.75rem] skeleton" />
              <div className="h-56 rounded-[1.75rem] skeleton" />
            </div>
          </div>
        ) : creatorDenied ? (
          <Card key="denied" className="rounded-[1.9rem] border-[color:var(--brand-100)] bg-white shadow-[var(--shadow-md)]">
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Creator access required
                </div>
                <div className="space-y-3">
                  <h2 className="font-['Fira_Sans'] text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                    This studio opens only for assigned company feed creators.
                  </h2>
                  <p className="max-w-2xl text-sm leading-7 text-slate-600">
                    Super Admin assigns posting rights separately. Once access is granted, this page
                    turns into the live submission workspace and your moderation history appears here.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to="/engagement/company-feed">Open company feed</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/engagement">Back to engagement hub</Link>
                  </Button>
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/90 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                  What happens next
                </p>
                <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
                  <p>Assigned creators can submit text-only or image-backed updates for moderation.</p>
                  <p>HR Head, Admin, and Super Admin remain the only publish and delete authorities.</p>
                  <p>Policy-violating content is rejected before it reaches the employee feed.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : creatorError ? (
          <Card key="error" className="rounded-[1.75rem] border-rose-200 bg-rose-50/80 shadow-[var(--shadow-sm)]">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-600 shadow-[var(--shadow-xs)]">
                  <AlertCircle className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-rose-900">Creator studio is unavailable</p>
                  <p className="mt-1 text-sm text-rose-700">{creatorError}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-rose-200 bg-white text-rose-800 hover:bg-rose-100"
                onClick={() => {
                  void myPostsQuery.refetch();
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div key="composer" className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_24rem]">
            <section id="creator-composer" className="space-y-5">
              <Card className="rounded-[1.85rem] border-slate-200 bg-white shadow-[var(--shadow-md)]">
                <CardContent className="space-y-6 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--brand-700)]">
                        Draft composer
                      </p>
                      <h2 className="mt-2 font-['Fira_Sans'] text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                        Prepare a clean post for moderation
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                        Keep the message factual, internal, and publication-ready. Images are optional,
                        and the review queue decides what becomes visible to all employees.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:min-w-[14rem]">
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Awaiting review
                        </p>
                        <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                          {awaitingCount}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Published
                        </p>
                        <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                          {publishedCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="company-post-copy">Post copy</Label>
                        <span className={`text-xs tabular-nums ${content.length > 1900 ? "text-amber-600" : "text-slate-400"}`}>
                          {content.length} / 2000
                        </span>
                      </div>
                      <Textarea
                        id="company-post-copy"
                        value={content}
                        maxLength={2000}
                        onChange={(event) => setContent(event.target.value)}
                        placeholder="Share a townhall highlight, operations update, employee moment, or compliance-safe internal announcement."
                        className="min-h-[220px] rounded-[1.4rem] border-slate-200 bg-slate-50/60 px-4 py-3 text-[15px] leading-7 text-slate-700"
                      />
                      <p className="text-xs text-slate-500">
                        Keep it concise and professional. Policy checks run before any approver sees it.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Label htmlFor="company-post-images">Images</Label>
                          <p className="mt-1 text-xs text-slate-500">
                            Supports JPG, PNG, GIF up to 10 MB. Up to four images per post.
                          </p>
                        </div>
                        <input
                          id="company-post-images"
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            addFiles(event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => {
                            document.getElementById("company-post-images")?.click();
                          }}
                        >
                          <ImagePlus className="h-4 w-4" />
                          Add images
                        </Button>
                      </div>

                      {draftImages.length === 0 ? (
                        <EmptyState
                          title="No images attached"
                          description="This post can go out as text-only, or you can add up to four supporting images before submission."
                        />
                      ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                          {draftImages.map((image) => (
                            <div
                              key={image.id}
                              className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-50/90"
                            >
                              <div className="relative aspect-video max-h-24 overflow-hidden bg-slate-200">
                                <img
                                  src={image.previewUrl}
                                  alt={image.file.name}
                                  className="h-full w-full object-cover"
                                />
                                <button
                                  type="button"
                                  className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/75 text-white transition hover:bg-slate-950"
                                  onClick={() => removeImage(image.id)}
                                  aria-label={`Remove ${image.file.name}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="space-y-2 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">
                                      {image.file.name}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {(image.file.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                  </div>
                                  <span
                                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                      image.uploadState === "uploaded"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : image.uploadState === "failed"
                                          ? "border-rose-200 bg-rose-50 text-rose-700"
                                          : image.uploadState === "uploading"
                                            ? "border-amber-200 bg-amber-50 text-amber-700"
                                            : "border-slate-200 bg-white text-slate-600"
                                    }`}
                                  >
                                    {image.uploadState === "uploaded"
                                      ? "Ready"
                                      : image.uploadState === "failed"
                                        ? "Upload failed"
                                        : image.uploadState === "uploading"
                                          ? "Uploading"
                                          : "Local preview"}
                                  </span>
                                </div>
                                {image.error ? (
                                  <p className="text-xs text-rose-600">{image.error}</p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {submitError ? (
                      <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {submitError}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm leading-6 text-slate-600">
                        <p className="font-semibold text-slate-900">Submission lane</p>
                        <p>
                          After submission, the post may go straight to approval, route to moderation review,
                          or auto-reject if policy-violating content is detected.
                        </p>
                      </div>
                      <Button
                        type="submit"
                        disabled={!canSubmit || isSubmitting}
                        className="rounded-[1rem] bg-[color:var(--brand-600)] hover:bg-[color:var(--brand-700)]"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Submitting
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Submit for review
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </section>

            <aside className="space-y-5">
              <div className="border rounded-lg p-3 text-xs text-slate-500">
                Posts are reviewed before publishing. Max 2000 chars. Images: JPG/PNG, max 4.
              </div>

              <Card className="rounded-[1.75rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                        My latest submissions
                      </p>
                    </div>
                    <Button asChild variant="ghost" className="rounded-xl px-0 text-[color:var(--brand-700)]">
                      <Link to="/engagement/company-feed">Open feed</Link>
                    </Button>
                  </div>

                  {myPosts.length === 0 ? (
                    <EmptyState
                      title="No submissions yet"
                      description="Your first creator draft will start the moderation history for this workspace."
                    />
                  ) : (
                    <div className="space-y-3">
                      {myPosts.slice(0, 3).map((post) => {
                        const statusMeta = getStatusMeta(post.status);
                        return (
                          <div
                            key={post.id}
                            className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-2">
                                <span
                                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(post.status)}`}
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                  {statusMeta.label}
                                </span>
                                <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                                  {post.content_text?.trim() || "Image-led post"}
                                </p>
                              </div>
                              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                                {formatDateTime(post.submitted_at ?? post.created_at)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {(myPostsQuery.data?.total ?? 0) > 3 && (
                        <p className="pt-1 text-center text-xs text-slate-500">
                          Showing 3 of {myPostsQuery.data?.total} posts
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}

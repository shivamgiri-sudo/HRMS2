import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, ArrowLeft, CalendarDays, Info, Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { addDays, errorMessage, formatDate, localIsoDate, reasonLabel, RESIGNATION_REASONS } from "./resignation-types";

const REMARKS_MAX = 1000;
const REASON_CODES = RESIGNATION_REASONS.map((r) => r.code) as [string, ...string[]];

function buildSchema(minDate: string) {
  return z.object({
    reasonCategory: z.enum(REASON_CODES, { errorMap: () => ({ message: "Please choose a reason" }) }),
    lastWorkingDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Please pick your last working day")
      .refine((v) => v >= minDate, "Your last working day must be after today"),
    remarks: z.string().trim().max(REMARKS_MAX, `Please keep it under ${REMARKS_MAX} characters`),
  });
}
type Values = z.infer<ReturnType<typeof buildSchema>>;

/**
 * Resignation form: reason (closed set → dropdown), last working day with the notice period shown,
 * optional remarks, then a review step. Posts the existing POST /api/exit/resignation contract:
 * { reason, last_working_day } plus exitReasonCategory.
 */
export function ResignationForm({
  noticePeriodDays,
  onBack,
  onSubmitted,
}: {
  noticePeriodDays: number;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const today = localIsoDate(new Date());
  const minDate = addDays(today, 1);
  const suggested = addDays(today, Math.max(1, noticePeriodDays));
  const schema = useMemo(() => buildSchema(minDate), [minDate]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reasonCategory: undefined as unknown as string, lastWorkingDay: suggested, remarks: "" },
  });
  const [review, setReview] = useState<Values | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const lwd = form.watch("lastWorkingDay");
  const shortNotice = !!lwd && /^\d{4}-\d{2}-\d{2}$/.test(lwd) && lwd < suggested;

  async function submit() {
    if (!review) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const label = reasonLabel(review.reasonCategory) ?? review.reasonCategory;
      await hrmsApi.post("/api/exit/resignation", {
        reason: review.remarks.trim() || label,
        last_working_day: review.lastWorkingDay,
        exitReasonCategory: review.reasonCategory,
      });
      onSubmitted();
    } catch (err) {
      setServerError(errorMessage(err, "Could not submit your resignation. Please try again."));
      setSubmitting(false);
    }
  }

  if (review) {
    const reviewShort = review.lastWorkingDay < suggested;
    return (
      <section aria-labelledby="review-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 id="review-title" className="text-xl font-bold text-slate-900">
          Please confirm
        </h2>
        <p className="mt-1 text-base leading-relaxed text-slate-600">
          Check the details below. Your manager and HR will be notified once you submit.
        </p>
        <dl className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
          <SummaryRow label="Reason" value={reasonLabel(review.reasonCategory) ?? "—"} />
          <SummaryRow label="Last working day" value={formatDate(review.lastWorkingDay)} />
          <SummaryRow label="Notice period" value={`${noticePeriodDays} days (suggested ${formatDate(suggested)})`} />
          <SummaryRow label="Remarks" value={review.remarks.trim() || "None"} />
        </dl>
        {reviewShort && <ShortNoticeNote />}
        <p className="mt-4 flex gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-base leading-relaxed text-emerald-900">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          You can withdraw your resignation yourself until your exit is processed.
        </p>
        {serverError && (
          <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-base text-rose-800">
            {serverError}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => setReview(null)} className="w-full cursor-pointer sm:w-auto">
            <Pencil aria-hidden /> Edit details
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full cursor-pointer bg-slate-900 text-white transition-colors duration-200 ease-out hover:bg-slate-800 sm:w-auto"
          >
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Submit resignation
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="form-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 mb-2 inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl px-2 text-base font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <h2 id="form-title" className="text-xl font-bold text-slate-900">
        Resignation details
      </h2>
      <p className="mt-1 text-base leading-relaxed text-slate-600">You will see a summary before anything is submitted.</p>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => setReview(v))} className="mt-5 space-y-5" noValidate>
          <FormField
            control={form.control}
            name="reasonCategory"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base text-slate-900">Main reason</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] cursor-pointer rounded-lg text-base">
                      <SelectValue placeholder="Choose a reason" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {RESIGNATION_REASONS.map((r) => (
                      <SelectItem key={r.code} value={r.code} className="min-h-[44px] text-base">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lastWorkingDay"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base text-slate-900">Last working day</FormLabel>
                <FormControl>
                  <Input type="date" min={minDate} className="cursor-pointer" {...field} />
                </FormControl>
                <FormDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  Notice period: {noticePeriodDays} days — suggested {formatDate(suggested)}.
                  {field.value !== suggested && (
                    <button
                      type="button"
                      onClick={() => form.setValue("lastWorkingDay", suggested, { shouldValidate: true })}
                      className="min-h-[44px] cursor-pointer rounded-lg px-1 font-semibold text-teal-800 underline underline-offset-2 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                    >
                      Use suggested date
                    </button>
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {shortNotice && <ShortNoticeNote />}

          <FormField
            control={form.control}
            name="remarks"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base text-slate-900">Anything you would like to add (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={4} placeholder="Share more context for your manager and HR" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onBack} className="w-full cursor-pointer sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" className="w-full cursor-pointer bg-slate-900 text-white transition-colors duration-200 ease-out hover:bg-slate-800 sm:w-auto">
              Review
            </Button>
          </div>
        </form>
      </Form>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="text-sm font-semibold text-slate-600 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-base text-slate-900">{value}</dd>
    </div>
  );
}

function ShortNoticeNote() {
  return (
    <p className="mt-3 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base leading-relaxed text-amber-900">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      This is earlier than your notice period. Your manager and HR will review it, and unserved notice may be adjusted in
      your final settlement.
    </p>
  );
}

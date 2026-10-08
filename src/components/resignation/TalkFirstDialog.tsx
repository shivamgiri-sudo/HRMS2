import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { errorMessage } from "./resignation-types";

const NOTE_MAX = 500;
const schema = z.object({ note: z.string().trim().max(NOTE_MAX, `Please keep it under ${NOTE_MAX} characters`) });
type Values = z.infer<typeof schema>;

/**
 * "Talk to my manager / HR first". Sends an inbox request to the reporting manager and HR; it
 * never creates a resignation. The server allows one request per 24 h and says so (409).
 */
export function TalkFirstDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { note: "" } });
  const noteLength = form.watch("note")?.length ?? 0;

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await hrmsApi.post("/api/exit/resignation/me/talk-first", { note: values.note || undefined });
      setSent(true);
    } catch (err) {
      setServerError(errorMessage(err, "Could not send your request. Please try again."));
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSent(false);
      setServerError(null);
      form.reset({ note: "" });
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="h-7 w-7" aria-hidden />
            </span>
            <DialogTitle className="text-xl text-slate-900">Request sent</DialogTitle>
            <DialogDescription className="text-base leading-relaxed text-slate-600">
              Your manager and HR have been told you would like to talk. No resignation has been submitted — take the time
              you need.
            </DialogDescription>
            <Button className="mt-2 w-full sm:w-auto" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <DialogHeader className="text-left">
                <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                  <MessagesSquare className="h-5 w-5" aria-hidden />
                </span>
                <DialogTitle className="text-xl text-slate-900">Talk to your manager / HR first</DialogTitle>
                <DialogDescription className="text-base leading-relaxed text-slate-600">
                  We will let your reporting manager and HR know you would like a conversation. Nothing is submitted and your
                  resignation is not started.
                </DialogDescription>
              </DialogHeader>

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base text-slate-900">A short note (optional)</FormLabel>
                    <FormControl>
                      <Textarea rows={4} maxLength={NOTE_MAX + 50} placeholder="What would you like to talk about?" {...field} />
                    </FormControl>
                    <FormDescription className="text-sm text-slate-600">
                      {noteLength}/{NOTE_MAX} characters
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {serverError && (
                <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900">
                  {serverError}
                </p>
              )}

              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
                <Button type="button" variant="outline" className="w-full cursor-pointer sm:w-auto" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  className="w-full cursor-pointer bg-amber-600 text-white transition-colors duration-200 ease-out hover:bg-amber-700 sm:w-auto"
                >
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                  Send request
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

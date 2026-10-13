// src/components/finance/client-billing/SubmitToClientDialog.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { listSubmissions, submitToClient } from "@/lib/clientBillingApi";
import {
  DIALOG_60VW_CLASS,
  SECTION_LABEL_CLASS,
  formatDateTime,
} from "./shared";

interface Props {
  target: { id: string; label: string } | null;
  onOpenChange: (open: boolean) => void;
}

const LETTERHEAD_OPTIONS = [
  { value: "1", label: "With letterhead (logo, CIN, branch address, footer)" },
  { value: "0", label: "Without letterhead (plain)" },
];

const splitEmails = (raw: string) =>
  raw
    .split(/[,;\n]/)
    .map((e) => e.trim())
    .filter(Boolean);

/** Emails the approved invoice PDF to the client and shows every earlier send (who, when, to whom). */
export function SubmitToClientDialog({ target, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [letterhead, setLetterhead] = useState("1");

  useEffect(() => {
    if (target) {
      setTo("");
      setCc("");
      setSubject("");
      setMessage("");
      setLetterhead("1");
    }
  }, [target]);

  const historyQuery = useQuery({
    queryKey: ["client-billing", "submissions", target?.id],
    queryFn: () => listSubmissions(target!.id),
    enabled: Boolean(target),
  });
  const history = historyQuery.data?.data ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      submitToClient(target!.id, {
        to: splitEmails(to),
        cc: splitEmails(cc),
        subject: subject.trim() || undefined,
        message: message.trim() || undefined,
        letterhead: letterhead === "1",
      }),
    onSuccess: (res) => {
      toast({
        title: "Invoice emailed",
        description: `Sent to ${res.data.to.join(", ")}`,
      });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not send the invoice",
        description: error.message,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({
        queryKey: ["client-billing", "submissions", target?.id],
      });
    },
  });

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_60VW_CLASS}>
        <DialogHeader>
          <DialogTitle>Submit to client — {target?.label}</DialogTitle>
          <DialogDescription>
            Emails the tax invoice PDF. The send (or failure) is logged against
            the invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">To * (comma separated)</Label>
            <Input
              className="mt-1 h-8 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="accounts@client.com"
              inputMode="email"
            />
          </div>
          <div>
            <Label className="text-xs">Cc</Label>
            <Input
              className="mt-1 h-8 text-sm"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              inputMode="email"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={`Tax Invoice ${target?.label ?? ""}`}
                maxLength={300}
              />
            </div>
            <div>
              <Label className="text-xs">PDF format</Label>
              <SearchableSelect
                className="mt-1"
                options={LETTERHEAD_OPTIONS}
                value={letterhead}
                onChange={setLetterhead}
                aria-label="PDF format"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea
              className="mt-1 min-h-[72px] text-sm"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div>
            <p className={SECTION_LABEL_CLASS}>Earlier sends</p>
            {historyQuery.isLoading ? (
              <Loader2 className="mt-2 h-4 w-4 animate-spin text-slate-400" />
            ) : history.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">None</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {history.map((h) => (
                  <li key={h.id} className="rounded border px-2 py-1 text-xs">
                    <span
                      className={
                        h.send_status === "sent"
                          ? "font-medium text-emerald-700"
                          : "font-medium text-rose-700"
                      }
                    >
                      {h.send_status === "sent" ? "Sent" : "Failed"}
                    </span>{" "}
                    {formatDateTime(h.sent_at)} to {h.to_emails}
                    {h.error_message && (
                      <span className="text-rose-700">
                        {" "}
                        — {h.error_message}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="mt-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={splitEmails(to).length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Send invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

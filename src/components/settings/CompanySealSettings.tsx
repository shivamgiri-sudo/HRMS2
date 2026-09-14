import { useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Save, Stamp, PenLine, Eye, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type SealStatus = {
  success: boolean;
  signature: { configured: boolean };
  stamp: { configured: boolean };
  signatoryName: string | null;
  signatoryDesignation: string | null;
  appliesTo: string[];
};

const DOCUMENT_LABELS: Record<string, string> = {
  EPF_DECLARATION: "EPF Declaration (Form 11)",
  EPF_NOMINATION_FORM2: "EPF Nomination (Form 2)",
};

/**
 * Uploading a signature changes every statutory form generated afterwards, so
 * the preview opens the real EPF form with the seal applied rather than showing
 * a mock-up of where it might land.
 */
export function CompanySealSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const signatureRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);

  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [designation, setDesignation] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["company-seal"],
    queryFn: () => hrmsApi.get<SealStatus>("/api/company-seal"),
  });

  const status = data as SealStatus | undefined;
  const signatoryName = name ?? status?.signatoryName ?? "";
  const signatoryDesignation = designation ?? status?.signatoryDesignation ?? "";

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (signatureFile) form.append("signature", signatureFile);
      if (stampFile) form.append("stamp", stampFile);
      form.append("signatoryName", signatoryName);
      form.append("signatoryDesignation", signatoryDesignation);
      return hrmsApi.postForm("/api/company-seal", form);
    },
    onSuccess: () => {
      toast({
        title: "Signature and stamp saved",
        description: "Every statutory form generated from now on carries them.",
      });
      setSignatureFile(null);
      setStampFile(null);
      if (signatureRef.current) signatureRef.current.value = "";
      if (stampRef.current) stampRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["company-seal"] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : "Upload failed.",
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: (asset: "signature" | "stamp") => hrmsApi.delete(`/api/company-seal/${asset}`),
    onSuccess: () => {
      toast({ title: "Removed" });
      queryClient.invalidateQueries({ queryKey: ["company-seal"] });
    },
  });

  const openPreview = async () => {
    try {
      // Authenticated endpoint, so fetch as a blob rather than linking to it.
      const blob = await hrmsApi.getBlob("/api/company-seal/preview");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast({ title: "Preview unavailable", variant: "destructive" });
    }
  };

  const nothingConfigured = !status?.signature.configured && !status?.stamp.configured;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stamp className="h-5 w-5" />
          Company signature &amp; stamp
        </CardTitle>
        <CardDescription>
          The statutory EPF forms require an employer signature and seal of establishment.
          Upload them once and they are placed automatically on every form generated
          afterwards, so nothing needs printing, signing and scanning.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {nothingConfigured && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Nothing uploaded yet, so the employer block on each statutory form is
                  still blank and has to be signed by hand.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <AssetField
                icon={<PenLine className="h-4 w-4" />}
                title="Authorised signature"
                hint="PNG with a transparent background reproduces best."
                configured={Boolean(status?.signature.configured)}
                inputRef={signatureRef}
                selected={signatureFile}
                onSelect={setSignatureFile}
                onRemove={() => remove.mutate("signature")}
                removing={remove.isPending}
              />
              <AssetField
                icon={<Stamp className="h-4 w-4" />}
                title="Rubber stamp / seal"
                hint="Placed behind the signature, as a stamp is struck on paper."
                configured={Boolean(status?.stamp.configured)}
                inputRef={stampRef}
                selected={stampFile}
                onSelect={setStampFile}
                onRemove={() => remove.mutate("stamp")}
                removing={remove.isPending}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signatory-name">Authorised signatory</Label>
                <Input
                  id="signatory-name"
                  value={signatoryName}
                  placeholder="e.g. R. Ramachandran"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signatory-designation">Designation</Label>
                <Input
                  id="signatory-designation"
                  value={signatoryDesignation}
                  placeholder="e.g. Director"
                  onChange={(event) => setDesignation(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Applied automatically to
              </Label>
              <div className="flex flex-wrap gap-2">
                {(status?.appliesTo ?? []).map((code) => (
                  <Badge key={code} variant="secondary">
                    {DOCUMENT_LABELS[code] ?? code}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || (!signatureFile && !stampFile && name === null && designation === null)}
              >
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
              <Button variant="outline" onClick={openPreview} disabled={nothingConfigured}>
                <Eye className="mr-2 h-4 w-4" />
                Preview on the real form
              </Button>
              <p className="text-xs text-muted-foreground">
                Opens EPF Form 11 with the seal applied, so you can check the placement.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssetField(props: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  configured: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  selected: File | null;
  onSelect: (file: File | null) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {props.icon}
          {props.title}
        </div>
        {props.configured ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Uploaded
          </Badge>
        ) : (
          <Badge variant="outline">Not set</Badge>
        )}
      </div>

      {previewUrl && (
        <div className="flex items-center justify-center rounded border bg-[repeating-conic-gradient(#f3f4f6_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
          <img src={previewUrl} alt="" className="max-h-20 object-contain" />
        </div>
      )}

      <Input
        ref={props.inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          props.onSelect(file);
          setPreviewUrl(file ? URL.createObjectURL(file) : null);
        }}
      />
      <p className="text-xs text-muted-foreground">{props.hint}</p>

      {props.configured && !props.selected && (
        <Button variant="ghost" size="sm" onClick={props.onRemove} disabled={props.removing}>
          <Trash2 className="mr-2 h-3 w-3" />
          Remove
        </Button>
      )}
    </div>
  );
}

export default CompanySealSettings;

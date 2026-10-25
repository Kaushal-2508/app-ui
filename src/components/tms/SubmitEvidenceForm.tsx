import { useRef, useState } from "react";
import { useSubmitEvidence } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, Loader2, Paperclip, X, Upload } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — matches storage bucket limit
const ACCEPT_TYPES =
  "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z";

interface SubmitEvidenceFormProps {
  taskId: string;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SubmitEvidenceForm({ taskId }: SubmitEvidenceFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [evidenceType, setEvidenceType] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [examReferenceId, setExamReferenceId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitEvidence = useSubmitEvidence();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      toast.error(`File too large. Max ${formatBytes(MAX_FILE_BYTES)}.`);
      e.target.value = "";
      return;
    }
    setFile(picked);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetForm = () => {
    setEvidenceType("");
    setNotes("");
    setExamReferenceId("");
    clearFile();
    setIsOpen(false);
  };

  const uploadFile = async (toUpload: File): Promise<{ url: string; name: string }> => {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) throw new Error("Not authenticated");

    const safeName = sanitizeFileName(toUpload.name);
    const path = `${user.id}/${taskId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("task-evidence")
      .upload(path, toUpload, {
        contentType: toUpload.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from("task-evidence")
      .getPublicUrl(path);

    return { url: urlData.publicUrl, name: toUpload.name };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (evidenceType === "file" && !file) {
      toast.error("Pick a file to upload first.");
      return;
    }

    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;

      if (evidenceType === "file" && file) {
        setIsUploading(true);
        const uploaded = await uploadFile(file);
        fileUrl = uploaded.url;
        fileName = uploaded.name;
      }

      await submitEvidence.mutateAsync({
        taskId,
        evidenceType,
        notes: notes || undefined,
        fileUrl,
        fileName,
        examReferenceId: examReferenceId || undefined,
      });

      resetForm();
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't submit evidence.",
        context: "submitEvidence",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const isBusy = isUploading || submitEvidence.isPending;
  const submitDisabled =
    !evidenceType ||
    isBusy ||
    (evidenceType === "file" && !file) ||
    (evidenceType === "exam_reference" && !examReferenceId.trim()) ||
    (evidenceType === "text_note" && !notes.trim());

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 h-auto py-3">
          <Plus className="h-4 w-4" />
          Add Evidence
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form onSubmit={handleSubmit} className="p-4 pt-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="evidence-type">Evidence Type</Label>
            <SearchableSelect
              value={evidenceType}
              onValueChange={setEvidenceType}
              placeholder="Select type"
              searchPlaceholder="Search types..."
              options={[
                { value: "file", label: "File Upload" },
                { value: "exam_reference", label: "Exam Reference" },
                { value: "text_note", label: "Text Notes" },
              ]}
            />
          </div>

          {evidenceType === "file" && (
            <div className="space-y-2">
              <Label>Choose File</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                className="hidden"
                onChange={handleFileChange}
              />

              {!file ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center gap-2 h-11"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                >
                  <Upload className="h-4 w-4" />
                  Pick a file from your device
                </Button>
              ) : (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={clearFile}
                    disabled={isBusy}
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Images, PDFs, Office docs, archives. Max {formatBytes(MAX_FILE_BYTES)}.
              </p>
            </div>
          )}

          {evidenceType === "exam_reference" && (
            <div className="space-y-2">
              <Label htmlFor="exam-ref">Exam Reference ID</Label>
              <Input
                id="exam-ref"
                value={examReferenceId}
                onChange={(e) => setExamReferenceId(e.target.value)}
                placeholder="Enter exam ID"
              />
            </div>
          )}

          {evidenceType === "text_note" && (
            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter your evidence notes..."
                rows={3}
                required
              />
            </div>
          )}

          {evidenceType !== "text_note" && evidenceType !== "" && (
            <div className="space-y-2">
              <Label htmlFor="additional-notes">Additional Notes (optional)</Label>
              <Textarea
                id="additional-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes..."
                rows={2}
              />
            </div>
          )}

          <Button
            type="submit"
            disabled={submitDisabled}
            className="w-full"
          >
            {isBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isUploading ? "Uploading…" : "Submit Evidence"}
          </Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

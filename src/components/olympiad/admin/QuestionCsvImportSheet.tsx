import { useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import {
  downloadCsvTemplate,
  parseCsv,
  validateAgainstTopics,
  rowsToPayload,
  type CsvImportRow,
} from "@/lib/olympiad/csv";
import { useOlympiadTopics } from "@/hooks/olympiad/useOlympiadTopics";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
};

export function QuestionCsvImportSheet({
  open,
  onOpenChange,
  subjectId,
  gradeLevelId,
}: Props) {
  const queryClient = useQueryClient();
  const { data: topics } = useOlympiadTopics(subjectId);
  const validTopics = (topics ?? []).filter(
    (t) => t.grade_level_id === gradeLevelId,
  );
  const [parsedRows, setParsedRows] = useState<CsvImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = await parseCsv(file);
      const validated = validateAgainstTopics(parsed, validTopics);
      setParsedRows(validated);
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't parse CSV.",
        context: "QuestionCsvImportSheet.parseCsv",
      });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    if (!parsedRows) return;
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.warning("No valid rows to import");
      return;
    }
    setBusy(true);
    try {
      const topicLookup = new Map(
        validTopics.map((t) => [t.name.trim().toLowerCase(), t.id]),
      );
      const payload = rowsToPayload(
        validRows,
        topicLookup,
        subjectId,
        gradeLevelId,
      );
      const result = await invokeEdgeFunction<{ inserted_count: number }>(
        "oly-question-csv-import",
        { rows: payload },
      );
      const count = result.inserted_count ?? 0;
      toast.success(`Imported ${count} question${count === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({
        queryKey: ["olympiad", "question-bank", subjectId, gradeLevelId],
      });
      setParsedRows(null);
      onOpenChange(false);
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't import questions.",
        context: "QuestionCsvImportSheet.onImport",
      });
    } finally {
      setBusy(false);
    }
  };

  const validCount =
    parsedRows?.filter((r) => r.errors.length === 0).length ?? 0;
  const invalidCount =
    parsedRows?.filter((r) => r.errors.length > 0).length ?? 0;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk import questions"
      subtitle="Upload a CSV of questions for this subject and class."
    >
      <div className="space-y-4">
        <Button
          variant="outline"
          type="button"
          onClick={downloadCsvTemplate}
        >
          <Download className="h-4 w-4 mr-2" />
          Download template
        </Button>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">CSV file</Label>
          <Input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            disabled={busy}
          />
        </div>

        {parsedRows && (
          <section className="space-y-2">
            <p className="text-sm text-ink-700">
              {validCount} valid · {invalidCount} invalid
            </p>
            {invalidCount > 0 && (
              <ul className="max-h-48 overflow-auto text-[11px] space-y-1 border border-surface-stroke rounded-md p-2 bg-surface-card">
                {parsedRows
                  .filter((r) => r.errors.length > 0)
                  .map((r) => (
                    <li key={r.rowNumber}>
                      <span className="font-medium">Row {r.rowNumber}:</span>{" "}
                      {r.errors.join("; ")}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || validCount === 0}
            onClick={onImport}
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Upload className="h-4 w-4 mr-1" />
            Import {validCount > 0 ? validCount : ""} valid row
            {validCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </MobileSheet>
  );
}

import type { Tables } from "@/integrations/supabase/types";
import { FileText, Link2, MessageSquare } from "lucide-react";
import { format } from "date-fns";

interface EvidenceSectionProps {
  evidence: Tables<"task_evidence">[];
}

export function EvidenceSection({ evidence }: EvidenceSectionProps) {
  if (evidence.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic p-4 bg-muted/50 rounded-lg text-center">
        No evidence submitted yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {evidence.map((item) => (
        <div 
          key={item.id} 
          className="p-3 bg-muted/50 rounded-lg space-y-2"
        >
          <div className="flex items-start gap-2">
            {item.evidence_type === "file" && <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />}
            {item.evidence_type === "exam_reference" && <Link2 className="h-4 w-4 text-muted-foreground mt-0.5" />}
            {/* The CHECK constraint allows only file | exam_reference | text_note.
                This tested for "notes", so text notes rendered with no icon. */}
            {item.evidence_type === "text_note" && <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize">
                  {item.evidence_type.replace("_", " ")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(item.uploaded_at), "MMM d, yyyy HH:mm")}
                </span>
              </div>
              
              {item.file_name && (
                <p className="text-sm text-muted-foreground truncate">
                  {item.file_name}
                </p>
              )}
              
              {item.notes && (
                <p className="text-sm mt-1 whitespace-pre-wrap">
                  {item.notes}
                </p>
              )}
              
              {item.file_url && (
                <a 
                  href={item.file_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1 mt-1"
                >
                  <Link2 className="h-3 w-3" />
                  View File
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

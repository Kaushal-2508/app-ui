import { useRef, ForwardRefExoticComponent, RefAttributes } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExportReportButton } from "@/components/student/reports/ExportReportButton";
import { FileText } from "lucide-react";

interface DocumentShowcaseTabProps {
  title: string;
  description: string;
  filename: string;
  DocumentComponent: ForwardRefExoticComponent<RefAttributes<HTMLDivElement>>;
}

export function DocumentShowcaseTab({ title, description, filename, DocumentComponent }: DocumentShowcaseTabProps) {
  const documentRef = useRef<HTMLDivElement>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <ExportReportButton
          documentRef={documentRef}
          filename={`${filename}.pdf`}
          buttonText="Download PDF"
          variant="default"
          size="sm"
        />
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[70vh] rounded-lg border border-border/50">
          <div className="p-2">
            <DocumentComponent ref={documentRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

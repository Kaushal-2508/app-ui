import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Home } from "lucide-react";

interface SyllabusBreadcrumbProps {
  gradeName?: string | null;
  subjectName?: string | null;
  onNavigateToGrades: () => void;
  onNavigateToSubjects: () => void;
}

export function SyllabusBreadcrumb({
  gradeName,
  subjectName,
  onNavigateToGrades,
  onNavigateToSubjects,
}: SyllabusBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            className="flex items-center gap-1 cursor-pointer hover:text-foreground"
            onClick={onNavigateToGrades}
          >
            <Home className="h-4 w-4" />
            <span>All Grades</span>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {gradeName && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {subjectName ? (
                <BreadcrumbLink
                  className="cursor-pointer hover:text-foreground"
                  onClick={onNavigateToSubjects}
                >
                  {gradeName}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{gradeName}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        )}

        {subjectName && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{subjectName}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

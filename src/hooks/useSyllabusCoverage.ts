import { useQuery } from "@tanstack/react-query";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  getCoverageForClassSubject,
  getCoverageRowsForClassSubject,
  type ChapterCoverageRow,
  type CoverageSummary,
} from "@/lib/syllabusCoverage";

// -------------------------------------------------------------
// Read-side hooks for the coverage lib. The lib is pure-async so
// it can be consumed from edge functions or background jobs; the
// hooks just wrap it for React Query caching.
//
// Query key note: academic_year currently doesn't scope plans
// directly (see syllabusCoverage.ts), but it's part of the key
// so rollover re-fetches clean.
// -------------------------------------------------------------

export function useSyllabusCoverage(args: {
  classId: string | null;
  subjectId: string | null;
  academicYear?: string;
  enabled?: boolean;
}) {
  const { classId, subjectId, academicYear, enabled = true } = args;
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: [
      "syllabus-coverage",
      "summary",
      institutionId,
      classId,
      subjectId,
      academicYear ?? null,
    ],
    queryFn: async (): Promise<CoverageSummary> => {
      return getCoverageForClassSubject({
        classId: classId!,
        subjectId: subjectId!,
        institutionId: institutionId!,
        academicYear,
      });
    },
    enabled: enabled && !!institutionId && !!classId && !!subjectId,
  });
}

export function useSyllabusCoverageRows(args: {
  classId: string | null;
  subjectId: string | null;
  academicYear?: string;
  enabled?: boolean;
}) {
  const { classId, subjectId, academicYear, enabled = true } = args;
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: [
      "syllabus-coverage",
      "rows",
      institutionId,
      classId,
      subjectId,
      academicYear ?? null,
    ],
    queryFn: async (): Promise<ChapterCoverageRow[]> => {
      return getCoverageRowsForClassSubject({
        classId: classId!,
        subjectId: subjectId!,
        institutionId: institutionId!,
        academicYear,
      });
    },
    enabled: enabled && !!institutionId && !!classId && !!subjectId,
  });
}

export type { CoverageSummary, ChapterCoverageRow };

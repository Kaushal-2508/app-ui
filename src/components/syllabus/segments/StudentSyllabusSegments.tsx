import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Layers,
  FileText,
  Video,
  BookOpen,
  ExternalLink,
  Link as LinkIcon,
} from "lucide-react";
import { useStudentSyllabusSegments } from "@/hooks/useStudentSyllabusSegments";

/** Small type icon for a chapter's attached material. */
function materialIcon(type: string) {
  if (type === "video") return <Video className="h-3.5 w-3.5 shrink-0" />;
  if (type === "book") return <BookOpen className="h-3.5 w-3.5 shrink-0" />;
  if (type === "pdf") return <FileText className="h-3.5 w-3.5 shrink-0" />;
  return <LinkIcon className="h-3.5 w-3.5 shrink-0" />;
}

/**
 * Read-only student view of syllabus parts, grouped by subject. Shows each part
 * name with the chapters inside it (ordered by the teacher's sequence) and, under
 * each chapter, its study materials as clickable links so students can open the
 * PDFs straight from here. No progress or completion metrics, by design. Renders
 * nothing when the school has no parts, so a subject with zero parts looks
 * unchanged.
 */
export function StudentSyllabusSegments({ enabled }: { enabled: boolean }) {
  const { data = [], isLoading, isError } = useStudentSyllabusSegments(enabled);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    );
  }

  // Error before empty: a failed read must not silently look like "no parts".
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        We could not load your syllabus parts right now. Please try again later.
      </p>
    );
  }

  if (data.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
          <Layers className="h-5 w-5" />
        </span>
        <h2 className="text-lg sm:text-xl font-semibold text-ink-900">
          Syllabus Parts
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.map((subject) => (
          <div
            key={subject.subjectId}
            className="surface-card frosted-shadow rounded-card p-4"
          >
            <h3 className="mb-3 text-base font-semibold text-ink-900">
              {subject.subjectName}
            </h3>
            <Accordion type="multiple" className="w-full">
              {subject.segments.map((segment) => {
                const fileCount = segment.chapters.reduce(
                  (n, c) => n + c.materials.length,
                  0,
                );
                return (
                  <AccordionItem key={segment.id} value={segment.id}>
                    <AccordionTrigger className="text-sm font-medium text-ink-800">
                      <span className="flex w-full items-center justify-between gap-3 pr-2">
                        <span className="text-left">{segment.name}</span>
                        <span className="text-xs font-normal text-ink-500">
                          {segment.chapters.length === 1
                            ? "1 chapter"
                            : `${segment.chapters.length} chapters`}
                          {fileCount > 0 &&
                            ` · ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {segment.chapters.length === 0 ? (
                        <p className="py-1 text-sm text-ink-500">
                          No chapters listed yet.
                        </p>
                      ) : (
                        <ul className="space-y-2.5 py-1">
                          {segment.chapters.map((chapter) => (
                            <li key={chapter.id} className="text-sm">
                              <div className="flex items-center gap-2 text-ink-800">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary/60" />
                                <span className="font-medium">{chapter.name}</span>
                                {chapter.materials.length > 0 && (
                                  <span className="text-xs font-normal text-ink-500">
                                    {chapter.materials.length}{" "}
                                    {chapter.materials.length === 1
                                      ? "file"
                                      : "files"}
                                  </span>
                                )}
                              </div>

                              {chapter.materials.length > 0 && (
                                <ul className="ml-3.5 mt-1.5 space-y-1">
                                  {chapter.materials.map((m) =>
                                    m.url ? (
                                      <li key={m.id}>
                                        <a
                                          href={m.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="group inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-primary transition-colors hover:bg-brand-primary/5"
                                        >
                                          {materialIcon(m.materialType)}
                                          <span className="truncate underline-offset-2 group-hover:underline">
                                            {m.title}
                                          </span>
                                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                                        </a>
                                      </li>
                                    ) : (
                                      <li key={m.id}>
                                        <span className="inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-xs text-ink-400">
                                          {materialIcon(m.materialType)}
                                          <span className="truncate">
                                            {m.title}
                                          </span>
                                        </span>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        ))}
      </div>
    </section>
  );
}

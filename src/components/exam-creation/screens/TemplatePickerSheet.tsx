import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FilePlus2, LayoutTemplate, Search, Loader2 } from "lucide-react";
import { useExamTemplates } from "@/hooks/useExamTemplates";
import type { ExamTemplate } from "@/types/exam";

interface TemplatePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartFromScratch: () => void;
  onUseTemplate: (template: ExamTemplate) => void;
}

export function TemplatePickerSheet({
  open,
  onOpenChange,
  onStartFromScratch,
  onUseTemplate,
}: TemplatePickerSheetProps) {
  const [mode, setMode] = useState<"pick" | "template-list">("pick");
  const [search, setSearch] = useState("");
  const { data: templates = [], isLoading } = useExamTemplates();

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-hidden sm:max-w-2xl sm:mx-auto sm:rounded-t-2xl"
      >
        <SheetHeader className="mb-4">
          <SheetTitle>How do you want to start?</SheetTitle>
          <SheetDescription>
            Start from a blank canvas or reuse a saved template.
          </SheetDescription>
        </SheetHeader>

        {mode === "pick" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={onStartFromScratch}
              className="flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 min-h-[72px]"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <FilePlus2 className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold">Start from scratch</div>
                <div className="text-xs text-muted-foreground">
                  Build a fresh exam paper step by step.
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("template-list")}
              className="flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 min-h-[72px]"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LayoutTemplate className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold">Use a template</div>
                <div className="text-xs text-muted-foreground">
                  Pick from {templates.length} saved template
                  {templates.length === 1 ? "" : "s"}.
                </div>
              </div>
            </button>
          </div>
        ) : (
          <div className="flex h-[60vh] flex-col">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates..."
                className="min-h-[44px] pl-9"
              />
            </div>

            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No templates yet. Save an exam as a template from the Review
                  & Publish screen to reuse it later.
                </div>
              ) : (
                <ul className="space-y-2 pr-2">
                  {filtered.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onUseTemplate(t)}
                        className="flex w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 min-h-[56px]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{t.name}</div>
                          {t.description && (
                            <div className="truncate text-xs text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {t.isShared ? "Shared" : "Private"} · Updated{" "}
                            {new Date(t.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>

            <div className="pt-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] w-full"
                onClick={() => setMode("pick")}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

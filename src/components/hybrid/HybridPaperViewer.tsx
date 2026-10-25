import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  Eraser,
  Highlighter,
  Loader2,
  Minus,
  PenLine,
  Plus,
  RotateCw,
  SlidersHorizontal,
  Stamp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  AnnotationCoordinates,
  AnnotationType,
  HybridAnnotation,
  HybridSignedPage,
} from "@/hooks/useHybridEvaluation";

const ANNOTATION_TOOLS: Array<{
  id: AnnotationType;
  label: string;
  hint: string;
  icon: typeof Check;
}> = [
  { id: "tick", label: "Tick", hint: "Click on the sheet to place a ✓", icon: Check },
  { id: "cross", label: "Cross", hint: "Click on the sheet to place a ✗", icon: X },
  { id: "highlight", label: "Highlight", hint: "Drag a box over the part to highlight", icon: Highlighter },
  { id: "freehand", label: "Draw", hint: "Click and drag on the sheet to draw", icon: PenLine },
];

// ── Marks stamp tool (CBSE-style: stamp "Q1 · 0.5/1" onto the sheet) ────

export interface StampQuestion {
  id: string;
  number: string;
  max: number;
  /** Currently awarded marks, or null when unmarked. */
  current: number | null;
  /** Selectable mark steps for this question. */
  steps: number[];
  /** Largest selectable mark without breaching the exam total. */
  cap: number;
}

export interface ArmedStamp {
  questionId: string;
  marks: number;
  /** Display text stamped on the sheet, e.g. "Q1 · 0.5/1". */
  label: string;
}

export interface MarksToolProps {
  questions: StampQuestion[];
  armed: ArmedStamp | null;
  onArm: (stamp: ArmedStamp | null) => void;
  onPlace: (args: {
    pageNumber: number;
    pageId: string | null;
    x: number;
    y: number;
  }) => void;
}

const ANNOTATION_COLORS = [
  "#DC2626", // red (default teacher pen)
  "#FA9314", // SALCI orange
  "#249CA2", // SALCI teal
  "#16A34A", // green
  "#2563EB", // blue
  "#FACC15", // yellow
];

interface HybridPaperViewerProps {
  pages: HybridSignedPage[];
  annotations: HybridAnnotation[];
  activeQuestionId: string | null;
  activeTool: AnnotationType | null;
  activeColor: string;
  isLocked: boolean;
  /** When provided, the pen-tool cluster renders in the toolbar. */
  onToolChange?: (tool: AnnotationType | null) => void;
  onColorChange?: (color: string) => void;
  onClearQuestion?: () => void;
  /** When provided, the Marks stamp tool renders in the toolbar. */
  marksTool?: MarksToolProps;
  /**
   * Teacher feedback per question (questionId → note). When a marks stamp's
   * question has a note, the stamp grows an ⓘ button — hover or tap it to
   * read the note. Shown to both teacher and student views.
   */
  questionNotes?: Record<string, string>;
  onCreateAnnotation: (args: {
    pageNumber: number;
    pageId: string | null;
    annotationType: AnnotationType;
    coordinates: AnnotationCoordinates;
    color: string;
    textContent?: string | null;
  }) => void;
  onDeleteAnnotation: (id: string) => void;
  onRotatePage?: (args: { pageId: string; nextRotation: number }) => void;
}

type DrawState =
  | { kind: "idle" }
  | { kind: "rect"; pageId: string | null; pageNumber: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "free"; pageId: string | null; pageNumber: number; points: Array<{ x: number; y: number }> };

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

/**
 * Renders the full uploaded answer sheet as a stack of pages with a
 * transparent annotation overlay. Tool-aware: drag for freehand and
 * single-click for tick/cross.
 *
 * Annotations are filtered to the active question — switching questions
 * shows a different overlay set.
 */
export function HybridPaperViewer({
  pages,
  annotations,
  activeQuestionId,
  activeTool,
  activeColor,
  isLocked,
  onToolChange,
  onColorChange,
  onClearQuestion,
  marksTool,
  questionNotes,
  onCreateAnnotation,
  onDeleteAnnotation,
  onRotatePage,
}: HybridPaperViewerProps) {
  const [zoom, setZoom] = useState(1);
  // Width actually available to a page, measured rather than assumed. The page
  // used to render at a hard-coded min(naturalWidth, 720)px, so on a 375px
  // phone the sheet was simply cut off at the right edge and the teacher could
  // not see the answers. At zoom 100% a page now fits the screen; zooming in
  // is how you inspect detail, which is what zoom is for.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      // Subtract the wrapper padding (p-3 phone / p-6 from sm) so the page is
      // never wider than the space left inside it.
      const pad = window.innerWidth >= 640 ? 48 : 24;
      setFitWidth(Math.max(240, el.clientWidth - pad));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [draw, setDraw] = useState<DrawState>({ kind: "idle" });
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const toolsDisabled = isLocked || !activeQuestionId;
  const activeToolMeta = ANNOTATION_TOOLS.find((t) => t.id === activeTool);
  const imageFilter =
    brightness !== 100 || contrast !== 100
      ? `brightness(${brightness}%) contrast(${contrast}%)`
      : undefined;

  const filteredAnnotations = useMemo(
    () =>
      annotations.filter(
        (a) => a.question_id === activeQuestionId || activeQuestionId === null,
      ),
    [annotations, activeQuestionId],
  );

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, HybridAnnotation[]>();
    filteredAnnotations.forEach((a) => {
      const list = map.get(a.page_number) ?? [];
      list.push(a);
      map.set(a.page_number, list);
    });
    return map;
  }, [filteredAnnotations]);

  const handleZoomDelta = (delta: number) =>
    setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));

  const jumpToPage = (pageNumber: number) =>
    pageRefs.current
      .get(pageNumber)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex h-full flex-col">
      {/* Single toolbar: pen tools (segmented) · color · erase · hint | adjust · zoom · pages */}
      {/* Scrolls sideways rather than overflowing. At 375px the tools, colour,
          erase, Marks picker and the zoom/page group cannot fit on one line,
          and letting them overflow gave the whole PAGE a horizontal scrollbar.
          Every control stays reachable by swiping the strip. */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {onToolChange && (
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background">
              {ANNOTATION_TOOLS.map(({ id, label, hint, icon: Icon }, i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToolChange(activeTool === id ? null : id)}
                  disabled={toolsDisabled}
                  title={hint}
                  className={cn(
                    "flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
                    i > 0 && "border-l border-border",
                    activeTool === id
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {onColorChange && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={toolsDisabled}
                    title="Pen color"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-border"
                      style={{ backgroundColor: activeColor }}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="flex items-center gap-1.5">
                    {ANNOTATION_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onColorChange(c)}
                        className={cn(
                          "h-6 w-6 rounded-full border-2 transition-transform",
                          activeColor === c
                            ? "scale-110 border-foreground"
                            : "border-transparent hover:scale-105",
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Pen color ${c}`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {onClearQuestion && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={onClearQuestion}
                disabled={toolsDisabled}
                title="Remove every pen mark on this question"
              >
                <Eraser className="mr-1 h-3.5 w-3.5" />
                Erase
              </Button>
            )}
          </div>
        )}
        {marksTool && (
          <MarksStampPicker
            questions={marksTool.questions}
            armed={marksTool.armed}
            onArm={marksTool.onArm}
            disabled={isLocked}
          />
        )}
        {marksTool?.armed && !isLocked ? (
          <span className="hidden truncate text-[11px] text-primary xl:inline">
            Click on the sheet to stamp {marksTool.armed.label}
          </span>
        ) : (
          activeToolMeta &&
          !toolsDisabled && (
            <span className="hidden truncate text-[11px] text-primary xl:inline">
              {activeToolMeta.hint}
            </span>
          )
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Adjust brightness & contrast"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60" align="end">
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Brightness</span>
                    <span className="tabular-nums text-muted-foreground">
                      {brightness}%
                    </span>
                  </div>
                  <Slider
                    min={50}
                    max={150}
                    step={5}
                    value={[brightness]}
                    onValueChange={(v) => setBrightness(v[0])}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Contrast</span>
                    <span className="tabular-nums text-muted-foreground">
                      {contrast}%
                    </span>
                  </div>
                  <Slider
                    min={50}
                    max={150}
                    step={5}
                    value={[contrast]}
                    onValueChange={(v) => setContrast(v[0])}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={brightness === 100 && contrast === 100}
                  onClick={() => {
                    setBrightness(100);
                    setContrast(100);
                  }}
                >
                  Reset
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => handleZoomDelta(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => handleZoomDelta(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {pages.length > 1 && (
            <div className="ml-2 flex items-center gap-1">
              {pages.map((p) => (
                <button
                  key={p.page_id}
                  type="button"
                  onClick={() => jumpToPage(p.page_number)}
                  title={`Go to page ${p.page_number}`}
                  className="flex h-6 min-w-6 items-center justify-center rounded border border-border bg-background px-1 text-[11px] font-medium tabular-nums text-foreground hover:border-primary/50 hover:text-primary"
                >
                  {p.page_number}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable stack */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-muted/40">
        {pages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No pages uploaded yet
          </div>
        ) : (
          // Tighter padding on a phone: p-6 spent 48px of a 375px screen on
          // margin around a sheet the teacher is trying to read.
          // min-w-fit, NOT mx-auto + w-fit: a fit-content box with auto side
          // margins resolves them EQUAL AND NEGATIVE once it outgrows its
          // container, which puts the left edge of a zoomed page outside the
          // scrollable area for good. This centers while it fits and grows
          // with the content after that, so zooming stays reversible.
          <div className="flex min-w-fit flex-col items-center gap-4 p-3 sm:gap-6 sm:p-6">
            {pages.map((page) => (
              <div
                key={page.page_id}
                ref={(el) => {
                  if (el) pageRefs.current.set(page.page_number, el);
                  else pageRefs.current.delete(page.page_number);
                }}
              >
                <PageWithOverlay
                  page={page}
                  zoom={zoom}
                  fitWidth={fitWidth}
                  imageFilter={imageFilter}
                  pageAnnotations={annotationsByPage.get(page.page_number) ?? []}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  isLocked={isLocked}
                  activeQuestionId={activeQuestionId}
                  stampArmed={!!marksTool?.armed}
                  onPlaceStamp={marksTool?.onPlace}
                  questionNotes={questionNotes}
                  draw={draw}
                  setDraw={setDraw}
                  onCreateAnnotation={onCreateAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onRotatePage={onRotatePage}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Marks stamp picker (questions → that question's marks) ─────────────

function MarksStampPicker({
  questions,
  armed,
  onArm,
  disabled,
}: {
  questions: StampQuestion[];
  armed: ArmedStamp | null;
  onArm: (stamp: ArmedStamp | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<StampQuestion | null>(null);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSelected(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Stamp a question's marks onto the sheet"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            armed
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground hover:bg-muted",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <Stamp className="h-3.5 w-3.5" />
          Marks
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {selected === null ? (
          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold text-foreground">
              Stamp marks for which question?
            </div>
            {armed && (
              <button
                type="button"
                onClick={() => {
                  onArm(null);
                  setOpen(false);
                }}
                className="mb-1 flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel stamping {armed.label}
              </button>
            )}
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {questions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelected(q)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span className="font-semibold text-foreground">{q.number}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {q.current !== null
                      ? `${q.current} / ${q.max}`
                      : `${q.max} mark${q.max === 1 ? "" : "s"}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="mb-1.5 flex items-center rounded-md px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="mr-0.5 h-3.5 w-3.5" />
              All questions
            </button>
            <div className="px-1 text-xs font-semibold text-foreground">
              {selected.number} · choose the marks
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1 pb-1">
              {selected.steps.map((s) => {
                const isCurrent =
                  selected.current !== null &&
                  Math.abs(selected.current - s) < 1e-9;
                const isBlocked = s > selected.cap + 1e-9 && !isCurrent;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={isBlocked}
                    title={
                      isBlocked
                        ? "This would push the total past the exam's maximum"
                        : `Stamp ${selected.number} · ${s}/${selected.max}`
                    }
                    onClick={() => {
                      onArm({
                        questionId: selected.id,
                        marks: s,
                        label: `${selected.number} · ${s}/${selected.max}`,
                      });
                      setOpen(false);
                      setSelected(null);
                    }}
                    className={cn(
                      "h-9 min-w-[44px] rounded-md border px-2.5 text-sm font-bold tabular-nums transition-colors",
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-primary/50",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Single page ────────────────────────────────────────────────────────

interface PageWithOverlayProps {
  page: HybridSignedPage;
  zoom: number;
  /** Measured width of the scroll area, or null before the first measure. */
  fitWidth: number | null;
  imageFilter?: string;
  pageAnnotations: HybridAnnotation[];
  activeTool: AnnotationType | null;
  activeColor: string;
  isLocked: boolean;
  activeQuestionId: string | null;
  stampArmed: boolean;
  onPlaceStamp?: MarksToolProps["onPlace"];
  questionNotes?: Record<string, string>;
  draw: DrawState;
  setDraw: (s: DrawState) => void;
  onCreateAnnotation: HybridPaperViewerProps["onCreateAnnotation"];
  onDeleteAnnotation: (id: string) => void;
  onRotatePage?: HybridPaperViewerProps["onRotatePage"];
}

function PageWithOverlay({
  page,
  zoom,
  fitWidth,
  imageFilter,
  pageAnnotations,
  activeTool,
  activeColor,
  isLocked,
  activeQuestionId,
  stampArmed,
  onPlaceStamp,
  questionNotes,
  draw,
  setDraw,
  onCreateAnnotation,
  onDeleteAnnotation,
  onRotatePage,
}: PageWithOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const aspect = naturalSize ? naturalSize.h / naturalSize.w : 4 / 3;
  // Fit the space we actually have, capped at 720 on a wide screen so a huge
  // phone photo does not render past a readable size, and floored at 240 so a
  // page stays a page in a narrow split. zoom multiplies this, so 100% means
  // "the full width of the sheet is on screen" and zooming in is how the
  // teacher inspects the handwriting.
  const isSideways = page.rotation_degrees % 180 !== 0;
  const widthCap = Math.min(fitWidth ?? 720, 720);
  // A sideways page presents its HEIGHT as its on-screen width, so its fit
  // budget is the available width divided by the aspect.
  const fitCap = isSideways ? widthCap / aspect : widthCap;
  const baseWidth = naturalSize ? Math.min(naturalSize.w, fitCap) : fitCap;
  const renderedWidth = Math.max(isSideways ? 240 / aspect : 240, baseWidth) * zoom;
  const renderedHeight = renderedWidth * aspect;
  // The overlay viewBox matches the page's aspect (width fixed at 100 units,
  // height = 100 × aspect) so shapes and text render UNIFORMLY. A square
  // 0-100 viewBox stretched over a portrait page distorted everything
  // vertically. Normalized y-coords are multiplied by vbH, not 100.
  const vbH = 100 * aspect;

  // ── Pointer → normalized coords ──────────────────────────────────
  // React's PointerEvent extends MouseEvent, so this reads clientX/clientY
  // from mouse, touch and stylus alike without branching.
  const coordsFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    },
    [],
  );

  // Highlight and Draw are the two drag-based tools; Tick, Cross and the marks
  // stamp all place on a single tap. Only the drag pair needs the browser to
  // stop treating the gesture as a scroll.
  const needsDragGesture =
    !isLocked &&
    !!activeQuestionId &&
    (activeTool === "highlight" || activeTool === "freehand");

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isLocked || !activeTool || !activeQuestionId) return;
    const { x, y } = coordsFromEvent(e);
    if (activeTool === "highlight") {
      setDraw({
        kind: "rect",
        pageId: page.page_id,
        pageNumber: page.page_number,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
      });
    } else if (activeTool === "freehand") {
      setDraw({
        kind: "free",
        pageId: page.page_id,
        pageNumber: page.page_number,
        points: [{ x, y }],
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draw.kind === "idle") return;
    const { x, y } = coordsFromEvent(e);
    if (draw.kind === "rect" && draw.pageNumber === page.page_number) {
      setDraw({ ...draw, x2: x, y2: y });
    } else if (draw.kind === "free" && draw.pageNumber === page.page_number) {
      setDraw({ ...draw, points: [...draw.points, { x, y }] });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    // Armed marks stamp places on plain click, before everything else.
    if (stampArmed && onPlaceStamp) {
      if (isLocked) return;
      const { x, y } = coordsFromEvent(e);
      onPlaceStamp({
        pageNumber: page.page_number,
        pageId: page.page_id,
        x,
        y,
      });
      return;
    }

    // Single-click tools (tick / cross / note) place on plain click. They set
    // no drag state, so this MUST run before the draw.kind idle guard below —
    // gating them behind it silently disabled all three (only the drag tools
    // ever populated `draw`).
    if (activeTool === "tick" || activeTool === "cross" || activeTool === "comment") {
      if (isLocked || !activeQuestionId) return;
      const { x, y } = coordsFromEvent(e);
      if (activeTool === "comment") {
        const text = window.prompt("Type your note", "");
        if (!text) return;
        onCreateAnnotation({
          pageNumber: page.page_number,
          pageId: page.page_id,
          annotationType: "comment",
          coordinates: { x, y },
          color: activeColor,
          textContent: text,
        });
      } else {
        onCreateAnnotation({
          pageNumber: page.page_number,
          pageId: page.page_id,
          annotationType: activeTool,
          coordinates: { x, y },
          color: activeColor,
        });
      }
      return;
    }

    if (draw.kind === "idle") return;
    if (draw.pageNumber !== page.page_number) return;
    if (draw.kind === "rect") {
      const x1 = Math.min(draw.x1, draw.x2);
      const y1 = Math.min(draw.y1, draw.y2);
      const x2 = Math.max(draw.x1, draw.x2);
      const y2 = Math.max(draw.y1, draw.y2);
      const minSize = 0.01;
      if (x2 - x1 >= minSize && y2 - y1 >= minSize) {
        onCreateAnnotation({
          pageNumber: page.page_number,
          pageId: page.page_id,
          annotationType: "highlight",
          coordinates: { x1, y1, x2, y2 },
          color: activeColor,
        });
      }
    } else if (draw.kind === "free") {
      const points = draw.points;
      if (points.length >= 2) {
        onCreateAnnotation({
          pageNumber: page.page_number,
          pageId: page.page_id,
          annotationType: "freehand",
          coordinates: { points },
          color: activeColor,
        });
      }
    }
    setDraw({ kind: "idle" });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Page {page.page_number}</span>
        {onRotatePage && !isLocked && (
          <button
            type="button"
            onClick={() =>
              onRotatePage({
                pageId: page.page_id,
                nextRotation: (page.rotation_degrees + 90) % 360,
              })
            }
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground"
            title="Rotate 90°"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        )}
      </div>
      <div
        className="relative overflow-hidden rounded-md border border-border bg-white shadow-sm"
        style={{
          // Swap dimensions when the page is rotated sideways so the
          // container hugs the visible (rotated) bounds.
          width: page.rotation_degrees % 180 === 0 ? renderedWidth : renderedHeight,
          height: page.rotation_degrees % 180 === 0 ? renderedHeight : renderedWidth,
        }}
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: renderedWidth,
            height: renderedHeight,
            transform: `translate(-50%, -50%) rotate(${page.rotation_degrees}deg)`,
            transformOrigin: "center center",
          }}
        >
          {page.signed_url ? (
            <img
              src={page.signed_url}
              alt={`Page ${page.page_number}`}
              className="absolute inset-0 h-full w-full select-none"
              draggable={false}
              style={imageFilter ? { filter: imageFilter } : undefined}
              onLoad={(e) =>
                setNaturalSize({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {/* Transparent annotation surface (rotates with the image so
              normalised annotation coords stay aligned to the ink). */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{
              cursor:
                !isLocked && (stampArmed || (activeTool && activeQuestionId))
                  ? "crosshair"
                  : "default",
              // Only steal the touch gesture while a DRAG tool is armed.
              // Unconditional "none" would make the sheet impossible to pan or
              // scroll on a phone, which is how the teacher reads it.
              touchAction: needsDragGesture ? "none" : undefined,
            }}
            // POINTER events, not mouse. A finger drag emits touchmove and
            // never mousemove, so on a phone the old onMouseMove wiring left
            // Highlight and Draw silently dead: mousedown opened a shape,
            // nothing extended it, and mouseup committed a zero-size
            // annotation. Pointer events cover mouse, touch and stylus.
            onPointerDown={(e) => {
              // Capture so a drag that leaves the overlay (or the page scrolls
              // under it) still delivers move/up to this element.
              if (needsDragGesture) e.currentTarget.setPointerCapture(e.pointerId);
              handleMouseDown(e);
            }}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
            onPointerCancel={() => {
              // Touch drags can be cancelled by a system gesture; drop the
              // in-progress shape rather than committing a partial one.
              if (draw.kind !== "idle" && draw.pageNumber === page.page_number) setDraw({ kind: "idle" });
            }}
            onPointerLeave={() => {
              if (draw.kind !== "idle" && draw.pageNumber === page.page_number) setDraw({ kind: "idle" });
            }}
          >
          <svg
            viewBox={`0 0 100 ${vbH}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={{ pointerEvents: "none" }}
          >
            {/* Persisted annotations */}
            {pageAnnotations.map((a) => (
              <PersistedAnnotation
                key={a.id}
                annotation={a}
                onDelete={onDeleteAnnotation}
                isLocked={isLocked}
                vbH={vbH}
                note={
                  a.question_id ? questionNotes?.[a.question_id] ?? null : null
                }
              />
            ))}

            {/* In-flight rect preview */}
            {draw.kind === "rect" && draw.pageNumber === page.page_number && (
              <rect
                x={Math.min(draw.x1, draw.x2) * 100}
                y={Math.min(draw.y1, draw.y2) * vbH}
                width={Math.abs(draw.x2 - draw.x1) * 100}
                height={Math.abs(draw.y2 - draw.y1) * vbH}
                fill={activeColor}
                fillOpacity={0.18}
                stroke={activeColor}
                strokeWidth={0.4}
              />
            )}

            {/* In-flight freehand preview */}
            {draw.kind === "free" && draw.pageNumber === page.page_number && draw.points.length > 1 && (
              <polyline
                points={draw.points.map((p) => `${p.x * 100},${p.y * vbH}`).join(" ")}
                fill="none"
                stroke={activeColor}
                strokeWidth={0.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>
        </div>
      </div>
    </div>
  );
}

// ── Marks stamp badge (+ ⓘ note tooltip) ────────────────────────────────

function MarksStampAnnotation({
  annotation,
  onDelete,
  isDeletable,
  note,
  vbH,
}: {
  annotation: HybridAnnotation;
  onDelete: (id: string) => void;
  isDeletable: boolean;
  note: string | null;
  vbH: number;
}) {
  // Hover shows the note; tap/click pins it (students on touch screens have
  // no hover). x is in 0–100 units, y in 0–vbH units (aspect-correct).
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const showNote = !!note && (hovered || pinned);

  const c = annotation.coordinates;
  const color = annotation.color;
  const x = (c.x ?? 0) * 100;
  const y = (c.y ?? 0) * vbH;
  const label = annotation.text_content ?? "";
  const w = Math.max(10, label.length * 1.9 + 3.5);

  // ⓘ sits just past the badge's right edge.
  const infoCx = x + w + 2.4;
  const infoCy = y;

  // Tooltip box: clamp inside the page, flip below when near the top.
  const TIP_W = 46;
  const charsPerLine = 30;
  const lines = note ? Math.min(6, Math.ceil(note.length / charsPerLine)) : 1;
  const tipH = lines * 3.3 + 3;
  const tipX = Math.max(1, Math.min(infoCx - TIP_W / 2, 99 - TIP_W));
  const tipAbove = infoCy - tipH - 3 >= 1;
  const tipY = tipAbove
    ? infoCy - tipH - 2.6
    : Math.min(infoCy + 3, Math.max(1, vbH - tipH - 1));

  return (
    <g>
      {/* Badge — click deletes (teacher view only). */}
      <g
        style={{ pointerEvents: "auto", cursor: isDeletable ? "pointer" : "default" }}
        onClick={(e) => {
          e.stopPropagation();
          if (isDeletable) onDelete(annotation.id);
        }}
      >
        <rect
          x={x}
          y={y - 2.7}
          width={w}
          height={5.4}
          rx={1.2}
          fill="#fff"
          fillOpacity={0.92}
          stroke={color}
          strokeWidth={0.35}
        />
        <text
          x={x + w / 2}
          y={y}
          fill={color}
          fontSize="3"
          fontWeight="bold"
          textAnchor="middle"
          dy="1"
        >
          {label}
        </text>
      </g>

      {/* ⓘ note button — hover or tap to read the teacher's feedback. */}
      {note && (
        <g
          style={{ pointerEvents: "auto", cursor: "help" }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            setPinned((p) => !p);
          }}
        >
          {/* Invisible oversized hit area so the ⓘ is easy to press on
              phones — the visible dot alone is far below a finger's size. */}
          <circle cx={infoCx} cy={infoCy} r={5} fill="transparent" />
          <circle cx={infoCx} cy={infoCy} r={1.9} fill={color} />
          <text
            x={infoCx}
            y={infoCy}
            fill="#fff"
            fontSize="2.6"
            fontWeight="bold"
            fontStyle="italic"
            textAnchor="middle"
            dy="0.9"
          >
            i
          </text>
        </g>
      )}

      {/* Note tooltip */}
      {showNote && (
        <foreignObject
          x={tipX}
          y={tipY}
          width={TIP_W}
          height={tipH}
          style={{ pointerEvents: "none", overflow: "visible" }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              background: "#ffffff",
              border: `0.3px solid ${color}`,
              borderRadius: "1px",
              padding: "1px 1.5px",
              fontSize: "2.3px",
              lineHeight: 1.35,
              color: "#1f2937",
              overflow: "hidden",
              wordBreak: "break-word",
            }}
          >
            {note}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ── Persisted annotation renderer ───────────────────────────────────────

function PersistedAnnotation({
  annotation,
  onDelete,
  isLocked,
  note,
  vbH,
}: {
  annotation: HybridAnnotation;
  onDelete: (id: string) => void;
  isLocked: boolean;
  /** Teacher feedback for this annotation's question (marks stamps only). */
  note?: string | null;
  /** viewBox height (100 × page aspect) — y-coords scale by this. */
  vbH: number;
}) {
  const c = annotation.coordinates;
  const color = annotation.color;
  const isDeletable = !isLocked;

  switch (annotation.annotation_type) {
    case "highlight": {
      const x = Math.min(c.x1 ?? 0, c.x2 ?? 0) * 100;
      const y = Math.min(c.y1 ?? 0, c.y2 ?? 0) * vbH;
      const w = Math.abs((c.x2 ?? 0) - (c.x1 ?? 0)) * 100;
      const h = Math.abs((c.y2 ?? 0) - (c.y1 ?? 0)) * vbH;
      return (
        <g style={{ pointerEvents: isDeletable ? "auto" : "none" }}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={color}
            fillOpacity={0.22}
            stroke={color}
            strokeWidth={0.4}
          />
          {isDeletable && (
            <g
              transform={`translate(${x + w - 2}, ${y - 0.5})`}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(annotation.id);
              }}
            >
              <circle r={1.6} fill="#000" />
              <text fill="#fff" fontSize="2" textAnchor="middle" dy="0.6">×</text>
            </g>
          )}
        </g>
      );
    }
    case "tick":
      return (
        <text
          x={(c.x ?? 0) * 100}
          y={(c.y ?? 0) * vbH}
          fill={color}
          fontSize="6"
          fontWeight="bold"
          dy="2"
          style={{ pointerEvents: "auto", cursor: isDeletable ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            if (isDeletable) onDelete(annotation.id);
          }}
        >
          ✓
        </text>
      );
    case "cross":
      return (
        <text
          x={(c.x ?? 0) * 100}
          y={(c.y ?? 0) * vbH}
          fill={color}
          fontSize="6"
          fontWeight="bold"
          dy="2"
          style={{ pointerEvents: "auto", cursor: isDeletable ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            if (isDeletable) onDelete(annotation.id);
          }}
        >
          ✗
        </text>
      );
    case "comment":
      return (
        <g
          style={{ pointerEvents: "auto", cursor: isDeletable ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            if (isDeletable) onDelete(annotation.id);
          }}
        >
          <circle cx={(c.x ?? 0) * 100} cy={(c.y ?? 0) * vbH} r={2} fill={color} />
          <text
            x={(c.x ?? 0) * 100}
            y={(c.y ?? 0) * vbH}
            fill="#fff"
            fontSize="2.2"
            fontWeight="bold"
            textAnchor="middle"
            dy="0.7"
          >
            !
          </text>
        </g>
      );
    case "marks_stamp":
      return (
        <MarksStampAnnotation
          annotation={annotation}
          onDelete={onDelete}
          isDeletable={isDeletable}
          note={note ?? null}
          vbH={vbH}
        />
      );
    case "freehand": {
      const pts = c.points ?? [];
      if (pts.length < 2) return null;
      return (
        <polyline
          points={pts.map((p) => `${p.x * 100},${p.y * vbH}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={0.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "auto", cursor: isDeletable ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            if (isDeletable) onDelete(annotation.id);
          }}
        />
      );
    }
    default:
      return null;
  }
}

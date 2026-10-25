import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { MathfieldElement } from "mathlive";
import { cn } from "@/lib/utils";

export interface MathFieldHandle {
  /** Insert a LaTeX snippet at the caret (`#?` marks a fill-in box). */
  insert: (latex: string) => void;
  focus: () => void;
  getValue: () => string;
}

interface MathFieldProps {
  /** Starting LaTeX (set once on mount). */
  initialValue?: string;
  onChange?: (latex: string) => void;
  onEnter?: () => void;
  className?: string;
}

// Lazy-load MathLive once; it registers the <math-field> element and injects
// its styles. Fonts are served from /public (Vite bundles the lib, so the
// library's own auto-detect can't find them).
type MathfieldCtor = typeof import("mathlive").MathfieldElement;
let mathlivePromise: Promise<MathfieldCtor> | null = null;
function loadMathlive(): Promise<MathfieldCtor> {
  if (!mathlivePromise) {
    mathlivePromise = import("mathlive").then((mod) => {
      mod.MathfieldElement.fontsDirectory = "/mathlive/fonts";
      mod.MathfieldElement.soundsDirectory = null;
      return mod.MathfieldElement;
    });
  }
  return mathlivePromise;
}

/**
 * Thin React wrapper around MathLive's `<math-field>` — a WYSIWYG math editor
 * with fill-in placeholder boxes the author types directly into. Created
 * imperatively to avoid custom-element/JSX prop pitfalls in React 18.
 */
export const MathField = forwardRef<MathFieldHandle, MathFieldProps>(
  function MathField({ initialValue = "", onChange, onEnter, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const elRef = useRef<MathfieldElement | null>(null);
    const onChangeRef = useRef(onChange);
    const onEnterRef = useRef(onEnter);
    const initialRef = useRef(initialValue);
    const [loading, setLoading] = useState(true);

    onChangeRef.current = onChange;
    onEnterRef.current = onEnter;

    useEffect(() => {
      let active = true;
      let teardown = () => {};
      loadMathlive().then((MFE) => {
        if (!active || !containerRef.current) return;
        const el = new MFE();
        el.value = initialRef.current;
        el.mathVirtualKeyboardPolicy = "auto"; // mobile gets the math keyboard
        el.style.width = "100%";

        const handleInput = () => onChangeRef.current?.(el.value);
        const handleKeydown = (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnterRef.current?.();
          }
        };
        el.addEventListener("input", handleInput);
        el.addEventListener("keydown", handleKeydown);
        containerRef.current.appendChild(el);
        elRef.current = el;
        setLoading(false);
        requestAnimationFrame(() => el.focus());

        teardown = () => {
          el.removeEventListener("input", handleInput);
          el.removeEventListener("keydown", handleKeydown);
          el.remove();
          elRef.current = null;
        };
      });
      return () => {
        active = false;
        teardown();
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        insert: (latex: string) => {
          const el = elRef.current;
          if (!el) return;
          el.focus();
          el.insert(latex, { focus: true, selectionMode: "placeholder" });
        },
        focus: () => elRef.current?.focus(),
        getValue: () => elRef.current?.value ?? "",
      }),
      []
    );

    return (
      <div className={cn("math-field-host", className)} ref={containerRef}>
        {loading && (
          <div className="flex min-h-[56px] items-center justify-center text-sm text-muted-foreground">
            Loading editor…
          </div>
        )}
      </div>
    );
  }
);

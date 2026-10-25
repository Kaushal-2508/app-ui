import { Label } from "@/components/ui/label";
import { QuestionImageUpload } from "@/components/ui/question-image-upload";

interface DiagramFieldProps {
  /** Current diagram URL, or null when the question has none. */
  imageUrl: string | null;
  /** Called with the new public URL, or null when the diagram is removed. */
  onChange: (url: string | null) => void;
  /** Overrides the default "Diagram (optional)" caption. */
  label?: string;
}

/**
 * Diagram upload row shared by EVERY manual question form.
 *
 * MCQ and True/False shipped with a hand-rolled copy of this block while the
 * other five forms had none, so a teacher writing a fill-in-the-blank, a
 * numerical, a match-the-columns, a subjective or a comprehension question had
 * no way to attach the figure the question refers to. Keep new forms on this
 * component rather than re-inlining the markup, so the label, spacing and
 * upload behaviour stay identical across types.
 *
 * Renders a plain <Label> (not <FormLabel>) on purpose: this row is not bound
 * to a react-hook-form field, so it must not depend on FormField/FormItem
 * context to render.
 */
export function DiagramField({
  imageUrl,
  onChange,
  label = "Diagram (optional)",
}: DiagramFieldProps) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <QuestionImageUpload imageUrl={imageUrl} onImageChange={onChange} />
    </div>
  );
}

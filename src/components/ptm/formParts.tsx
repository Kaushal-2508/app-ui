import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

/**
 * The pieces the two PTM forms share: the in-person sheet (PTMFormSheet) and
 * the residential one (ResidentialPTMSheet). Moved out of PTMFormSheet on
 * 2026-10-03 so both read the same; the markup is unchanged. The option
 * lists live in ./formOptions.
 */

/** A setting inside a section: title, one line of help and an optional
 *  control (a switch) on the right. */
export function SettingRow({
  htmlFor,
  title,
  description,
  control,
}: {
  htmlFor: string;
  title: string;
  description: string;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-ink-900">
          {title}
        </Label>
        <p className="mt-1 text-xs text-ink-500">{description}</p>
      </div>
      {control && <div className="shrink-0 pt-1">{control}</div>}
    </div>
  );
}

/** One group of the form, flat on the sheet: a tinted icon and a title, then
 *  its fields. The form's divide-y draws the line between groups. */
export function FormSection({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section className="space-y-3 py-5 first:pt-1 last:pb-1">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <span
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4",
            t.bg,
            t.fg,
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}
